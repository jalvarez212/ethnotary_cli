const { parentPort, workerData } = require('worker_threads');
const { ethers } = require('ethers');

async function scanNetwork(networkConfig, contractAddress, includeHistorical) {
    const { networkKey, network, erc20ABI, erc721ABI } = networkConfig;
    
    try {
        const provider = new ethers.JsonRpcProvider(network.rpcUrl);
        const discoveredTokens = [];
        const tokenAddresses = new Set();

        // Get current block
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = includeHistorical ? 0 : Math.max(0, currentBlock - 900000);
        
        // Transfer event topics
        const transferTopic = ethers.id("Transfer(address,address,uint256)");

        // Scan for transfers TO and FROM the contract
        const [incomingLogs, outgoingLogs] = await Promise.all([
            provider.getLogs({
                fromBlock,
                toBlock: currentBlock,
                topics: [
                    transferTopic,
                    null,
                    ethers.zeroPadValue(contractAddress, 32)
                ]
            }),
            provider.getLogs({
                fromBlock,
                toBlock: currentBlock,
                topics: [
                    transferTopic,
                    ethers.zeroPadValue(contractAddress, 32),
                    null
                ]
            })
        ]);

        // Extract unique token addresses
        [...incomingLogs, ...outgoingLogs].forEach(log => {
            tokenAddresses.add(log.address.toLowerCase());
        });

        // Check each token contract
        const tokenChecks = Array.from(tokenAddresses).map(async (tokenAddress) => {
            try {
                // Try ERC20
                try {
                    const erc20Contract = new ethers.Contract(tokenAddress, erc20ABI, provider);
                    const [balance, decimals, symbol, name] = await Promise.all([
                        erc20Contract.balanceOf(contractAddress),
                        erc20Contract.decimals(),
                        erc20Contract.symbol(),
                        erc20Contract.name()
                    ]);

                    if (balance > 0n) {
                        const formattedBalance = ethers.formatUnits(balance, decimals);
                        return {
                            type: 'ERC20',
                            address: tokenAddress,
                            symbol: symbol,
                            name: name,
                            balance: formattedBalance,
                            rawBalance: balance.toString(),
                            decimals: decimals,
                            network: networkKey,
                            source: 'events'
                        };
                    }
                } catch (erc20Error) {
                    // Try ERC721
                    try {
                        const erc721Contract = new ethers.Contract(tokenAddress, erc721ABI, provider);
                        const [balance, symbol, name] = await Promise.all([
                            erc721Contract.balanceOf(contractAddress),
                            erc721Contract.symbol(),
                            erc721Contract.name()
                        ]);

                        if (balance > 0n) {
                            // Try walletOfOwner first, fallback to tokenOfOwnerByIndex
                            let tokenIds = [];
                            try {
                                // Try walletOfOwner
                                const walletTokens = await erc721Contract.walletOfOwner(contractAddress);
                                tokenIds = walletTokens.map(id => id.toString());
                                console.log(`Found ${tokenIds.length} tokens using walletOfOwner`);
                            } catch (walletError) {
                                // Fallback to tokenOfOwnerByIndex
                                const promises = [];
                                for (let i = 0; i < Math.min(Number(balance), 50); i++) {
                                    promises.push(erc721Contract.tokenOfOwnerByIndex(contractAddress, i)
                                        .then(tokenId => tokenIds.push(tokenId.toString()))
                                        .catch(() => {}));
                                }
                                await Promise.allSettled(promises);
                                console.log(`Found ${tokenIds.length} tokens using tokenOfOwnerByIndex`);
                            }

                            // Try to get token URIs
                            const tokenDetails = await Promise.all(
                                tokenIds.map(async (tokenId) => {
                                    try {
                                        const uri = await erc721Contract.tokenURI(tokenId);
                                        return { id: tokenId, uri };
                                    } catch (error) {
                                        return { id: tokenId };
                                    }
                                })
                            );

                            return {
                                type: 'ERC721',
                                address: tokenAddress,
                                symbol: symbol,
                                name: name,
                                balance: balance.toString(),
                                tokenIds: tokenIds,
                                tokenDetails: tokenDetails,
                                network: networkKey,
                                source: 'events'
                            };
                        }
                    } catch (erc721Error) {
                        // Not a valid token contract
                    }
                }
            } catch (error) {
                // Log error but continue with other tokens
                console.error(`Error checking token ${tokenAddress}: ${error.message}`);
            }
            return null;
        });

        const results = await Promise.allSettled(tokenChecks);
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                discoveredTokens.push(result.value);
            }
        });

        return {
            networkKey,
            networkName: network.name,
            tokens: discoveredTokens
        };

    } catch (error) {
        return {
            networkKey,
            networkName: network.name,
            error: error.message,
            tokens: []
        };
    }
}

// Handle messages from parent
parentPort.on('message', async ({ networkConfig, contractAddress, includeHistorical }) => {
    try {
        const result = await scanNetwork(networkConfig, contractAddress, includeHistorical);
        parentPort.postMessage({ type: 'success', data: result });
    } catch (error) {
        parentPort.postMessage({ type: 'error', error: error.message });
    }
});
