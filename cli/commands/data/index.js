const { Command } = require('commander');
const { ethers } = require('ethers');
const { createOutput } = require('../../utils/output');
const { getNetwork, getRpcUrl, validateNetwork } = require('../../utils/networks');
const { resolveAddress, getContract, getContractNetworks } = require('../../utils/contracts');

const data = new Command('data')
  .description('Data query commands');

/**
 * Get networks to query for a contract
 * If --network is specified, use only that network
 * Otherwise, use all networks the contract is deployed on
 */
async function getQueryNetworks(aliasOrAddress, specifiedNetwork, out) {
  const contractNetworks = getContractNetworks(aliasOrAddress);
  
  if (specifiedNetwork) {
    // Filter to specified network only
    const resolved = validateNetwork(specifiedNetwork);
    if (!resolved) {
      return null;
    }
    if (contractNetworks.length > 0 && !contractNetworks.includes(resolved.key)) {
      out.warn(`Contract is not configured for network: ${specifiedNetwork}`);
      out.info(`Configured networks: ${contractNetworks.join(', ')}`);
    }
    return [resolved.key];
  }
  
  // Use all contract networks, or fall back to default
  if (contractNetworks.length > 0) {
    return contractNetworks;
  }
  
  // No networks configured - use default
  return ['sepolia'];
}

// data balance - Get portfolio balance across all contract networks
data
  .command('balance')
  .description('Get account balance across all networks the contract is deployed on')
  .option('--address <address>', 'MultiSig address or alias')
  .option('--network <network>', 'Filter to specific network')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const address = resolveAddress(options.address);
      const networks = await getQueryNetworks(options.address, options.network || globalOpts.network, out);
      
      if (!networks) {
        return;
      }

      out.startSpinner(`Fetching balance across ${networks.length} network(s)...`);

      const balances = [];
      let totalEth = 0n;

      for (const networkKey of networks) {
        try {
          const rpc = getRpcUrl(networkKey);
          if (!rpc) {
            out.warn(`No RPC configured for ${networkKey}, skipping...`);
            continue;
          }
          
          const provider = new ethers.JsonRpcProvider(rpc);
          const balance = await provider.getBalance(address);
          
          balances.push({
            network: networkKey,
            balance: ethers.formatEther(balance) + ' ETH',
            balanceWei: balance.toString()
          });
          
          totalEth += balance;
        } catch (err) {
          out.warn(`Failed to fetch balance on ${networkKey}: ${err.message}`);
        }
      }

      out.succeedSpinner(`Balance retrieved from ${balances.length} network(s)`);

      out.print({
        address,
        networks: networks,
        totalBalance: ethers.formatEther(totalEth) + ' ETH',
        balances
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// MultiSig event signatures - complete list
const MULTISIG_EVENTS_ABI = [
  "event Confirmation(address indexed sender, uint indexed transactionId)",
  "event Revocation(address indexed sender, uint indexed transactionId)",
  "event Submission(uint indexed transactionId, address dest, uint256 value, bytes func)",
  "event ExecutionFailure(uint indexed transactionId)",
  "event Deposit(address sender, uint value)",
  "event OwnerAddition(address indexed owner)",
  "event OwnerRemoval(address indexed owner)",
  "event OwnerReplace(address indexed oldOwner, address indexed newOwner)",
  "event RequirementChange(uint required)",
  "event Delete(uint indexed transactionId, address indexed sender)",
  "event NftReceived(address operator, address from, uint256 tokenId, bytes data)",
  "event Swap(uint indexed transactionId, address indexed swapModule, address indexed executor, uint256 ethValue)",
  "event TokenTransfer(uint indexed transactionId, address indexed assetContract, address indexed to, uint256 amountOrTokenId, address executor, bool isNFT)",
  "event NativeTransfer(uint indexed transactionId, address indexed to, uint256 amount, address executor)",
  "event ContractInteraction(uint indexed transactionId, address indexed target, address indexed executor, uint256 value, bytes data)",
  "event CashOut(uint256 indexed approvalTxId, uint256 indexed transferTxId, address indexed depositAddress, address tokenAddress, uint256 amount, address executor, bool isNative)"
];

// data events - Get transaction events across all contract networks
data
  .command('events')
  .description('Get recent transaction events across all networks')
  .option('--address <address>', 'MultiSig address or alias')
  .option('--network <network>', 'Filter to specific network')
  .option('--limit <number>', 'Number of events to fetch per network', parseInt, 10)
  .option('--from-block <block>', 'Start from specific block number', parseInt)
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const address = resolveAddress(options.address);
      const networks = await getQueryNetworks(options.address, options.network || globalOpts.network, out);
      
      if (!networks) {
        return;
      }

      out.startSpinner(`Fetching events across ${networks.length} network(s)...`);

      const allEvents = [];
      let totalLogs = 0;

      for (const networkKey of networks) {
        try {
          const rpc = getRpcUrl(networkKey);
          if (!rpc) {
            out.warn(`No RPC configured for ${networkKey}, skipping...`);
            continue;
          }
          
          const provider = new ethers.JsonRpcProvider(rpc);
          const multisig = new ethers.Contract(address, MULTISIG_EVENTS_ABI, provider);

          const fromBlock = options.fromBlock || 0;
          const filter = {
            address: address,
            fromBlock,
            toBlock: 'latest'
          };

          const logs = await provider.getLogs(filter);
          totalLogs += logs.length;
          
          // Take the latest N events per network
          const recentLogs = logs.slice(-options.limit).reverse();
          
          for (const log of recentLogs) {
            try {
              const parsed = multisig.interface.parseLog(log);
              if (parsed) {
                const block = await provider.getBlock(log.blockNumber);
                
                const args = {};
                const fragment = parsed.fragment;
                for (let i = 0; i < fragment.inputs.length; i++) {
                  const input = fragment.inputs[i];
                  let value = parsed.args[i];
                  if (typeof value === 'bigint') {
                    value = value.toString();
                  }
                  args[input.name] = value;
                }
                
                allEvents.push({
                  network: networkKey,
                  event: parsed.name,
                  args,
                  blockNumber: log.blockNumber,
                  transactionHash: log.transactionHash,
                  timestamp: new Date(block.timestamp * 1000).toISOString()
                });
              }
            } catch {}
          }
        } catch (err) {
          out.warn(`Failed to fetch events on ${networkKey}: ${err.message}`);
        }
      }

      // Sort all events by timestamp (most recent first)
      allEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      out.succeedSpinner(`Found ${allEvents.length} events (${totalLogs} total across ${networks.length} networks)`);

      out.print({
        address,
        networks,
        totalEvents: totalLogs,
        showing: allEvents.length,
        events: allEvents
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// Block explorer API V2 endpoint and chain IDs
const ETHERSCAN_V2_API = 'https://api.etherscan.io/v2/api';
const CHAIN_IDS = {
  sepolia: 11155111,
  ethereum: 1,
  'base-sepolia': 84532,
  base: 8453,
  'arbitrum-sepolia': 421614,
  arbitrum: 42161
};

const fs = require('fs');
const path = require('path');
const os = require('os');
const ETHNOTARY_DIR = path.join(os.homedir(), '.ethnotary');
const CONFIG_PATH = path.join(ETHNOTARY_DIR, 'config.json');

function loadTokenConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

function saveTokenConfig(config) {
  if (!fs.existsSync(ETHNOTARY_DIR)) fs.mkdirSync(ETHNOTARY_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getEtherscanApiKey() {
  if (process.env.ETHERSCAN_API_KEY) return process.env.ETHERSCAN_API_KEY;
  const config = loadTokenConfig();
  return config.etherscanApiKey || null;
}

async function ensureEtherscanApiKey() {
  let apiKey = getEtherscanApiKey();
  if (apiKey) return apiKey;
  
  const inquirer = require('inquirer');
  const chalk = require('chalk');
  
  console.log(chalk.yellow('\n⚠️  No Etherscan API key configured.'));
  console.log(chalk.cyan('\nToken discovery requires an Etherscan API key (free).'));
  console.log(chalk.gray('\nHow to get one:'));
  console.log(chalk.gray('  1. Go to https://etherscan.io/register'));
  console.log(chalk.gray('  2. Create a free account'));
  console.log(chalk.gray('  3. Go to https://etherscan.io/myapikey'));
  console.log(chalk.gray('  4. Create a new API key'));
  console.log('');
  
  const { apiKeyInput } = await inquirer.prompt([{
    type: 'input',
    name: 'apiKeyInput',
    message: 'Enter your Etherscan API key:',
    validate: (input) => input && input.length >= 10 ? true : 'Please enter a valid API key'
  }]);
  
  const config = loadTokenConfig();
  config.etherscanApiKey = apiKeyInput;
  saveTokenConfig(config);
  console.log(chalk.green('✓ API key saved to ~/.ethnotary/config.json\n'));
  
  return apiKeyInput;
}

const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

async function fetchNFTTransfers(address, networkKey, apiKey) {
  const chainId = CHAIN_IDS[networkKey];
  if (!chainId) return [];
  
  const url = `${ETHERSCAN_V2_API}?chainid=${chainId}&module=account&action=tokennfttx&address=${address}&page=1&offset=100&sort=desc&apikey=${apiKey}`;
  const data = await httpsGet(url);
  
  if (!data || data.status !== '1' || !data.result) return [];
  
  // Group by contract and track token IDs currently held
  const nftMap = new Map();
  for (const tx of data.result) {
    const key = tx.contractAddress.toLowerCase();
    if (!nftMap.has(key)) {
      nftMap.set(key, {
        contract: tx.contractAddress,
        symbol: tx.tokenSymbol || 'NFT',
        name: tx.tokenName || 'Unknown NFT',
        tokenIds: new Set()
      });
    }
    // Received
    if (tx.to.toLowerCase() === address.toLowerCase()) {
      nftMap.get(key).tokenIds.add(tx.tokenID);
    }
    // Sent out
    if (tx.from.toLowerCase() === address.toLowerCase()) {
      nftMap.get(key).tokenIds.delete(tx.tokenID);
    }
  }
  
  return Array.from(nftMap.values())
    .filter(nft => nft.tokenIds.size > 0)
    .map(nft => ({
      ...nft,
      tokenIds: Array.from(nft.tokenIds),
      count: nft.tokenIds.size
    }));
}

async function fetchERC20Transfers(address, networkKey, apiKey) {
  const chainId = CHAIN_IDS[networkKey];
  if (!chainId) return [];
  
  const url = `${ETHERSCAN_V2_API}?chainid=${chainId}&module=account&action=tokentx&address=${address}&page=1&offset=100&sort=desc&apikey=${apiKey}`;
  const data = await httpsGet(url);
  
  if (!data || data.status !== '1' || !data.result) return [];
  
  const tokenMap = new Map();
  for (const tx of data.result) {
    if (!tokenMap.has(tx.contractAddress.toLowerCase())) {
      tokenMap.set(tx.contractAddress.toLowerCase(), {
        contract: tx.contractAddress,
        symbol: tx.tokenSymbol || 'UNKNOWN',
        name: tx.tokenName || 'Unknown Token',
        decimals: parseInt(tx.tokenDecimal) || 18
      });
    }
  }
  
  return Array.from(tokenMap.values());
}

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

async function getERC20Balance(address, tokenContract, decimals, provider) {
  try {
    const token = new ethers.Contract(tokenContract, ERC20_ABI, provider);
    const balance = await token.balanceOf(address);
    return Number(balance) / Math.pow(10, decimals);
  } catch { return 0; }
}

// data tokens - Get token holdings
data
  .command('tokens')
  .description('Get ERC20 and NFT holdings across all networks')
  .option('--address <address>', 'MultiSig address or alias')
  .option('--network <network>', 'Filter to specific network')
  .option('--type <type>', 'Filter by token type: erc20, nft, or all', 'all')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const address = resolveAddress(options.address);
      const networks = await getQueryNetworks(options.address, options.network || globalOpts.network, out);
      
      if (!networks) return;

      const apiKey = await ensureEtherscanApiKey();
      if (!apiKey) return;

      const showERC20 = options.type === 'all' || options.type === 'erc20';
      const showNFT = options.type === 'all' || options.type === 'nft';

      out.startSpinner(`Discovering tokens across ${networks.length} network(s)...`);

      const allERC20 = [];
      const allNFTs = [];

      for (const networkKey of networks) {
        try {
          const rpc = getRpcUrl(networkKey);
          if (!rpc) continue;
          
          const provider = new ethers.JsonRpcProvider(rpc);

          if (showNFT) {
            out.updateSpinner(`Fetching NFTs on ${networkKey}...`);
            const nfts = await fetchNFTTransfers(address, networkKey, apiKey);
            for (const nft of nfts) {
              allNFTs.push({ network: networkKey, ...nft });
            }
          }

          if (showERC20) {
            out.updateSpinner(`Fetching ERC20 tokens on ${networkKey}...`);
            const tokens = await fetchERC20Transfers(address, networkKey, apiKey);
            for (const token of tokens) {
              const balance = await getERC20Balance(address, token.contract, token.decimals, provider);
              if (balance > 0) {
                allERC20.push({ network: networkKey, ...token, balance });
              }
            }
          }
        } catch (err) {
          // Continue to next network
        }
      }

      out.succeedSpinner(`Found ${allERC20.length} ERC20 tokens and ${allNFTs.length} NFT collections`);

      out.print({
        address,
        networks,
        erc20Tokens: allERC20,
        nfts: allNFTs,
        summary: {
          erc20Count: allERC20.length,
          nftCollections: allNFTs.length,
          totalNFTs: allNFTs.reduce((sum, n) => sum + n.count, 0)
        }
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// data pending - Get pending transactions across all contract networks
const MULTISIG_ABI = [
  "function transactions(uint) view returns (address dest, uint value, bytes func, bool executed, uint id)",
  "function getConfirmationCount(uint transactionId) view returns (uint count)",
  "function getConfirmations(uint transactionId) view returns (address[])",
  "function required() view returns (uint)",
  "function transactionCount() view returns (uint)"
];

data
  .command('pending')
  .description('Get pending transactions across all networks')
  .option('--address <address>', 'MultiSig address or alias')
  .option('--network <network>', 'Filter to specific network')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const address = resolveAddress(options.address);
      const networks = await getQueryNetworks(options.address, options.network || globalOpts.network, out);
      
      if (!networks) {
        return;
      }

      out.startSpinner(`Fetching pending transactions across ${networks.length} network(s)...`);

      const allPending = [];
      let totalRequired = 0;

      for (const networkKey of networks) {
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

      out.succeedSpinner(`Found ${allPending.length} pending transactions across ${networks.length} network(s)`);

      out.print({
        multisig: address,
        networks,
        required: totalRequired,
        pendingCount: allPending.length,
        transactions: allPending
      });

    } catch (error) {
      out.error(error.message);
    }
  });

module.exports = data;
