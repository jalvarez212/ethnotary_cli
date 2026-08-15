const { ethers } = require('ethers');
require('dotenv').config();

/**
 * Script to remove/delete a transaction from MultiSig on a specific network
 * Usage: node removeTransaction.js <multisig_address> <network> <transaction_id>
 * Example: node removeTransaction.js 0x123... sepolia 1
 */

// MultiSig ABI - functions we need
const MULTISIG_ABI = [
    "function deleteTransaction(uint transactionId) public",
    "function isOwner(address) view returns (bool)",
    "function transactions(uint) view returns (address dest, uint value, bytes func, bool executed, uint id)",
    "function getConfirmationCount(uint transactionId) view returns (uint count)",
    "function required() view returns (uint)",
    "event Delete(uint indexed transactionId, address indexed sender)"
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

class TransactionRemover {
    constructor(multisigAddress, network, transactionId) {
        this.multisigAddress = multisigAddress;
        this.network = network;
        this.transactionId = parseInt(transactionId);
    }

    async removeTransaction() {
        try {
            console.log(`🗑️  Removing transaction ${this.transactionId} from MultiSig ${this.multisigAddress}`);
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
                throw new Error(`Transaction ${this.transactionId} has already been executed and cannot be removed`);
            }

            // Show transaction details before removing
            await this.showTransactionDetails(multisig, transaction);

            // Confirm removal with user
            console.log(`⚠️  WARNING: This will permanently delete the transaction and all its confirmations!`);
            console.log(`   This action cannot be undone.\n`);

            // Estimate gas
            let gasEstimate;
            try {
                gasEstimate = await multisig.removeTransaction.estimateGas(this.transactionId);
                console.log(`⛽ Estimated gas: ${gasEstimate.toString()}`);
            } catch (gasError) {
                console.warn(`⚠️  Gas estimation failed: ${gasError.message}`);
                gasEstimate = 200000n; // Fallback gas limit
            }

            // Remove transaction
            console.log(`🗑️  Removing transaction...`);
            const tx = await multisig.removeTransaction(this.transactionId, {
                gasLimit: gasEstimate * 120n / 100n // Add 20% buffer
            });

            console.log(`⏳ Removal submitted: ${tx.hash}`);
            console.log(`🔗 Explorer: ${this.getExplorerUrl(networkConfig.chainId, tx.hash)}`);

            // Wait for confirmation
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                // Find the Removal event
                const removalEvent = receipt.logs.find(log => {
                    try {
                        const parsed = multisig.interface.parseLog(log);
                        return parsed.name === 'Removal';
                    } catch {
                        return false;
                    }
                });

                if (removalEvent) {
                    const parsed = multisig.interface.parseLog(removalEvent);
                    
                    console.log(`✅ Transaction removed successfully!`);
                    console.log(`🆔 Removed Transaction ID: ${parsed.args.transactionId}`);
                    console.log(`👤 Removed by: ${parsed.args.sender}`);
                    console.log(`📊 Gas used: ${receipt.gasUsed.toString()}`);
                    console.log(`💸 Gas cost: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} ETH`);
                    
                    return {
                        success: true,
                        transactionId: this.transactionId,
                        txHash: tx.hash,
                        gasUsed: receipt.gasUsed.toString(),
                        network: this.network,
                        removedBy: parsed.args.sender
                    };
                } else {
                    throw new Error('Removal event not found in transaction receipt');
                }
            } else {
                throw new Error('Transaction failed');
            }

        } catch (error) {
            console.error(`❌ Error removing transaction on ${this.network}:`);
            console.error(`   ${error.message}`);
            
            // Provide specific error guidance
            if (error.message.includes('not an owner')) {
                console.error(`💡 Make sure the wallet address is added as an owner to the MultiSig`);
            } else if (error.message.includes('does not exist')) {
                console.error(`💡 Check the transaction ID and network. Transaction IDs are network-specific`);
            } else if (error.message.includes('already executed')) {
                console.error(`💡 Executed transactions cannot be removed from the MultiSig`);
            } else if (error.message.includes('gas')) {
                console.error(`💡 Try increasing gas limit or check network congestion`);
            } else if (error.message.includes('insufficient funds')) {
                console.error(`💡 Ensure the wallet has enough ETH for gas fees`);
            }
            
            throw error;
        }
    }

    async showTransactionDetails(multisig, transaction) {
        try {
            const confirmationCount = await multisig.getConfirmationCount(this.transactionId);
            const required = await multisig.required();
            
            console.log(`📋 Transaction to Remove:`);
            console.log(`   🆔 ID: ${this.transactionId}`);
            console.log(`   📍 Destination: ${transaction.dest}`);
            console.log(`   💰 Value: ${ethers.formatEther(transaction.value)} ETH`);
            console.log(`   📝 Function Data: ${transaction.func}`);
            console.log(`   ⚡ Executed: ${transaction.executed ? 'Yes' : 'No'}`);
            console.log(`   ✅ Confirmations: ${confirmationCount}/${required}`);
            console.log('');
        } catch (error) {
            console.warn(`⚠️  Could not fetch full transaction details: ${error.message}`);
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
        console.log('Usage: node removeTransaction.js <multisig_address> <network> <transaction_id>');
        console.log('');
        console.log('Arguments:');
        console.log('  multisig_address  - Address of the MultiSig contract');
        console.log('  network          - Network name (sepolia, base-sepolia, arbitrum-sepolia)');
        console.log('  transaction_id   - ID of the transaction to remove');
        console.log('');
        console.log('Examples:');
        console.log('  node removeTransaction.js 0x123... sepolia 1');
        console.log('  node removeTransaction.js 0x456... base-sepolia 5');
        console.log('');
        console.log('⚠️  WARNING: This permanently deletes the transaction and all confirmations!');
        process.exit(1);
    }

    const [multisigAddress, network, transactionId] = args;

    try {
        const remover = new TransactionRemover(multisigAddress, network, transactionId);
        const result = await remover.removeTransaction();
        
        console.log('\n📋 Summary:');
        console.log(`✅ Transaction ${result.transactionId} removed successfully on ${result.network}`);
        console.log(`🔗 TX Hash: ${result.txHash}`);
        console.log(`👤 Removed by: ${result.removedBy}`);
        
        process.exit(0);
    } catch (error) {
        console.error('\n💥 Script failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { TransactionRemover };
