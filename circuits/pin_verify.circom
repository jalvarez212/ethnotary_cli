pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

template PinVerify() {
    // Public inputs
    signal input pinHash;
    signal input sender; // Bind proof to msg.sender - prevents replay attacks
    
    // Private input (witness)
    signal input pin;
    
    // 1. Verify PIN matches static hash (Poseidon(1))
    component hasher = Poseidon(1);
    hasher.inputs[0] <== pin;
    pinHash === hasher.out;

    // 2. Bind sender to proof (prevents proof reuse by different addresses)
    component binder = Poseidon(2);
    binder.inputs[0] <== pin;
    binder.inputs[1] <== sender;
    // Note: binder.out is unused but the constraints are added to the system
}

// Main component with pinHash and sender as public inputs (nonce removed for better UX)
component main {public [pinHash, sender]} = PinVerify();
