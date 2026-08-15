const { poseidon1 } = require('poseidon-lite');

/**
 * Compute PIN hash using Poseidon hash function
 * This hash is stored on-chain during contract creation
 * @param {string|number} pin - The PIN to hash
 * @returns {string} - Hex string of the hash (bytes32)
 */
function computePinHash(pin) {
  const pinBigInt = BigInt(pin);
  const hash = poseidon1([pinBigInt]);
  return '0x' + hash.toString(16).padStart(64, '0');
}

/**
 * Generate zkSNARK proof for PIN verification
 * Used for account management operations (add/remove/replace owner)
 * @param {string|number} pin - The PIN
 * @param {string} pinHash - The stored PIN hash from contract
 * @param {number} nonce - Current nonce from contract (unused - kept for API compatibility)
 * @param {string} sender - The sender address (msg.sender)
 * @returns {Object} - Proof components { pA, pB, pC }
 */
async function generateZkProof(pin, pinHash, nonce, sender) {
  const snarkjs = require('snarkjs');
  const path = require('path');
  const fs = require('fs');

  // Paths to circuit artifacts
  const wasmPath = path.join(__dirname, '../../zkbuild/pin_verify_js/pin_verify.wasm');
  const zkeyPath = path.join(__dirname, '../../zkbuild/pin_verify_final.zkey');

  // Check if circuit artifacts exist
  if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
    throw new Error('zkSNARK circuit artifacts not found. Run compile_circuit.sh first.');
  }

  // Convert sender address to BigInt (remove 0x prefix)
  const senderBigInt = BigInt(sender).toString();

  // Prepare inputs - circuit expects: pinHash, sender (public) + pin (private)
  // Note: nonce was removed from circuit for better UX
  const input = {
    pin: BigInt(pin).toString(),
    pinHash: pinHash,
    sender: senderBigInt
  };

  // Generate proof
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmPath,
    zkeyPath
  );

  // Format proof for Solidity verifier
  const pA = [proof.pi_a[0], proof.pi_a[1]];
  const pB = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]]
  ];
  const pC = [proof.pi_c[0], proof.pi_c[1]];

  return { pA, pB, pC, publicSignals };
}

/**
 * Verify a proof locally (for testing)
 */
async function verifyProofLocally(proof, publicSignals) {
  const snarkjs = require('snarkjs');
  const path = require('path');
  const fs = require('fs');

  const vkeyPath = path.join(__dirname, '../../zkbuild/verification_key.json');
  
  if (!fs.existsSync(vkeyPath)) {
    throw new Error('Verification key not found.');
  }

  const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
  return await snarkjs.groth16.verify(vkey, publicSignals, proof);
}

module.exports = {
  computePinHash,
  generateZkProof,
  verifyProofLocally
};
