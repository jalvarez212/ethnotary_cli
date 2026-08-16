const { Command } = require('commander');
const { ethers } = require('ethers');
const { createOutput } = require('../../utils/output');
const { getWallet } = require('../../utils/auth');
const { getNetwork, getRpcUrl, validateNetwork } = require('../../utils/networks');
const { resolveAddress, getContractNetworks } = require('../../utils/contracts');
const { buildNotificationPayload, generateApprovalUrl, formatApprovalMessage } = require('../../utils/notifications');

/**
 * Get the network for a transaction command
 * If --network is specified, use that
 * Otherwise, prompt user to select from contract's configured networks
 */
async function getTransactionNetwork(aliasOrAddress, specifiedNetwork, globalOpts, out) {
  const contractNetworks = getContractNetworks(aliasOrAddress);
  
  if (specifiedNetwork) {
    // Use specified network
    const resolved = validateNetwork(specifiedNetwork);
    if (!resolved) {
      return null;
    }
    
    // Warn if not in contract's configured networks
    if (contractNetworks.length > 0 && !contractNetworks.includes(resolved.key)) {
      out.warn(`Contract is not configured for network: ${specifiedNetwork}`);
      out.info(`Configured networks: ${contractNetworks.join(', ')}`);
    }
    
    const rpc = getRpcUrl(resolved.key);
    if (!rpc) {
      out.error(`No RPC configured for ${resolved.key}. Run: ethnotary config rpc ${resolved.key}`);
      return null;
    }
    
    return { key: resolved.key, config: resolved.config, rpc };
  }
  
  // No network specified - need to prompt or error
  if (contractNetworks.length === 0) {
    out.error('No network specified and contract has no configured networks.');
    out.info('Use --network <network> to specify the target network.');
    return null;
  }
  
  if (contractNetworks.length === 1) {
    // Only one network - use it
    const key = contractNetworks[0];
    const resolved = validateNetwork(key);
    const rpc = getRpcUrl(key);
    if (!rpc) {
      out.error(`No RPC configured for ${key}. Run: ethnotary config rpc ${key}`);
      return null;
    }
    return { key, config: resolved.config, rpc };
  }
  
  // Multiple networks - prompt user to select (unless in JSON mode)
  if (globalOpts.json) {
    out.error('Multiple networks available. Use --network to specify which one.');
    out.info(`Available: ${contractNetworks.join(', ')}`);
    return null;
  }
  
  const inquirer = require('inquirer');
  const { selectedNetwork } = await inquirer.prompt([{
    type: 'list',
    name: 'selectedNetwork',
    message: 'Select target network:',
    choices: contractNetworks.map(n => ({ name: n, value: n }))
  }]);
  
  const resolved = validateNetwork(selectedNetwork);
  const rpc = getRpcUrl(selectedNetwork);
  if (!rpc) {
    out.error(`No RPC configured for ${selectedNetwork}. Run: ethnotary config rpc ${selectedNetwork}`);
    return null;
  }
  
  return { key: selectedNetwork, config: resolved.config, rpc };
}

// MultiSig ABI - transaction functions
const MULTISIG_ABI = [
  "function submitTransaction(address dest, uint256 value, bytes memory func) public returns (uint transactionId)",
  "function confirmTransaction(uint transactionId) public",
  "function execute(uint transactionId) public",
  "function revokeConfirmation(uint transactionId) public",
  "function isOwner(address) view returns (bool)",
  "function getOwners() view returns (address[])",
  "function transactions(uint) view returns (address dest, uint value, bytes func, bool executed, uint id)",
  "function confirmations(uint, address) view returns (bool)",
  "function getConfirmationCount(uint transactionId) view returns (uint count)",
  "function getConfirmations(uint transactionId) view returns (address[])",
  "function required() view returns (uint)",
  "function transactionCount() view returns (uint)",
  "function isConfirmed(uint transactionId) view returns (bool)",
  "event Submission(uint indexed transactionId, address dest, uint256 value, bytes func)",
  "event Confirmation(address indexed sender, uint indexed transactionId)",
  "event Execution(uint indexed transactionId)"
];

// ERC20 ABI for transfer
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)"
];

// ERC721 ABI for transfer
const ERC721_ABI = [
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)"
];

const tx = new Command('tx')
  .description('Transaction management commands');

// tx submit - Submit a new transaction
tx
  .command('submit')
  .description('Submit a new transaction to the MultiSig')
  .option('--address <address>', 'MultiSig address or alias')
  .option('--network <network>', 'Target network (prompts if not specified)')
  .requiredOption('--dest <destination>', 'Destination address')
  .option('--value <ethAmount>', 'ETH value to send', '0')
  .option('--data <hexData>', 'Transaction data (hex)', '0x')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      if (!ethers.isAddress(options.dest)) {
        out.error(`Invalid destination address: ${options.dest}`);
        return;
      }

      const address = resolveAddress(options.address);
      const wallet = await getWallet(globalOpts);
      
      // Get network - prompts if multiple networks and none specified
      const network = await getTransactionNetwork(options.address, options.network || globalOpts.network, globalOpts, out);
      if (!network) {
        return;
      }
      
      const provider = new ethers.JsonRpcProvider(network.rpc);
      const signer = wallet.connect(provider);

      const multisig = new ethers.Contract(address, MULTISIG_ABI, signer);

      // Verify caller is owner
      const isOwner = await multisig.isOwner(wallet.address);
      if (!isOwner) {
        out.error(`Address ${wallet.address} is not an owner of this MultiSig`);
        return;
      }

      // Hedera EVM stores HBAR value in tinybars (8 decimals) — not wei (18).
      // When the multisig later calls `target.call{value: txn.value}`, that value is
      // interpreted as tinybars on Hedera. Parsing as ether (10^18) would over-spend.
      const valueWei = (network.key === 'hedera-testnet')
        ? ethers.parseUnits(options.value, 8)
        : ethers.parseEther(options.value);

      if (globalOpts.dryRun) {
        out.print({
          dryRun: true,
          action: 'submitTransaction',
          multisig: address,
          destination: options.dest,
          value: options.value + ' ETH',
          data: options.data,
          network: globalOpts.network
        });
        return;
      }

      out.startSpinner('Submitting transaction...');
      const submitTx = await multisig.submitTransaction(options.dest, valueWei, options.data);
      out.updateSpinner(`Transaction sent: ${submitTx.hash}`);

      const receipt = await submitTx.wait();

      // Find transaction ID from Submission event
      let transactionId = null;
      for (const log of receipt.logs) {
        try {
          const parsed = multisig.interface.parseLog(log);
          if (parsed?.name === 'Submission') {
            transactionId = Number(parsed.args.transactionId);
            break;
          }
        } catch {}
      }

      out.succeedSpinner('Transaction submitted');

      // Get owners and required for notification data
      const [owners, required] = await Promise.all([
        multisig.getOwners(),
        multisig.required()
      ]);

      // Build notification payload for agents
      const notificationData = buildNotificationPayload({
        transactionId,
        network: network.key,
        contractAddress: address,
        destination: options.dest,
        value: options.value + ' ETH',
        data: options.data,
        confirmations: 1, // Submitter auto-confirms
        required: Number(required),
        owners: owners,
        senderAddress: wallet.address
      });

      out.print({
        multisig: address,
        network: network.key,
        transactionId,
        destination: options.dest,
        value: options.value + ' ETH',
        txHash: receipt.hash,
        status: 'submitted',
        confirmations: `1/${required}`,
        canExecute: Number(required) <= 1,
        approvalUrl: notificationData.approvalUrl,
        notifyOwners: notificationData.notifyOwners
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// tx confirm - Confirm a transaction
tx
  .command('confirm')
  .description('Confirm a pending transaction')
  .option('--address <address>', 'MultiSig address or alias')
  .option('--network <network>', 'Target network (prompts if not specified)')
  .requiredOption('--txid <transactionId>', 'Transaction ID to confirm', parseInt)
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const address = resolveAddress(options.address);
      const wallet = await getWallet(globalOpts);
      
      const network = await getTransactionNetwork(options.address, options.network || globalOpts.network, globalOpts, out);
      if (!network) return;
      
      const provider = new ethers.JsonRpcProvider(network.rpc);
      const signer = wallet.connect(provider);

      const multisig = new ethers.Contract(address, MULTISIG_ABI, signer);

      // Check if already confirmed (idempotent)
      const alreadyConfirmed = await multisig.confirmations(options.txid, wallet.address);
      if (alreadyConfirmed) {
        out.print({
          multisig: address,
          transactionId: options.txid,
          status: 'already_confirmed',
          message: 'You have already confirmed this transaction'
        });
        return;
      }

      if (globalOpts.dryRun) {
        out.print({
          dryRun: true,
          action: 'confirmTransaction',
          multisig: address,
          transactionId: options.txid,
          network: globalOpts.network
        });
        return;
      }

      out.startSpinner('Confirming transaction...');
      const confirmTx = await multisig.confirmTransaction(options.txid);
      out.updateSpinner(`Transaction sent: ${confirmTx.hash}`);

      await confirmTx.wait();

      // Check confirmation count
      const [confirmCount, required] = await Promise.all([
        multisig.getConfirmationCount(options.txid),
        multisig.required()
      ]);

      out.succeedSpinner('Transaction confirmed');

      out.print({
        multisig: address,
        transactionId: options.txid,
        txHash: confirmTx.hash,
        confirmations: `${confirmCount}/${required}`,
        canExecute: Number(confirmCount) >= Number(required),
        status: 'confirmed'
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// tx execute - Execute a confirmed transaction
tx
  .command('execute')
  .description('Execute a fully confirmed transaction')
  .option('--address <address>', 'MultiSig address or alias')
  .option('--network <network>', 'Target network (prompts if not specified)')
  .requiredOption('--txid <transactionId>', 'Transaction ID to execute', parseInt)
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const address = resolveAddress(options.address);
      const wallet = await getWallet(globalOpts);
      
      const network = await getTransactionNetwork(options.address, options.network || globalOpts.network, globalOpts, out);
      if (!network) return;
      
      const provider = new ethers.JsonRpcProvider(network.rpc);
      const signer = wallet.connect(provider);

      const multisig = new ethers.Contract(address, MULTISIG_ABI, signer);

      // Check if already executed (idempotent)
      const txData = await multisig.transactions(options.txid);
      if (txData.executed) {
        out.print({
          multisig: address,
          transactionId: options.txid,
          status: 'already_executed',
          message: 'Transaction has already been executed'
        });
        return;
      }

      // Check if confirmed
      const isConfirmed = await multisig.isConfirmed(options.txid);
      if (!isConfirmed) {
        const [confirmCount, required] = await Promise.all([
          multisig.getConfirmationCount(options.txid),
          multisig.required()
        ]);
        out.error(`Transaction not fully confirmed. Has ${confirmCount}/${required} confirmations.`);
        return;
      }

      if (globalOpts.dryRun) {
        out.print({
          dryRun: true,
          action: 'executeTransaction',
          multisig: address,
          transactionId: options.txid,
          network: globalOpts.network
        });
        return;
      }

      out.startSpinner('Executing transaction...');
      // Hashio (Hedera) often fails eth_estimateGas with require(false) when the
      // inner call simulation can't be replayed — supply an explicit gasLimit.
      const execOverrides = (network.key === 'hedera-testnet') ? { gasLimit: 3_000_000n } : {};
      const executeTx = await multisig.execute(options.txid, execOverrides);
      out.updateSpinner(`Transaction sent: ${executeTx.hash}`);

      await executeTx.wait();
      out.succeedSpinner('Transaction executed');

      out.print({
        multisig: address,
        transactionId: options.txid,
        txHash: executeTx.hash,
        status: 'executed'
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// tx revoke - Revoke confirmation
tx
  .command('revoke')
  .description('Revoke your confirmation from a transaction')
  .option('--address <address>', 'MultiSig address or alias')
  .option('--network <network>', 'Target network (prompts if not specified)')
  .requiredOption('--txid <transactionId>', 'Transaction ID', parseInt)
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const address = resolveAddress(options.address);
      const wallet = await getWallet(globalOpts);
      
      const network = await getTransactionNetwork(options.address, options.network || globalOpts.network, globalOpts, out);
      if (!network) return;
      
      const provider = new ethers.JsonRpcProvider(network.rpc);
      const signer = wallet.connect(provider);

      const multisig = new ethers.Contract(address, MULTISIG_ABI, signer);

      // Check if confirmed (idempotent)
      const hasConfirmed = await multisig.confirmations(options.txid, wallet.address);
      if (!hasConfirmed) {
        out.print({
          multisig: address,
          transactionId: options.txid,
          status: 'not_confirmed',
          message: 'You have not confirmed this transaction'
        });
        return;
      }

      if (globalOpts.dryRun) {
        out.print({
          dryRun: true,
          action: 'revokeConfirmation',
          multisig: address,
          transactionId: options.txid,
          network: globalOpts.network
        });
        return;
      }

      out.startSpinner('Revoking confirmation...');
      const revokeTx = await multisig.revokeConfirmation(options.txid);
      out.updateSpinner(`Transaction sent: ${revokeTx.hash}`);

      await revokeTx.wait();
      out.succeedSpinner('Confirmation revoked');

      out.print({
        multisig: address,
        transactionId: options.txid,
        txHash: revokeTx.hash,
        status: 'revoked'
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// tx pending - List pending transactions across all networks
tx
  .command('pending')
  .description('List pending transactions across all networks')
  .option('--address <address>', 'MultiSig address or alias')
  .option('--network <network>', 'Filter to specific network')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const address = resolveAddress(options.address);
      const contractNetworks = getContractNetworks(options.address);
      
      // Determine which networks to query
      let networksToQuery = [];
      const specifiedNetwork = options.network || globalOpts.network;
      
      if (specifiedNetwork) {
        // Filter to specific network
        const resolved = validateNetwork(specifiedNetwork);
        if (!resolved) {
          out.error(`Unknown network: ${specifiedNetwork}`);
          return;
        }
        networksToQuery = [resolved.key];
      } else if (contractNetworks.length > 0) {
        // Query all contract networks
        networksToQuery = contractNetworks;
      } else {
        // Fallback to default
        networksToQuery = ['sepolia'];
      }

      out.startSpinner(`Fetching pending transactions across ${networksToQuery.length} network(s)...`);

      const allPending = [];
      let totalRequired = 0;

      for (const networkKey of networksToQuery) {
        try {
          const rpc = getRpcUrl(networkKey);
          if (!rpc) {
            out.warn(`No RPC configured for ${networkKey}, skipping...`);
            continue;
          }
          
          const provider = new ethers.JsonRpcProvider(rpc);
          const multisig = new ethers.Contract(address, MULTISIG_ABI, provider);

          const [txCount, required] = await Promise.all([
            multisig.transactionCount(),
            multisig.required()
          ]);

          totalRequired = Number(required);

          for (let i = 0; i < Number(txCount); i++) {
            const txData = await multisig.transactions(i);
            if (!txData.executed) {
              const confirmCount = await multisig.getConfirmationCount(i);
              const confirmers = await multisig.getConfirmations(i);
              allPending.push({
                network: networkKey,
                id: i,
                destination: txData.dest,
                value: ethers.formatEther(txData.value) + ' ETH',
                data: txData.func,
                confirmations: `${confirmCount}/${required}`,
                confirmedBy: confirmers,
                canExecute: Number(confirmCount) >= Number(required)
              });
            }
          }
        } catch (err) {
          out.warn(`Failed to fetch pending on ${networkKey}: ${err.message}`);
        }
      }

      out.succeedSpinner(`Found ${allPending.length} pending transactions across ${networksToQuery.length} network(s)`);

      out.print({
        multisig: address,
        networks: networksToQuery,
        required: totalRequired,
        pendingCount: allPending.length,
        transactions: allPending
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// tx transfer-erc20 - Submit ERC20 transfer
tx
  .command('transfer-erc20')
  .description('Submit an ERC20 token transfer')
  .option('--address <address>', 'MultiSig address or alias')
  .option('--network <network>', 'Target network (prompts if not specified)')
  .requiredOption('--token <tokenAddress>', 'ERC20 token contract address')
  .requiredOption('--to <recipient>', 'Recipient address')
  .requiredOption('--amount <amount>', 'Amount to transfer (in token units)')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      if (!ethers.isAddress(options.token)) {
        out.error(`Invalid token address: ${options.token}`);
        return;
      }
      if (!ethers.isAddress(options.to)) {
        out.error(`Invalid recipient address: ${options.to}`);
        return;
      }

      const address = resolveAddress(options.address);
      const wallet = await getWallet(globalOpts);
      
      const network = await getTransactionNetwork(options.address, options.network || globalOpts.network, globalOpts, out);
      if (!network) return;
      
      const provider = new ethers.JsonRpcProvider(network.rpc);
      const signer = wallet.connect(provider);

      // Get token info
      const token = new ethers.Contract(options.token, ERC20_ABI, provider);
      const [decimals, symbol] = await Promise.all([
        token.decimals(),
        token.symbol()
      ]);

      const amountWei = ethers.parseUnits(options.amount, decimals);

      // Encode transfer call
      const transferData = token.interface.encodeFunctionData('transfer', [options.to, amountWei]);

      const multisig = new ethers.Contract(address, MULTISIG_ABI, signer);

      if (globalOpts.dryRun) {
        out.print({
          dryRun: true,
          action: 'transferERC20',
          multisig: address,
          token: options.token,
          symbol,
          to: options.to,
          amount: options.amount,
          network: globalOpts.network
        });
        return;
      }

      out.startSpinner(`Submitting ${symbol} transfer...`);
      const submitTx = await multisig.submitTransaction(options.token, 0, transferData);
      out.updateSpinner(`Transaction sent: ${submitTx.hash}`);

      const receipt = await submitTx.wait();

      // Find transaction ID
      let transactionId = null;
      for (const log of receipt.logs) {
        try {
          const parsed = multisig.interface.parseLog(log);
          if (parsed?.name === 'Submission') {
            transactionId = Number(parsed.args.transactionId);
            break;
          }
        } catch {}
      }

      out.succeedSpinner('ERC20 transfer submitted');

      out.print({
        multisig: address,
        transactionId,
        token: options.token,
        symbol,
        to: options.to,
        amount: options.amount,
        txHash: receipt.hash,
        status: 'submitted'
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// tx transfer-nft - Submit NFT transfer
tx
  .command('transfer-nft')
  .description('Submit an NFT (ERC721) transfer')
  .option('--address <address>', 'MultiSig address or alias')
  .option('--network <network>', 'Target network (prompts if not specified)')
  .requiredOption('--token <tokenAddress>', 'NFT contract address')
  .requiredOption('--to <recipient>', 'Recipient address')
  .requiredOption('--tokenid <tokenId>', 'Token ID to transfer')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      if (!ethers.isAddress(options.token)) {
        out.error(`Invalid token address: ${options.token}`);
        return;
      }
      if (!ethers.isAddress(options.to)) {
        out.error(`Invalid recipient address: ${options.to}`);
        return;
      }

      const address = resolveAddress(options.address);
      const wallet = await getWallet(globalOpts);
      
      const network = await getTransactionNetwork(options.address, options.network || globalOpts.network, globalOpts, out);
      if (!network) return;
      
      const provider = new ethers.JsonRpcProvider(network.rpc);
      const signer = wallet.connect(provider);

      // Encode safeTransferFrom call
      const nft = new ethers.Contract(options.token, ERC721_ABI, provider);
      const transferData = nft.interface.encodeFunctionData('safeTransferFrom', [
        address, // from (the multisig)
        options.to,
        options.tokenid
      ]);

      const multisig = new ethers.Contract(address, MULTISIG_ABI, signer);

      if (globalOpts.dryRun) {
        out.print({
          dryRun: true,
          action: 'transferNFT',
          multisig: address,
          token: options.token,
          to: options.to,
          tokenId: options.tokenid,
          network: globalOpts.network
        });
        return;
      }

      out.startSpinner('Submitting NFT transfer...');
      const submitTx = await multisig.submitTransaction(options.token, 0, transferData);
      out.updateSpinner(`Transaction sent: ${submitTx.hash}`);

      const receipt = await submitTx.wait();

      // Find transaction ID
      let transactionId = null;
      for (const log of receipt.logs) {
        try {
          const parsed = multisig.interface.parseLog(log);
          if (parsed?.name === 'Submission') {
            transactionId = Number(parsed.args.transactionId);
            break;
          }
        } catch {}
      }

      out.succeedSpinner('NFT transfer submitted');

      out.print({
        multisig: address,
        transactionId,
        token: options.token,
        to: options.to,
        tokenId: options.tokenid,
        txHash: receipt.hash,
        status: 'submitted'
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// tx notify - Generate notification payload for a pending transaction
tx
  .command('notify')
  .description('Generate notification payload for a pending transaction')
  .option('--address <address>', 'MultiSig address or alias')
  .option('--network <network>', 'Target network (prompts if not specified)')
  .requiredOption('--txid <transactionId>', 'Transaction ID', parseInt)
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const address = resolveAddress(options.address);
      const wallet = await getWallet(globalOpts);
      
      const network = await getTransactionNetwork(options.address, options.network || globalOpts.network, globalOpts, out);
      if (!network) return;
      
      const provider = new ethers.JsonRpcProvider(network.rpc);

      const multisig = new ethers.Contract(address, MULTISIG_ABI, provider);

      // Get transaction data
      const [txData, owners, required, confirmCount, confirmers] = await Promise.all([
        multisig.transactions(options.txid),
        multisig.getOwners(),
        multisig.required(),
        multisig.getConfirmationCount(options.txid),
        multisig.getConfirmations(options.txid)
      ]);

      if (txData.executed) {
        out.info('Transaction already executed');
        out.print({
          transactionId: options.txid,
          status: 'executed',
          notifyOwners: []
        });
        return;
      }

      // Build notification payload
      const notificationData = buildNotificationPayload({
        transactionId: options.txid,
        network: network.key,
        contractAddress: address,
        destination: txData.dest,
        value: ethers.formatEther(txData.value) + ' ETH',
        data: txData.func,
        confirmations: Number(confirmCount),
        required: Number(required),
        owners: owners,
        senderAddress: wallet.address
      });

      out.print({
        multisig: address,
        transactionId: options.txid,
        destination: txData.dest,
        value: ethers.formatEther(txData.value) + ' ETH',
        confirmations: `${confirmCount}/${required}`,
        confirmedBy: confirmers,
        canExecute: Number(confirmCount) >= Number(required),
        approvalUrl: notificationData.approvalUrl,
        notifyOwners: notificationData.notifyOwners,
        message: notificationData.message
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// tx link - Generate approval URL for a transaction
tx
  .command('link')
  .description('Generate approval URL for a transaction')
  .option('--address <address>', 'MultiSig address or alias')
  .option('--network <network>', 'Target network (prompts if not specified)')
  .requiredOption('--txid <transactionId>', 'Transaction ID', parseInt)
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const address = resolveAddress(options.address);
      
      const network = await getTransactionNetwork(options.address, options.network || globalOpts.network, globalOpts, out);
      if (!network) return;

      const approvalUrl = generateApprovalUrl(
        options.txid,
        network.key,
        address
      );

      if (globalOpts.json) {
        out.print({
          transactionId: options.txid,
          network: network.key,
          multisig: address,
          approvalUrl
        });
      } else {
        console.log(approvalUrl);
      }

    } catch (error) {
      out.error(error.message);
    }
  });

module.exports = tx;
