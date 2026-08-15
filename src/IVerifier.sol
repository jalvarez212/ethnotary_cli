// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IVerifier
 * @dev Interface for Groth16 zk-SNARK verifier contract
 * This interface will be implemented by the auto-generated verifier from snarkjs
 */
interface IVerifier {
    /**
     * @dev Verifies a zk-SNARK proof
     * @param _pA Proof point A (2 elements)
     * @param _pB Proof point B (2x2 elements)
     * @param _pC Proof point C (2 elements)
     * @param _pubSignals Public signals (pinHash and sender)
     * @return bool True if proof is valid, false otherwise
     */
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[2] calldata _pubSignals
    ) external view returns (bool);
}
