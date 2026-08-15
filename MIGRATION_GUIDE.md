# Ethnotary CLI Migration Guide

## Latest Changes: Nonce Removal (Version 1.1.0)

**Date:** March 9, 2026  
**Breaking Change:** ⚠️ Yes  
**Migration Required:** Yes

---

## What Changed?

### Major: Removed PIN Nonce Tracking

**Previous Behavior:**
- Each PIN-verified operation required a global nonce
- Users had to query `pinNonce()` before every transaction
- Simultaneous operations could fail due to nonce race conditions

**New Behavior:**
- ✅ **No nonce tracking required**
- ✅ **No state management** for clients
- ✅ **Simpler, more reliable UX**

### Why This Is Safe

The security is maintained through **msg.sender binding** in the zk-proof:

```
Public Signals: [pinHash, sender]
Private Witness: [pin]
```

This means:
1. Each owner's proof is bound to their unique address
2. Proofs cannot be reused by other addresses
3. No global state = no race conditions
4. Simpler code = fewer bugs

---

## Smart Contract Changes

### Function Signature Updates

All PIN-verified functions **removed** the `_expectedNonce` parameter:

#### `addOwner()`
```solidity
// ❌ OLD
function addOwner(
    address accountOwner,
    uint[2] calldata _pA,
    uint[2][2] calldata _pB,
    uint[2] calldata _pC,
    uint256 _expectedNonce  // REMOVED
) public

// ✅ NEW
function addOwner(
    address accountOwner,
    uint[2] calldata _pA,
    uint[2][2] calldata _pB,
    uint[2] calldata _pC
) public
```

#### `removeOwner()`
```solidity
// ❌ OLD: 5 parameters
function removeOwner(address, uint[2], uint[2][2], uint[2], uint256)

// ✅ NEW: 4 parameters
function removeOwner(address, uint[2], uint[2][2], uint[2])
```

#### `replaceOwner()`
```solidity
// ❌ OLD: 6 parameters
function replaceOwner(address, address, uint[2], uint[2][2], uint[2], uint256)

// ✅ NEW: 5 parameters
function replaceOwner(address, address, uint[2], uint[2][2], uint[2])
```

#### `changeRequirement()`
```solidity
// ❌ OLD
function changeRequirement(uint, uint[2], uint[2][2], uint[2], uint256)

// ✅ NEW
function changeRequirement(uint, uint[2], uint[2][2], uint[2])
```

#### `deleteTransaction()`
```solidity
// ❌ OLD
function deleteTransaction(uint, uint[2], uint[2][2], uint[2], uint256)

// ✅ NEW
function deleteTransaction(uint, uint[2], uint[2][2], uint[2])
```

#### `confirmTransaction()`
```solidity
// ❌ OLD
function confirmTransaction(uint transactionId, uint256 _expectedNonce)

// ✅ NEW
function confirmTransaction(uint transactionId)
```

### State Variable Changes

```solidity
// ⚠️ DEPRECATED but still exists for backwards compatibility
uint256 public pinNonce;  // No longer incremented or used
```

### Circuit Changes

**Circom Circuit:** `circuits/pin_verify.circom`

```circom
// ❌ OLD: 3 public signals
component main {public [pinHash, nonce, sender]} = PinVerify();

// ✅ NEW: 2 public signals
component main {public [pinHash, sender]} = PinVerify();
```

### Verifier Contract Changes

**Interface:** `src/IVerifier.sol`

```solidity
// ❌ OLD: 3 public signals
function verifyProof(
    uint[2] calldata _pA,
    uint[2][2] calldata _pB,
    uint[2] calldata _pC,
    uint[3] calldata _pubSignals  // [pinHash, nonce, sender]
) external view returns (bool);

// ✅ NEW: 2 public signals
function verifyProof(
    uint[2] calldata _pA,
    uint[2][2] calldata _pB,
    uint[2] calldata _pC,
    uint[2] calldata _pubSignals  // [pinHash, sender]
) external view returns (bool);
```

---

## Migration Steps

### For Smart Contract Developers

1. **Update Contract Calls**
   Remove the nonce parameter from all function calls:

   ```solidity
   // Before
   multisig.addOwner(newOwner, pA, pB, pC, nonce);
   
   // After
   multisig.addOwner(newOwner, pA, pB, pC);
   ```

2. **Redeploy Verifier Contract** (if using custom verifier)
   - Recompile circuit with 2 public signals
   - Generate new verification key
   - Deploy updated verifier

3. **Update Tests**
   Remove nonce tracking from test files:

   ```javascript
   // Before
   const nonce = await multisig.pinNonce();
   await multisig.confirmTransaction(txId, nonce);
   
   // After
   await multisig.confirmTransaction(txId);
   ```

### For JavaScript/CLI Developers

1. **Update ABI References**
   ```javascript
   // Remove nonce from function signatures
   const MULTISIG_ABI = [
       "function confirmTransaction(uint transactionId) public",
       "function addOwner(address, uint[2], uint[2][2], uint[2])",
       // ... remove all _expectedNonce parameters
   ];
   ```

2. **Remove Nonce Fetching**
   ```javascript
   // DELETE this code:
   // const nonce = await multisig.pinNonce();
   
   // Just call directly:
   await multisig.confirmTransaction(txId);
   ```

3. **Update Proof Generation**
   ```javascript
   // Before (3 public signals)
   const proof = await snarkjs.groth16.fullProve(
       { pin: userPin, nonce: currentNonce, sender: userAddress },
       witnessPath,
       zkeyPath
   );
   const publicSignals = [pinHash, currentNonce, userAddress];
   
   // After (2 public signals)
   const proof = await snarkjs.groth16.fullProve(
       { pin: userPin, sender: userAddress },
       witnessPath,
       zkeyPath
   );
   const publicSignals = [pinHash, userAddress];
   ```

4. **Simplify Error Handling**
   ```javascript
   // No more "nonce mismatch" errors to handle!
   try {
       await multisig.confirmTransaction(txId);
   } catch (error) {
       // Handle: IncorrectPin, NotOwner, etc.
       // But NOT: NonceMismatch
   }
   ```

### For Existing Deployments

⚠️ **Important:** If you have an existing deployment:

1. **Non-Breaking:** Existing multisig accounts continue to work
2. **Breaks:** New contract interactions must use updated ABI
3. **Recommendation:** 
   - Deploy new factory with updated verifier
   - Migrate users gradually
   - Maintain old contract for backwards compatibility during transition

---

## Testing

### Run Smart Contract Tests
```bash
cd ethnotary_cli
forge test --match-contract MultiSigTest -v
```

**Expected Output:**
```
Ran 21 tests for test/MultiSig.t.sol:MultiSigTest
[PASS] test_ConfirmTransaction() (gas: 180209)
[PASS] test_Execute() (gas: 241457)
...
Suite result: ok. 21 passed; 0 failed
```

### Regenerate zk-SNARK Proofs
```bash
# Recompile circuit
cd circuits
circom pin_verify.circom --r1cs --wasm --sym

# Setup Phase 1 (if needed)
snarkjs powersoftau new bn128 12 powersOfTau28_hez_final_12.ptau

# Generate verification key
snarkjs zkey new pin_verify.r1cs powersOfTau28_hez_final_12.ptau pin_verify_0000.zkey

# Export verification key
snarkjs zkey export verificationkey pin_verify_0000.zkey verification_key.json
```

### Test Proof Generation
```bash
node scripts/test_zk_proof.js
```

---

## Benefits Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Public Signals** | 3 (pinHash, nonce, sender) | 2 (pinHash, sender) |
| **State Changes** | Increment nonce | None |
| **Client Complexity** | Query nonce, handle failures | Generate proof, call function |
| **Race Conditions** | Possible | Impossible |
| **Failed Transactions** | Nonce mismatch | None |
| **Gas Cost** | Higher (SSTORE for nonce) | Lower |
| **User Experience** | Complex | Simple |

---

## Troubleshooting

### Common Issues

#### 1. "Wrong number of arguments" Error

**Cause:** Still passing nonce parameter

**Fix:**
```javascript
// ❌ WRONG
await contract.addOwner(addr, pA, pB, pC, nonce);

// ✅ CORRECT
await contract.addOwner(addr, pA, pB, pC);
```

#### 2. "Wrong number of public signals" Error

**Cause:** Using old verifier with new circuit or vice versa

**Fix:**
- Ensure verifier contract matches circuit (2 public signals)
- Redeploy verifier if needed

#### 3. "Proof verification failed" Error

**Cause:** Public signals don't match what proof was generated with

**Fix:**
```javascript
// Ensure order matches circuit
const publicSignals = [pinHash, senderAddress];  // ✅ Correct
// NOT: [pinHash, nonce, senderAddress]  // ❌ Old format
```

---

## Questions?

- Check `SECURITY_REVIEW.md` for security details
- Review `test/MultiSig.t.sol` for implementation examples
- Open an issue for migration support

---

**Last Updated:** March 9, 2026  
**Version:** 1.1.0
