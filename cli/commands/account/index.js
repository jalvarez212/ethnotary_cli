const { Command } = require('commander');
const { ethers } = require('ethers');
const { createOutput } = require('../../utils/output');
const { getWallet } = require('../../utils/auth');
const { getNetwork, getRpcUrl } = require('../../utils/networks');
const { computePinHash, generateZkProof } = require('../../utils/pin');
const { saveContract, resolveAddress, getContractNetworks, getContract, getDefaultContract } = require('../../utils/contracts');
const { fetchAccountStateAcrossNetworks, analyzeAccountSync, handleDecoupling, preflightAccountOperation, displayPreflightResults } = require('../../utils/crosschain');
const { MULTISIG_ABI, MSA_FACTORY_ABI, getFactoryAddress } = require('../../utils/constants');

const account = new Command('account')
  .description('Account management commands');

// account create - Deploy new MultiSig account
account
  .command('create')
  .description('Deploy a new MultiSig account')
  .requiredOption('--owners <addresses>', 'Comma-separated list of owner addresses')
  .requiredOption('--required <number>', 'Number of required confirmations', parseInt)
  .requiredOption('--pin <pin>', 'PIN for account management')
  .requiredOption('--name <name>', 'Name for the MultiSig account')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      // Parse owners
      const owners = options.owners.split(',').map(addr => addr.trim());
      for (const owner of owners) {
        if (!ethers.isAddress(owner)) {
          out.error(`Invalid owner address: ${owner}`);
          return;
        }
      }

      if (options.required < 1 || options.required > owners.length) {
        out.error(`Required confirmations must be between 1 and ${owners.length}`);
        return;
      }

      // Get wallet
      const wallet = await getWallet(globalOpts);
      
      // Get network
      const network = await getNetwork(globalOpts.network);
      const provider = new ethers.JsonRpcProvider(network.rpc);
      const signer = wallet.connect(provider);

      // Compute PIN hash
      const pinHash = computePinHash(options.pin);
      
      // Account name (use alias if provided, otherwise default)
      const accountName = options.name || options.saveAs || 'MultiSig';

      // Get factory address from centralized config
      const factoryAddress = getFactoryAddress(globalOpts.network);
      const factory = new ethers.Contract(factoryAddress, MSA_FACTORY_ABI, signer);

      // Predict address
      out.startSpinner('Predicting contract address...');
      let predictedAddress;
      try {
        predictedAddress = await factory.predictMSAAddress(owners, options.required, pinHash, accountName);
        out.updateSpinner(`Predicted address: ${predictedAddress}`);
      } catch (e) {
        out.failSpinner('Could not predict address');
      }

      // Check if already deployed
      if (predictedAddress) {
        const code = await provider.getCode(predictedAddress);
        if (code !== '0x') {
          out.stopSpinner();
          out.print({
            address: predictedAddress,
            status: 'already_deployed',
            network: globalOpts.network
          });
          return;
        }
      }

      // Confirm if not --yes
      if (!globalOpts.yes && !globalOpts.json) {
        out.stopSpinner();
        out.info(`Deploying MultiSig to ${network.name}`);
        out.info(`Name: ${accountName}`);
        out.info(`Owners: ${owners.join(', ')}`);
        out.info(`Required: ${options.required}`);
        out.info(`Predicted address: ${predictedAddress || 'unknown'}`);
        
        const inquirer = require('inquirer');
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: 'Proceed with deployment?',
          default: true
        }]);
        if (!confirm) {
          out.warn('Deployment cancelled');
          return;
        }
      }

      // Dry run check
      if (globalOpts.dryRun) {
        out.print({
          dryRun: true,
          predictedAddress,
          owners,
          required: options.required,
          network: globalOpts.network,
          pinHash
        });
        return;
      }

      // Deploy
      out.startSpinner('Deploying MultiSig account...');
      const fee = 1000000000000000n; // 0.001 ETH

      const tx = await factory.newMSA(owners, options.required, pinHash, accountName, { value: fee });
      out.updateSpinner(`Transaction sent: ${tx.hash}`);

      const receipt = await tx.wait();
      
      // Find NewMSACreated event
      let deployedAddress = predictedAddress;
      const event = receipt.logs.find(log => {
        try {
          return factory.interface.parseLog(log)?.name === 'NewMSACreated';
        } catch { return false; }
      });

      if (event) {
        const parsed = factory.interface.parseLog(event);
        deployedAddress = parsed.args.msaAddress;
      }

      out.succeedSpinner('MultiSig deployed successfully');

      // Save contract with name as alias
      saveContract(accountName, deployedAddress, globalOpts.network);

      out.print({
        address: deployedAddress,
        txHash: receipt.hash,
        network: globalOpts.network,
        owners,
        required: options.required,
        name: accountName,
        alias: accountName
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// account info - Show account information
account
  .command('info')
  .description('Show account information (owners, required confirmations, balance)')
  .option('--address <address>', 'MultiSig address or alias')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const address = resolveAddress(options.address);
      const contractNetworks = getContractNetworks(options.address);
      const networksToQuery = contractNetworks.length > 0 ? contractNetworks : ['sepolia'];

      out.startSpinner('Fetching account info across all networks...');

      // Fetch balances from all networks in parallel
      const balancePromises = networksToQuery.map(async (networkKey) => {
        try {
          const network = await getNetwork(networkKey);
          const provider = new ethers.JsonRpcProvider(network.rpc);
          const balance = await provider.getBalance(address);
          return { network: networkKey, balance: ethers.formatEther(balance), raw: balance };
        } catch (e) {
          return { network: networkKey, balance: 'unavailable', error: e.message };
        }
      });

      // Get account details from first available network
      let owners = [];
      let required = 0;
      let primaryNetwork = null;

      for (const networkKey of networksToQuery) {
        try {
          const network = await getNetwork(networkKey);
          const provider = new ethers.JsonRpcProvider(network.rpc);
          const code = await provider.getCode(address);
          if (code !== '0x') {
            const multisig = new ethers.Contract(address, MULTISIG_ABI, provider);
            [owners, required] = await Promise.all([
              multisig.getOwners(),
              multisig.required()
            ]);
            primaryNetwork = networkKey;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!primaryNetwork) {
        out.failSpinner('Contract not found on any network');
        return;
      }

      const balances = await Promise.all(balancePromises);
      const totalBalance = balances.reduce((sum, b) => {
        if (b.raw) return sum + b.raw;
        return sum;
      }, 0n);

      out.succeedSpinner('Account info retrieved');

      // Format balances object
      const balancesByNetwork = {};
      for (const b of balances) {
        balancesByNetwork[b.network] = b.error ? b.balance : `${b.balance} ETH`;
      }

      out.print({
        address,
        networks: networksToQuery,
        owners: owners.map(o => o),
        required: Number(required),
        ownerCount: owners.length,
        confirmationsNeeded: `${required} of ${owners.length}`,
        balances: balancesByNetwork,
        totalBalance: ethers.formatEther(totalBalance) + ' ETH'
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// account owners - List owners
account
  .command('owners')
  .description('List account owners')
  .option('--address <address>', 'MultiSig address or alias')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const address = resolveAddress(options.address);
      // Get first network from contract's networks, or use specified network
      const contractNetworks = getContractNetworks(options.address);
      const networkKey = globalOpts.network || contractNetworks[0] || 'sepolia';
      const network = await getNetwork(networkKey);
      const provider = new ethers.JsonRpcProvider(network.rpc);

      const multisig = new ethers.Contract(address, MULTISIG_ABI, provider);

      out.startSpinner('Fetching owners...');
      const [owners, required] = await Promise.all([
        multisig.getOwners(),
        multisig.required()
      ]);
      out.succeedSpinner('Owners retrieved');

      out.print({
        address,
        owners: owners.map(o => o),
        required: Number(required),
        total: owners.length
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// account add - Add owner (applies to all networks)
account
  .command('add')
  .description('Add a new owner to the account (applies to all configured networks)')
  .option('--address <address>', 'MultiSig address or alias')
  .requiredOption('--owner <ownerAddress>', 'Address of new owner to add')
  .requiredOption('--pin <pin>', 'PIN for authentication')
  .option('--force', 'Proceed even if pre-flight check fails')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      if (!ethers.isAddress(options.owner)) {
        out.error(`Invalid owner address: ${options.owner}`);
        return;
      }

      const address = resolveAddress(options.address);
      const wallet = await getWallet(globalOpts);
      
      // Get alias - either from options or from default contract
      const aliasOrAddress = options.address || (getDefaultContract()?.alias);
      const networks = getContractNetworks(aliasOrAddress);
      
      // Pre-flight check across all networks
      out.startSpinner('Running pre-flight checks across all networks...');
      const preflight = await preflightAccountOperation(
        aliasOrAddress,
        address,
        wallet.address,
        'addOwner',
        { owner: options.owner }
      );
      out.stopSpinner();
      
      displayPreflightResults(preflight, out);
      
      if (!preflight.canProceed && !options.force) {
        out.error('Pre-flight check failed. Use --force to proceed anyway.');
        out.print({
          preflightFailed: true,
          networks: preflight.networks
        });
        return;
      }
      
      if (!preflight.canProceed && options.force) {
        out.warn('Proceeding despite pre-flight failures (--force)');
      }

      if (globalOpts.dryRun) {
        out.print({
          dryRun: true,
          action: 'addOwner',
          address,
          newOwner: options.owner,
          networks,
          preflight: preflight.networks
        });
        return;
      }

      // Execute on all networks
      const results = [];
      for (const networkKey of networks) {
        try {
          const rpc = getRpcUrl(networkKey);
          if (!rpc) {
            results.push({ network: networkKey, success: false, error: 'No RPC configured' });
            continue;
          }
          
          const provider = new ethers.JsonRpcProvider(rpc);
          const signer = wallet.connect(provider);
          const multisig = new ethers.Contract(address, MULTISIG_ABI, signer);

          // Check if already owner on this network
          const isAlreadyOwner = await multisig.isOwner(options.owner);
          if (isAlreadyOwner) {
            results.push({ network: networkKey, success: true, status: 'already_owner' });
            continue;
          }

          out.startSpinner(`Adding owner on ${networkKey}...`);
          
          const [storedPinHash, pinNonce] = await Promise.all([
            multisig.pinHash(),
            multisig.pinNonce()
          ]);
          
          const { pA, pB, pC } = await generateZkProof(options.pin, storedPinHash, pinNonce, wallet.address);
          
          const tx = await multisig.addOwner(options.owner, pA, pB, pC);
          await tx.wait();
          
          out.succeedSpinner(`Owner added on ${networkKey}`);
          results.push({ network: networkKey, success: true, txHash: tx.hash });
        } catch (err) {
          out.failSpinner(`Failed on ${networkKey}: ${err.message}`);
          results.push({ network: networkKey, success: false, error: err.message });
        }
      }

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success);
      
      // Handle decoupling if some networks failed
      if (failed.length > 0) {
        handleDecoupling(aliasOrAddress, address, failed, out);
      }

      out.print({
        address,
        owner: options.owner,
        networksProcessed: networks.length,
        successful,
        failed: failed.length,
        results,
        status: failed.length === 0 ? 'added' : 'partially_added'
      });

      // Force exit since snarkjs keeps handles open
      process.exit(0);

    } catch (error) {
      out.error(error.message);
      process.exit(1);
    }
  });

// account remove - Remove owner (applies to all networks)
account
  .command('remove')
  .description('Remove an owner from the account (applies to all configured networks)')
  .option('--address <address>', 'MultiSig address or alias')
  .requiredOption('--owner <ownerAddress>', 'Address of owner to remove')
  .requiredOption('--pin <pin>', 'PIN for authentication')
  .option('--force', 'Proceed even if pre-flight check fails')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      if (!ethers.isAddress(options.owner)) {
        out.error(`Invalid owner address: ${options.owner}`);
        return;
      }

      const address = resolveAddress(options.address);
      const wallet = await getWallet(globalOpts);
      
      // Get alias - either from options or from default contract
      const aliasOrAddress = options.address || (getDefaultContract()?.alias);
      const networks = getContractNetworks(aliasOrAddress);
      
      // Pre-flight check across all networks
      out.startSpinner('Running pre-flight checks across all networks...');
      const preflight = await preflightAccountOperation(
        aliasOrAddress,
        address,
        wallet.address,
        'removeOwner',
        { owner: options.owner }
      );
      out.stopSpinner();
      
      displayPreflightResults(preflight, out);
      
      if (!preflight.canProceed && !options.force) {
        out.error('Pre-flight check failed. Use --force to proceed anyway.');
        out.print({
          preflightFailed: true,
          networks: preflight.networks
        });
        return;
      }
      
      if (!preflight.canProceed && options.force) {
        out.warn('Proceeding despite pre-flight failures (--force)');
      }

      if (globalOpts.dryRun) {
        out.print({
          dryRun: true,
          action: 'removeOwner',
          address,
          owner: options.owner,
          networks,
          preflight: preflight.networks
        });
        return;
      }

      // Execute on all networks
      const results = [];
      for (const networkKey of networks) {
        try {
          const rpc = getRpcUrl(networkKey);
          if (!rpc) {
            results.push({ network: networkKey, success: false, error: 'No RPC configured' });
            continue;
          }
          
          const provider = new ethers.JsonRpcProvider(rpc);
          const signer = wallet.connect(provider);
          const multisig = new ethers.Contract(address, MULTISIG_ABI, signer);

          // Check if owner exists on this network
          const isOwner = await multisig.isOwner(options.owner);
          if (!isOwner) {
            results.push({ network: networkKey, success: true, status: 'not_owner' });
            continue;
          }

          out.startSpinner(`Removing owner on ${networkKey}...`);
          
          const [storedPinHash, pinNonce] = await Promise.all([
            multisig.pinHash(),
            multisig.pinNonce()
          ]);
          
          const { pA, pB, pC } = await generateZkProof(options.pin, storedPinHash, pinNonce, wallet.address);
          
          const tx = await multisig.removeOwner(options.owner, pA, pB, pC);
          await tx.wait();
          
          out.succeedSpinner(`Owner removed on ${networkKey}`);
          results.push({ network: networkKey, success: true, txHash: tx.hash });
        } catch (err) {
          out.failSpinner(`Failed on ${networkKey}: ${err.message}`);
          results.push({ network: networkKey, success: false, error: err.message });
        }
      }

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success);
      
      // Handle decoupling if some networks failed
      if (failed.length > 0) {
        handleDecoupling(aliasOrAddress, address, failed, out);
      }

      out.print({
        address,
        owner: options.owner,
        networksProcessed: networks.length,
        successful,
        failed: failed.length,
        results,
        status: failed.length === 0 ? 'removed' : 'partially_removed'
      });

      // Force exit since snarkjs keeps handles open
      process.exit(0);

    } catch (error) {
      out.error(error.message);
      process.exit(1);
    }
  });

// account replace - Replace owner (applies to all networks)
account
  .command('replace')
  .description('Replace an existing owner with a new one (applies to all configured networks)')
  .option('--address <address>', 'MultiSig address or alias')
  .requiredOption('--old <oldOwner>', 'Address of owner to replace')
  .requiredOption('--new <newOwner>', 'Address of new owner')
  .requiredOption('--pin <pin>', 'PIN for authentication')
  .option('--force', 'Proceed even if pre-flight check fails')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      if (!ethers.isAddress(options.old)) {
        out.error(`Invalid old owner address: ${options.old}`);
        return;
      }
      if (!ethers.isAddress(options.new)) {
        out.error(`Invalid new owner address: ${options.new}`);
        return;
      }

      const address = resolveAddress(options.address);
      const wallet = await getWallet(globalOpts);
      
      // Get alias - either from options or from default contract
      const aliasOrAddress = options.address || (getDefaultContract()?.alias);
      const networks = getContractNetworks(aliasOrAddress);
      
      // Pre-flight check across all networks
      out.startSpinner('Running pre-flight checks across all networks...');
      const preflight = await preflightAccountOperation(
        aliasOrAddress,
        address,
        wallet.address,
        'replaceOwner',
        { oldOwner: options.old, newOwner: options.new }
      );
      out.stopSpinner();
      
      displayPreflightResults(preflight, out);
      
      if (!preflight.canProceed && !options.force) {
        out.error('Pre-flight check failed. Use --force to proceed anyway.');
        out.print({
          preflightFailed: true,
          networks: preflight.networks
        });
        return;
      }
      
      if (!preflight.canProceed && options.force) {
        out.warn('Proceeding despite pre-flight failures (--force)');
      }

      if (globalOpts.dryRun) {
        out.print({
          dryRun: true,
          action: 'replaceOwner',
          address,
          oldOwner: options.old,
          newOwner: options.new,
          networks,
          preflight: preflight.networks
        });
        return;
      }

      // Execute on all networks
      const results = [];
      for (const networkKey of networks) {
        try {
          const rpc = getRpcUrl(networkKey);
          if (!rpc) {
            results.push({ network: networkKey, success: false, error: 'No RPC configured' });
            continue;
          }
          
          const provider = new ethers.JsonRpcProvider(rpc);
          const signer = wallet.connect(provider);
          const multisig = new ethers.Contract(address, MULTISIG_ABI, signer);

          out.startSpinner(`Replacing owner on ${networkKey}...`);
          
          const [storedPinHash, pinNonce] = await Promise.all([
            multisig.pinHash(),
            multisig.pinNonce()
          ]);
          
          const { pA, pB, pC } = await generateZkProof(options.pin, storedPinHash, pinNonce, wallet.address);
          
          const tx = await multisig.replaceOwner(options.old, options.new, pA, pB, pC);
          await tx.wait();
          
          out.succeedSpinner(`Owner replaced on ${networkKey}`);
          results.push({ network: networkKey, success: true, txHash: tx.hash });
        } catch (err) {
          out.failSpinner(`Failed on ${networkKey}: ${err.message}`);
          results.push({ network: networkKey, success: false, error: err.message });
        }
      }

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success);
      
      // Handle decoupling if some networks failed
      if (failed.length > 0) {
        handleDecoupling(aliasOrAddress, address, failed, out);
      }

      out.print({
        address,
        oldOwner: options.old,
        newOwner: options.new,
        networksProcessed: networks.length,
        successful,
        failed: failed.length,
        results,
        status: failed.length === 0 ? 'replaced' : 'partially_replaced'
      });

      // Force exit since snarkjs keeps handles open
      process.exit(0);

    } catch (error) {
      out.error(error.message);
      process.exit(1);
    }
  });

// account sync - Synchronize account state across all networks
account
  .command('sync')
  .description('Synchronize account owners and requirements across all networks')
  .option('--address <address>', 'MultiSig address or alias')
  .option('--dry-run', 'Show what would be synced without making changes')
  .requiredOption('--pin <pin>', 'PIN for authentication')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const address = resolveAddress(options.address);
      const networks = getContractNetworks(options.address);
      
      if (networks.length < 2) {
        out.info('Account is only configured for one network. Nothing to sync.');
        return;
      }

      out.startSpinner(`Checking account state across ${networks.length} networks...`);

      // Fetch state from all networks
      const states = await fetchAccountStateAcrossNetworks(options.address, address);
      const analysis = analyzeAccountSync(states);

      out.stopSpinner();

      if (analysis.inSync) {
        out.print({
          address,
          networks,
          status: 'in_sync',
          owners: analysis.canonical.owners,
          required: analysis.canonical.required,
          message: 'Account is in sync across all networks'
        });
        return;
      }

      // Show discrepancies
      if (!globalOpts.json) {
        const chalk = require('chalk');
        console.log(chalk.yellow('\n⚠️  Account is out of sync:\n'));
        console.log(chalk.gray(`Canonical state (${analysis.networkCount - analysis.discrepancies.length} networks):`));
        console.log(chalk.gray(`  Owners: ${analysis.canonical.owners.join(', ')}`));
        console.log(chalk.gray(`  Required: ${analysis.canonical.required}\n`));
        
        for (const d of analysis.discrepancies) {
          console.log(chalk.red(`Network: ${d.network}`));
          if (d.missingOwners.length > 0) {
            console.log(chalk.yellow(`  Missing owners: ${d.missingOwners.join(', ')}`));
          }
          if (d.extraOwners.length > 0) {
            console.log(chalk.yellow(`  Extra owners: ${d.extraOwners.join(', ')}`));
          }
          if (d.requirementMismatch) {
            console.log(chalk.yellow(`  Required: ${d.currentRequired} (should be ${analysis.canonical.required})`));
          }
        }
      }

      if (options.dryRun || globalOpts.dryRun) {
        out.print({
          dryRun: true,
          address,
          canonical: analysis.canonical,
          discrepancies: analysis.discrepancies
        });
        return;
      }

      // Confirm sync
      if (!globalOpts.yes && !globalOpts.json) {
        const inquirer = require('inquirer');
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: 'Proceed with synchronization?',
          default: false
        }]);
        if (!confirm) {
          out.warn('Sync cancelled');
          return;
        }
      }

      // Get wallet for signing
      const wallet = await getWallet(globalOpts);
      const results = [];

      // Sync each discrepant network
      for (const d of analysis.discrepancies) {
        out.startSpinner(`Syncing ${d.network}...`);
        
        try {
          const rpc = getRpcUrl(d.network);
          const provider = new ethers.JsonRpcProvider(rpc);
          const signer = wallet.connect(provider);
          const multisig = new ethers.Contract(address, MULTISIG_ABI, signer);

          // Get zkSNARK proof data
          const [storedPinHash, pinNonce] = await Promise.all([
            multisig.pinHash(),
            multisig.pinNonce()
          ]);

          // Add missing owners
          for (const owner of d.missingOwners) {
            out.updateSpinner(`Adding owner ${owner.slice(0, 10)}... on ${d.network}`);
            const { pA, pB, pC } = await generateZkProof(options.pin, storedPinHash, pinNonce, wallet.address);
            const tx = await multisig.addOwner(owner, pA, pB, pC);
            await tx.wait();
          }

          // Remove extra owners
          for (const owner of d.extraOwners) {
            out.updateSpinner(`Removing owner ${owner.slice(0, 10)}... on ${d.network}`);
            const { pA, pB, pC } = await generateZkProof(options.pin, storedPinHash, pinNonce, wallet.address);
            const tx = await multisig.removeOwner(owner, pA, pB, pC);
            await tx.wait();
          }

          // Fix requirement if needed
          if (d.requirementMismatch) {
            out.updateSpinner(`Updating requirement on ${d.network}`);
            const { pA, pB, pC } = await generateZkProof(options.pin, storedPinHash, pinNonce, wallet.address);
            const tx = await multisig.changeRequirement(analysis.canonical.required, pA, pB, pC);
            await tx.wait();
          }

          results.push({ network: d.network, success: true });
          out.succeedSpinner(`Synced ${d.network}`);
        } catch (err) {
          results.push({ network: d.network, success: false, error: err.message });
          out.failSpinner(`Failed to sync ${d.network}: ${err.message}`);
        }
      }

      const successful = results.filter(r => r.success).length;
      out.print({
        address,
        syncedNetworks: successful,
        totalDiscrepancies: analysis.discrepancies.length,
        results,
        status: successful === analysis.discrepancies.length ? 'fully_synced' : 'partially_synced'
      });

      // Force exit since snarkjs keeps handles open
      process.exit(0);

    } catch (error) {
      out.error(error.message);
      process.exit(1);
    }
  });

// account status - Check sync status across all networks
account
  .command('status')
  .description('Check account sync status across all configured networks')
  .option('--address <address>', 'MultiSig address or alias')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const address = resolveAddress(options.address);
      const networks = getContractNetworks(options.address);
      
      if (networks.length === 0) {
        out.warn('No networks configured for this contract.');
        return;
      }

      out.startSpinner(`Checking account state across ${networks.length} networks...`);

      const states = await fetchAccountStateAcrossNetworks(options.address, address);
      const analysis = analyzeAccountSync(states);

      out.stopSpinner();

      if (analysis.inSync) {
        if (!globalOpts.json) {
          const chalk = require('chalk');
          console.log(chalk.green('\n✓ Account is in sync across all networks\n'));
          console.log(chalk.gray(`Networks: ${networks.join(', ')}`));
          console.log(chalk.gray(`Owners: ${analysis.canonical.owners.length}`));
          console.log(chalk.gray(`Required: ${analysis.canonical.required}`));
        }
      } else {
        if (!globalOpts.json) {
          const chalk = require('chalk');
          console.log(chalk.yellow('\n⚠️  Account is OUT OF SYNC\n'));
          console.log(chalk.gray('Run "ethnotary account sync" to synchronize.'));
        }
      }

      out.print({
        address,
        networks,
        inSync: analysis.inSync,
        canonical: analysis.canonical,
        discrepancies: analysis.discrepancies,
        networkStates: states
      });

    } catch (error) {
      out.error(error.message);
    }
  });

module.exports = account;
