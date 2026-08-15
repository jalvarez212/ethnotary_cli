const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
const chalk = require('chalk');
const { createOutput } = require('../../utils/output');

const ETHNOTARY_DIR = path.join(os.homedir(), '.ethnotary');
const CONFIG_PATH = path.join(ETHNOTARY_DIR, 'config.json');

// RPC provider suggestions
const RPC_PROVIDERS = {
  infura: {
    name: 'Infura',
    url: 'https://infura.io',
    description: 'Popular provider, requires API key'
  },
  alchemy: {
    name: 'Alchemy',
    url: 'https://alchemy.com',
    description: 'Full-featured provider, requires API key'
  },
  quicknode: {
    name: 'QuickNode',
    url: 'https://quicknode.com',
    description: 'High-performance provider, requires API key'
  },
  publicnode: {
    name: 'PublicNode',
    url: 'https://publicnode.com',
    description: 'Free public RPCs (rate limited)'
  }
};

// Default network definitions
const DEFAULT_NETWORKS = {
  sepolia: { name: 'Sepolia', chainId: 11155111, testnet: true },
  'base-sepolia': { name: 'Base Sepolia', chainId: 84532, testnet: true },
  'arbitrum-sepolia': { name: 'Arbitrum Sepolia', chainId: 421614, testnet: true },
  ethereum: { name: 'Ethereum Mainnet', chainId: 1, testnet: false },
  base: { name: 'Base', chainId: 8453, testnet: false },
  arbitrum: { name: 'Arbitrum One', chainId: 42161, testnet: false },
  optimism: { name: 'Optimism', chainId: 10, testnet: false },
  polygon: { name: 'Polygon', chainId: 137, testnet: false }
};

// Ensure directory exists
function ensureDir() {
  if (!fs.existsSync(ETHNOTARY_DIR)) {
    fs.mkdirSync(ETHNOTARY_DIR, { recursive: true });
  }
}

// Load config
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
  ensureDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

const config = new Command('config')
  .description('Configuration commands');

// config rpc - Add or update RPC URL for a network
config
  .command('rpc')
  .description('Add or update RPC URL for a network')
  .argument('[network]', 'Network name (e.g., sepolia, base, arbitrum)')
  .option('--url <url>', 'RPC URL to set')
  .action(async (network, options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const cfg = loadConfig();

      // If no network specified, show current RPC config
      if (!network) {
        const rpcEntries = Object.entries(cfg.rpc);
        if (rpcEntries.length === 0) {
          out.info('No RPC URLs configured.');
          out.info('Use "ethnotary config rpc <network> --url <url>" to add one.');
        }
        out.print({
          rpc: cfg.rpc
        });
        return;
      }

      // If URL provided via flag, set it directly
      if (options.url) {
        if (!options.url.startsWith('http://') && !options.url.startsWith('https://')) {
          out.error('RPC URL must start with http:// or https://');
          return;
        }
        cfg.rpc[network] = options.url;
        saveConfig(cfg);
        out.success(`RPC URL set for ${network}`);
        out.print({ network, url: options.url });
        return;
      }

      // Interactive mode - prompt for URL
      if (globalOpts.json) {
        out.error('--url required in JSON mode');
        return;
      }

      console.log(chalk.cyan(`\nConfiguring RPC for: ${network}`));
      console.log(chalk.gray('\nWhere to get RPC URLs:'));
      for (const [key, provider] of Object.entries(RPC_PROVIDERS)) {
        console.log(chalk.gray(`  • ${provider.name}: ${provider.url} - ${provider.description}`));
      }
      console.log('');

      const { rpcUrl } = await inquirer.prompt([{
        type: 'input',
        name: 'rpcUrl',
        message: `Enter RPC URL for ${network}:`,
        validate: (input) => {
          if (!input.startsWith('http://') && !input.startsWith('https://')) {
            return 'RPC URL must start with http:// or https://';
          }
          return true;
        }
      }]);

      cfg.rpc[network] = rpcUrl;
      saveConfig(cfg);
      out.success(`RPC URL set for ${network}`);
      out.print({ network, url: rpcUrl });

    } catch (error) {
      out.error(error.message);
    }
  });

// config network - Add or update a network
config
  .command('network')
  .description('Add or update a network configuration')
  .argument('[network]', 'Network name/key')
  .option('--name <name>', 'Display name for the network')
  .option('--chain-id <chainId>', 'Chain ID', parseInt)
  .option('--rpc <url>', 'RPC URL for the network')
  .option('--testnet', 'Mark as testnet')
  .action(async (network, options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const cfg = loadConfig();

      // If no network specified, list all networks
      if (!network) {
        const allNetworks = { ...DEFAULT_NETWORKS };
        // Merge custom networks
        for (const [key, value] of Object.entries(cfg.networks)) {
          allNetworks[key] = value;
        }
        // Add RPC status
        const networksWithStatus = Object.entries(allNetworks).map(([key, net]) => ({
          key,
          ...net,
          rpcConfigured: !!(cfg.rpc[key] || process.env[`${key.toUpperCase().replace('-', '_')}_RPC_URL`])
        }));

        if (!globalOpts.json) {
          console.log(chalk.bold('\nConfigured Networks:\n'));
          for (const net of networksWithStatus) {
            const status = net.rpcConfigured ? chalk.green('✓') : chalk.yellow('○');
            const type = net.testnet ? chalk.gray('(testnet)') : '';
            console.log(`  ${status} ${net.key} - ${net.name} ${type}`);
            console.log(chalk.gray(`      Chain ID: ${net.chainId}`));
          }
          console.log('');
          console.log(chalk.gray('Use "ethnotary config network <name>" to add/edit a network'));
          console.log(chalk.gray('Use "ethnotary config rpc <network>" to configure RPC URL\n'));
        }

        out.print({ networks: networksWithStatus });
        return;
      }

      // Check if it's a known network
      const existing = cfg.networks[network] || DEFAULT_NETWORKS[network];

      // If options provided, update directly
      if (options.name || options.chainId || options.rpc) {
        const netConfig = existing || {};
        if (options.name) netConfig.name = options.name;
        if (options.chainId) netConfig.chainId = options.chainId;
        if (options.testnet !== undefined) netConfig.testnet = options.testnet;
        
        cfg.networks[network] = netConfig;
        
        if (options.rpc) {
          cfg.rpc[network] = options.rpc;
        }
        
        saveConfig(cfg);
        out.success(`Network "${network}" configured`);
        out.print({ network, config: netConfig, rpc: cfg.rpc[network] || null });
        return;
      }

      // Interactive mode
      if (globalOpts.json) {
        out.error('Options required in JSON mode (--name, --chain-id, --rpc)');
        return;
      }

      console.log(chalk.cyan(`\nConfiguring network: ${network}`));
      if (existing) {
        console.log(chalk.gray(`Existing config: ${existing.name}, Chain ID: ${existing.chainId}`));
      }

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Display name:',
          default: existing?.name || network
        },
        {
          type: 'number',
          name: 'chainId',
          message: 'Chain ID:',
          default: existing?.chainId,
          validate: (input) => input > 0 ? true : 'Chain ID must be positive'
        },
        {
          type: 'confirm',
          name: 'testnet',
          message: 'Is this a testnet?',
          default: existing?.testnet || false
        },
        {
          type: 'confirm',
          name: 'configureRpc',
          message: 'Configure RPC URL now?',
          default: !cfg.rpc[network]
        }
      ]);

      cfg.networks[network] = {
        name: answers.name,
        chainId: answers.chainId,
        testnet: answers.testnet
      };

      if (answers.configureRpc) {
        console.log(chalk.gray('\nWhere to get RPC URLs:'));
        for (const [key, provider] of Object.entries(RPC_PROVIDERS)) {
          console.log(chalk.gray(`  • ${provider.name}: ${provider.url}`));
        }
        console.log('');

        const { rpcUrl } = await inquirer.prompt([{
          type: 'input',
          name: 'rpcUrl',
          message: 'RPC URL:',
          validate: (input) => {
            if (!input) return true; // Allow empty
            if (!input.startsWith('http://') && !input.startsWith('https://')) {
              return 'RPC URL must start with http:// or https://';
            }
            return true;
          }
        }]);

        if (rpcUrl) {
          cfg.rpc[network] = rpcUrl;
        }
      }

      saveConfig(cfg);
      out.success(`Network "${network}" configured`);
      out.print({ 
        network, 
        config: cfg.networks[network], 
        rpc: cfg.rpc[network] || null 
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// config show - Show all config
config
  .command('show')
  .description('Show all configuration')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const cfg = loadConfig();

      if (!globalOpts.json) {
        console.log(chalk.bold('\nEthnotary Configuration\n'));
        console.log(chalk.gray(`Config file: ${CONFIG_PATH}`));
        
        console.log(chalk.bold('\nRPC URLs:'));
        const rpcEntries = Object.entries(cfg.rpc);
        if (rpcEntries.length === 0) {
          console.log(chalk.gray('  No RPC URLs configured'));
        } else {
          for (const [network, url] of rpcEntries) {
            console.log(`  ${network}: ${chalk.gray(url.substring(0, 50))}...`);
          }
        }

        console.log(chalk.bold('\nCustom Networks:'));
        const netEntries = Object.entries(cfg.networks);
        if (netEntries.length === 0) {
          console.log(chalk.gray('  Using default networks only'));
        } else {
          for (const [key, net] of netEntries) {
            console.log(`  ${key}: ${net.name} (Chain ID: ${net.chainId})`);
          }
        }
        console.log('');
      }

      out.print({
        configPath: CONFIG_PATH,
        rpc: cfg.rpc,
        networks: cfg.networks
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// config path - Show config file path
config
  .command('path')
  .description('Show configuration file paths')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    out.print({
      configDir: ETHNOTARY_DIR,
      configFile: CONFIG_PATH,
      keystoreFile: path.join(ETHNOTARY_DIR, 'keystore.json'),
      contractsFile: path.join(ETHNOTARY_DIR, 'contracts.json')
    });
  });

module.exports = config;
