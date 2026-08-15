const { ethers } = require('ethers');
require('dotenv').config();

/**
 * Script to revoke confirmation for a transaction on MultiSig for a specific network
 * Usage: node revokeConfirmation.js <multisig_address> <network> <transaction_id>
 * Example: node revokeConfirmation.js 0x123... sepolia 1
 */

// MultiSig ABI - functions we need
const MULTISIG_ABI = [
    "function revokeConfirmation(uint transactionId) public",
    "function isOwner(address) view returns (bool)",
    "function transactions(uint) view returns (address dest, uint value, bytes func, bool executed, uint id)",
    "function confirmations(uint, address) view returns (bool)",
    "function getConfirmationCount(uint transactionId) view returns (uint count)",
    "function required() view returns (uint)",
    "function isConfirmed(uint transactionId) view returns (bool)",
    "event Revocation(address indexed sender, uint indexed transactionId)"
];

// Available networks
const NETWORKS = {
    sepolia: {
        name: 'Sepolia',
        rpc: process.env.SEPOLIA_RPC_URL,
        chainId: 11155111
    },
    'base-sepolia': {
        name: 'Base Sepolia',
        rpc: process.env.BASE_SEPOLIA_RPC_URL,
        chainId: 84532
    },
    'arbitrum-sepolia': {
        name: 'Arbitrum Sepolia',
        rpc: process.env.ARBITRUM_SEPOLIA_RPC_URL,
        chainId: 421614
    }
};

class ConfirmationRevoker {
    constructor(multisigAddress, network, transactionId) {
        this.multisigAddress = multisigAddress;
        this.network = network;
        this.transactionId = parseInt(transactionId);
    }

    async revokeConfirmation() {
        try {
            console.log(`❌ Revoking confirmation for transaction ${this.transactionId} on MultiSig ${this.multisigAddress}`);
            console.log(`🌐 Network: ${this.network}\n`);

            // Validate inputs
            this.validateInputs();

            // Get network configuration
            const networkConfig = NETWORKS[this.network];
            if (!networkConfig) {
                throw new Error(`Unsupported network: ${this.network}. Available: ${Object.keys(NETWORKS).join(', ')}`);
            }

            // Setup provider and signer
            const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
            const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
            const multisig = new ethers.Contract(this.multisigAddress, MULTISIG_ABI, wallet);

            // Verify caller is an owner
            const isOwner = await multisig.isOwner(wallet.address);
            if (!isOwner) {
                throw new Error(`Address ${wallet.address} is not an owner of the MultiSig`);
            }

            // Check if transaction exists
            const transaction = await multisig.transactions(this.transactionId);
            if (transaction.dest === ethers.ZeroAddress) {
                throw new Error(`Transaction ${this.transactionId} does not exist`);
            }

            // Check if transaction is already executed
            if (transaction.executed) {
                throw new Error(`Transaction ${this.transactionId} has already been executed and cannot be revoked`);
            }

            // Check if this owner has actually confirmed the transaction
            const hasConfirmed = await multisig.confirmations(this.transactionId, wallet.address);
            if (!hasConfirmed) {
                console.log(`⚠️  Transaction ${this.transactionId} is not confirmed by ${wallet.address}`);
                
                // Show current status
                await this.showTransactionStatus(multisig);
                return {
                    success: true,
                    notConfirmed: true,
                    transactionId: this.transactionId,
                    network: this.network
                };
            }

            // Show transaction details before revoking
            await this.showTransactionDetails(multisig, transaction);

            // Estimate gas
            let gasEstimate;
            try {
                gasEstimate = await multisig.revokeConfirmation.estimateGas(this.transactionId);
                console.log(`⛽ Estimated gas: ${gasEstimate.toString()}`);
            } catch (gasError) {
                console.warn(`⚠️  Gas estimation failed: ${gasError.message}`);
                gasEstimate = 200000n; // Fallback gas limit
            }

            // Revoke confirmation
            console.log(`📤 Revoking confirmation...`);
            const tx = await multisig.revokeConfirmation(this.transactionId, {
                gasLimit: gasEstimate * 120n / 100n // Add 20% buffer
            });

            console.log(`⏳ Revocation submitted: ${tx.hash}`);
            console.log(`🔗 Explorer: ${this.getExplorerUrl(networkConfig.chainId, tx.hash)}`);

            // Wait for confirmation
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                console.log(`✅ Confirmation revoked successfully!`);
                console.log(`📊 Gas used: ${receipt.gasUsed.toString()}`);
                console.log(`💸 Gas cost: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} ETH\n`);
                
                // Show updated status
                await this.showTransactionStatus(multisig);
                
                return {
                    success: true,
                    transactionId: this.transactionId,
                    txHash: tx.hash,
                    gasUsed: receipt.gasUsed.toString(),
                    network: this.network
                };
            } else {
                throw new Error('Transaction failed');
            }

        } catch (error) {
            console.error(`❌ Error revoking confirmation on ${this.network}:`);
            console.error(`   ${error.message}`);
            
            // Provide specific error guidance
            if (error.message.includes('not an owner')) {
                console.error(`💡 Make sure the wallet address is added as an owner to the MultiSig`);
            } else if (error.message.includes('does not exist')) {
                console.error(`💡 Check the transaction ID and network. Transaction IDs are network-specific`);
            } else if (error.message.includes('not confirmed')) {
                console.error(`💡 This owner has not confirmed this transaction yet`);
            } else if (error.message.includes('already executed')) {
                console.error(`💡 This transaction has already been executed and cannot be revoked`);
            } else if (error.message.includes('gas')) {
                console.error(`💡 Try increasing gas limit or check network congestion`);
            }
            
            throw error;
        }
    }

    async showTransactionDetails(multisig, transaction) {
        console.log(`📋 Transaction Details:`);
        console.log(`   🆔 ID: ${this.transactionId}`);
        console.log(`   📍 Destination: ${transaction.dest}`);
        console.log(`   💰 Value: ${ethers.formatEther(transaction.value)} ETH`);
        console.log(`   📝 Function Data: ${transaction.func}`);
        console.log(`   ⚡ Executed: ${transaction.executed ? 'Yes' : 'No'}`);
        console.log('');
    }

    async showTransactionStatus(multisig) {
        try {
            const confirmationCount = await multisig.getConfirmationCount(this.transactionId);
            const required = await multisig.required();
            const isConfirmed = await multisig.isConfirmed(this.transactionId);
            
            console.log(`📊 Transaction Status:`);
            console.log(`   ✅ Confirmations: ${confirmationCount}/${required}`);
            console.log(`   🎯 Ready to execute: ${isConfirmed ? 'Yes' : 'No'}`);
            
            if (isConfirmed) {
                console.log(`   💡 Transaction still has enough confirmations and can be executed`);
            } else {
                const needed = Number(required) - Number(confirmationCount);
                console.log(`   ⏳ Need ${needed} more confirmation(s)`);
            }
        } catch (error) {
            console.warn(`⚠️  Could not fetch transaction status: ${error.message}`);
        }
    }

    validateInputs() {
        if (!ethers.isAddress(this.multisigAddress)) {
            throw new Error(`Invalid MultiSig address: ${this.multisigAddress}`);
        }
        
        if (isNaN(this.transactionId) || this.transactionId < 0) {
            throw new Error(`Invalid transaction ID: ${this.transactionId}. Must be a non-negative number`);
        }

        if (!process.env.PRIVATE_KEY) {
            throw new Error('PRIVATE_KEY environment variable not set');
        }
    }

    getExplorerUrl(chainId, txHash) {
        const explorers = {
            11155111: `https://sepolia.etherscan.io/tx/${txHash}`,
            84532: `https://sepolia.basescan.org/tx/${txHash}`,
            421614: `https://sepolia.arbiscan.io/tx/${txHash}`
        };
        return explorers[chainId] || `Transaction: ${txHash}`;
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
        console.log('Usage: node revokeConfirmation.js <multisig_address> <network> <transaction_id>');
        console.log('');
        console.log('Arguments:');
        console.log('  multisig_address  - Address of the MultiSig contract');
        console.log('  network          - Network name (sepolia, base-sepolia, arbitrum-sepolia)');
        console.log('  transaction_id   - ID of the transaction to revoke confirmation for');
        console.log('');
        console.log('Examples:');
        console.log('  node revokeConfirmation.js 0x123... sepolia 1');
        console.log('  node revokeConfirmation.js 0x456... base-sepolia 5');
        console.log('');
        console.log('Note: You can only revoke your own confirmation for unexecuted transactions');
        process.exit(1);
    }

    const [multisigAddress, network, transactionId] = args;

    try {
        const revoker = new ConfirmationRevoker(multisigAddress, network, transactionId);
        const result = await revoker.revokeConfirmation();
        
        console.log('\n📋 Summary:');
        if (result.notConfirmed) {
            console.log(`ℹ️  Transaction ${result.transactionId} was not confirmed by this owner on ${result.network}`);
        } else {
            console.log(`✅ Confirmation revoked for transaction ${result.transactionId} on ${result.network}`);
            console.log(`🔗 TX Hash: ${result.txHash}`);
        }
        
        process.exit(0);
    } catch (error) {
        console.error('\n💥 Script failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { ConfirmationRevoker };
