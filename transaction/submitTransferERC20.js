const { ethers } = require('ethers');
require('dotenv').config();

/**
 * Script to submit an ERC20 token transfer transaction to MultiSig on a specific network
 * Usage: node submitTransferERC20.js <multisig_address> <network> <token_address> <recipient> <amount> [decimals]
 * Example: node submitTransferERC20.js 0x123... sepolia 0x456... 0x789... 100 18
 */

// MultiSig ABI - functions we need
const MULTISIG_ABI = [
    "function submitTransferERC20(address erc20ContractAddress, address to, uint256 amount) public returns (uint256)",
    "function isOwner(address) view returns (bool)",
    "function getOwners() view returns (address[])",
    "function required() view returns (uint)",
    "function transactionCount() view returns (uint)",
    "event Submission(uint indexed transactionId, address dest, uint256 value, bytes func)"
];

// ERC20 ABI - functions we need for validation
const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function totalSupply() view returns (uint256)"
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

class ERC20TransferSubmitter {
    constructor(multisigAddress, network, tokenAddress, recipient, amount, decimals) {
        this.multisigAddress = multisigAddress;
        this.network = network;
        this.tokenAddress = tokenAddress;
        this.recipient = recipient;
        this.amount = amount;
        this.decimals = decimals || 18; // Default to 18 decimals
    }

    async submitTransferERC20() {
        try {
            console.log(`🪙 Submitting ERC20 transfer to MultiSig ${this.multisigAddress} on ${this.network}`);
            console.log(`🎯 Token: ${this.tokenAddress}`);
            console.log(`📍 Recipient: ${this.recipient}`);
            console.log(`💰 Amount: ${this.amount}\n`);

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
            const token = new ethers.Contract(this.tokenAddress, ERC20_ABI, provider);

            // Verify caller is an owner
            const isOwner = await multisig.isOwner(wallet.address);
            if (!isOwner) {
                throw new Error(`Address ${wallet.address} is not an owner of the MultiSig`);
            }

            // Get token information
            const tokenInfo = await this.getTokenInfo(token);
            console.log(`📋 Token Information:`);
            console.log(`   Name: ${tokenInfo.name}`);
            console.log(`   Symbol: ${tokenInfo.symbol}`);
            console.log(`   Decimals: ${tokenInfo.decimals}`);
            console.log(`   Total Supply: ${ethers.formatUnits(tokenInfo.totalSupply, tokenInfo.decimals)}`);

            // Use token's actual decimals if not provided
            const actualDecimals = tokenInfo.decimals;
            const amountWei = ethers.parseUnits(this.amount.toString(), actualDecimals);

            // Check MultiSig token balance
            const multisigBalance = await token.balanceOf(this.multisigAddress);
            console.log(`   MultiSig Balance: ${ethers.formatUnits(multisigBalance, actualDecimals)} ${tokenInfo.symbol}`);

            if (multisigBalance < amountWei) {
                throw new Error(`Insufficient token balance: ${ethers.formatUnits(multisigBalance, actualDecimals)} ${tokenInfo.symbol} < ${this.amount} ${tokenInfo.symbol} required`);
            }

            console.log(`   Transfer Amount: ${ethers.formatUnits(amountWei, actualDecimals)} ${tokenInfo.symbol}\n`);

            // Estimate gas
            let gasEstimate;
            try {
                gasEstimate = await multisig.submitTransferERC20.estimateGas(
                    this.tokenAddress,
                    this.recipient,
                    amountWei
                );
                console.log(`⛽ Estimated gas: ${gasEstimate.toString()}`);
            } catch (gasError) {
                console.warn(`⚠️  Gas estimation failed: ${gasError.message}`);
                gasEstimate = 300000n; // Fallback gas limit
            }

            // Submit ERC20 transfer transaction
            console.log(`📤 Submitting ERC20 transfer transaction...`);
            const tx = await multisig.submitTransferERC20(
                this.tokenAddress,
                this.recipient,
                amountWei,
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
                    
                    console.log(`✅ ERC20 transfer transaction submitted successfully!`);
                    console.log(`🆔 Transaction ID: ${transactionId}`);
                    console.log(`🪙 Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
                    console.log(`📍 Recipient: ${this.recipient}`);
                    console.log(`💰 Amount: ${ethers.formatUnits(amountWei, actualDecimals)} ${tokenInfo.symbol}`);
                    console.log(`📊 Gas used: ${receipt.gasUsed.toString()}`);
                    console.log(`💸 Gas cost: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} ETH`);
                    
                    return {
                        success: true,
                        transactionId: transactionId.toString(),
                        txHash: tx.hash,
                        gasUsed: receipt.gasUsed.toString(),
                        network: this.network,
                        tokenInfo: tokenInfo,
                        recipient: this.recipient,
                        amount: ethers.formatUnits(amountWei, actualDecimals)
                    };
                } else {
                    throw new Error('Submission event not found in transaction receipt');
                }
            } else {
                throw new Error('Transaction failed');
            }

        } catch (error) {
            console.error(`❌ Error submitting ERC20 transfer on ${this.network}:`);
            console.error(`   ${error.message}`);
            
            // Provide specific error guidance
            if (error.message.includes('not an owner')) {
                console.error(`💡 Make sure the wallet address is added as an owner to the MultiSig`);
            } else if (error.message.includes('Insufficient token balance')) {
                console.error(`💡 The MultiSig needs more tokens to execute this transfer`);
            } else if (error.message.includes('invalid address')) {
                console.error(`💡 Check that the token and recipient addresses are valid`);
            } else if (error.message.includes('gas')) {
                console.error(`💡 Try increasing gas limit or check network congestion`);
            } else if (error.message.includes('insufficient funds')) {
                console.error(`💡 Ensure the wallet has enough ETH for gas fees`);
            }
            
            throw error;
        }
    }

    async getTokenInfo(token) {
        try {
            const [name, symbol, decimals, totalSupply] = await Promise.all([
                token.name(),
                token.symbol(),
                token.decimals(),
                token.totalSupply()
            ]);

            return {
                name,
                symbol,
                decimals: Number(decimals),
                totalSupply
            };
        } catch (error) {
            throw new Error(`Failed to get token information: ${error.message}. Make sure the token address is a valid ERC20 contract.`);
        }
    }

    validateInputs() {
        if (!ethers.isAddress(this.multisigAddress)) {
            throw new Error(`Invalid MultiSig address: ${this.multisigAddress}`);
        }
        
        if (!ethers.isAddress(this.tokenAddress)) {
            throw new Error(`Invalid token address: ${this.tokenAddress}`);
        }

        if (!ethers.isAddress(this.recipient)) {
            throw new Error(`Invalid recipient address: ${this.recipient}`);
        }

        if (isNaN(this.amount) || this.amount <= 0) {
            throw new Error(`Invalid amount: ${this.amount}. Must be a positive number`);
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
        console.log('Usage: node submitTransferERC20.js <multisig_address> <network> <token_address> <recipient> <amount> [decimals]');
        console.log('');
        console.log('Arguments:');
        console.log('  multisig_address  - Address of the MultiSig contract');
        console.log('  network          - Network name (sepolia, base-sepolia, arbitrum-sepolia)');
        console.log('  token_address    - Address of the ERC20 token contract');
        console.log('  recipient        - Address to receive the tokens');
        console.log('  amount           - Amount of tokens to transfer (in token units, not wei)');
        console.log('  decimals         - Optional: Token decimals (will auto-detect if not provided)');
        console.log('');
        console.log('Examples:');
        console.log('  node submitTransferERC20.js 0x123... sepolia 0x456... 0x789... 100');
        console.log('  node submitTransferERC20.js 0x123... base-sepolia 0x456... 0x789... 50.5 6');
        process.exit(1);
    }

    const [multisigAddress, network, tokenAddress, recipient, amount, decimals] = args;

    try {
        const submitter = new ERC20TransferSubmitter(
            multisigAddress,
            network,
            tokenAddress,
            recipient,
            parseFloat(amount),
            decimals ? parseInt(decimals) : undefined
        );

        const result = await submitter.submitTransferERC20();
        
        console.log('\n📋 Summary:');
        console.log(`✅ ERC20 transfer transaction submitted successfully on ${result.network}`);
        console.log(`🆔 Transaction ID: ${result.transactionId}`);
        console.log(`🪙 Token: ${result.tokenInfo.name} (${result.tokenInfo.symbol})`);
        console.log(`📍 Recipient: ${result.recipient}`);
        console.log(`💰 Amount: ${result.amount} ${result.tokenInfo.symbol}`);
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

module.exports = { ERC20TransferSubmitter };
