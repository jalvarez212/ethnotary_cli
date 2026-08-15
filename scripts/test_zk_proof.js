/**
 * ZK Proof Generation Test Script
 * 
 * This script tests proof generation using the same pattern as the frontend.
 * It verifies that the circuit works correctly with snarkjs.
 */

const snarkjs = require('snarkjs');
const { poseidon1 } = require('poseidon-lite');
const fs = require('fs');
const path = require('path');

// Paths to circuit artifacts
const WASM_PATH = path.join(__dirname, '../public/zk/pin_verify.wasm');
const ZKEY_PATH = path.join(__dirname, '../public/zk/pin_verify_final.zkey');
const VKEY_PATH = path.join(__dirname, '../public/zk/verification_key.json');

/**
 * Compute PIN hash using Poseidon (same as frontend)
 */
function computePinHash(pin) {
    const pinBigInt = BigInt(pin);
    const hashBigInt = poseidon1([pinBigInt]);
    return '0x' + hashBigInt.toString(16).padStart(64, '0');
}

/**
 * Generate ZK proof (same pattern as zkProofGenerator.js)
 */
async function generateProof(pin, pinHash, nonce, sender) {
    console.log('\n🔐 Generating zk-SNARK proof...');
    console.log('  📋 Inputs:');
    console.log(`    - PIN: ${pin}`);
    console.log(`    - pinHash: ${pinHash}`);
    console.log(`    - nonce: ${nonce}`);
    console.log(`    - sender: ${sender}`);

    // Verify PIN hash matches (same check as frontend)
    const computedHash = computePinHash(pin);
    console.log('\n  🔍 Verification check:');
    console.log(`    - Client-computed hash: ${computedHash}`);
    console.log(`    - Expected hash:        ${pinHash}`);

    if (computedHash.toLowerCase() !== pinHash.toLowerCase()) {
        throw new Error(`PIN HASH MISMATCH! Computed: ${computedHash}, Expected: ${pinHash}`);
    }
    console.log('  ✅ PIN hash matches!');

    // Prepare circuit inputs (same as frontend)
    const input = {
        pin: BigInt(pin).toString(),
        pinHash: BigInt(pinHash).toString(),
        nonce: BigInt(nonce).toString(),
        sender: BigInt(sender).toString()
    };

    console.log('\n  📊 Circuit inputs:');
    console.log(`    - pin: ${input.pin}`);
    console.log(`    - pinHash: ${input.pinHash}`);
    console.log(`    - nonce: ${input.nonce}`);
    console.log(`    - sender: ${input.sender}`);

    // Generate proof
    console.log('\n  ⏳ Computing witness and generating proof...');
    const startTime = Date.now();
    
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        WASM_PATH,
        ZKEY_PATH
    );

    const duration = Date.now() - startTime;
    console.log(`  ✅ Proof generated in ${duration}ms`);

    // Format proof for Solidity (same as frontend)
    const pA = [proof.pi_a[0], proof.pi_a[1]];
    const pB = [
        [proof.pi_b[0][1], proof.pi_b[0][0]],
        [proof.pi_b[1][1], proof.pi_b[1][0]]
    ];
    const pC = [proof.pi_c[0], proof.pi_c[1]];

    return {
        proof: { pA, pB, pC },
        publicSignals,
        rawProof: proof
    };
}

/**
 * Verify proof using verification key
 */
async function verifyProof(proof, publicSignals) {
    console.log('\n🔍 Verifying proof...');
    
    const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, 'utf8'));
    const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    
    return isValid;
}

/**
 * Main test function
 */
async function main() {
    console.log('========================================');
    console.log('🧪 ZK Proof Generation Test');
    console.log('========================================');

    // Check if files exist
    console.log('\n📁 Checking circuit artifacts...');
    if (!fs.existsSync(WASM_PATH)) {
        console.error(`❌ WASM file not found: ${WASM_PATH}`);
        console.log('   Run: bash scripts/compile_and_test_circuit.sh');
        process.exit(1);
    }
    if (!fs.existsSync(ZKEY_PATH)) {
        console.error(`❌ Zkey file not found: ${ZKEY_PATH}`);
        console.log('   Run: bash scripts/compile_and_test_circuit.sh');
        process.exit(1);
    }
    if (!fs.existsSync(VKEY_PATH)) {
        console.error(`❌ Verification key not found: ${VKEY_PATH}`);
        console.log('   Run: bash scripts/compile_and_test_circuit.sh');
        process.exit(1);
    }
    console.log('  ✅ All circuit artifacts found');

    // Test parameters (same as the contract we've been testing)
    const TEST_PIN = '303';
    const TEST_NONCE = '0';
    const TEST_SENDER = '0x1c5456054aa45f708f664aa7e6ff5d62bce3c10d';

    // Compute expected hash
    const expectedHash = computePinHash(TEST_PIN);
    console.log(`\n📊 Test Parameters:`);
    console.log(`  - PIN: ${TEST_PIN}`);
    console.log(`  - Expected Hash: ${expectedHash}`);
    console.log(`  - Nonce: ${TEST_NONCE}`);
    console.log(`  - Sender: ${TEST_SENDER}`);

    try {
        // Generate proof
        const result = await generateProof(
            TEST_PIN,
            expectedHash,
            TEST_NONCE,
            TEST_SENDER
        );

        console.log('\n📤 Proof Output:');
        console.log('  Public Signals:', result.publicSignals);

        // Verify proof
        const isValid = await verifyProof(result.rawProof, result.publicSignals);
        
        if (isValid) {
            console.log('\n✅ PROOF VERIFIED SUCCESSFULLY!');
            console.log('\n📋 Solidity-formatted proof:');
            console.log('  pA:', JSON.stringify(result.proof.pA));
            console.log('  pB:', JSON.stringify(result.proof.pB));
            console.log('  pC:', JSON.stringify(result.proof.pC));
        } else {
            console.log('\n❌ PROOF VERIFICATION FAILED!');
            process.exit(1);
        }

        // Test with wrong PIN (should fail hash check)
        console.log('\n========================================');
        console.log('🧪 Testing with WRONG PIN (should fail)');
        console.log('========================================');
        
        try {
            await generateProof('999', expectedHash, TEST_NONCE, TEST_SENDER);
            console.log('❌ ERROR: Should have thrown PIN mismatch error!');
            process.exit(1);
        } catch (error) {
            if (error.message.includes('PIN HASH MISMATCH')) {
                console.log('✅ Correctly rejected wrong PIN');
            } else {
                throw error;
            }
        }

        console.log('\n========================================');
        console.log('🎉 ALL TESTS PASSED!');
        console.log('========================================');
        console.log('\nThe circuit is working correctly.');
        console.log('You can now use the frontend to generate proofs.');

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();
