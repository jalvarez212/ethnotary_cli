const fs = require('fs');
const path = require('path');
const os = require('os');

const ETHNOTARY_DIR = path.join(os.homedir(), '.ethnotary');
const CONFIG_PATH = path.join(ETHNOTARY_DIR, 'config.json');

// Comprehensive network definitions
const DEFAULT_NETWORKS = {
  // Mainnets
  ethereum: { name: 'Ethereum Mainnet', chainId: 1, testnet: false },
  optimism: { name: 'Optimism', chainId: 10, testnet: false },
  base: { name: 'Base', chainId: 8453, testnet: false },
  arbitrum: { name: 'Arbitrum One', chainId: 42161, testnet: false },
  'arbitrum-nova': { name: 'Arbitrum Nova', chainId: 42170, testnet: false },
  'zksync-era': { name: 'zkSync Era', chainId: 324, testnet: false },
  scroll: { name: 'Scroll', chainId: 534352, testnet: false },
  'polygon-zkevm': { name: 'Polygon zkEVM', chainId: 1101, testnet: false },
  linea: { name: 'Linea', chainId: 59144, testnet: false },
  polygon: { name: 'Polygon PoS', chainId: 137, testnet: false },
  gnosis: { name: 'Gnosis Chain', chainId: 100, testnet: false },
  avalanche: { name: 'Avalanche C-Chain', chainId: 43114, testnet: false },
  celo: { name: 'Celo', chainId: 42220, testnet: false },
  soneium: { name: 'Soneium', chainId: 1868, testnet: false },
  
  // Testnets
  sepolia: { name: 'Sepolia', chainId: 11155111, testnet: true },
  'base-sepolia': { name: 'Base Sepolia', chainId: 84532, testnet: true },
  'arbitrum-sepolia': { name: 'Arbitrum Sepolia', chainId: 421614, testnet: true },
  'polygon-mumbai': { name: 'Polygon Mumbai', chainId: 80001, testnet: true },
  'polygon-amoy': { name: 'Polygon Amoy', chainId: 80002, testnet: true },
  'avalanche-fuji': { name: 'Avalanche Fuji', chainId: 43113, testnet: true },
  'hedera-testnet': { name: 'Hedera Testnet', chainId: 296, testnet: true, currency: 'HBAR', explorer: 'https://hashscan.io/testnet' }
};

// Build chain ID to network key mapping
const CHAIN_ID_TO_NETWORK = {};
for (const [key, config] of Object.entries(DEFAULT_NETWORKS)) {
  CHAIN_ID_TO_NETWORK[config.chainId] = key;
}

// RPC provider suggestions
const RPC_PROVIDERS = [
  { name: 'Infura', url: 'https://infura.io' },
  { name: 'Alchemy', url: 'https://alchemy.com' },
  { name: 'QuickNode', url: 'https://quicknode.com' },
  { name: 'PublicNode', url: 'https://publicnode.com' }
];

// Load config from ~/.ethnotary/config.json
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { networks: {}, rpc: {} };
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!cfg.networks) cfg.networks = {};
    if (!cfg.rpc) cfg.rpc = {};
    return cfg;
  } catch {
    return { networks: {}, rpc: {} };
  }
}

// Save config
function saveConfig(config) {
  if (!fs.existsSync(ETHNOTARY_DIR)) {
    fs.mkdirSync(ETHNOTARY_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Get RPC URL for a network (config file > env var)
function getRpcUrl(networkName) {
  const cfg = loadConfig();
  
  // Priority 1: Config file
  if (cfg.rpc[networkName]) {
    return cfg.rpc[networkName];
  }
  
  // Priority 2: Environment variable (legacy support)
  const envVar = `${networkName.toUpperCase().replace(/-/g, '_')}_RPC_URL`;
  if (process.env[envVar]) {
    return process.env[envVar];
  }
  
  return null;
}

const DEFAULT_NETWORK = 'sepolia';

// Resolve network from name or chain ID
function resolveNetwork(networkOrChainId) {
  const cfg = loadConfig();
  
  // Check if it's a chain ID (number)
  const chainId = parseInt(networkOrChainId);
  if (!isNaN(chainId)) {
    // Look up by chain ID
    const networkKey = CHAIN_ID_TO_NETWORK[chainId];
    if (networkKey) {
      return { key: networkKey, config: DEFAULT_NETWORKS[networkKey] };
    }
    // Check custom networks
    for (const [key, config] of Object.entries(cfg.networks || {})) {
      if (config.chainId === chainId) {
        return { key, config };
      }
    }
    return null;
  }
  
  // It's a network name - normalize it
  const normalized = networkOrChainId.toLowerCase().trim();
  
  // Check default networks
  if (DEFAULT_NETWORKS[normalized]) {
    return { key: normalized, config: DEFAULT_NETWORKS[normalized] };
  }
  
  // Check custom networks
  if (cfg.networks && cfg.networks[normalized]) {
    return { key: normalized, config: cfg.networks[normalized] };
  }
  
  return null;
}

// Validate network and return helpful error if not found
function validateNetwork(networkOrChainId) {
  const resolved = resolveNetwork(networkOrChainId);
  
  if (!resolved) {
    const chalk = require('chalk');
    const allNetworks = { ...DEFAULT_NETWORKS, ...loadConfig().networks };
    const networkList = Object.entries(allNetworks)
      .map(([key, cfg]) => `  ${key} (${cfg.chainId})`)
      .join('\n');
    
    console.log(chalk.red(`\n✗ Unknown network: "${networkOrChainId}"`));
    console.log(chalk.yellow('\nPlease double-check the network name or chain ID.'));
    console.log(chalk.gray('\nSupported networks:'));
    console.log(chalk.gray(networkList));
    console.log(chalk.cyan('\nTo add a custom network:'));
    console.log(chalk.white(`  ethnotary config network <name> --chain-id <id> --rpc <url>`));
    console.log(chalk.cyan('\nTo request support for a new network:'));
    console.log(chalk.white('  https://github.com/ethnotary/cli/issues/new'));
    
    return null;
  }
  
  return resolved;
}

// Ensure RPC is configured for a network, prompt if missing
async function ensureRpcConfigured(networkKey, networkConfig, options = {}) {
  const rpc = getRpcUrl(networkKey);
  
  if (rpc) {
    return rpc;
  }
  
  // In JSON mode, fail instead of prompting
  if (options.json) {
    const chalk = require('chalk');
    console.log(chalk.red(`\n✗ No RPC URL configured for ${networkConfig.name}`));
    console.log(chalk.cyan('\nTo configure an RPC URL, run:'));
    console.log(chalk.white(`  ethnotary config rpc ${networkKey} --url <your-rpc-url>`));
    return null;
  }
  
  // Interactive prompt
  return await promptForRpc(networkKey, networkConfig);
}

// Prompt for RPC URL if not configured
async function promptForRpc(networkName, networkConfig) {
  const inquirer = require('inquirer');
  const chalk = require('chalk');
  
  console.log(chalk.yellow(`\n⚠️  No RPC URL configured for ${networkConfig.name}.`));
  console.log(chalk.cyan('\nTo configure an RPC URL, run:'));
  console.log(chalk.white(`  ethnotary config rpc ${networkName} --url <your-rpc-url>`));
  console.log(chalk.gray('\nOr run interactively:'));
  console.log(chalk.white(`  ethnotary config rpc ${networkName}`));
  console.log(chalk.gray('\nWhere to get RPC URLs:'));
  for (const provider of RPC_PROVIDERS) {
    console.log(chalk.gray(`  • ${provider.name}: ${provider.url}`));
  }
  console.log('');
  
  const { rpcUrl } = await inquirer.prompt([{
    type: 'input',
    name: 'rpcUrl',
    message: `Enter RPC URL for ${networkConfig.name}:`,
    validate: (input) => {
      if (!input.startsWith('http://') && !input.startsWith('https://')) {
        return 'RPC URL must start with http:// or https://';
      }
      return true;
    }
  }]);
  
  // Save to config file
  const cfg = loadConfig();
  cfg.rpc[networkName] = rpcUrl;
  saveConfig(cfg);
  console.log(chalk.green(`✓ RPC URL saved to ~/.ethnotary/config.json\n`));
  
  return rpcUrl;
}

async function getNetwork(networkName) {
  const cfg = loadConfig();
  
  // Get network config (custom > default)
  const networkConfig = cfg.networks[networkName] || DEFAULT_NETWORKS[networkName];
  if (!networkConfig) {
    const available = [...Object.keys(DEFAULT_NETWORKS), ...Object.keys(cfg.networks)];
    throw new Error(`Unknown network: ${networkName}. Available: ${[...new Set(available)].join(', ')}`);
  }
  
  let rpc = getRpcUrl(networkName);
  
  // If no RPC configured, prompt for one
  if (!rpc) {
    rpc = await promptForRpc(networkName, networkConfig);
  }
  
  return {
    name: networkConfig.name,
    rpc,
    chainId: networkConfig.chainId
  };
}

function listNetworks() {
  const cfg = loadConfig();
  const allNetworks = { ...DEFAULT_NETWORKS, ...cfg.networks };
  
  return Object.entries(allNetworks).map(([key, value]) => ({
    key,
    name: value.name,
    chainId: value.chainId,
    configured: !!getRpcUrl(key)
  }));
}

// Parse multiple networks from comma-separated string (names or chain IDs)
function parseNetworks(networkString) {
  if (!networkString) return [];
  
  const parts = networkString.split(',').map(s => s.trim()).filter(Boolean);
  const results = [];
  const errors = [];
  
  for (const part of parts) {
    const resolved = resolveNetwork(part);
    if (resolved) {
      results.push(resolved);
    } else {
      errors.push(part);
    }
  }
  
  return { networks: results, errors };
}

// Validate multiple networks and show helpful errors
function validateNetworks(networkString) {
  const { networks, errors } = parseNetworks(networkString);
  
  if (errors.length > 0) {
    const chalk = require('chalk');
    const allNetworks = { ...DEFAULT_NETWORKS, ...loadConfig().networks };
    const networkList = Object.entries(allNetworks)
      .map(([key, cfg]) => `  ${key} (${cfg.chainId})`)
      .join('\n');
    
    console.log(chalk.red(`\n✗ Unknown network(s): ${errors.join(', ')}`));
    console.log(chalk.yellow('\nPlease double-check the network name(s) or chain ID(s).'));
    console.log(chalk.gray('\nSupported networks:'));
    console.log(chalk.gray(networkList));
    console.log(chalk.cyan('\nTo add a custom network:'));
    console.log(chalk.white(`  ethnotary config network <name> --chain-id <id> --rpc <url>`));
    console.log(chalk.cyan('\nTo request support for a new network:'));
    console.log(chalk.white('  https://github.com/ethnotary/cli/issues/new'));
    
    return null;
  }
  
  return networks;
}

// Ensure RPC is configured for multiple networks, prompt for missing ones
async function ensureRpcsConfigured(networks, options = {}) {
  const chalk = require('chalk');
  const results = [];
  
  for (const { key, config } of networks) {
    const rpc = getRpcUrl(key);
    
    if (rpc) {
      results.push({ key, config, rpc });
    } else {
      if (options.json) {
        console.log(chalk.red(`\n✗ No RPC URL configured for ${config.name}`));
        console.log(chalk.cyan('\nTo configure an RPC URL, run:'));
        console.log(chalk.white(`  ethnotary config rpc ${key} --url <your-rpc-url>`));
        return null;
      }
      
      // Interactive prompt
      const promptedRpc = await promptForRpc(key, config);
      results.push({ key, config, rpc: promptedRpc });
    }
  }
  
  return results;
}

module.exports = {
  DEFAULT_NETWORKS,
  DEFAULT_NETWORK,
  CHAIN_ID_TO_NETWORK,
  getNetwork,
  listNetworks,
  getRpcUrl,
  resolveNetwork,
  validateNetwork,
  ensureRpcConfigured,
  parseNetworks,
  validateNetworks,
  ensureRpcsConfigured
};
