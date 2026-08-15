const { ethers } = require('ethers');
require('dotenv').config();

/**
 * Script to submit an NFT transfer transaction to MultiSig on a specific network
 * Usage: node submitTransferNFT.js <multisig_address> <network> <nft_address> <recipient> <token_id>
 * Example: node submitTransferNFT.js 0x123... sepolia 0x456... 0x789... 1
 */

// MultiSig ABI - functions we need
const MULTISIG_ABI = [
    "function submitTransferNFT(address nftContractAddress, address to, uint256 tokenId) public returns (uint256)",
    "function isOwner(address) view returns (bool)",
    "function getOwners() view returns (address[])",
    "function required() view returns (uint)",
    "function transactionCount() view returns (uint)",
    "event Submission(uint indexed transactionId, address dest, uint256 value, bytes func)"
];

// ERC721 ABI - functions we need for validation
const ERC721_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function tokenURI(uint256 tokenId) view returns (string)",
    "function balanceOf(address owner) view returns (uint256)",
    "function supportsInterface(bytes4 interfaceId) view returns (bool)"
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

class NFTTransferSubmitter {
    constructor(multisigAddress, network, nftAddress, recipient, tokenId) {
        this.multisigAddress = multisigAddress;
        this.network = network;
        this.nftAddress = nftAddress;
        this.recipient = recipient;
        this.tokenId = parseInt(tokenId);
    }

    async submitTransferNFT() {
        try {
            console.log(`🖼️  Submitting NFT transfer to MultiSig ${this.multisigAddress} on ${this.network}`);
            console.log(`🎯 NFT Contract: ${this.nftAddress}`);
            console.log(`📍 Recipient: ${this.recipient}`);
            console.log(`🆔 Token ID: ${this.tokenId}\n`);

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
            const nft = new ethers.Contract(this.nftAddress, ERC721_ABI, provider);

            // Verify caller is an owner
            const isOwner = await multisig.isOwner(wallet.address);
            if (!isOwner) {
                throw new Error(`Address ${wallet.address} is not an owner of the MultiSig`);
            }

            // Get NFT information
            const nftInfo = await this.getNFTInfo(nft);
            console.log(`📋 NFT Collection Information:`);
            console.log(`   Name: ${nftInfo.name}`);
            console.log(`   Symbol: ${nftInfo.symbol}`);
            console.log(`   Is ERC721: ${nftInfo.isERC721 ? 'Yes' : 'No'}`);

            // Check token ownership
            let currentOwner;
            try {
                currentOwner = await nft.ownerOf(this.tokenId);
            } catch (error) {
                throw new Error(`Token ID ${this.tokenId} does not exist or contract does not support ownerOf`);
            }

            if (currentOwner.toLowerCase() !== this.multisigAddress.toLowerCase()) {
                throw new Error(`MultiSig does not own token ID ${this.tokenId}. Current owner: ${currentOwner}`);
            }

            console.log(`   Current Owner: ${currentOwner} ✅`);

            // Try to get token URI for additional info
            try {
                const tokenURI = await nft.tokenURI(this.tokenId);
                console.log(`   Token URI: ${tokenURI}`);
            } catch (error) {
                console.log(`   Token URI: Not available`);
            }

            // Get MultiSig NFT balance
            try {
                const balance = await nft.balanceOf(this.multisigAddress);
                console.log(`   MultiSig NFT Balance: ${balance.toString()} tokens\n`);
            } catch (error) {
                console.log(`   MultiSig NFT Balance: Unable to determine\n`);
            }

            // Estimate gas
            let gasEstimate;
            try {
                gasEstimate = await multisig.submitTransferNFT.estimateGas(
                    this.nftAddress,
                    this.recipient,
                    this.tokenId
                );
                console.log(`⛽ Estimated gas: ${gasEstimate.toString()}`);
            } catch (gasError) {
                console.warn(`⚠️  Gas estimation failed: ${gasError.message}`);
                gasEstimate = 400000n; // Fallback gas limit for NFT transfers
            }

            // Submit NFT transfer transaction
            console.log(`📤 Submitting NFT transfer transaction...`);
            const tx = await multisig.submitTransferNFT(
                this.nftAddress,
                this.recipient,
                this.tokenId,
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
                    
                    console.log(`✅ NFT transfer transaction submitted successfully!`);
                    console.log(`🆔 Transaction ID: ${transactionId}`);
                    console.log(`🖼️  NFT: ${nftInfo.name} (${nftInfo.symbol})`);
                    console.log(`🎯 Token ID: ${this.tokenId}`);
                    console.log(`📍 Recipient: ${this.recipient}`);
                    console.log(`📊 Gas used: ${receipt.gasUsed.toString()}`);
                    console.log(`💸 Gas cost: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} ETH`);
                    
                    return {
                        success: true,
                        transactionId: transactionId.toString(),
                        txHash: tx.hash,
                        gasUsed: receipt.gasUsed.toString(),
                        network: this.network,
                        nftInfo: nftInfo,
                        recipient: this.recipient,
                        tokenId: this.tokenId
                    };
                } else {
                    throw new Error('Submission event not found in transaction receipt');
                }
            } else {
                throw new Error('Transaction failed');
            }

        } catch (error) {
            console.error(`❌ Error submitting NFT transfer on ${this.network}:`);
            console.error(`   ${error.message}`);
            
            // Provide specific error guidance
            if (error.message.includes('not an owner')) {
                console.error(`💡 Make sure the wallet address is added as an owner to the MultiSig`);
            } else if (error.message.includes('does not own token')) {
                console.error(`💡 The MultiSig must own the NFT before it can be transferred`);
            } else if (error.message.includes('does not exist')) {
                console.error(`💡 Check that the token ID exists in the NFT contract`);
            } else if (error.message.includes('invalid address')) {
                console.error(`💡 Check that the NFT contract and recipient addresses are valid`);
            } else if (error.message.includes('gas')) {
                console.error(`💡 Try increasing gas limit or check network congestion`);
            } else if (error.message.includes('insufficient funds')) {
                console.error(`💡 Ensure the wallet has enough ETH for gas fees`);
            }
            
            throw error;
        }
    }

    async getNFTInfo(nft) {
        try {
            // Check if it's a valid ERC721 contract
            const ERC721_INTERFACE_ID = '0x80ac58cd';
            let isERC721 = false;
            
            try {
                isERC721 = await nft.supportsInterface(ERC721_INTERFACE_ID);
            } catch (error) {
                // If supportsInterface fails, we'll still try to get basic info
                console.warn('⚠️  Could not verify ERC721 interface support');
            }

            const [name, symbol] = await Promise.all([
                nft.name().catch(() => 'Unknown'),
                nft.symbol().catch(() => 'UNKNOWN')
            ]);

            return {
                name,
                symbol,
                isERC721
            };
        } catch (error) {
            throw new Error(`Failed to get NFT information: ${error.message}. Make sure the NFT address is a valid ERC721 contract.`);
        }
    }

    validateInputs() {
        if (!ethers.isAddress(this.multisigAddress)) {
            throw new Error(`Invalid MultiSig address: ${this.multisigAddress}`);
        }
        
        if (!ethers.isAddress(this.nftAddress)) {
            throw new Error(`Invalid NFT contract address: ${this.nftAddress}`);
        }

        if (!ethers.isAddress(this.recipient)) {
            throw new Error(`Invalid recipient address: ${this.recipient}`);
        }

        if (isNaN(this.tokenId) || this.tokenId < 0) {
            throw new Error(`Invalid token ID: ${this.tokenId}. Must be a non-negative number`);
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
        console.log('Usage: node submitTransferNFT.js <multisig_address> <network> <nft_address> <recipient> <token_id>');
        console.log('');
        console.log('Arguments:');
        console.log('  multisig_address  - Address of the MultiSig contract');
        console.log('  network          - Network name (sepolia, base-sepolia, arbitrum-sepolia)');
        console.log('  nft_address      - Address of the NFT (ERC721) contract');
        console.log('  recipient        - Address to receive the NFT');
        console.log('  token_id         - ID of the specific NFT token to transfer');
        console.log('');
        console.log('Examples:');
        console.log('  node submitTransferNFT.js 0x123... sepolia 0x456... 0x789... 1');
        console.log('  node submitTransferNFT.js 0x123... base-sepolia 0x456... 0x789... 42');
        process.exit(1);
    }

    const [multisigAddress, network, nftAddress, recipient, tokenId] = args;

    try {
        const submitter = new NFTTransferSubmitter(
            multisigAddress,
            network,
            nftAddress,
            recipient,
            tokenId
        );

        const result = await submitter.submitTransferNFT();
        
        console.log('\n📋 Summary:');
        console.log(`✅ NFT transfer transaction submitted successfully on ${result.network}`);
        console.log(`🆔 Transaction ID: ${result.transactionId}`);
        console.log(`🖼️  NFT: ${result.nftInfo.name} (${result.nftInfo.symbol})`);
        console.log(`🎯 Token ID: ${result.tokenId}`);
        console.log(`📍 Recipient: ${result.recipient}`);
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

module.exports = { NFTTransferSubmitter };
