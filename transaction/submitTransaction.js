const { ethers } = require('ethers');
require('dotenv').config();

/**
 * Script to submit a transaction to MultiSig on a specific network
 * Usage: node submitTransaction.js <multisig_address> <network> <destination> <value_in_eth> <function_data> [pin]
 * Example: node submitTransaction.js 0x123... sepolia 0x456... 0.1 0x 1234
 */

// MultiSig ABI - functions we need
const MULTISIG_ABI = [
    "function submitTransaction(address dest, uint256 value, bytes memory func) public returns (uint transactionId)",
    "function isOwner(address) view returns (bool)",
    "function getOwners() view returns (address[])",
    "function required() view returns (uint)",
    "function transactionCount() view returns (uint)",
    "event Submission(uint indexed transactionId, address dest, uint256 value, bytes func)"
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

class TransactionSubmitter {
    constructor(multisigAddress, network, destination, value, functionData, pin) {
        this.multisigAddress = multisigAddress;
        this.network = network;
        this.destination = destination;
        this.value = value;
        this.functionData = functionData;
        this.pin = pin;
    }

    async submitTransaction() {
        try {
            console.log(`🚀 Submitting transaction to MultiSig ${this.multisigAddress} on ${this.network}`);
            console.log(`📍 Destination: ${this.destination}`);
            console.log(`💰 Value: ${this.value} ETH`);
            console.log(`📝 Function Data: ${this.functionData}\n`);

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

            // Convert value to wei - handle scientific notation
            const valueWei = ethers.parseEther(this.value.toFixed(18));

            // Estimate gas
            let gasEstimate;
            try {
                gasEstimate = await multisig.submitTransaction.estimateGas(
                    this.destination,
                    valueWei,
                    this.functionData
                );
                console.log(`⛽ Estimated gas: ${gasEstimate.toString()}`);
            } catch (gasError) {
                console.warn(`⚠️  Gas estimation failed: ${gasError.message}`);
                gasEstimate = 500000n; // Fallback gas limit
            }

            // Submit transaction
            console.log(`📤 Submitting transaction...`);
            const tx = await multisig.submitTransaction(
                this.destination,
                valueWei,
                this.functionData,
                {
                    gasLimit: gasEstimate * 120n / 100n // Add 20% buffer
                }
            );

            console.log(`⏳ Transaction submitted: ${tx.hash}`);
            console.log(`🔗 Explorer: ${this.getExplorerUrl(networkConfig.chainId, tx.hash)}`);

            // Wait for confirmation
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                // Find the Submission event to get transaction ID
                const submissionEvent = receipt.logs.find(log => {
                    try {
                        const parsed = multisig.interface.parseLog(log);
                        return parsed.name === 'Submission';
                    } catch {
                        return false;
                    }
                });

                if (submissionEvent) {
                    const parsed = multisig.interface.parseLog(submissionEvent);
                    const transactionId = parsed.args.transactionId;
                    
                    console.log(`✅ Transaction submitted successfully!`);
                    console.log(`🆔 Transaction ID: ${transactionId}`);
                    console.log(`📊 Gas used: ${receipt.gasUsed.toString()}`);
                    console.log(`💸 Gas cost: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} ETH`);
                    
                    return {
                        success: true,
                        transactionId: transactionId.toString(),
                        txHash: tx.hash,
                        gasUsed: receipt.gasUsed.toString(),
                        network: this.network
                    };
                } else {
                    throw new Error('Submission event not found in transaction receipt');
                }
            } else {
                throw new Error('Transaction failed');
            }

        } catch (error) {
            console.error(`❌ Error submitting transaction on ${this.network}:`);
            console.error(`   ${error.message}`);
            
            // Provide specific error guidance
            if (error.message.includes('not an owner')) {
                console.error(`💡 Make sure the wallet address is added as an owner to the MultiSig`);
            } else if (error.message.includes('gas')) {
                console.error(`💡 Try increasing gas limit or check network congestion`);
            } else if (error.message.includes('insufficient funds')) {
                console.error(`💡 Ensure the wallet has enough ETH for gas fees`);
            }
            
            throw error;
        }
    }

    validateInputs() {
        if (!ethers.isAddress(this.multisigAddress)) {
            throw new Error(`Invalid MultiSig address: ${this.multisigAddress}`);
        }
        
        if (!ethers.isAddress(this.destination)) {
            throw new Error(`Invalid destination address: ${this.destination}`);
        }

        if (isNaN(this.value) || this.value < 0) {
            throw new Error(`Invalid value: ${this.value}. Must be a non-negative number`);
        }

        if (!this.functionData.startsWith('0x')) {
            throw new Error(`Invalid function data: ${this.functionData}. Must start with 0x`);
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
    
    if (args.length < 5) {
        console.log('Usage: node submitTransaction.js <multisig_address> <network> <destination> <value_in_eth> <function_data> [pin]');
        console.log('');
        console.log('Arguments:');
        console.log('  multisig_address  - Address of the MultiSig contract');
        console.log('  network          - Network name (sepolia, base-sepolia, arbitrum-sepolia)');
        console.log('  destination      - Destination address for the transaction');
        console.log('  value_in_eth     - Amount of ETH to send (e.g., 0.1)');
        console.log('  function_data    - Function call data (0x for plain ETH transfer)');
        console.log('  pin             - Optional PIN for additional security');
        console.log('');
        console.log('Examples:');
        console.log('  node submitTransaction.js 0x123... sepolia 0x456... 0.1 0x');
        console.log('  node submitTransaction.js 0x123... base-sepolia 0x456... 0 0xa9059cbb...');
        process.exit(1);
    }

    const [multisigAddress, network, destination, value, functionData, pin] = args;

    try {
        const submitter = new TransactionSubmitter(
            multisigAddress,
            network,
            destination,
            parseFloat(value),
            functionData,
            pin
        );

        const result = await submitter.submitTransaction();
        
        console.log('\n📋 Summary:');
        console.log(`✅ Transaction submitted successfully on ${result.network}`);
        console.log(`🆔 Transaction ID: ${result.transactionId}`);
        console.log(`🔗 TX Hash: ${result.txHash}`);
        
        process.exit(0);
    } catch (error) {
        console.error('\n💥 Script failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { TransactionSubmitter };
