# zk-SNARK PIN Verification System

This implementation provides zero-knowledge proof-based PIN verification for the MultiSig wallet, ensuring PINs never appear on-chain while maintaining security.

## 🎯 Overview

The system uses Groth16 zk-SNARKs to prove knowledge of a PIN without revealing it. The circuit verifies that `hash(pin, nonce) == pinHash`, where:
- `pin` is the private witness (never revealed)
- `pinHash` is stored publicly in the contract
- `nonce` prevents proof replay attacks

## 📁 Project Structure

```
v3/
├── circuits/
│   └── pin_verify.circom          # Circom circuit definition
├── src/
│   ├── IVerifier.sol              # Verifier interface
│   ├── PinVerifier.sol            # Auto-generated verifier (after compilation)
│   └── MultiSig.sol               # Updated MultiSig contracts
├── public/
│   └── scripts/
│       └── zkProofGenerator.js    # Frontend proof generation
├── build/                         # Generated after compilation
│   ├── pin_verify_js/
│   │   └── pin_verify.wasm       # Witness generator
│   ├── pin_verify_final.zkey     # Proving key
│   └── verification_key.json     # Verification key
└── compile_circuit.sh             # Compilation script
```

## 🚀 Setup Instructions

### 1. Install Dependencies

```bash
# Install circom and snarkjs globally
npm install -g circom snarkjs

# Install circomlib locally
npm install circomlib
```

### 2. Compile the Circuit

```bash
# Run the compilation script
./compile_circuit.sh
```

This will:
- Compile the Circom circuit to WASM and R1CS
- Download Powers of Tau (trusted setup)
- Generate proving and verification keys
- Export the Solidity verifier contract

### 3. Deploy Contracts

```bash
# Deploy the verifier contract first
forge create src/PinVerifier.sol:Groth16Verifier --rpc-url $RPC_URL --private-key $PRIVATE_KEY

# Deploy MSAFactory with the verifier address
forge create src/MultiSig.sol:MSAFactory --constructor-args <VERIFIER_ADDRESS> --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

### 4. Host Circuit Artifacts

Upload `pin_verify.wasm` and `pin_verify_final.zkey` to IPFS or your CDN:

```bash
# Example with IPFS
ipfs add build/pin_verify_js/pin_verify.wasm
ipfs add build/pin_verify_final.zkey

# Pin on Pinata, Infura IPFS, or your own node
```

Update the URLs in `zkProofGenerator.js`:

```javascript
const zkProof = new ZKProofGenerator({
    wasmURL: 'https://ipfs.io/ipfs/QmXXX.../pin_verify.wasm',
    zkeyURL: 'https://ipfs.io/ipfs/QmYYY.../pin_verify_final.zkey'
});
```

## 💻 Frontend Integration

### Creating a Contract with PIN Hash

```javascript
// Compute PIN hash off-chain
const pin = 123456;
const pinBigInt = BigInt(pin);
const pinHex = '0x' + pinBigInt.toString(16).padStart(64, '0');
const pinHash = ethers.keccak256(pinHex);

// Deploy MultiSig with pinHash (not raw PIN)
const factory = new ethers.Contract(factoryAddress, factoryABI, signer);
const tx = await factory.newMSA(
    owners,
    required,
    pinHash,  // Only hash goes on-chain
    { value: fee }
);
```

### Using PIN-Protected Functions

```javascript
// Initialize proof generator
const zkProof = new ZKProofGenerator();

// Get contract instance
const multiSig = new ethers.Contract(contractAddress, multiSigABI, signer);

// Add owner with proof
const userPin = 123456;
const newOwnerAddress = '0x...';

const pinHash = await multiSig.pinHash();
const nonce = await multiSig.pinNonce();

// Generate proof
const { pA, pB, pC } = await zkProof.generateProof(userPin, pinHash, nonce);

// Call function with proof
const tx = await multiSig.addOwner(newOwnerAddress, pA, pB, pC);
await tx.wait();
```

### Helper Method

```javascript
// Simplified execution
await zkProof.executeWithProof(
    multiSig,
    'addOwner',
    [newOwnerAddress],
    userPin
);
```

## 🔒 Security Features

### Nonce-Based Replay Protection

Each proof is tied to a specific nonce that increments after each use:

```solidity
modifier verifyPinProof(
    uint[2] calldata _pA,
    uint[2][2] calldata _pB,
    uint[2] calldata _pC
) {
    uint[2] memory pubSignals = [uint256(pinHash), pinNonce];
    bool valid = pinVerifier.verifyProof(_pA, _pB, _pC, pubSignals);
    if (!valid) revert IncorrectPin();
    pinNonce++; // Increment to prevent replay
    _;
}
```

### What's Protected

✅ **PIN never appears on-chain** (not in creation, not in function calls)  
✅ **Proof replay prevented** (nonce increments after each use)  
✅ **Reentrancy protected** (existing guard maintained)  
✅ **Same deterministic addresses** (CREATE2 uses pinHash in salt)

### What's NOT Protected Against

⚠️ **Weak PINs** - Users can still choose `1234`. Consider enforcing minimum complexity.  
⚠️ **Device compromise** - Keyloggers can capture PIN when typed.  
⚠️ **Brute force on pinHash** - If PIN is weak, attackers can brute-force offline.

## 📊 Gas Costs

| Operation | Without zk-SNARK | With zk-SNARK | Difference |
|-----------|------------------|---------------|------------|
| Contract creation | ~2.5M gas | ~2.5M gas | Same |
| addOwner | ~50k gas | ~300k gas | +250k gas |
| removeOwner | ~30k gas | ~280k gas | +250k gas |
| Proof generation (off-chain) | 0 | ~2-5 seconds | Client-side |

The verifier contract adds ~250k gas per call due to elliptic curve operations.

## 🔧 Troubleshooting

### Circuit Compilation Fails

```bash
# Ensure circom is installed
circom --version

# Reinstall if needed
npm install -g circom@latest
```

### Proof Generation Fails

- Check that `.wasm` and `.zkey` URLs are accessible
- Verify snarkjs is loaded: `typeof snarkjs !== 'undefined'`
- Check browser console for CORS errors

### Verifier Rejects Valid Proof

- Ensure nonce matches: `await contract.pinNonce()`
- Verify pinHash matches: `await contract.pinHash()`
- Check that proof was generated with correct inputs

## 🧪 Testing

```javascript
// Test proof generation and verification
const zkProof = new ZKProofGenerator();
const pin = 123456;
const pinHash = await zkProof.computePinHash(pin);
const nonce = 0;

const { pA, pB, pC, publicSignals } = await zkProof.generateProof(pin, pinHash, nonce);

// Verify off-chain
const isValid = await zkProof.verifyProof({ pA, pB, pC }, publicSignals);
console.log('Proof valid:', isValid); // Should be true
```

## 📚 Additional Resources

- [Circom Documentation](https://docs.circom.io/)
- [snarkjs Documentation](https://github.com/iden3/snarkjs)
- [Groth16 Paper](https://eprint.iacr.org/2016/260.pdf)
- [Powers of Tau Ceremony](https://github.com/iden3/snarkjs#7-prepare-phase-2)

## 🔐 Production Checklist

- [ ] Run multi-party ceremony for trusted setup
- [ ] Upload circuit artifacts to IPFS with pinning
- [ ] Deploy verifier contract to all target networks
- [ ] Update frontend with IPFS URLs
- [ ] Enforce minimum PIN complexity in UI
- [ ] Add rate limiting for failed proof attempts
- [ ] Document verifier addresses in deployment config
- [ ] Test on testnets before mainnet deployment
- [ ] Audit smart contracts
- [ ] Verify circuit logic matches specification

## 📝 Notes

- The circuit uses Poseidon hash (SNARK-friendly)
- Powers of Tau from Hermez/Ethereum Foundation (trusted)
- Verifier contract is deterministic and can be shared across all MultiSigs
- Circuit artifacts (`.wasm`, `.zkey`) are safe to publish publicly
- Consider using PLONK or STARKs for no trusted setup requirement
