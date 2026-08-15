#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const program = new Command();

// Load environment variables
require('dotenv').config();

// Package info
const pkg = require('../package.json');

// Check RPC configuration on startup - warn but don't exit
async function checkRpcConfig() {
  const { listNetworks } = require('./utils/networks');
  const networks = listNetworks();
  const configured = networks.filter(n => n.configured);
  
  if (configured.length === 0) {
    console.log(chalk.yellow('\n⚠️  No RPC URLs configured. Some commands may not work.'));
    console.log(chalk.gray('Run a transaction command to be prompted for an RPC URL.\n'));
  }
}

// Run async check before starting CLI
(async () => {
  await checkRpcConfig();
  
  program
    .name('ethnotary')
    .description('CLI for managing MultiSig accounts, transactions, and data queries across EVM networks')
    .version(pkg.version);

  // Global options available to all commands
  program
    .option('--json', 'Output in JSON format (machine-readable)')
    .option('--private-key <key>', 'Use this private key directly')
    .option('--network <name>', 'Network to use (defaults to all contract networks for data commands)')
    .option('--yes', 'Skip all confirmation prompts')
    .option('--dry-run', 'Simulate without executing');

  // Register command groups
  program.addCommand(require('./commands/wallet'));
  program.addCommand(require('./commands/account'));
  program.addCommand(require('./commands/tx'));
  program.addCommand(require('./commands/data'));
  program.addCommand(require('./commands/contract'));
  program.addCommand(require('./commands/contact'));
  program.addCommand(require('./commands/config'));

  // Top-level shortcuts (like git)
  const { setDefaultContract, getDefaultContract, listContracts } = require('./utils/contracts');
  
  // ethnotary checkout <alias> - shortcut for contract checkout
  program
    .command('checkout <alias>')
    .description('Switch to a different contract (like git checkout)')
    .action((alias) => {
      try {
        setDefaultContract(alias);
        const current = getDefaultContract();
        console.log(chalk.green(`✓ Switched to "${alias}"`));
        console.log(chalk.gray(`  Address: ${current.address}`));
        console.log(chalk.gray(`  Network: ${current.network}`));
      } catch (error) {
        console.log(chalk.red(`✗ ${error.message}`));
        process.exit(1);
      }
    });

  // ethnotary status - show current contract (like git status)
  program
    .command('status')
    .description('Show the currently active contract')
    .action(() => {
      const current = getDefaultContract();
      if (current) {
        // Migrate old format if needed
        const networks = current.networks || (current.network ? [current.network] : []);
        console.log(chalk.cyan(`On account: ${chalk.bold(current.alias)}`));
        console.log(chalk.gray(`  Address: ${current.address}`));
        console.log(chalk.gray(`  Networks: ${networks.join(', ') || 'none'}`));
        if (current.label) console.log(chalk.gray(`  Label: ${current.label}`));
      } else {
        console.log(chalk.yellow('No contract checked out.'));
        console.log(chalk.gray('Use "ethnotary checkout <alias>" to switch to a contract.'));
        const contracts = listContracts();
        if (contracts.length > 0) {
          console.log(chalk.gray(`\nAvailable contracts: ${contracts.map(c => c.alias).join(', ')}`));
        }
      }
    });

  // ethnotary list - list all saved contracts
  program
    .command('list')
    .description('List all saved contracts')
    .action(() => {
      const contracts = listContracts();
      const current = getDefaultContract();
      const opts = program.opts();
      
      if (opts.json) {
        console.log(JSON.stringify({
          count: contracts.length,
          current: current?.alias || null,
          contracts
        }, null, 2));
        return;
      }

      if (contracts.length === 0) {
        console.log(chalk.yellow('No contracts saved.'));
        console.log(chalk.gray('Use "ethnotary add" to save a contract.'));
        return;
      }

      console.log(chalk.bold(`\nSaved Contracts (${contracts.length}):\n`));
      for (const c of contracts) {
        const isActive = current && current.alias === c.alias;
        const marker = isActive ? chalk.green('* ') : '  ';
        const name = isActive ? chalk.green.bold(c.alias) : c.alias;
        console.log(`${marker}${name}`);
        console.log(chalk.gray(`    Address: ${c.address}`));
        // Support both old (network) and new (networks) format
        const networks = c.networks || (c.network ? [c.network] : []);
        console.log(chalk.gray(`    Networks: ${networks.join(', ')}`));
        if (c.label) console.log(chalk.gray(`    Label: ${c.label}`));
        if (c.decoupledFrom) console.log(chalk.yellow(`    ⚠️  Decoupled from: ${c.decoupledFrom}`));
      }
      console.log('');
    });

  // ethnotary add - save a contract (shortcut for contract add)
  const { saveContract, removeContract } = require('./utils/contracts');
  const { validateNetwork, ensureRpcConfigured, validateNetworks, ensureRpcsConfigured } = require('./utils/networks');
  const { ethers } = require('ethers');

  program
    .command('add')
    .description('Save a contract with an alias')
    .requiredOption('--alias <alias>', 'Alias for the contract')
    .requiredOption('--address <address>', 'Contract address')
    .option('--chain-id <chainIds>', 'Chain ID(s), comma-separated (alternative to --network)')
    .option('--label <label>', 'Optional label/description')
    .option('--skip-validation', 'Skip Ethnotary contract validation')
    .action(async (options) => {
      const opts = program.opts();
      try {
        if (!ethers.isAddress(options.address)) {
          console.log(chalk.red(`✗ Invalid address: ${options.address}`));
          process.exit(1);
        }

        // Resolve network(s) from --network or --chain-id (supports comma-separated)
        const networkIdentifier = options.chainId || opts.network;
        if (!networkIdentifier) {
          console.log(chalk.red('✗ Either --network or --chain-id is required'));
          process.exit(1);
        }

        // Check if multiple networks
        const isMultiple = networkIdentifier.includes(',');
        
        if (isMultiple) {
          // Multi-network add - validates on each network, saves under single alias
          const networks = validateNetworks(networkIdentifier);
          if (!networks) {
            process.exit(1);
          }

          // Ensure all RPCs are configured
          const networksWithRpc = await ensureRpcsConfigured(networks, { json: opts.json });
          if (!networksWithRpc) {
            process.exit(1);
          }

          if (!opts.json) {
            console.log(chalk.cyan(`\nValidating contract on ${networksWithRpc.length} networks...\n`));
          }

          const validNetworks = [];
          const failedNetworks = [];
          
          for (const { key, config, rpc } of networksWithRpc) {
            // Validate contract on this network
            if (!options.skipValidation) {
              if (!opts.json) {
                console.log(chalk.gray(`Validating on ${config.name}...`));
              }
              
              const provider = new ethers.JsonRpcProvider(rpc);
              const contract = new ethers.Contract(
                options.address,
                ['function isEthnotaryMultiSig() external view returns (bool)'],
                provider
              );

              try {
                const isValid = await contract.isEthnotaryMultiSig();
                if (!isValid) {
                  console.log(chalk.red(`✗ Contract not found or invalid on ${config.name}`));
                  failedNetworks.push(key);
                  continue;
                }
                if (!opts.json) {
                  console.log(chalk.green(`✓ Valid on ${config.name}`));
                }
              } catch (err) {
                console.log(chalk.red(`✗ Contract not found or invalid on ${config.name}`));
                failedNetworks.push(key);
                continue;
              }
            }
            validNetworks.push(key);
          }

          if (validNetworks.length === 0) {
            console.log(chalk.red('\n✗ Contract not valid on any of the specified networks'));
            process.exit(1);
          }

          // Save contract with all valid networks under single alias
          const saved = saveContract(options.alias, options.address, validNetworks, options.label);

          if (opts.json) {
            console.log(JSON.stringify({
              alias: options.alias,
              address: options.address,
              networks: validNetworks,
              failedNetworks: failedNetworks,
              label: options.label || '',
              created: saved.created
            }, null, 2));
          } else {
            console.log(chalk.green(`\n✓ Contract saved as "${options.alias}"`));
            console.log(chalk.gray(`  Address: ${options.address}`));
            console.log(chalk.gray(`  Networks: ${validNetworks.join(', ')}`));
            if (failedNetworks.length > 0) {
              console.log(chalk.yellow(`  Failed: ${failedNetworks.join(', ')}`));
            }
          }
        } else {
          // Single network add
          const resolved = validateNetwork(networkIdentifier);
          if (!resolved) {
            process.exit(1);
          }

          const rpc = await ensureRpcConfigured(resolved.key, resolved.config, { json: opts.json });
          if (!rpc) {
            process.exit(1);
          }

          // Validate that this is an Ethnotary MultiSig contract
          if (!options.skipValidation) {
            if (!opts.json) {
              console.log(chalk.gray('Validating Ethnotary contract...'));
            }
            
            const provider = new ethers.JsonRpcProvider(rpc);
            const contract = new ethers.Contract(
              options.address,
              ['function isEthnotaryMultiSig() external view returns (bool)'],
              provider
            );

            try {
              const isValid = await contract.isEthnotaryMultiSig();
              if (!isValid) {
                console.log(chalk.red(`✗ Contract at ${options.address} is not a valid Ethnotary MultiSig`));
                console.log(chalk.yellow('\nPlease double-check your contract address.'));
                console.log(chalk.gray('To create a new Ethnotary MultiSig, run:'));
                console.log(chalk.white('  ethnotary create --owners <addr1,addr2,...> --required <number> --pin <pin> --name <name>'));
                process.exit(1);
              }
            } catch (err) {
              console.log(chalk.red(`✗ Contract at ${options.address} is not a valid Ethnotary MultiSig`));
              console.log(chalk.yellow('\nPlease double-check your contract address.'));
              console.log(chalk.gray('To create a new Ethnotary MultiSig, run:'));
              console.log(chalk.white('  ethnotary create --owners <addr1,addr2,...> --required <number> --pin <pin> --name <name>'));
              process.exit(1);
            }
          }

          const saved = saveContract(options.alias, options.address, resolved.key, options.label);

          if (opts.json) {
            console.log(JSON.stringify({
              alias: options.alias,
              address: options.address,
              network: resolved.key,
              chainId: resolved.config.chainId,
              label: options.label || '',
              created: saved.created
            }, null, 2));
          } else {
            console.log(chalk.green(`✓ Contract saved as "${options.alias}"`));
            console.log(chalk.gray(`  Address: ${options.address}`));
            console.log(chalk.gray(`  Network: ${resolved.config.name} (${resolved.key})`));
            console.log(chalk.gray(`  Chain ID: ${resolved.config.chainId}`));
          }
        }
      } catch (error) {
        console.log(chalk.red(`✗ ${error.message}`));
        process.exit(1);
      }
    });

  // ethnotary remove - remove a saved contract (shortcut for contract remove)
  program
    .command('remove <alias>')
    .description('Remove a saved contract')
    .action((alias) => {
      const opts = program.opts();
      try {
        removeContract(alias);
        if (opts.json) {
          console.log(JSON.stringify({ alias, status: 'removed' }, null, 2));
        } else {
          console.log(chalk.green(`✓ Contract "${alias}" removed`));
        }
      } catch (error) {
        console.log(chalk.red(`✗ ${error.message}`));
        process.exit(1);
      }
    });

  // ethnotary create - shortcut for account create
  program
    .command('create')
    .description('Deploy a new MultiSig account (shortcut for account create)')
    .requiredOption('--owners <addresses>', 'Comma-separated list of owner addresses')
    .requiredOption('--required <number>', 'Number of required confirmations', parseInt)
    .requiredOption('--pin <pin>', 'PIN for account management')
    .requiredOption('--name <name>', 'Name for the MultiSig account')
    .option('--chain-id <chainIds>', 'Chain ID(s), comma-separated (alternative to --network)')
    .action(async (options) => {
      const opts = program.opts();
      const { ethers } = require('ethers');
      const { getWallet } = require('./utils/auth');
      const { computePinHash } = require('./utils/pin');
      const { listContracts, removeContract } = require('./utils/contracts');
      const { MSA_FACTORY_ABI, getFactoryAddress } = require('./utils/constants');
      
      // Resolve network(s) from --network or --chain-id
      const networkIdentifier = options.chainId || opts.network;
      if (!networkIdentifier) {
        console.log(chalk.red('✗ Either --network or --chain-id is required'));
        process.exit(1);
      }

      // Parse owners
      const owners = options.owners.split(',').map(addr => addr.trim());
      for (const owner of owners) {
        if (!ethers.isAddress(owner)) {
          console.log(chalk.red(`✗ Invalid owner address: ${owner}`));
          process.exit(1);
        }
      }

      if (options.required < 1 || options.required > owners.length) {
        console.log(chalk.red(`✗ Required confirmations must be between 1 and ${owners.length}`));
        process.exit(1);
      }

      // Parse networks
      const networkKeys = networkIdentifier.split(',').map(n => n.trim());
      const networksToProcess = [];
      
      for (const netKey of networkKeys) {
        const resolved = validateNetwork(netKey);
        if (!resolved) {
          process.exit(1);
        }
        networksToProcess.push(resolved);
      }

      // Ensure all RPCs are configured
      const networksWithRpc = await ensureRpcsConfigured(
        networksToProcess.map(n => n),
        { json: opts.json }
      );
      if (!networksWithRpc) {
        process.exit(1);
      }

      // Get wallet ONCE (single password prompt)
      let wallet;
      try {
        wallet = await getWallet(opts);
      } catch (err) {
        console.log(chalk.red(`✗ ${err.message}`));
        process.exit(1);
      }

      // Compute PIN hash
      const pinHash = computePinHash(options.pin);

      // Run pre-flight / dry-run across all networks
      if (!opts.json) {
        console.log(chalk.cyan(`\n📋 Pre-flight Check for ${networksWithRpc.length} network(s)...\n`));
      }

      const preflightResults = [];
      for (const { key, config, rpc } of networksWithRpc) {
        try {
          const provider = new ethers.JsonRpcProvider(rpc);
          const signer = wallet.connect(provider);
          
          const factoryAddress = getFactoryAddress(key);
          const factory = new ethers.Contract(factoryAddress, MSA_FACTORY_ABI, signer);
          
          // Predict address
          let predictedAddress = null;
          let lastPredictErr = null;
          for (let attempt = 0; attempt < 3 && !predictedAddress; attempt++) {
            try {
              predictedAddress = await factory.predictMSAAddress(owners, options.required, pinHash, options.name);
            } catch (e) {
              lastPredictErr = e;
              if (attempt < 2) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
            }
          }
          if (!predictedAddress) {
            // Last-resort fallback: if factory bytecode is present on-chain, treat the chain
            // as available even though the view call kept failing (Hashio relay flake, etc.)
            try {
              const code = await provider.getCode(factoryAddress);
              if (code && code !== '0x') {
                predictedAddress = '0x' + '0'.repeat(40); // sentinel; will skip "already deployed" check
              }
            } catch {}
            if (process.env.ETHNOTARY_DEBUG && lastPredictErr) {
              console.log(chalk.gray(`    debug predict err on ${key} @ ${factoryAddress}: ${lastPredictErr.shortMessage || lastPredictErr.message}`));
            }
          }
          
          // Check if already deployed
          let alreadyDeployed = false;
          if (predictedAddress) {
            const code = await provider.getCode(predictedAddress);
            alreadyDeployed = code !== '0x';
          }
          
          // Get wallet balance and estimate gas
          const balance = await provider.getBalance(wallet.address);
          const feeData = await provider.getFeeData();
          const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('20', 'gwei');
          const estimatedGas = 500000n; // Approximate gas for deployment
          const deploymentFee = 1000000000000000n; // 0.001 ETH
          const estimatedCost = (estimatedGas * gasPrice) + deploymentFee;
          const sufficient = balance >= estimatedCost;
          
          preflightResults.push({
            network: key,
            networkName: config.name,
            rpc,
            predictedAddress,
            alreadyDeployed,
            balance: ethers.formatEther(balance),
            estimatedCost: ethers.formatEther(estimatedCost),
            sufficient,
            ready: sufficient && !alreadyDeployed && predictedAddress !== null,
            error: predictedAddress === null ? 'Factory not deployed or not responding' : null
          });
          
          if (!opts.json) {
            if (alreadyDeployed) {
              console.log(chalk.yellow(`  ⚠ ${config.name}: Already deployed at ${predictedAddress}`));
            } else if (!predictedAddress) {
              console.log(chalk.red(`  ✗ ${config.name}: Factory not available`));
            } else if (!sufficient) {
              console.log(chalk.red(`  ✗ ${config.name}: Insufficient balance`));
              console.log(chalk.gray(`      Balance: ${ethers.formatEther(balance)} ETH`));
              console.log(chalk.gray(`      Required: ~${ethers.formatEther(estimatedCost)} ETH`));
            } else {
              console.log(chalk.green(`  ✓ ${config.name}: Ready`));
              console.log(chalk.gray(`      Predicted: ${predictedAddress}`));
              console.log(chalk.gray(`      Balance: ${ethers.formatEther(balance)} ETH`));
              console.log(chalk.gray(`      Est. cost: ~${ethers.formatEther(estimatedCost)} ETH`));
            }
          }
        } catch (err) {
          preflightResults.push({
            network: key,
            networkName: config.name,
            ready: false,
            error: err.message
          });
          if (!opts.json) {
            console.log(chalk.red(`  ✗ ${config.name}: ${err.message}`));
          }
        }
      }

      const readyNetworks = preflightResults.filter(r => r.ready);
      const notReadyNetworks = preflightResults.filter(r => !r.ready);

      if (readyNetworks.length === 0) {
        console.log(chalk.red('\n✗ No networks ready for deployment'));
        process.exit(1);
      }

      // Show summary and single confirmation
      if (!opts.json && !opts.yes) {
        console.log(chalk.cyan('\n📝 Deployment Summary:\n'));
        console.log(chalk.gray(`  Name: ${options.name}`));
        console.log(chalk.gray(`  Owners: ${owners.join(', ')}`));
        console.log(chalk.gray(`  Required: ${options.required}`));
        console.log(chalk.gray(`  Networks ready: ${readyNetworks.map(r => r.network).join(', ')}`));
        if (notReadyNetworks.length > 0) {
          console.log(chalk.yellow(`  Networks skipped: ${notReadyNetworks.map(r => r.network).join(', ')}`));
        }
        if (readyNetworks[0]?.predictedAddress) {
          console.log(chalk.gray(`  Predicted address: ${readyNetworks[0].predictedAddress}`));
        }
        console.log('');
        
        const inquirer = require('inquirer');
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: `Deploy to ${readyNetworks.length} network(s)?`,
          default: true
        }]);
        if (!confirm) {
          console.log(chalk.yellow('Deployment cancelled'));
          process.exit(0);
        }
      }

      // Dry run - just show results
      if (opts.dryRun) {
        if (opts.json) {
          console.log(JSON.stringify({
            dryRun: true,
            name: options.name,
            owners,
            required: options.required,
            networks: preflightResults
          }, null, 2));
        } else {
          console.log(chalk.cyan('\n✓ Dry run complete. No deployments made.'));
        }
        process.exit(0);
      }

      // Execute deployments
      const successfulNetworks = [];
      const failedNetworks = [];
      let deployedAddress = null;

      for (const result of readyNetworks) {
        const { network: key, networkName, rpc, predictedAddress } = result;
        
        if (!opts.json) {
          console.log(chalk.cyan(`\n📡 Deploying to ${networkName}...`));
        }

        try {
          const provider = new ethers.JsonRpcProvider(rpc);
          const signer = wallet.connect(provider);
          
          const factoryAddress = getFactoryAddress(key);
          const factory = new ethers.Contract(factoryAddress, MSA_FACTORY_ABI, signer);

          // notaryFee in the factory is 9999999999 (≈10^10) and the contract checks
          // `msg.value <= notaryFee` (strict greater-than required).
          // On Hedera, `msg.value` is reported in TINYBAR (1 HBAR = 10^8 tinybar), not
          // wei — so the contract sees msg.value = HBAR_sent * 10^8. To clear the check
          // we need > 99.99 HBAR. Send 150 HBAR for headroom. The factory owner is the
          // CREATE2Factory contract on Hedera (immutable), so the fee cannot be changed.
          // Also: Hashio's eth_estimateGas drops `value` causing simulated reverts —
          // skip estimation by setting an explicit gasLimit.
          const isHedera = key === 'hedera-testnet';
          const fee = isHedera ? 150_000_000_000_000_000_000n /* 150 HBAR */ : 1_000_000_000_000_000n /* 0.001 ETH */;
          const txOverrides = { value: fee };
          if (isHedera) {
            txOverrides.gasLimit = 3_000_000n;
          }

          const tx = await factory.newMSA(owners, options.required, pinHash, options.name, txOverrides);
          
          if (!opts.json) {
            console.log(chalk.gray(`  Transaction: ${tx.hash}`));
          }

          const receipt = await tx.wait();
          
          // Get deployed address from event or use predicted
          let actualAddress = null;
          for (const log of receipt.logs) {
            try {
              const parsed = factory.interface.parseLog(log);
              if (parsed && parsed.name === 'NewMSACreated') {
                // The event has a single indexed address parameter
                actualAddress = parsed.args.msaAddress || parsed.args[0];
                break;
              }
            } catch (e) {
              // Log might be from a different contract, try parsing the topic directly
              // NewMSACreated(address indexed msaAddress) - topic[1] contains the address
              if (log.topics && log.topics.length >= 2) {
                const eventSig = ethers.id('NewMSACreated(address)');
                if (log.topics[0] === eventSig) {
                  actualAddress = ethers.getAddress('0x' + log.topics[1].slice(26));
                  break;
                }
              }
            }
          }
          
          // Fallback to predicted address if event parsing failed
          if (!actualAddress) {
            actualAddress = predictedAddress;
          }

          if (!deployedAddress && actualAddress) {
            deployedAddress = actualAddress;
          }

          successfulNetworks.push(key);
          
          if (!opts.json) {
            console.log(chalk.green(`  ✓ Deployed to ${actualAddress}`));
          }
        } catch (err) {
          failedNetworks.push({ network: key, error: err.message });
          if (!opts.json) {
            console.log(chalk.red(`  ✗ Failed: ${err.message}`));
          }
        }
      }

      // Save contract with all successful networks
      if (successfulNetworks.length > 0 && deployedAddress) {
        saveContract(options.name, deployedAddress, successfulNetworks);
      }

      // Final summary
      if (!opts.json) {
        if (successfulNetworks.length > 0) {
          console.log(chalk.green(`\n✓ Deployed to ${successfulNetworks.length}/${readyNetworks.length} network(s)`));
          console.log(chalk.gray(`  Alias: ${options.name}`));
          console.log(chalk.gray(`  Address: ${deployedAddress}`));
          console.log(chalk.gray(`  Networks: ${successfulNetworks.join(', ')}`));
          if (failedNetworks.length > 0) {
            console.log(chalk.yellow(`  Failed: ${failedNetworks.map(f => f.network).join(', ')}`));
          }
        } else {
          console.log(chalk.red('\n✗ Deployment failed on all networks'));
        }
      } else {
        console.log(JSON.stringify({
          address: deployedAddress,
          alias: options.name,
          networks: successfulNetworks,
          failed: failedNetworks
        }, null, 2));
      }
    });

  // Parse arguments
  program.parse(process.argv);

  // Show help if no command provided
  if (!process.argv.slice(2).length) {
    program.outputHelp();
  }
})();
