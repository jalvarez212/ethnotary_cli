const { ethers } = require('ethers');
require('dotenv').config();

/**
 * Comprehensive MultiSig Contract Function Test Script
 * Tests all major functions in order and provides gas analysis
 */

// Configuration
const CONFIG = {
    multisigAddress: '0xa24012755BF99D4D3e3f89E94A04E01afc4C381E',
    targetWallet: '0x1c5456054AA45F708f664aa7e6ff5D62bCE3C10D', // Corrected - this is what the secret phrase derives to
    secretPhrase: process.env.MNEMONIC || 'test test test test test test test test test test test junk',
    pin: 1,
    nftAddress: '0xe6c1ee6624c6819262f29199dF25A70B2648B818',
    tokenAddress: '0x399ab04277063386023c41D0F77d15B79cb2d3BE',
    recipientAddress: '0x1c5456054aa45f708f664aa7e6ff5d62bce3c10d',
    ownerToRemove: '0x87A202e106f042F1465AC5390BbA269E1C211838',
    ownerToAdd: '0x87A202e106f042F1465AC5390BbA269E1C211838',
    ownerToReplace: '0xf6708b682066e15e85074bcccf3252ec51c1eb44',
    network: {
        name: 'Sepolia Testnet',
        chainId: 11155111,
        rpc: process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
        explorer: 'https://sepolia.etherscan.io'
    }
};

// MultiSig Contract ABI
const MULTISIG_ABI = [
    "function submitTransaction(address dest, uint256 value, bytes memory func) public returns (uint256)",
    "function submitTransferNFT(address nftContractAddress, address to, uint256 tokenId) public returns (uint256)",
    "function submitTransferERC20(address erc20ContractAddress, address to, uint256 amount) public returns (uint256)",
    "function addOwner(address accountOwner, uint256 _pin) public",
    "function removeOwner(address accountOwner, uint256 _pin) public",
    "function replaceOwner(address accountOwner, address newOwner, uint256 _pin) public",
    "function changeRequirement(uint _required, uint256 _pin) public",
    "function execute(uint transactionId) public",
    "function revokeConfirmation(uint transactionId) public",
    "function deleteTransaction(uint transactionId, uint256 _pin) public",
    "function isConfirmed(uint transactionId) view returns (bool)",
    "function transactions(uint) view returns (address dest, uint value, bytes func, bool executed, uint id)",
    "function transactionCount() view returns (uint256)",
    "function getOwners() view returns (address[])",
    "function required() view returns (uint256)",
    "event Submission(uint indexed transactionId, address dest, uint256 value, bytes func)",
    "event Confirmation(address indexed sender, uint indexed transactionId)",
    "event Revocation(address indexed sender, uint indexed transactionId)",
    "event ExecutionFailure(uint indexed transactionId)",
    "event OwnerAddition(address indexed owner)",
    "event OwnerRemoval(address indexed owner)",
    "event OwnerReplace(address indexed oldOwner, address indexed newOwner)",
    "event RequirementChange(uint required)"
];

// Test results storage
const testResults = {
    passed: [],
    failed: [],
    gasUsage: {}
};

class MultiSigTester {
    constructor() {
        this.provider = null;
        this.signer = null;
        this.multisig = null;
        this.transactionIds = {};
    }

    async initialize() {
        console.log('🔧 Initializing test environment...\n');
        
        // Create provider
        this.provider = new ethers.JsonRpcProvider(CONFIG.network.rpc);
        
        // Create wallet from mnemonic
        const wallet = ethers.Wallet.fromPhrase(CONFIG.secretPhrase);
        this.signer = wallet.connect(this.provider);
        
        console.log(`✅ Wallet Address: ${this.signer.address}`);
        console.log(`✅ Expected Address: ${CONFIG.targetWallet}`);
        
        if (this.signer.address.toLowerCase() !== CONFIG.targetWallet.toLowerCase()) {
            throw new Error('Wallet address mismatch!');
        }
        
        // Check balance
        const balance = await this.provider.getBalance(this.signer.address);
        console.log(`💰 Wallet Balance: ${ethers.formatEther(balance)} ETH`);
        
        if (balance === 0n) {
            throw new Error('Wallet has no ETH for gas!');
        }
        
        // Create contract instance
        this.multisig = new ethers.Contract(CONFIG.multisigAddress, MULTISIG_ABI, this.signer);
        
        // Verify contract
        const code = await this.provider.getCode(CONFIG.multisigAddress);
        if (code === '0x') {
            throw new Error('No contract found at MultiSig address!');
        }
        
        console.log(`✅ MultiSig Contract: ${CONFIG.multisigAddress}`);
        
        // Get initial state
        const owners = await this.multisig.getOwners();
        const required = await this.multisig.required();
        const txCount = await this.multisig.transactionCount();
        
        console.log(`📊 Current Owners: ${owners.length}`);
        console.log(`📊 Required Confirmations: ${required}`);
        console.log(`📊 Transaction Count: ${txCount}\n`);
        
        console.log('✅ Initialization complete!\n');
    }

    async executeTest(testNumber, testName, testFunction) {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`TEST ${testNumber}: ${testName}`);
        console.log('='.repeat(80));
        
        try {
            const result = await testFunction();
            testResults.passed.push({ number: testNumber, name: testName, ...result });
            console.log(`✅ TEST ${testNumber} PASSED`);
            return result;
        } catch (error) {
            console.error(`❌ TEST ${testNumber} FAILED: ${error.message}`);
            testResults.failed.push({ number: testNumber, name: testName, error: error.message });
            return null;
        }
    }

    async waitForTransaction(tx, testName) {
        console.log(`⏳ Waiting for transaction confirmation...`);
        console.log(`   Tx Hash: ${tx.hash}`);
        
        const receipt = await tx.wait();
        
        const gasUsed = receipt.gasUsed;
        const gasPrice = tx.gasPrice || receipt.gasPrice || 0n;
        const gasCost = gasUsed * gasPrice;
        
        testResults.gasUsage[testName] = {
            gasUsed: gasUsed.toString(),
            gasPrice: ethers.formatUnits(gasPrice, 'gwei'),
            gasCost: ethers.formatEther(gasCost),
            blockNumber: receipt.blockNumber
        };
        
        console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
        console.log(`⛽ Gas Used: ${gasUsed.toString()}`);
        console.log(`💰 Gas Cost: ${ethers.formatEther(gasCost)} ETH`);
        
        return receipt;
    }

    async extractTransactionId(receipt, eventName = 'Submission') {
        const event = receipt.logs.find(log => {
            try {
                const parsed = this.multisig.interface.parseLog(log);
                return parsed && parsed.name === eventName;
            } catch {
                return false;
            }
        });
        
        if (event) {
            const parsed = this.multisig.interface.parseLog(event);
            const txId = parsed.args.transactionId || parsed.args[0];
            console.log(`📋 Transaction ID: ${txId}`);
            return txId;
        }
        
        throw new Error(`Could not find ${eventName} event in receipt`);
    }

    // TEST 1: Submit Transfer NFT
    async test1_submitTransferNFT() {
        console.log(`\n📝 Submitting NFT transfer...`);
        console.log(`   NFT Contract: ${CONFIG.nftAddress}`);
        console.log(`   Token ID: 235`);
        console.log(`   Recipient: ${CONFIG.recipientAddress}`);
        
        const tx = await this.multisig.submitTransferNFT(
            CONFIG.nftAddress,
            CONFIG.recipientAddress,
            235
        );
        
        const receipt = await this.waitForTransaction(tx, 'submitTransferNFT');
        const txId = await this.extractTransactionId(receipt);
        this.transactionIds.nftTransfer = txId;
        
        return { transactionId: txId.toString(), txHash: tx.hash };
    }

    // TEST 2: Execute Transfer NFT
    async test2_executeTransferNFT() {
        const txId = this.transactionIds.nftTransfer;
        console.log(`\n⚡ Executing NFT transfer (Transaction ID: ${txId})...`);
        
        const tx = await this.multisig.execute(txId);
        const receipt = await this.waitForTransaction(tx, 'executeTransferNFT');
        
        return { transactionId: txId.toString(), txHash: tx.hash };
    }

    // TEST 3: Submit Transfer ERC20
    async test3_submitTransferERC20() {
        console.log(`\n📝 Submitting ERC20 transfer...`);
        console.log(`   Token Contract: ${CONFIG.tokenAddress}`);
        console.log(`   Amount: 77 tokens`);
        console.log(`   Recipient: ${CONFIG.recipientAddress}`);
        
        const amount = ethers.parseUnits('77', 18); // Assuming 18 decimals
        
        const tx = await this.multisig.submitTransferERC20(
            CONFIG.tokenAddress,
            CONFIG.recipientAddress,
            amount
        );
        
        const receipt = await this.waitForTransaction(tx, 'submitTransferERC20');
        const txId = await this.extractTransactionId(receipt);
        this.transactionIds.erc20Transfer = txId;
        
        return { transactionId: txId.toString(), txHash: tx.hash };
    }

    // TEST 4: Execute Transfer ERC20
    async test4_executeTransferERC20() {
        const txId = this.transactionIds.erc20Transfer;
        console.log(`\n⚡ Executing ERC20 transfer (Transaction ID: ${txId})...`);
        
        const tx = await this.multisig.execute(txId);
        const receipt = await this.waitForTransaction(tx, 'executeTransferERC20');
        
        return { transactionId: txId.toString(), txHash: tx.hash };
    }

    // TEST 5: Submit Native ETH Transfer (0.00001 ETH)
    async test5_submitNativeTransfer() {
        console.log(`\n📝 Submitting native ETH transfer...`);
        console.log(`   Amount: 0.00001 ETH`);
        console.log(`   Recipient: ${CONFIG.recipientAddress}`);
        console.log(`   Data: 0x (empty)`);
        
        const value = ethers.parseEther('0.00001');
        
        const tx = await this.multisig.submitTransaction(
            CONFIG.recipientAddress,
            value,
            '0x'
        );
        
        const receipt = await this.waitForTransaction(tx, 'submitNativeTransfer');
        const txId = await this.extractTransactionId(receipt);
        this.transactionIds.nativeTransfer = txId;
        
        return { transactionId: txId.toString(), txHash: tx.hash };
    }

    // TEST 6: Execute Native ETH Transfer
    async test6_executeNativeTransfer() {
        const txId = this.transactionIds.nativeTransfer;
        console.log(`\n⚡ Executing native ETH transfer (Transaction ID: ${txId})...`);
        
        const tx = await this.multisig.execute(txId);
        const receipt = await this.waitForTransaction(tx, 'executeNativeTransfer');
        
        return { transactionId: txId.toString(), txHash: tx.hash };
    }

    // TEST 7: Submit Another Native ETH Transfer (for revoke test)
    async test7_submitNativeTransferForRevoke() {
        console.log(`\n📝 Submitting native ETH transfer (for revoke test)...`);
        console.log(`   Amount: 0 ETH`);
        console.log(`   Recipient: ${CONFIG.recipientAddress}`);
        console.log(`   Data: 0x (empty)`);
        
        const tx = await this.multisig.submitTransaction(
            CONFIG.recipientAddress,
            0,
            '0x'
        );
        
        const receipt = await this.waitForTransaction(tx, 'submitNativeTransferForRevoke');
        const txId = await this.extractTransactionId(receipt);
        this.transactionIds.nativeTransferRevoke = txId;
        
        return { transactionId: txId.toString(), txHash: tx.hash };
    }

    // TEST 8: Revoke Confirmation
    async test8_revokeConfirmation() {
        const txId = this.transactionIds.nativeTransferRevoke;
        console.log(`\n🔙 Revoking confirmation (Transaction ID: ${txId})...`);
        
        const tx = await this.multisig.revokeConfirmation(txId);
        const receipt = await this.waitForTransaction(tx, 'revokeConfirmation');
        
        return { transactionId: txId.toString(), txHash: tx.hash };
    }

    // TEST 9: Delete Transaction
    async test9_deleteTransaction() {
        const txId = this.transactionIds.nativeTransferRevoke;
        console.log(`\n🗑️  Deleting transaction (Transaction ID: ${txId})...`);
        console.log(`   PIN: ${CONFIG.pin}`);
        
        const tx = await this.multisig.deleteTransaction(txId, CONFIG.pin);
        const receipt = await this.waitForTransaction(tx, 'deleteTransaction');
        
        return { transactionId: txId.toString(), txHash: tx.hash };
    }

    // TEST 10: Submit ERC20 Transfer (for delete test)
    async test10_submitERC20ForDelete() {
        console.log(`\n📝 Submitting ERC20 transfer (for delete test)...`);
        console.log(`   Token Contract: ${CONFIG.tokenAddress}`);
        console.log(`   Amount: 1 token`);
        console.log(`   Recipient: ${CONFIG.recipientAddress}`);
        
        const amount = ethers.parseUnits('1', 18);
        
        const tx = await this.multisig.submitTransferERC20(
            CONFIG.tokenAddress,
            CONFIG.recipientAddress,
            amount
        );
        
        const receipt = await this.waitForTransaction(tx, 'submitERC20ForDelete');
        const txId = await this.extractTransactionId(receipt);
        this.transactionIds.erc20Delete = txId;
        
        return { transactionId: txId.toString(), txHash: tx.hash };
    }

    // TEST 11: Revoke ERC20 Confirmation
    async test11_revokeERC20Confirmation() {
        const txId = this.transactionIds.erc20Delete;
        console.log(`\n🔙 Revoking ERC20 confirmation (Transaction ID: ${txId})...`);
        
        const tx = await this.multisig.revokeConfirmation(txId);
        const receipt = await this.waitForTransaction(tx, 'revokeERC20Confirmation');
        
        return { transactionId: txId.toString(), txHash: tx.hash };
    }

    // TEST 12: Delete ERC20 Transaction
    async test12_deleteERC20Transaction() {
        const txId = this.transactionIds.erc20Delete;
        console.log(`\n🗑️  Deleting ERC20 transaction (Transaction ID: ${txId})...`);
        console.log(`   PIN: ${CONFIG.pin}`);
        
        const tx = await this.multisig.deleteTransaction(txId, CONFIG.pin);
        const receipt = await this.waitForTransaction(tx, 'deleteERC20Transaction');
        
        return { transactionId: txId.toString(), txHash: tx.hash };
    }

    // TEST 13: Remove Owner (with PIN)
    async test13_removeOwner() {
        console.log(`\n📝 Removing owner...`);
        console.log(`   Owner to remove: ${CONFIG.ownerToRemove}`);
        console.log(`   PIN: ${CONFIG.pin}`);
        
        const tx = await this.multisig.removeOwner(CONFIG.ownerToRemove, CONFIG.pin);
        const receipt = await this.waitForTransaction(tx, 'removeOwner');
        
        return { txHash: tx.hash };
    }

    // TEST 14: Add Owner (with PIN)
    async test14_addOwner() {
        console.log(`\n📝 Adding owner...`);
        console.log(`   Owner to add: ${CONFIG.ownerToAdd}`);
        console.log(`   PIN: ${CONFIG.pin}`);
        
        const tx = await this.multisig.addOwner(CONFIG.ownerToAdd, CONFIG.pin);
        const receipt = await this.waitForTransaction(tx, 'addOwner');
        
        return { txHash: tx.hash };
    }

    // TEST 15: Replace Owner (with PIN)
    async test15_replaceOwner() {
        console.log(`\n📝 Replacing owner...`);
        console.log(`   Old Owner: ${CONFIG.ownerToRemove}`);
        console.log(`   New Owner: ${CONFIG.ownerToReplace}`);
        console.log(`   PIN: ${CONFIG.pin}`);
        
        const tx = await this.multisig.replaceOwner(
            CONFIG.ownerToRemove,
            CONFIG.ownerToReplace,
            CONFIG.pin
        );
        const receipt = await this.waitForTransaction(tx, 'replaceOwner');
        
        return { txHash: tx.hash };
    }

    // TEST 16: Change Requirement (with PIN)
    async test16_changeRequirement() {
        console.log(`\n📝 Changing requirement...`);
        console.log(`   New Requirement: 2`);
        console.log(`   PIN: ${CONFIG.pin}`);
        
        const tx = await this.multisig.changeRequirement(2, CONFIG.pin);
        const receipt = await this.waitForTransaction(tx, 'changeRequirement');
        
        return { txHash: tx.hash };
    }


    async printSummary() {
        console.log('\n\n');
        console.log('='.repeat(80));
        console.log('TEST SUMMARY');
        console.log('='.repeat(80));
        
        console.log(`\n✅ PASSED: ${testResults.passed.length} tests`);
        testResults.passed.forEach(test => {
            console.log(`   ${test.number}. ${test.name}`);
        });
        
        if (testResults.failed.length > 0) {
            console.log(`\n❌ FAILED: ${testResults.failed.length} tests`);
            testResults.failed.forEach(test => {
                console.log(`   ${test.number}. ${test.name}`);
                console.log(`      Error: ${test.error}`);
            });
        }
        
        console.log('\n\n');
        console.log('='.repeat(80));
        console.log('GAS USAGE ANALYSIS');
        console.log('='.repeat(80));
        
        let totalGasUsed = 0n;
        let totalGasCost = 0;
        
        console.log('\n');
        Object.entries(testResults.gasUsage).forEach(([testName, gas]) => {
            console.log(`📊 ${testName}`);
            console.log(`   Gas Used: ${gas.gasUsed}`);
            console.log(`   Gas Price: ${gas.gasPrice} gwei`);
            console.log(`   Gas Cost: ${gas.gasCost} ETH`);
            console.log(`   Block: ${gas.blockNumber}`);
            console.log('');
            
            totalGasUsed += BigInt(gas.gasUsed);
            totalGasCost += parseFloat(gas.gasCost);
        });
        
        console.log('='.repeat(80));
        console.log(`TOTAL GAS USED: ${totalGasUsed.toString()}`);
        console.log(`TOTAL GAS COST: ${totalGasCost.toFixed(6)} ETH`);
        console.log('='.repeat(80));
        
        // Function-specific analysis
        console.log('\n\n');
        console.log('='.repeat(80));
        console.log('FUNCTION ANALYSIS');
        console.log('='.repeat(80));
        
        const functionGroups = {
            'Submit Functions': [
                'submitTransferNFT',
                'submitTransferERC20',
                'submitNativeTransfer',
                'submitNativeTransferForRevoke',
                'submitERC20ForDelete',
                'removeOwner',
                'addOwner',
                'replaceOwner',
                'changeRequirement'
            ],
            'Execute Functions': [
                'executeTransferNFT',
                'executeTransferERC20',
                'executeNativeTransfer',
            ],
            'Management Functions': [
                'revokeConfirmation',
                'revokeERC20Confirmation',
                'deleteTransaction',
                'deleteERC20Transaction'
            ]
        };
        
        Object.entries(functionGroups).forEach(([groupName, functions]) => {
            console.log(`\n${groupName}:`);
            console.log('-'.repeat(80));
            
            functions.forEach(funcName => {
                const gas = testResults.gasUsage[funcName];
                if (gas) {
                    console.log(`  ${funcName.padEnd(35)} | Gas: ${gas.gasUsed.padStart(10)} | Cost: ${gas.gasCost.padStart(12)} ETH`);
                }
            });
        });
        
        console.log('\n\n');
    }

    async runAllTests() {
        try {
            await this.initialize();
            
            // Run all tests in order
            await this.executeTest(1, 'Submit Transfer NFT', () => this.test1_submitTransferNFT());
            await this.executeTest(2, 'Execute Transfer NFT', () => this.test2_executeTransferNFT());
            await this.executeTest(3, 'Submit Transfer ERC20', () => this.test3_submitTransferERC20());
            await this.executeTest(4, 'Execute Transfer ERC20', () => this.test4_executeTransferERC20());
            await this.executeTest(5, 'Submit Native ETH Transfer', () => this.test5_submitNativeTransfer());
            await this.executeTest(6, 'Execute Native ETH Transfer', () => this.test6_executeNativeTransfer());
            await this.executeTest(7, 'Submit Native Transfer (for revoke)', () => this.test7_submitNativeTransferForRevoke());
            await this.executeTest(8, 'Revoke Confirmation', () => this.test8_revokeConfirmation());
            await this.executeTest(9, 'Delete Transaction', () => this.test9_deleteTransaction());
            await this.executeTest(10, 'Submit ERC20 (for delete)', () => this.test10_submitERC20ForDelete());
            await this.executeTest(11, 'Revoke ERC20 Confirmation', () => this.test11_revokeERC20Confirmation());
            await this.executeTest(12, 'Delete ERC20 Transaction', () => this.test12_deleteERC20Transaction());
            await this.executeTest(13, 'Remove Owner (PIN)', () => this.test13_removeOwner());
            await this.executeTest(14, 'Add Owner (PIN)', () => this.test14_addOwner());
            await this.executeTest(15, 'Replace Owner (PIN)', () => this.test15_replaceOwner());
            await this.executeTest(16, 'Change Requirement (PIN)', () => this.test16_changeRequirement());
            
            await this.printSummary();
            
        } catch (error) {
            console.error('\n❌ FATAL ERROR:', error.message);
            console.error(error);
            process.exit(1);
        }
    }
}

// Run tests
if (require.main === module) {
    const tester = new MultiSigTester();
    tester.runAllTests().then(() => {
        console.log('\n✅ All tests completed!');
        process.exit(0);
    }).catch(error => {
        console.error('\n❌ Test suite failed:', error);
        process.exit(1);
    });
}

module.exports = { MultiSigTester };
