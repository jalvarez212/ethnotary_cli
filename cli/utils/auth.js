const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ETHNOTARY_DIR = path.join(os.homedir(), '.ethnotary');
const KEYSTORE_PATH = path.join(ETHNOTARY_DIR, 'keystore.json');

// Ensure .ethnotary directory exists
function ensureDir() {
  if (!fs.existsSync(ETHNOTARY_DIR)) {
    fs.mkdirSync(ETHNOTARY_DIR, { recursive: true });
  }
}

/**
 * Get wallet from various sources (priority order):
 * 1. --private-key flag (explicit override)
 * 2. Encrypted keystore (default if exists)
 * 3. PRIVATE_KEY env var (fallback for scripts/automation)
 */
async function getWallet(options = {}) {
  // Priority 1: Direct private key from CLI flag (explicit override)
  if (options.privateKey) {
    try {
      return new ethers.Wallet(options.privateKey);
    } catch (e) {
      throw new Error(`Invalid private key provided: ${e.message}`);
    }
  }

  // Priority 2: Encrypted keystore (default if exists)
  if (keystoreExists()) {
    if (!options.password) {
      // In non-interactive mode (--json), fall back to env var
      if (options.json) {
        if (process.env.PRIVATE_KEY) {
          return new ethers.Wallet(process.env.PRIVATE_KEY);
        }
        throw new Error('No private key provided. Use --private-key or set PRIVATE_KEY env var.');
      }
      // Interactive mode - prompt for password
      const inquirer = require('inquirer');
      const { password } = await inquirer.prompt([{
        type: 'password',
        name: 'password',
        message: 'Enter keystore password:',
        mask: '*'
      }]);
      options.password = password;
    }
    return await loadKeystore(options.password);
  }

  // Priority 3: Environment variable (fallback for scripts/automation)
  if (process.env.PRIVATE_KEY) {
    try {
      return new ethers.Wallet(process.env.PRIVATE_KEY);
    } catch (e) {
      throw new Error(`Invalid PRIVATE_KEY in environment: ${e.message}`);
    }
  }

  throw new Error('No wallet configured. Use --private-key, set PRIVATE_KEY env var, or run "ethnotary wallet init"');
}

/**
 * Check if keystore file exists
 */
function keystoreExists() {
  return fs.existsSync(KEYSTORE_PATH);
}

/**
 * Create new wallet and save encrypted keystore
 */
async function createKeystore(password) {
  ensureDir();
  const wallet = ethers.Wallet.createRandom();
  const encryptedJson = await wallet.encrypt(password);
  fs.writeFileSync(KEYSTORE_PATH, encryptedJson);
  return wallet;
}

/**
 * Import existing key/mnemonic and save encrypted keystore
 */
async function importKeystore(keyOrMnemonic, password) {
  ensureDir();
  let wallet;
  
  // Try as mnemonic first
  if (keyOrMnemonic.includes(' ')) {
    try {
      wallet = ethers.Wallet.fromPhrase(keyOrMnemonic);
    } catch (e) {
      throw new Error(`Invalid mnemonic phrase: ${e.message}`);
    }
  } else {
    // Try as private key
    try {
      wallet = new ethers.Wallet(keyOrMnemonic);
    } catch (e) {
      throw new Error(`Invalid private key: ${e.message}`);
    }
  }

  const encryptedJson = await wallet.encrypt(password);
  fs.writeFileSync(KEYSTORE_PATH, encryptedJson);
  return wallet;
}

/**
 * Load and decrypt keystore
 */
async function loadKeystore(password) {
  if (!keystoreExists()) {
    throw new Error('No keystore found. Run "ethnotary wallet init" first.');
  }
  
  const encryptedJson = fs.readFileSync(KEYSTORE_PATH, 'utf8');
  try {
    return await ethers.Wallet.fromEncryptedJson(encryptedJson, password);
  } catch (e) {
    throw new Error('Incorrect password or corrupted keystore');
  }
}

/**
 * Get wallet address from keystore without decrypting
 */
function getKeystoreAddress() {
  if (!keystoreExists()) {
    return null;
  }
  const encryptedJson = JSON.parse(fs.readFileSync(KEYSTORE_PATH, 'utf8'));
  return encryptedJson.address ? `0x${encryptedJson.address}` : null;
}

module.exports = {
  getWallet,
  keystoreExists,
  createKeystore,
  importKeystore,
  loadKeystore,
  getKeystoreAddress,
  ETHNOTARY_DIR,
  KEYSTORE_PATH
};
