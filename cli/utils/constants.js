/**
 * Centralized constants for ethnotary CLI
 * 
 * UPDATE THESE ADDRESSES when deploying new factory/verifier versions
 */

// Default MSA Factory address - same across most EVM networks via CREATE2
const DEFAULT_MSA_FACTORY = '0x3DEB514B2ac536b8048f5b37182196cf9d5dDD45';

// Default PIN Verifier (Groth16Verifier) address - same across most EVM networks via CREATE2
const DEFAULT_PIN_VERIFIER = '0x65ee46C4d21405f4a4C8e9d0F8a3832c1B885ab4';

// Per-network factory overrides (for chains where CREATE2 produces a different address,
// or where the factory was deployed via a non-CREATE2 path). Update after running setup.js.
const FACTORY_OVERRIDES = {
  'hedera-testnet': '0x918D413056F3Edf38017a37df758b3a4Fa3d06ff'
};

// MSAFactory ABI - functions needed for account creation
const MSA_FACTORY_ABI = [
  "function newMSA(address[] calldata _owners, uint _required, bytes32 _pinHash, string calldata _name) external payable returns (address)",
  "function predictMSAAddress(address[] calldata _owners, uint _required, bytes32 _pinHash, string calldata _name) external view returns (address)",
  "function notaryFee() view returns (uint256)",
  "function pinVerifier() view returns (address)",
  "event NewMSACreated(address indexed msaAddress)"
];

// MultiSig ABI - functions needed for account management
const MULTISIG_ABI = [
  "function getOwners() view returns (address[])",
  "function required() view returns (uint)",
  "function isOwner(address) view returns (bool)",
  "function pinHash() view returns (bytes32)",
  "function pinNonce() view returns (uint256)",
  "function addOwner(address accountOwner, uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC) public",
  "function removeOwner(address accountOwner, uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC) public",
  "function replaceOwner(address accountOwner, address newOwner, uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC) public"
];

/**
 * Get the factory address for a given network
 * Priority: network-specific env var > generic env var > default
 * 
 * @param {string} network - Network key (e.g., 'sepolia', 'base-sepolia')
 * @returns {string} Factory address
 */
function getFactoryAddress(network) {
  if (network) {
    const envKey = `${network.toUpperCase().replace(/-/g, '_')}_FACTORY_ADDRESS`;
    if (process.env[envKey]) {
      return process.env[envKey];
    }
    if (FACTORY_OVERRIDES[network]) {
      return FACTORY_OVERRIDES[network];
    }
  }
  return process.env.MSA_FACTORY_ADDRESS || DEFAULT_MSA_FACTORY;
}

/**
 * Get the PIN verifier address
 * Priority: env var > default
 * 
 * @returns {string} Verifier address
 */
function getVerifierAddress() {
  return process.env.PIN_VERIFIER_ADDRESS || DEFAULT_PIN_VERIFIER;
}

module.exports = {
  DEFAULT_MSA_FACTORY,
  DEFAULT_PIN_VERIFIER,
  MSA_FACTORY_ABI,
  MULTISIG_ABI,
  getFactoryAddress,
  getVerifierAddress
};
