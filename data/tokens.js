#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { ethers } = require('ethers');
const { Worker } = require('worker_threads');

class TokenScanner {
    constructor() {
        this.networks = {
            sepolia: {
                name: 'Sepolia Testnet',
                chainId: 11155111,
                isTestnet: true
            },
            'base-sepolia': {
                name: 'Base Sepolia',
                chainId: 84532,
                isTestnet: true
            },
            'arbitrum-sepolia': {
                name: 'Arbitrum Sepolia',
                chainId: 421614,
                isTestnet: true
            }
        };

        this.erc20ABI = [
            "function balanceOf(address owner) view returns (uint256)",
            "function decimals() view returns (uint8)",
            "function symbol() view returns (string)",
            "function name() view returns (string)"
        ];
        
        this.erc721ABI = [
            "function balanceOf(address owner) view returns (uint256)",
            "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
            "function ownerOf(uint256 tokenId) view returns (address)",
            "function name() view returns (string)",
            "function symbol() view returns (string)",
            "function walletOfOwner(address owner) view returns (uint256[])",
            "function tokenURI(uint256 tokenId) view returns (string)"
        ];

        this.tokenDatabase = null;
        this.cache = new Map();
        this.cacheFile = path.join(__dirname, 'token_cache.json');
    }

    async loadConfig() {
        try {
            const envPath = path.join(__dirname, '..', '.env');
            const envContent = await fs.readFile(envPath, 'utf8');
            
            const envVars = {};
            envContent.split('\n').forEach(line => {
                const [key, value] = line.split('=');
                if (key && value) {
                    envVars[key.trim()] = value.trim().replace(/['"]/g, '');
                }
            });

            this.networks.sepolia.rpcUrl = envVars.SEPOLIA_RPC_URL;
            this.networks['base-sepolia'].rpcUrl = envVars.BASE_SEPOLIA_RPC_URL;
            this.networks['arbitrum-sepolia'].rpcUrl = envVars.ARBITRUM_SEPOLIA_RPC_URL;

            console.log('✅ Configuration loaded');
            return true;
        } catch (error) {
            console.error('❌ Failed to load configuration:', error.message);
            return false;
        }
    }

    async loadTokenDatabase() {
        if (this.tokenDatabase) return this.tokenDatabase;

        try {
            const dbPath = path.join(__dirname, '..', 'token_database.json');
            const dbContent = await fs.readFile(dbPath, 'utf8');
            this.tokenDatabase = JSON.parse(dbContent);
            console.log('✅ Token database loaded');
            return this.tokenDatabase;
        } catch (error) {
            console.error('❌ Failed to load token database:', error.message);
            return null;
        }
    }

    async loadCache() {
        try {
            const cacheContent = await fs.readFile(this.cacheFile, 'utf8');
            const cacheData = JSON.parse(cacheContent);
            
            Object.entries(cacheData).forEach(([key, value]) => {
                if (Date.now() - value.timestamp < 300000) { // 5 minutes
                    this.cache.set(key, value);
                }
            });
            
            console.log(`✅ Cache loaded: ${this.cache.size} entries`);
        } catch (error) {
            console.log('ℹ️ No existing cache found, starting fresh');
        }
    }

    async saveCache() {
        try {
            const cacheObj = Object.fromEntries(this.cache);
            await fs.writeFile(this.cacheFile, JSON.stringify(cacheObj, (key, value) =>
                typeof value === 'bigint' ? value.toString() : value
            , 2));
            console.log('✅ Cache saved');
        } catch (error) {
            console.error('⚠️ Failed to save cache:', error.message);
        }
    }

    async updateTokenDatabase(newTokens) {
        try {
            const tokenDb = await this.loadTokenDatabase();
            let addedCount = 0;

            for (const token of newTokens) {
                const networkKey = token.network;
                const tokenType = token.type.toLowerCase();

                if (!tokenDb.networks[networkKey]) continue;
                if (!['erc20', 'erc721'].includes(tokenType)) continue;

                const networkTokens = tokenDb.networks[networkKey].tokens[tokenType];
                
                // Check discovered section
                if (!networkTokens.discovered) {
                    networkTokens.discovered = {};
                }

                // Check if token already exists in any category
                const tokenExists = Object.values(networkTokens).some(category =>
                    Object.values(category).some(t =>
                        t.address.toLowerCase() === token.address.toLowerCase()
                    )
                );

                if (!tokenExists) {
                    const tokenKey = `${token.symbol}_${token.address.substring(2, 6)}`;
                    networkTokens.discovered[tokenKey] = {
                        address: token.address,
                        name: token.name,
                        symbol: token.symbol,
                        type: 'discovered',
                        decimals: token.decimals,
                        discoveryMethod: token.source,
                        discoveredAt: new Date().toISOString(),
                        lastVerified: new Date().toISOString()
                    };
                    addedCount++;
                }
            }

            if (addedCount > 0) {
                // Update metadata
                tokenDb.metadata.totalTokens += addedCount;
                tokenDb.metadata.lastUpdated = new Date().toISOString();

                // Save to file
                await fs.writeFile(
                    path.join(__dirname, '..', 'token_database.json'),
                    JSON.stringify(tokenDb, (key, value) =>
                        typeof value === 'bigint' ? value.toString() : value
                    , 2)
                );
                console.log(`✅ Added ${addedCount} new tokens to database`);
            }

            return addedCount;
        } catch (error) {
            console.error('❌ Failed to update token database:', error.message);
            return 0;
        }
    }

    async scanTokens(contractAddress, includeHistoricalScan = false) {
        console.log(`🚀 Starting token scan for: ${contractAddress}`);
        console.log(`📜 Historical scan: ${includeHistoricalScan ? 'ENABLED' : 'DISABLED'}`);

        // Load configuration
        const configLoaded = await this.loadConfig();
        if (!configLoaded) {
            console.error('❌ Failed to load configuration');
            return;
        }

        // Load cache
        await this.loadCache();

        let discoveredTokens = [];
        const summary = {
            contract: contractAddress,
            timestamp: new Date().toISOString(),
            networks: {},
            totalTokens: 0,
            tokensByType: { ERC20: 0, ERC721: 0 },
            tokens: []
        };

        // Process all networks in parallel using worker threads
        const workerPromises = Object.entries(this.networks).map(([networkKey, network]) => {
            if (!network.rpcUrl) return Promise.resolve(null);

            return new Promise((resolve) => {
                const worker = new Worker('./data/scanWorker.js');
                
                worker.on('message', (message) => {
                    if (message.type === 'success') {
                        const result = message.data;
                        console.log(`\n🌐 Completed ${result.networkName}...`);
                        worker.terminate();
                        resolve(result);
                    } else if (message.type === 'error') {
                        console.error(`❌ Worker error for ${network.name}:`, message.error);
                        worker.terminate();
                        resolve(null);
                    }
                });

                worker.on('error', (error) => {
                    console.error(`❌ Worker crashed for ${network.name}:`, error);
                    worker.terminate();
                    resolve(null);
                });

                worker.postMessage({
                    networkConfig: {
                        networkKey,
                        network,
                        erc20ABI: this.erc20ABI,
                        erc721ABI: this.erc721ABI
                    },
                    contractAddress,
                    includeHistorical: includeHistoricalScan
                });
            });
        });

        // Wait for all network scans to complete
        console.log('🚀 Scanning all networks in parallel...');
        const results = await Promise.all(workerPromises);
        
        // Process results
        results.forEach(result => {
            if (result && result.tokens.length > 0) {
                discoveredTokens.push(...result.tokens);
                
                // Update summary
                summary.networks[result.networkKey] = {
                    name: result.networkName,
                    tokenCount: result.tokens.length,
                    tokens: result.tokens
                };

                console.log(`  ✅ ${result.networkName}: Found ${result.tokens.length} tokens`);
            }
        });

        // Update token database with new discoveries
        if (discoveredTokens.length > 0) {
            console.log('\n📝 Updating token database...');
            const addedCount = await this.updateTokenDatabase(discoveredTokens);
            if (addedCount > 0) {
                console.log(`  ✨ Added ${addedCount} new tokens to database`);
            }

            // Update cache with all discovered tokens
            const cacheKey = `${contractAddress}_scan`;
            this.cache.set(cacheKey, {
                data: discoveredTokens,
                timestamp: Date.now()
            });
            await this.saveCache();
        }

        // Final summary
        summary.totalTokens = discoveredTokens.length;
        summary.tokensByType.ERC20 = discoveredTokens.filter(t => t.type === 'ERC20').length;
        summary.tokensByType.ERC721 = discoveredTokens.filter(t => t.type === 'ERC721').length;
        summary.tokens = discoveredTokens;

        console.log(`\n🎉 Token scan complete!`);
        console.log(`📊 Total: ${summary.totalTokens} tokens (${summary.tokensByType.ERC20} ERC20, ${summary.tokensByType.ERC721} ERC721)`);

        // Display results by network
        if (discoveredTokens.length > 0) {
            console.log(`\n📋 Found Tokens:`);
            
            // Group tokens by network
            const networkGroups = {};
            discoveredTokens.forEach(token => {
                if (!networkGroups[token.network]) {
                    networkGroups[token.network] = [];
                }
                networkGroups[token.network].push(token);
            });

            // Display tokens by network
            Object.entries(networkGroups).forEach(([network, tokens]) => {
                const networkInfo = this.networks[network];
                console.log(`\n🌐 ${networkInfo.name}:`);
                
                // Display ERC20 tokens first
                const erc20Tokens = tokens.filter(t => t.type === 'ERC20');
                if (erc20Tokens.length > 0) {
                    console.log('  📈 ERC20 Tokens:');
                    erc20Tokens.forEach(token => {
                        console.log(`    • ${token.symbol} (${token.name})`);
                        console.log(`      Balance: ${token.balance}`);
                        console.log(`      Address: ${token.address}`);
                    });
                }

                // Then display ERC721 tokens
                const erc721Tokens = tokens.filter(t => t.type === 'ERC721');
                if (erc721Tokens.length > 0) {
                    console.log('  🎨 NFT Collections:');
                    erc721Tokens.forEach(token => {
                        console.log(`    • ${token.symbol} (${token.name})`);
                        console.log(`      Total Owned: ${token.balance}`);
                        console.log(`      Address: ${token.address}`);
                        if (token.tokenDetails && token.tokenDetails.length > 0) {
                            console.log(`      Token IDs:`);
                            token.tokenDetails.forEach(detail => {
                                if (detail.uri) {
                                    console.log(`        - #${detail.id} (URI: ${detail.uri}`);
                                } else {
                                    console.log(`        - #${detail.id}`);
                                }
                            });
                        } else if (token.tokenIds && token.tokenIds.length > 0) {
                            console.log(`      Token IDs: ${token.tokenIds.join(', ')}`);
                        }
                    });
                }
            });
        }

        return summary;
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node data/tokens.js <contract_address> [--historical]');
        console.log('Example: node data/tokens.js 0xe4F717Fbe2901efF97d3fD48593Ef2c6453b4Eee --historical');
        process.exit(1);
    }

    const contractAddress = args[0];
    const includeHistorical = args.includes('--historical');

    if (!ethers.isAddress(contractAddress)) {
        console.error('❌ Invalid contract address');
        process.exit(1);
    }

    const scanner = new TokenScanner();
    await scanner.scanTokens(contractAddress, includeHistorical);
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Script failed:', error.message);
        process.exit(1);
    });
}

module.exports = TokenScanner;
