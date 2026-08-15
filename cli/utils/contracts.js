const fs = require('fs');
const path = require('path');
const os = require('os');
const { ethers } = require('ethers');

const ETHNOTARY_DIR = path.join(os.homedir(), '.ethnotary');
const CONTRACTS_PATH = path.join(ETHNOTARY_DIR, 'contracts.json');

// Ensure .ethnotary directory exists
function ensureDir() {
  if (!fs.existsSync(ETHNOTARY_DIR)) {
    fs.mkdirSync(ETHNOTARY_DIR, { recursive: true });
  }
}

// Load contracts file
function loadContracts() {
  if (!fs.existsSync(CONTRACTS_PATH)) {
    return { contracts: {}, default: null };
  }
  try {
    return JSON.parse(fs.readFileSync(CONTRACTS_PATH, 'utf8'));
  } catch (e) {
    return { contracts: {}, default: null };
  }
}

// Save contracts file
function saveContracts(data) {
  ensureDir();
  fs.writeFileSync(CONTRACTS_PATH, JSON.stringify(data, null, 2));
}

// Migrate old single-network format to new multi-network format
function migrateContract(contract) {
  if (contract.network && !contract.networks) {
    // Old format: { network: "sepolia" } -> New format: { networks: ["sepolia"] }
    return {
      ...contract,
      networks: [contract.network],
      network: undefined // Remove old field
    };
  }
  return contract;
}

/**
 * Save a contract with alias
 * @param {string} alias - Contract alias
 * @param {string} address - Contract address
 * @param {string|string[]} networks - Network(s) the contract is deployed on
 * @param {string} label - Optional label
 */
function saveContract(alias, address, networks, label = '') {
  if (!ethers.isAddress(address)) {
    throw new Error(`Invalid address: ${address}`);
  }
  
  // Normalize networks to array
  const networkArray = Array.isArray(networks) ? networks : [networks];
  
  const data = loadContracts();
  
  // Check if contract already exists - merge networks if so
  if (data.contracts[alias]) {
    const existing = migrateContract(data.contracts[alias]);
    const mergedNetworks = [...new Set([...existing.networks, ...networkArray])];
    data.contracts[alias] = {
      address: address,
      networks: mergedNetworks,
      created: existing.created,
      updated: new Date().toISOString(),
      label: label || existing.label || ''
    };
  } else {
    data.contracts[alias] = {
      address: address,
      networks: networkArray,
      created: new Date().toISOString(),
      label: label || ''
    };
  }
  
  saveContracts(data);
  return data.contracts[alias];
}

/**
 * Add network(s) to an existing contract
 */
function addNetworkToContract(alias, networks) {
  const data = loadContracts();
  if (!data.contracts[alias]) {
    throw new Error(`Contract alias not found: ${alias}`);
  }
  
  const contract = migrateContract(data.contracts[alias]);
  const networkArray = Array.isArray(networks) ? networks : [networks];
  contract.networks = [...new Set([...contract.networks, ...networkArray])];
  contract.updated = new Date().toISOString();
  
  data.contracts[alias] = contract;
  saveContracts(data);
  return contract;
}

/**
 * Remove network from a contract
 */
function removeNetworkFromContract(alias, network) {
  const data = loadContracts();
  if (!data.contracts[alias]) {
    throw new Error(`Contract alias not found: ${alias}`);
  }
  
  const contract = migrateContract(data.contracts[alias]);
  contract.networks = contract.networks.filter(n => n !== network);
  contract.updated = new Date().toISOString();
  
  if (contract.networks.length === 0) {
    throw new Error(`Cannot remove last network from contract. Use "ethnotary remove ${alias}" to delete the contract.`);
  }
  
  data.contracts[alias] = contract;
  saveContracts(data);
  return contract;
}

/**
 * Get contract by alias or address
 * Returns { address, networks, label } or throws if not found
 */
function getContract(aliasOrAddress) {
  // If it's a valid address, return it directly (no network info)
  if (ethers.isAddress(aliasOrAddress)) {
    return { address: aliasOrAddress, networks: [], label: null };
  }

  // Look up by alias
  const data = loadContracts();
  const contract = data.contracts[aliasOrAddress];
  if (!contract) {
    throw new Error(`Contract alias not found: ${aliasOrAddress}. Use "ethnotary list" to see saved contracts.`);
  }
  return migrateContract(contract);
}

/**
 * Resolve address from alias, address, or default
 */
function resolveAddress(aliasOrAddress) {
  if (aliasOrAddress) {
    return getContract(aliasOrAddress).address;
  }
  
  // Try default
  const defaultContract = getDefaultContract();
  if (defaultContract) {
    return defaultContract.address;
  }
  
  throw new Error('No address provided and no default contract set. Use --address or run "ethnotary contract default <alias>"');
}

/**
 * List all saved contracts
 */
function listContracts() {
  const data = loadContracts();
  return Object.entries(data.contracts).map(([alias, contract]) => ({
    alias,
    ...migrateContract(contract),
    isDefault: data.default === alias
  }));
}

/**
 * Remove a saved contract
 */
function removeContract(alias) {
  const data = loadContracts();
  if (!data.contracts[alias]) {
    throw new Error(`Contract alias not found: ${alias}`);
  }
  delete data.contracts[alias];
  if (data.default === alias) {
    data.default = null;
  }
  saveContracts(data);
}

/**
 * Get default contract
 */
function getDefaultContract() {
  const data = loadContracts();
  if (!data.default) {
    return null;
  }
  const contract = data.contracts[data.default];
  if (!contract) {
    return null;
  }
  return { alias: data.default, ...contract };
}

/**
 * Set default contract
 */
function setDefaultContract(alias) {
  const data = loadContracts();
  if (!data.contracts[alias]) {
    throw new Error(`Contract alias not found: ${alias}`);
  }
  data.default = alias;
  saveContracts(data);
}

/**
 * Create a decoupled contract alias when sync fails
 */
function createDecoupledContract(originalAlias, address, network, label = '') {
  const decoupledAlias = `${originalAlias}-${network}-decoupled`;
  const data = loadContracts();
  
  data.contracts[decoupledAlias] = {
    address: address,
    networks: [network],
    created: new Date().toISOString(),
    label: label || `Decoupled from ${originalAlias}`,
    decoupledFrom: originalAlias,
    decoupledAt: new Date().toISOString()
  };
  
  saveContracts(data);
  return { alias: decoupledAlias, ...data.contracts[decoupledAlias] };
}

/**
 * Get contract networks (for interoperability)
 * If no aliasOrAddress provided, uses default contract
 */
function getContractNetworks(aliasOrAddress) {
  if (!aliasOrAddress) {
    const defaultContract = getDefaultContract();
    if (defaultContract) {
      return migrateContract(defaultContract).networks || [];
    }
    return [];
  }
  const contract = getContract(aliasOrAddress);
  return contract.networks || [];
}

module.exports = {
  saveContract,
  getContract,
  resolveAddress,
  listContracts,
  removeContract,
  getDefaultContract,
  setDefaultContract,
  addNetworkToContract,
  removeNetworkFromContract,
  createDecoupledContract,
  getContractNetworks,
  migrateContract,
  CONTRACTS_PATH
};
