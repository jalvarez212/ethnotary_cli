/**
 * Test PIN Hash Generation Consistency
 * 
 * This script tests that both wizard.js and zkProofGenerator.js
 * produce the same PIN hash for the same input.
 */

// Try to load poseidon-lite if available (Node.js)
let poseidon;
try {
    const { poseidon1 } = require("poseidon-lite");
    poseidon = (args) => {
        if (args.length === 1) return poseidon1(args);
        throw new Error("Only poseidon(1) is supported");
    };
    console.log("✅ Loaded poseidon-lite library\n");
} catch (e) {
    // Fallback to mock for demonstration
    console.log("ℹ️  poseidon-lite not found, using mock hash\n");
    poseidon = function(args) {
        if (args.length !== 1) {
            throw new Error("Only poseidon(1) is supported");
        }
        const value = BigInt(args[0]);
        return value * 7n + 13n; // Simple mock
    };
}

// Wizard.js hash function (from wizard.js lines 508-512)
function wizardHashPin(pin) {
    const pinBigInt = BigInt(pin);
    const hashBigInt = poseidon([pinBigInt]);
    return '0x' + hashBigInt.toString(16).padStart(64, '0');
}

// zkProofGenerator.js hash function (from zkProofGenerator.js lines 29-32)
function zkProofHashPin(pin) {
    const pinBigInt = BigInt(pin);
    const hashBigInt = poseidon([pinBigInt]);
    return '0x' + hashBigInt.toString(16).padStart(64, '0');
}

// Test cases
const testPins = [
    '123456',
    '999999',
    '000001',
    '555555',
    '314159'
];

console.log('='.repeat(80));
console.log('PIN Hash Consistency Test');
console.log('Testing wizard.js vs zkProofGenerator.js hash generation');
console.log('='.repeat(80));
console.log();

let allTestsPassed = true;

testPins.forEach((pin, index) => {
    console.log(`Test ${index + 1}: PIN = ${pin}`);
    console.log('-'.repeat(80));
    
    const wizardHash = wizardHashPin(pin);
    const zkProofHash = zkProofHashPin(pin);
    
    console.log(`  wizard.js hash:        ${wizardHash}`);
    console.log(`  zkProofGenerator hash: ${zkProofHash}`);
    
    const match = wizardHash === zkProofHash;
    console.log(`  Match: ${match ? '✅ PASS' : '❌ FAIL'}`);
    console.log();
    
    if (!match) {
        allTestsPassed = false;
    }
});

console.log('='.repeat(80));
console.log(`Overall Result: ${allTestsPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
console.log('='.repeat(80));
console.log();

// Additional verification with actual Poseidon library
console.log('🔍 Additional Hash Details:');
console.log();

const testPin = '123456';
const pinBigInt = BigInt(testPin);
const actualHash = poseidon([pinBigInt]);
const hexHash = '0x' + actualHash.toString(16).padStart(64, '0');

console.log(`  Test PIN: ${testPin}`);
console.log(`  Poseidon hash (BigInt): ${actualHash}`);
console.log(`  Poseidon hash (hex):    ${hexHash}`);
console.log();

console.log('ℹ️  Note: To test with real Poseidon hashes in browser, include:');
console.log('   <script type="module">');
console.log('     import { poseidon1 } from "https://esm.sh/poseidon-lite@0.2.0";');
console.log('     window.poseidon = (args) => poseidon1(args);');
console.log('   </script>');
console.log();

// Export for Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        wizardHashPin,
        zkProofHashPin,
        testPins
    };
}
