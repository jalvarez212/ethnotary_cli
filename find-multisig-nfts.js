const { ethers } = require('ethers');

// Configuration
const CONFIG = {
    multisigAddress: '0xF098DD37b9dC542273A8E6431b1f3eE9Bfd47b5a',
    nftAddress: '0xe6c1ee6624c6819262f29199dF25A70B2648B818',
    rpc: process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY'
};

// ERC721 ABI
const ERC721_ABI = [
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function balanceOf(address owner) view returns (uint256)",
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
];

async function findMultiSigNFTs() {
    console.log('🔍 Finding NFTs owned by MultiSig...\n');
    
    try {
        const provider = new ethers.JsonRpcProvider(CONFIG.rpc);
        const nftContract = new ethers.Contract(CONFIG.nftAddress, ERC721_ABI, provider);
        
        const balance = await nftContract.balanceOf(CONFIG.multisigAddress);
        console.log(`MultiSig owns ${balance.toString()} NFT(s)\n`);
        
        if (balance == 0) {
            console.log('❌ MultiSig does not own any NFTs from this collection');
            return;
        }
        
        console.log('Searching for Transfer events to MultiSig...\n');
        
        // Get Transfer events where MultiSig is the recipient
        const filter = nftContract.filters.Transfer(null, CONFIG.multisigAddress);
        const events = await nftContract.queryFilter(filter, -10000); // Last 10k blocks
        
        console.log(`Found ${events.length} transfer(s) to MultiSig\n`);
        
        const ownedTokens = [];
        
        for (const event of events) {
            const tokenId = event.args.tokenId;
            console.log(`Checking token ID ${tokenId}...`);
            
            try {
                const currentOwner = await nftContract.ownerOf(tokenId);
                if (currentOwner.toLowerCase() === CONFIG.multisigAddress.toLowerCase()) {
                    console.log(`   ✅ Still owned by MultiSig`);
                    ownedTokens.push(tokenId.toString());
                } else {
                    console.log(`   ❌ No longer owned (current owner: ${currentOwner})`);
                }
            } catch (e) {
                console.log(`   ❌ Token no longer exists`);
            }
        }
        
        if (ownedTokens.length > 0) {
            console.log(`\n📋 MultiSig currently owns token IDs: ${ownedTokens.join(', ')}`);
            console.log(`\n💡 Update your test script to use one of these token IDs!`);
        } else {
            console.log(`\n⚠️  MultiSig received NFTs but no longer owns them`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

findMultiSigNFTs();
