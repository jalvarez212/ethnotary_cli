const { Command } = require('commander');
const { ethers } = require('ethers');
const { createOutput } = require('../../utils/output');
const { 
  saveContract, 
  listContracts, 
  removeContract, 
  setDefaultContract, 
  getDefaultContract 
} = require('../../utils/contracts');

const contract = new Command('contract')
  .description('Contract storage commands');

// contract add - Save a contract
contract
  .command('add')
  .description('Save a contract with an alias')
  .requiredOption('--alias <alias>', 'Alias for the contract')
  .requiredOption('--address <address>', 'Contract address')
  .option('--label <label>', 'Optional label/description')
  .option('--network <network>', 'Network the contract is on')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      if (!ethers.isAddress(options.address)) {
        out.error(`Invalid address: ${options.address}`);
        return;
      }

      const network = options.network || globalOpts.network;
      const saved = saveContract(options.alias, options.address, network, options.label);

      out.success(`Contract saved as "${options.alias}"`);
      out.print({
        alias: options.alias,
        address: options.address,
        network,
        label: options.label || '',
        created: saved.created
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// contract list - List saved contracts
contract
  .command('list')
  .description('List all saved contracts')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const contracts = listContracts();

      if (contracts.length === 0) {
        out.info('No contracts saved. Use "ethnotary contract add" to save one.');
        out.print({ contracts: [] });
        return;
      }

      out.print({
        count: contracts.length,
        contracts
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// contract remove - Remove a saved contract
contract
  .command('remove')
  .description('Remove a saved contract')
  .requiredOption('--alias <alias>', 'Alias of contract to remove')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      removeContract(options.alias);
      out.success(`Contract "${options.alias}" removed`);
      out.print({
        alias: options.alias,
        status: 'removed'
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// contract default - Set or show default contract (legacy, kept for compatibility)
contract
  .command('default')
  .description('Set or show the default contract (alias for checkout/current)')
  .option('--alias <alias>', 'Set this alias as default')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      if (options.alias) {
        setDefaultContract(options.alias);
        out.success(`Switched to "${options.alias}"`);
        out.print({
          current: options.alias,
          status: 'checked_out'
        });
      } else {
        const defaultContract = getDefaultContract();
        if (defaultContract) {
          out.print({
            current: defaultContract.alias,
            address: defaultContract.address,
            network: defaultContract.network
          });
        } else {
          out.info('No contract checked out. Use "ethnotary checkout <alias>"');
          out.print({ current: null });
        }
      }

    } catch (error) {
      out.error(error.message);
    }
  });

// contract checkout - Switch to a different contract (like git checkout)
contract
  .command('checkout <alias>')
  .description('Switch to a different contract (like git checkout)')
  .action(async (alias, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      setDefaultContract(alias);
      const contract = getDefaultContract();
      
      out.success(`Switched to "${alias}"`);
      out.print({
        current: alias,
        address: contract.address,
        network: contract.network,
        label: contract.label || ''
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// contract current - Show current checked out contract (like git branch)
contract
  .command('current')
  .alias('status')
  .description('Show the currently active contract')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const current = getDefaultContract();
      
      if (current) {
        if (!globalOpts.json) {
          out.info(`On account: ${current.alias}`);
          out.info(`Address: ${current.address}`);
          out.info(`Network: ${current.network}`);
          if (current.label) out.info(`Label: ${current.label}`);
        }
        out.print({
          current: current.alias,
          address: current.address,
          network: current.network,
          label: current.label || ''
        });
      } else {
        out.warn('No contract checked out.');
        out.info('Use "ethnotary checkout <alias>" to switch to a contract.');
        out.info('Use "ethnotary contract list" to see available contracts.');
        out.print({ current: null });
      }

    } catch (error) {
      out.error(error.message);
    }
  });

module.exports = contract;
