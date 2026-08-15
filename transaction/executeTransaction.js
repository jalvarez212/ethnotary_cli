const { ethers } = require('ethers');
require('dotenv').config();

/**
 * Script to execute a confirmed transaction on MultiSig for a specific network
 * Usage: node executeTransaction.js <multisig_address> <network> <transaction_id>
 * Example: node executeTransaction.js 0x123... sepolia 1
 */

// MultiSig ABI - functions we need
const MULTISIG_ABI = [
    "function execute(uint transactionId) public",
    "function isOwner(address) view returns (bool)",
    "function transactions(uint) view returns (address dest, uint value, bytes func, bool executed, uint id)",
    "function isConfirmed(uint transactionId) view returns (bool)",
    "function getConfirmationCount(uint transactionId) view returns (uint count)",
    "function required() view returns (uint)",
    "event Execution(uint transactionId, address indexed to, uint indexed amount)",
    "event ExecutionFailure(uint indexed transactionId)"
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

class TransactionExecutor {
    constructor(multisigAddress, network, transactionId) {
        this.multisigAddress = multisigAddress;
        this.network = network;
        this.transactionId = parseInt(transactionId);
    }

    async executeTransaction() {
        try {
            console.log(`⚡ Executing transaction ${this.transactionId} on MultiSig ${this.multisigAddress}`);
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
                console.log(`⚠️  Transaction ${this.transactionId} has already been executed`);
                await this.showTransactionDetails(multisig, transaction);
                return {
                    success: true,
                    alreadyExecuted: true,
                    transactionId: this.transactionId,
                    network: this.network
                };
            }

            // Check if transaction has enough confirmations
            const isConfirmed = await multisig.isConfirmed(this.transactionId);
            if (!isConfirmed) {
                const confirmationCount = await multisig.getConfirmationCount(this.transactionId);
                const required = await multisig.required();
                throw new Error(`Transaction ${this.transactionId} does not have enough confirmations (${confirmationCount}/${required})`);
            }

            // Show transaction details before executing
            await this.showTransactionDetails(multisig, transaction);

            // Check MultiSig balance if sending ETH
            if (transaction.value > 0n) {
                const balance = await provider.getBalance(this.multisigAddress);
                if (balance < transaction.value) {
                    throw new Error(`Insufficient MultiSig balance: ${ethers.formatEther(balance)} ETH < ${ethers.formatEther(transaction.value)} ETH required`);
                }
                console.log(`💰 MultiSig balance: ${ethers.formatEther(balance)} ETH`);
            }

            // Estimate gas
            let gasEstimate;
            try {
                gasEstimate = await multisig.execute.estimateGas(this.transactionId);
                console.log(`⛽ Estimated gas: ${gasEstimate.toString()}`);
            } catch (gasError) {
                console.warn(`⚠️  Gas estimation failed: ${gasError.message}`);
                gasEstimate = 500000n; // Fallback gas limit for complex transactions
            }

            // Execute transaction
            console.log(`🚀 Executing transaction...`);
            const tx = await multisig.execute(this.transactionId, {
                gasLimit: gasEstimate * 130n / 100n // Add 30% buffer for execution
            });

            console.log(`⏳ Execution submitted: ${tx.hash}`);
            console.log(`🔗 Explorer: ${this.getExplorerUrl(networkConfig.chainId, tx.hash)}`);

            // Wait for confirmation
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                // Check for execution events
                const executionEvent = receipt.logs.find(log => {
                    try {
                        const parsed = multisig.interface.parseLog(log);
                        return parsed.name === 'Execution';
                    } catch {
                        return false;
                    }
                });

                const executionFailureEvent = receipt.logs.find(log => {
                    try {
                        const parsed = multisig.interface.parseLog(log);
                        return parsed.name === 'ExecutionFailure';
                    } catch {
                        return false;
                    }
                });

                if (executionEvent) {
                    console.log(`✅ Transaction executed successfully!`);
                    console.log(`📊 Gas used: ${receipt.gasUsed.toString()}`);
                    console.log(`💸 Gas cost: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} ETH`);
                    
                    const parsed = multisig.interface.parseLog(executionEvent);
                    console.log(`📍 Executed to: ${parsed.args.to}`);
                    console.log(`💰 Amount sent: ${ethers.formatEther(parsed.args.amount)} ETH`);
                    
                    return {
                        success: true,
                        executed: true,
                        transactionId: this.transactionId,
                        txHash: tx.hash,
                        gasUsed: receipt.gasUsed.toString(),
                        network: this.network,
                        destination: parsed.args.to,
                        amount: parsed.args.amount.toString()
                    };
                } else if (executionFailureEvent) {
                    throw new Error(`Transaction execution failed - the target transaction reverted`);
                } else {
                    throw new Error('No execution event found - transaction may have failed');
                }
            } else {
                throw new Error('Transaction failed');
            }

        } catch (error) {
            console.error(`❌ Error executing transaction on ${this.network}:`);
            console.error(`   ${error.message}`);
            
            // Provide specific error guidance
            if (error.message.includes('not an owner')) {
                console.error(`💡 Make sure the wallet address is added as an owner to the MultiSig`);
            } else if (error.message.includes('does not exist')) {
                console.error(`💡 Check the transaction ID and network. Transaction IDs are network-specific`);
            } else if (error.message.includes('already executed')) {
                console.error(`💡 This transaction has already been executed`);
            } else if (error.message.includes('not have enough confirmations')) {
                console.error(`💡 Get more owners to confirm this transaction before executing`);
            } else if (error.message.includes('Insufficient MultiSig balance')) {
                console.error(`💡 The MultiSig needs more ETH to execute this transaction`);
            } else if (error.message.includes('execution failed')) {
                console.error(`💡 The target transaction reverted - check destination contract and function data`);
            } else if (error.message.includes('gas')) {
                console.error(`💡 Try increasing gas limit or check network congestion`);
            }
            
            throw error;
        }
    }

    async showTransactionDetails(multisig, transaction) {
        try {
            const confirmationCount = await multisig.getConfirmationCount(this.transactionId);
            const required = await multisig.required();
            const isConfirmed = await multisig.isConfirmed(this.transactionId);
            
            console.log(`📋 Transaction Details:`);
            console.log(`   🆔 ID: ${this.transactionId}`);
            console.log(`   📍 Destination: ${transaction.dest}`);
            console.log(`   💰 Value: ${ethers.formatEther(transaction.value)} ETH`);
            console.log(`   📝 Function Data: ${transaction.func}`);
            console.log(`   ⚡ Executed: ${transaction.executed ? 'Yes' : 'No'}`);
            console.log(`   ✅ Confirmations: ${confirmationCount}/${required}`);
            console.log(`   🎯 Ready to execute: ${isConfirmed ? 'Yes' : 'No'}`);
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
        console.log('Usage: node executeTransaction.js <multisig_address> <network> <transaction_id>');
        console.log('');
        console.log('Arguments:');
        console.log('  multisig_address  - Address of the MultiSig contract');
        console.log('  network          - Network name (sepolia, base-sepolia, arbitrum-sepolia)');
        console.log('  transaction_id   - ID of the transaction to execute');
        console.log('');
        console.log('Examples:');
        console.log('  node executeTransaction.js 0x123... sepolia 1');
        console.log('  node executeTransaction.js 0x456... base-sepolia 5');
        process.exit(1);
    }

    const [multisigAddress, network, transactionId] = args;

    try {
        const executor = new TransactionExecutor(multisigAddress, network, transactionId);
        const result = await executor.executeTransaction();
        
        console.log('\n📋 Summary:');
        if (result.alreadyExecuted) {
            console.log(`ℹ️  Transaction ${result.transactionId} was already executed on ${result.network}`);
        } else {
            console.log(`✅ Transaction ${result.transactionId} executed successfully on ${result.network}`);
            console.log(`🔗 TX Hash: ${result.txHash}`);
            console.log(`📍 Destination: ${result.destination}`);
            console.log(`💰 Amount: ${ethers.formatEther(result.amount)} ETH`);
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

module.exports = { TransactionExecutor };
