const { Command } = require('commander');
const { createOutput } = require('../../utils/output');
const { createKeystore, importKeystore, getKeystoreAddress, keystoreExists } = require('../../utils/auth');
const { ethers } = require('ethers');

const wallet = new Command('wallet')
  .description('Wallet management commands');

// wallet init - Generate new wallet
wallet
  .command('init')
  .description('Generate a new wallet and save encrypted keystore')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      if (keystoreExists()) {
        const existingAddress = getKeystoreAddress();
        out.error(`Keystore already exists with address: ${existingAddress}. Use "ethnotary wallet import" to replace.`);
        return;
      }

      let password;
      
      if (globalOpts.json) {
        // In JSON mode, generate wallet and output private key (for agent setup)
        const wallet = ethers.Wallet.createRandom();
        out.print({
          address: wallet.address,
          privateKey: wallet.privateKey,
          mnemonic: wallet.mnemonic.phrase,
          note: 'Store these securely. Use --private-key or PRIVATE_KEY env var to authenticate.'
        });
        return;
      }

      // Interactive mode - prompt for password
      const inquirer = require('inquirer');
      const answers = await inquirer.prompt([
        {
          type: 'password',
          name: 'password',
          message: 'Enter password to encrypt keystore:',
          mask: '*',
          validate: (input) => input.length >= 8 || 'Password must be at least 8 characters'
        },
        {
          type: 'password',
          name: 'confirmPassword',
          message: 'Confirm password:',
          mask: '*',
          validate: (input, answers) => input === answers.password || 'Passwords do not match'
        }
      ]);

      out.startSpinner('Generating wallet and encrypting keystore...');
      const newWallet = await createKeystore(answers.password);
      out.succeedSpinner('Wallet created successfully');

      out.print({
        address: newWallet.address,
        mnemonic: newWallet.mnemonic.phrase
      }, { title: '\n🔐 New Wallet Created' });

      out.warn('Save your mnemonic phrase securely. It will not be shown again.');

    } catch (error) {
      out.error(error.message);
    }
  });

// wallet import - Import existing key/mnemonic
wallet
  .command('import')
  .description('Import an existing private key or mnemonic phrase')
  .option('--key <privateKey>', 'Private key to import')
  .option('--mnemonic <phrase>', 'Mnemonic phrase to import')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      let keyOrMnemonic = options.key || options.mnemonic;

      if (!keyOrMnemonic) {
        if (globalOpts.json) {
          out.error('Provide --key or --mnemonic in JSON mode');
          return;
        }

        const inquirer = require('inquirer');
        const { inputType } = await inquirer.prompt([{
          type: 'list',
          name: 'inputType',
          message: 'What do you want to import?',
          choices: ['Private Key', 'Mnemonic Phrase']
        }]);

        const { input } = await inquirer.prompt([{
          type: 'password',
          name: 'input',
          message: `Enter your ${inputType.toLowerCase()}:`,
          mask: '*'
        }]);
        keyOrMnemonic = input;
      }

      let password;
      if (globalOpts.json) {
        // In JSON mode, just validate and output address
        let testWallet;
        if (keyOrMnemonic.includes(' ')) {
          testWallet = ethers.Wallet.fromPhrase(keyOrMnemonic);
        } else {
          testWallet = new ethers.Wallet(keyOrMnemonic);
        }
        out.print({
          address: testWallet.address,
          note: 'Use --private-key or PRIVATE_KEY env var to authenticate.'
        });
        return;
      }

      const inquirer = require('inquirer');
      const { password: pwd } = await inquirer.prompt([{
        type: 'password',
        name: 'password',
        message: 'Enter password to encrypt keystore:',
        mask: '*',
        validate: (input) => input.length >= 8 || 'Password must be at least 8 characters'
      }]);

      out.startSpinner('Importing and encrypting keystore...');
      const importedWallet = await importKeystore(keyOrMnemonic, pwd);
      out.succeedSpinner('Wallet imported successfully');

      out.print({ address: importedWallet.address }, { title: '\n🔐 Wallet Imported' });

    } catch (error) {
      out.error(error.message);
    }
  });

// wallet show - Display wallet address
wallet
  .command('show')
  .description('Display the current wallet address')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      // Priority 1: --private-key flag (explicit override)
      if (globalOpts.privateKey) {
        const wallet = new ethers.Wallet(globalOpts.privateKey);
        out.print({ address: wallet.address, source: 'private-key-flag' });
        return;
      }

      // Priority 2: Keystore (default if exists)
      if (keystoreExists()) {
        const address = getKeystoreAddress();
        out.print({ address: address, source: 'keystore' });
        return;
      }

      // Priority 3: Environment variable (fallback)
      if (process.env.PRIVATE_KEY) {
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
        out.print({ address: wallet.address, source: 'environment' });
        return;
      }

      out.error('No wallet configured. Use --private-key, set PRIVATE_KEY env var, or run "ethnotary wallet init"');

    } catch (error) {
      out.error(error.message);
    }
  });

module.exports = wallet;
