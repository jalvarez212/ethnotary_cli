# MultiSig Contract Function Test Suite

## Overview

This test suite comprehensively tests all major functions of the MultiSig contract in the correct order, providing detailed gas analysis and function status reporting.

## Test Script

**File:** `test-multisig-functions.js`

## Prerequisites

1. **Node.js** and **npm** installed
2. **ethers.js** package: `npm install ethers`
3. **dotenv** package: `npm install dotenv`
4. Sufficient ETH in the target wallet for gas fees

## Configuration

The script uses the following configuration:

```javascript
{
    multisigAddress: '0x49909c741C0621D4637D6E8e61478a53916d284a',
    targetWallet: '0x1caefdf15648e7bdbfc9dc51076506d9454aa492',
    secretPhrase: process.env.MNEMONIC, // set in .env — never hardcode a real seed phrase
    pin: 212,
    nftAddress: '0xe6c1ee6624c6819262f29199dF25A70B2648B818',
    tokenAddress: '0x399ab04277063386023c41D0F77d15B79cb2d3BE',
    recipientAddress: '0x1c5456054aa45f708f664aa7e6ff5d62bce3c10d',
    network: 'Sepolia Testnet'
}
```

## Test Sequence

The script executes 22 tests in the following order:

### Asset Transfer Tests (1-6)
1. **Submit Transfer NFT** - Submit Doodle #234 NFT transfer
2. **Execute Transfer NFT** - Execute the NFT transfer
3. **Submit Transfer ERC20** - Submit 77 MT tokens transfer
4. **Execute Transfer ERC20** - Execute the token transfer
5. **Submit Native ETH Transfer** - Submit 0.00001 ETH transfer
6. **Execute Native ETH Transfer** - Execute the ETH transfer

### Transaction Management Tests (7-12)
7. **Submit Native Transfer (for revoke)** - Submit a transaction to test revoke
8. **Revoke Confirmation** - Revoke confirmation on the transaction
9. **Delete Transaction** - Delete the revoked transaction using PIN
10. **Submit ERC20 (for delete)** - Submit another transaction to test delete
11. **Revoke ERC20 Confirmation** - Revoke confirmation
12. **Delete ERC20 Transaction** - Delete using PIN

### Owner Management Tests (13-18)
13. **Submit Remove Owner** - Submit removal of 0xf6708b682066e15e85074bcCcf3252Ec51C1EB44
14. **Execute Remove Owner** - Execute the owner removal
15. **Submit Add Owner** - Submit addition of 0xf6708b682066e15e85074bcCcf3252Ec51C1EB44
16. **Execute Add Owner** - Execute the owner addition
17. **Submit Replace Owner** - Submit replacement (old: 0xf6708b682066e15e85074bcCcf3252Ec51C1EB44, new: 0x87A202e106f042F1465AC5390BbA269E1C211838)
18. **Execute Replace Owner** - Execute the owner replacement

### Configuration Tests (19-20)
19. **Submit Change Requirement** - Submit change to require 2 confirmations
20. **Execute Change Requirement** - Execute the requirement change

### Recovery Tests (21-22)
21. **Initiate Recovery** - Submit and execute recovery initiation
22. **Cancel Recovery** - Cancel the recovery using PIN

## Running the Tests

```bash
node test-multisig-functions.js
```

## Output

The script provides:

### 1. Real-time Test Execution
- Each test shows its number, name, and status
- Transaction hashes and block numbers
- Gas usage per transaction
- Transaction IDs for tracking

### 2. Test Summary
```
✅ PASSED: X tests
   1. Submit Transfer NFT
   2. Execute Transfer NFT
   ...

❌ FAILED: Y tests (if any)
   X. Test Name
      Error: Error message
```

### 3. Gas Usage Analysis
```
📊 submitTransferNFT
   Gas Used: 123456
   Gas Price: 2.5 gwei
   Gas Cost: 0.000308 ETH
   Block: 12345678

TOTAL GAS USED: 2500000
TOTAL GAS COST: 0.006250 ETH
```

### 4. Function Analysis
Groups functions by category:
- **Submit Functions** - All submission operations
- **Execute Functions** - All execution operations
- **Management Functions** - Revoke, delete, cancel operations

## Key Features

### Automatic Transaction ID Tracking
The script automatically:
- Extracts transaction IDs from Submission events
- Stores them for use in execute operations
- Handles recovery IDs from RecoveryInitiated events

### Comprehensive Error Handling
- Validates wallet address matches expected
- Checks contract existence
- Verifies sufficient balance
- Catches and reports all errors with context

### Gas Analysis
For each transaction:
- Gas used (units)
- Gas price (gwei)
- Total cost (ETH)
- Block number

### Transaction Verification
- Waits for transaction confirmation
- Extracts relevant event data
- Verifies transaction success

## Important Notes

### Transaction IDs
- Transaction IDs are automatically extracted from events
- If unsure about a transaction ID, run `node data/events.js <multisig_address>` to see all submissions

### PIN Requirement
- PIN (212) is required for:
  - `deleteTransaction`
  - `cancelRecovery`

### Multi-Sig Threshold
- The script assumes the target wallet is the only owner initially
- After changing requirement to 2, additional confirmations would be needed
- Tests are designed for single-owner scenario

### Network
- All tests run on Sepolia Testnet
- Ensure the MultiSig contract has:
  - The NFT (Doodle #234)
  - Sufficient MT tokens (at least 78)
  - Sufficient ETH for transfers and gas

## Troubleshooting

### "Wallet has no ETH for gas"
- Fund the target wallet with Sepolia ETH
- Get testnet ETH from: https://sepoliafaucet.com/

### "No contract found at MultiSig address"
- Verify the MultiSig address is correct
- Ensure you're on the right network (Sepolia)

### "Transaction reverted"
- Check that the MultiSig owns the assets being transferred
- Verify the target wallet is an owner
- Ensure sufficient confirmations for execution

### "Could not find Submission event"
- The transaction may have failed
- Check the transaction hash on Etherscan
- Review error logs for revert reasons

## Gas Optimization Insights

The test results will show which functions consume the most gas:

**Typically:**
- **Submit functions**: 100k-200k gas (creates transaction + auto-confirms)
- **Execute functions**: Varies by operation
  - Simple transfers: 50k-100k gas
  - Owner management: 80k-150k gas
  - Complex operations: 150k-300k gas
- **Revoke/Delete**: 50k-80k gas

## Verification

After running tests, verify on Sepolia Etherscan:
1. Check all transaction hashes
2. Verify events were emitted correctly
3. Confirm state changes (owners, requirements, balances)

## Support

If tests fail:
1. Check the error message in the output
2. Verify contract state using `data/events.js`
3. Review transaction on Etherscan
4. Ensure all prerequisites are met

## Example Output

```
🔧 Initializing test environment...

✅ Wallet Address: 0x1caefdf15648e7bdbfc9dc51076506d9454aa492
✅ Expected Address: 0x1caefdf15648e7bdbfc9dc51076506d9454aa492
💰 Wallet Balance: 0.5 ETH
✅ MultiSig Contract: 0x49909c741C0621D4637D6E8e61478a53916d284a
📊 Current Owners: 1
📊 Required Confirmations: 1
📊 Transaction Count: 0

✅ Initialization complete!

================================================================================
TEST 1: Submit Transfer NFT
================================================================================

📝 Submitting NFT transfer...
   NFT Contract: 0xe6c1ee6624c6819262f29199dF25A70B2648B818
   Token ID: 234
   Recipient: 0x1c5456054aa45f708f664aa7e6ff5d62bce3c10d
⏳ Waiting for transaction confirmation...
   Tx Hash: 0xabc...def
✅ Transaction confirmed in block 12345678
⛽ Gas Used: 156789
💰 Gas Cost: 0.000392 ETH
📋 Transaction ID: 0
✅ TEST 1 PASSED

...

================================================================================
TEST SUMMARY
================================================================================

✅ PASSED: 22 tests
   1. Submit Transfer NFT
   2. Execute Transfer NFT
   ...

================================================================================
GAS USAGE ANALYSIS
================================================================================

TOTAL GAS USED: 2500000
TOTAL GAS COST: 0.006250 ETH
================================================================================
```
