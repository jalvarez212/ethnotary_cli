const { ethers } = require('ethers');
require('dotenv').config();

/**
 * Pre-flight check script to verify the test environment is ready
 * Run this before executing the main test suite
 */

const CONFIG = {
    multisigAddress: '0x49909c741C0621D4637D6E8e61478a53916d284a',
    targetWallet: '0x1caefdf15648e7bdbfc9dc51076506d9454aa492',
    secretPhrase: process.env.MNEMONIC || 'test test test test test test test test test test test junk',
    nftAddress: '0xe6c1ee6624c6819262f29199dF25A70B2648B818',
    tokenAddress: '0x399ab04277063386023c41D0F77d15B79cb2d3BE',
    network: {
        name: 'Sepolia Testnet',
        chainId: 11155111,
        rpc: process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
        explorer: 'https://sepolia.etherscan.io'
    }
};

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
];

const ERC721_ABI = [
    "function ownerOf(uint256) view returns (address)",
    "function name() view returns (string)"
];

const MULTISIG_ABI = [
    "function getOwners() view returns (address[])",
    "function required() view returns (uint256)",
    "function transactionCount() view returns (uint256)",
    "function isOwner(address) view returns (bool)"
];

async function verifyEnvironment() {
    console.log('🔍 Verifying Test Environment...\n');
    console.log('='.repeat(80));
    
    const checks = {
        passed: [],
        failed: [],
        warnings: []
    };
    
    try {
        // 1. Check RPC Connection
        console.log('\n1️⃣  Checking RPC Connection...');
        const provider = new ethers.JsonRpcProvider(CONFIG.network.rpc);
        
        try {
            const blockNumber = await provider.getBlockNumber();
            console.log(`   ✅ Connected to ${CONFIG.network.name}`);
            console.log(`   📊 Current Block: ${blockNumber}`);
            checks.passed.push('RPC Connection');
        } catch (error) {
            console.log(`   ❌ Failed to connect: ${error.message}`);
            checks.failed.push('RPC Connection');
            return checks;
        }
        
        // 2. Check Wallet
        console.log('\n2️⃣  Checking Wallet...');
        const wallet = ethers.Wallet.fromPhrase(CONFIG.secretPhrase);
        const signer = wallet.connect(provider);
        
        console.log(`   📍 Derived Address: ${signer.address}`);
        console.log(`   📍 Expected Address: ${CONFIG.targetWallet}`);
        
        if (signer.address.toLowerCase() === CONFIG.targetWallet.toLowerCase()) {
            console.log(`   ✅ Wallet address matches`);
            checks.passed.push('Wallet Address');
        } else {
            console.log(`   ❌ Wallet address mismatch!`);
            checks.failed.push('Wallet Address');
            return checks;
        }
        
        // 3. Check Wallet Balance
        console.log('\n3️⃣  Checking Wallet Balance...');
        const balance = await provider.getBalance(signer.address);
        const balanceEth = ethers.formatEther(balance);
        
        console.log(`   💰 Balance: ${balanceEth} ETH`);
        
        if (balance > ethers.parseEther('0.01')) {
            console.log(`   ✅ Sufficient balance for gas`);
            checks.passed.push('Wallet Balance');
        } else if (balance > 0n) {
            console.log(`   ⚠️  Low balance - may not be enough for all tests`);
            checks.warnings.push('Low wallet balance');
            checks.passed.push('Wallet Balance');
        } else {
            console.log(`   ❌ No ETH for gas!`);
            checks.failed.push('Wallet Balance');
        }
        
        // 4. Check MultiSig Contract
        console.log('\n4️⃣  Checking MultiSig Contract...');
        const code = await provider.getCode(CONFIG.multisigAddress);
        
        if (code === '0x') {
            console.log(`   ❌ No contract found at ${CONFIG.multisigAddress}`);
            checks.failed.push('MultiSig Contract');
            return checks;
        }
        
        console.log(`   ✅ Contract exists at ${CONFIG.multisigAddress}`);
        
        const multisig = new ethers.Contract(CONFIG.multisigAddress, MULTISIG_ABI, provider);
        
        try {
            const owners = await multisig.getOwners();
            const required = await multisig.required();
            const txCount = await multisig.transactionCount();
            const isOwner = await multisig.isOwner(signer.address);
            
            console.log(`   📊 Owners: ${owners.length}`);
            console.log(`   📊 Required Confirmations: ${required}`);
            console.log(`   📊 Transaction Count: ${txCount}`);
            console.log(`   📊 Target Wallet is Owner: ${isOwner}`);
            
            if (isOwner) {
                console.log(`   ✅ Target wallet is an owner`);
                checks.passed.push('MultiSig Ownership');
            } else {
                console.log(`   ❌ Target wallet is NOT an owner!`);
                checks.failed.push('MultiSig Ownership');
            }
            
            // Check MultiSig balance
            const multisigBalance = await provider.getBalance(CONFIG.multisigAddress);
            console.log(`   💰 MultiSig Balance: ${ethers.formatEther(multisigBalance)} ETH`);
            
            if (multisigBalance > ethers.parseEther('0.0001')) {
                console.log(`   ✅ MultiSig has ETH for transfers`);
                checks.passed.push('MultiSig ETH Balance');
            } else {
                console.log(`   ⚠️  MultiSig has low/no ETH`);
                checks.warnings.push('Low MultiSig ETH balance');
            }
            
        } catch (error) {
            console.log(`   ❌ Error reading MultiSig state: ${error.message}`);
            checks.failed.push('MultiSig State');
        }
        
        // 5. Check NFT
        console.log('\n5️⃣  Checking NFT (Doodle #234)...');
        const nftCode = await provider.getCode(CONFIG.nftAddress);
        
        if (nftCode === '0x') {
            console.log(`   ❌ No NFT contract found at ${CONFIG.nftAddress}`);
            checks.failed.push('NFT Contract');
        } else {
            console.log(`   ✅ NFT contract exists`);
            
            const nft = new ethers.Contract(CONFIG.nftAddress, ERC721_ABI, provider);
            
            try {
                const name = await nft.name();
                console.log(`   📛 NFT Name: ${name}`);
                
                const owner = await nft.ownerOf(234);
                console.log(`   👤 Token #234 Owner: ${owner}`);
                
                if (owner.toLowerCase() === CONFIG.multisigAddress.toLowerCase()) {
                    console.log(`   ✅ MultiSig owns Doodle #234`);
                    checks.passed.push('NFT Ownership');
                } else {
                    console.log(`   ❌ MultiSig does NOT own Doodle #234!`);
                    checks.failed.push('NFT Ownership');
                }
            } catch (error) {
                console.log(`   ❌ Error checking NFT: ${error.message}`);
                checks.failed.push('NFT Check');
            }
        }
        
        // 6. Check ERC20 Token
        console.log('\n6️⃣  Checking ERC20 Token (MT)...');
        const tokenCode = await provider.getCode(CONFIG.tokenAddress);
        
        if (tokenCode === '0x') {
            console.log(`   ❌ No token contract found at ${CONFIG.tokenAddress}`);
            checks.failed.push('Token Contract');
        } else {
            console.log(`   ✅ Token contract exists`);
            
            const token = new ethers.Contract(CONFIG.tokenAddress, ERC20_ABI, provider);
            
            try {
                const symbol = await token.symbol();
                const decimals = await token.decimals();
                const balance = await token.balanceOf(CONFIG.multisigAddress);
                const balanceFormatted = ethers.formatUnits(balance, decimals);
                
                console.log(`   📛 Token Symbol: ${symbol}`);
                console.log(`   💰 MultiSig Balance: ${balanceFormatted} ${symbol}`);
                
                if (balance >= ethers.parseUnits('78', decimals)) {
                    console.log(`   ✅ MultiSig has sufficient tokens (need 78)`);
                    checks.passed.push('Token Balance');
                } else {
                    console.log(`   ❌ MultiSig does NOT have enough tokens (need 78)!`);
                    checks.failed.push('Token Balance');
                }
            } catch (error) {
                console.log(`   ❌ Error checking token: ${error.message}`);
                checks.failed.push('Token Check');
            }
        }
        
        // 7. Summary
        console.log('\n\n');
        console.log('='.repeat(80));
        console.log('VERIFICATION SUMMARY');
        console.log('='.repeat(80));
        
        console.log(`\n✅ PASSED: ${checks.passed.length} checks`);
        checks.passed.forEach(check => {
            console.log(`   ✓ ${check}`);
        });
        
        if (checks.warnings.length > 0) {
            console.log(`\n⚠️  WARNINGS: ${checks.warnings.length}`);
            checks.warnings.forEach(warning => {
                console.log(`   ⚠ ${warning}`);
            });
        }
        
        if (checks.failed.length > 0) {
            console.log(`\n❌ FAILED: ${checks.failed.length} checks`);
            checks.failed.forEach(check => {
                console.log(`   ✗ ${check}`);
            });
            
            console.log('\n⛔ Environment is NOT ready for testing!');
            console.log('Please fix the failed checks before running tests.\n');
            return false;
        } else {
            console.log('\n✅ Environment is READY for testing!');
            console.log('You can now run: node test-multisig-functions.js\n');
            return true;
        }
        
    } catch (error) {
        console.error('\n❌ FATAL ERROR during verification:', error.message);
        console.error(error);
        return false;
    }
}

// Run verification
if (require.main === module) {
    verifyEnvironment().then(ready => {
        process.exit(ready ? 0 : 1);
    });
}

module.exports = { verifyEnvironment };
