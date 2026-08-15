/**
 * Script to replace an owner in MultiSig across all EVM networks using zk-SNARK PIN authentication
 * Usage: node replaceOwner.js <multisig_address> <old_owner> <new_owner> <pin>
 * 
 * Process:
 * 1. Generate zk-SNARK proof for PIN verification (once)
 * 2. Validate addresses and PIN
 * 3. Check current state across networks
 * 4. Execute replaceOwner with zk-proof on each network
 * 5. Verify results
 */

// MultiSig ABI - functions we need (no nonce - simplified!)
const MULTISIG_ABI = [
    "function replaceOwner(address accountOwner, address newOwner, uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC) public",
    "function isOwner(address) view returns (bool)",
    "function getOwners() view returns (address[])",
    "function required() view returns (uint)",
    "function pinHash() view returns (bytes32)",
    "event OwnerReplace(address indexed oldOwner, address indexed newOwner)"
];

// Available networks
const NETWORKS = {
    sepolia: {
        name: 'Sepolia',
        rpc: process.env.SEPOLIA_RPC_URL
    },
    'base-sepolia': {
        name: 'Base Sepo<new_content>
    }
};

class CrossChainOwnerReplacer {
    constructor(multisigAddress, oldOwner, newOwner, pin) {
        this.multisigAddress = multisigAddress;
        this.oldOwner = oldOwner;
        this.newOwner = newOwner;
        this.pin = pin;
        this.results = {};
        this.errors = {};
        this.proof = null;
        this.contractProof = null;
        this.walletAddress = null;
    }

    async replaceOwnerAcrossNetworks() {
        console.log(`🔄 Replacing owner in MultiSig ${this.multisigAddress} across all networks using zk-SNARK`);
        console.log(`   Old owner: ${this.oldOwner}`);
        console.log(`   New owner: ${this.newOwner}\n`);

        // Validate addresses
        if (!ethers.isAddress(this.multisigAddress)) {
            throw new Error(`Invalid MultiSig address: ${this.multisigAddress}`);
        }
        if (!ethers.isAddress(this.oldOwner)) {
            throw new Error(`Invalid old owner address: ${this.oldOwner}`);
        }
        if (!ethers.isAddress(this.newOwner)) {
            throw new Error(`Invalid new owner address: ${this.newOwner}`);
        }
        if (this.oldOwner === this.newOwner) {
            throw new Error('Old owner and new owner cannot be the same address');
        }

        // Validate PIN
        if (!this.pin || isNaN(this.pin)) {
            throw new Error('Invalid PIN: must be a number');
        }

        // Step 0: Generate zk-SNARK proof (only once)
        await this.generateProof();

        // Step 1: Check current state across networks
        await this.checkCurrentState();

        // Step 2: Check balances and gas requirements
        await this.checkBalances();

        // Step 3: Execute replaceOwner transactions across networks
        await this.executeReplaceOwner();

        // Step 4: Verify results
        await this.verifyResults();

        // Step 5: Summary
        this.printSummary();
    }

    async generateProof() {
        console.log('🔐 Step 0: Generating zk-SNARK proof...\n');

        const snarkjs = require('snarkjs');
        const fs = require('fs');
        const path = require('path');
        const { poseidon1 } = require('poseidon-lite');

        try {
            // Get wallet address for sender binding
            const privateKey = process.env.PRIVATE_KEY;
            if (!privateKey) {
                throw new Error('PRIVATE_KEY not found in environment variables');
            }
            const wallet = new ethers.Wallet(privateKey);
            this.walletAddress = wallet.address.toLowerCase();
            
            console.log(`   Wallet address: ${this.walletAddress}`);

            // Load circuit files
            const circuitPath = path.join(__dirname, '../zkbuild/pin_verify_js');
            const wasmFile = path.join(circuitPath, 'pin_verify.wasm');
            const zkeyFile = path.join(__dirname, '../zkbuild/pin_verify_final.zkey');

            if (!fs.existsSync(wasmFile)) {
                throw new Error(`WASM file not found: ${wasmFile}`);
            }
            if (!fs.existsSync(zkeyFile)) {
                throw new Error(`zkey file not found: ${zkeyFile}`);
            }

            // Validate newOwner is not zero address
            if (this.newOwner === ethers.ZeroAddress) {
                throw new Error('New owner address cannot be zero address');
            }

            // Prepare circuit inputs
            const senderBigInt = BigInt(this.walletAddress);
            
            const input = {
                pin: this.pin.toString(),
                sender: senderBigInt.toString()
            };

            console.log(`   Generating witness...`);
            
            // Generate witness
            const { wasm, wtns } = await snarkjs.wtns.calculate(input, wasmFile);
            
            console.log(`   Computing proof...`);
            
            // Generate Groth16 proof
            const proof = await snarkjs.groth16.prove(zkeyFile, wtns);
            
            this.proof = proof;
            
            // Format proof for contract
            this.contractProof = {
                pA: [proof.pi_a[0], proof.pi_a[1]],
                pB: [
                    [proof.pi_b[0][1], proof.pi_b[0][0]],
                    [proof.pi_b[1][1], proof.pi_b[1][0]]
                ],
                pC: [proof.pi_c[0], proof.pi_c[1]]
            };

            console.log(`   ✅ Proof generated successfully`);
            console.log(`   Public signals: [pinHash, sender]`);
            console.log(``);

        } catch (error) {
            console.error(`❌ Error generating proof: ${error.message}`);
            throw error;
        }
    }

    async checkCurrentState() {
        console.log('🔍 Step 1: Checking current state across networks...\n');

        for (const [networkKey, networkConfig] of Object.entries(NETWORKS)) {
            if (!networkConfig.rpc) {
                console.log(`⚠️  Skipping ${networkConfig.name}: No RPC URL configured`);
                continue;
            }

            try {
                const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
                const multisig = new ethers.Contract(this.multisigAddress, MULTISIG_ABI, provider);

                // Check if contract exists
                const code = await provider.getCode(this.multisigAddress);
                if (code === '0x') {
                    console.log(`⚠️  ${networkConfig.name}: No contract found at ${this.multisigAddress}`);
                    this.results[networkKey] = { status: 'no_contract' };
                    continue;
                }

                // Get current owners and check states
                const [owners, required, isOldOwner, isNewOwner] = await Promise.all([
                    multisig.getOwners(),
                    multisig.required(),
                    multisig.isOwner(this.oldOwner),
                    multisig.isOwner(this.newOwner)
                ]);

                console.log(`📊 ${networkConfig.name}:`);
                console.log(`  Current owners: ${owners.length}`);
                console.log(`  Required confirmations: ${required}`);
                console.log(`  Old owner exists: ${isOldOwner}`);
                console.log(`  New owner already exists: ${isNewOwner}`);

                let status = 'ready';
                if (!isOldOwner) {
                    status = 'old_owner_not_found';
                } else if (isNewOwner) {
                    status = 'new_owner_already_exists';
                }

                this.results[networkKey] = {
                    status,
                    owners: owners.length,
                    required: Number(required),
                    isOldOwner,
                    isNewOwner,
                    contract: multisig,
                    provider
                };

            } catch (error) {
                console.error(`❌ ${networkConfig.name}: Error checking state - ${error.message}`);
                this.errors[networkKey] = error.message;
                this.results[networkKey] = { status: 'error' };
            }
        }
        console.log('');
    }

    async checkBalances() {
        console.log('💰 Step 2: Checking wallet balances and gas requirements...\n');

        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
        console.log(`📋 Using wallet: ${wallet.address}`);

        for (const [networkKey, networkConfig] of Object.entries(NETWORKS)) {
            if (!this.results[networkKey] || this.results[networkKey].status !== 'ready') {
                continue;
            }

            try {
                const provider = this.results[networkKey].provider;
                const balance = await provider.getBalance(wallet.address);
                const gasPrice = await provider.getFeeData();

                // Estimate gas for replaceOwner transaction with zk-proof
                const multisig = this.results[networkKey].contract.connect(wallet.connect(provider));
                let gasEstimate;
                try {
                    gasEstimate = await multisig.replaceOwner.estimateGas(
                        this.oldOwner,
                        this.newOwner,
                        this.contractProof.pA,
                        this.contractProof.pB,
                        this.contractProof.pC
                    );
                } catch (error) {
                    console.log(`⚠️  ${networkConfig.name}: Cannot estimate gas - ${error.message}`);
                    gasEstimate = ethers.parseUnits('300000', 'wei'); // higher estimate for zk-proof
                }

                const estimatedCost = gasEstimate * gasPrice.gasPrice;
                const hasEnoughBalance = balance > estimatedCost;

                console.log(`💳 ${networkConfig.name}:`);
                console.log(`  Balance: ${ethers.formatEther(balance)} ETH`);
                console.log(`  Estimated cost: ${ethers.formatEther(estimatedCost)} ETH`);
                console.log(`  Sufficient funds: ${hasEnoughBalance ? '✅' : '❌'}`);

                this.results[networkKey].balance = balance;
                this.results[networkKey].estimatedCost = estimatedCost;
                this.results[networkKey].hasEnoughBalance = hasEnoughBalance;

                if (!hasEnoughBalance) {
                    this.results[networkKey].status = 'insufficient_funds';
                }

            } catch (error) {
                console.error(`❌ ${networkConfig.name}: Error checking balance - ${error.message}`);
                this.errors[networkKey] = error.message;
                this.results[networkKey].status = 'error';
            }
        }
        console.log('');
    }

    async executeReplaceOwner() {
        console.log('🚀 Step 3: Executing replaceOwner transactions...\n');

        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);

        for (const [networkKey, networkConfig] of Object.entries(NETWORKS)) {
            if (!this.results[networkKey] || this.results[networkKey].status !== 'ready') {
                continue;
            }

            try {
                const provider = this.results[networkKey].provider;
                const multisig = this.results[networkKey].contract.connect(wallet.connect(provider));

                console.log(`📤 ${networkConfig.name}: Executing replaceOwner with zk-proof...`);

                const tx = await multisig.replaceOwner(
                    this.oldOwner,
                    this.newOwner,
                    this.contractProof.pA,
                    this.contractProof.pB,
                    this.contractProof.pC,
                    {
                        gasLimit: 350000 // Higher limit for zk-proof verification
                    }
                );

                console.log(`  Transaction hash: ${tx.hash}`);
                this.results[networkKey].txHash = tx.hash;
                this.results[networkKey].status = 'pending';

                // Wait for transaction to complete
                console.log(`⏳ ${networkConfig.name}: Waiting for confirmation...`);
                const receipt = await tx.wait();

                if (receipt.status === 1) {
                    console.log(`✅ ${networkConfig.name}: Transaction executed in block ${receipt.blockNumber}`);
                    this.results[networkKey].status = 'executed';
                    this.results[networkKey].blockNumber = receipt.blockNumber;

                    // Check for OwnerReplace event
                    const ownerReplaceEvent = receipt.logs.find(log => {
                        try {
                            const parsed = this.results[networkKey].contract.interface.parseLog(log);
                            return parsed && parsed.name === 'OwnerReplace';
                        } catch { return false; }
                    });
                    
                    if (ownerReplaceEvent) {
                        const parsed = this.results[networkKey].contract.interface.parseLog(ownerReplaceEvent);
                        console.log(`  Old owner: ${parsed.args.oldOwner}`);
                        console.log(`  New owner: ${parsed.args.newOwner}`);
                    }
                } else {
                    console.log(`❌ ${networkConfig.name}: Transaction failed`);
                    this.results[networkKey].status = 'tx_failed';
                }

            } catch (error) {
                console.error(`❌ ${networkConfig.name}: Transaction failed - ${error.message}`);
                this.errors[networkKey] = error.message;
                this.results[networkKey].status = 'tx_failed';
            }
        }
        console.log('');
    }

    async verifyResults() {
        console.log('🔍 Step 4: Verifying owner replacement across networks...\n');

        for (const [networkKey, networkConfig] of Object.entries(NETWORKS)) {
            if (!this.results[networkKey] || this.results[networkKey].status !== 'executed') {
                continue;
            }

            try {
                const multisig = this.results[networkKey].contract;
                const [isOldOwnerGone, isNewOwnerAdded, owners] = await Promise.all([
                    multisig.isOwner(this.oldOwner),
                    multisig.isOwner(this.newOwner),
                    multisig.getOwners()
                ]);

                const replacementSuccessful = !isOldOwnerGone && isNewOwnerAdded;

                console.log(`✅ ${networkConfig.name}: Owner replacement verification`);
                console.log(`  Old owner removed: ${!isOldOwnerGone ? '✅' : '❌'}`);
                console.log(`  New owner added: ${isNewOwnerAdded ? '✅' : '❌'}`);
                console.log(`  Total owners: ${owners.length} (unchanged)`);
                console.log(`  Replacement successful: ${replacementSuccessful ? '✅' : '❌'}`);

                this.results[networkKey].verified = replacementSuccessful;
                this.results[networkKey].finalOwnerCount = owners.length;

            } catch (error) {
                console.error(`❌ ${networkConfig.name}: Verification failed - ${error.message}`);
                this.results[networkKey].verified = false;
            }
        }
        console.log('');
    }

    printSummary() {
        console.log('📋 EXECUTION SUMMARY');
        console.log('===================');

        let successCount = 0;
        let networksWithContract = 0;
        let totalNetworks = 0;

        for (const [networkKey, networkConfig] of Object.entries(NETWORKS)) {
            if (!networkConfig.rpc) continue;
            
            totalNetworks++;
            const result = this.results[networkKey];

            if (!result) {
                console.log(`${networkConfig.name}: ❌ No result`);
                continue;
            }

            if (result.status !== 'no_contract') {
                networksWithContract++;
            }

            switch (result.status) {
                case 'executed':
                    console.log(`${networkConfig.name}: ✅ Executed (Block: ${result.blockNumber})`);
                    if (result.verified) {
                        console.log(`  ${this.oldOwner.slice(0, 8)}... → ${this.newOwner.slice(0, 8)}...`);
                        successCount++;
                    }
                    break;
                case 'old_owner_not_found':
                    console.log(`${networkConfig.name}: ⚠️  Old owner not found`);
                    successCount++; // Count as success since no action needed
                    break;
                case 'new_owner_already_exists':
                    console.log(`${networkConfig.name}: ⚠️  New owner already exists`);
                    break;
                case 'no_contract':
                    console.log(`${networkConfig.name}: ⚠️  No contract found`);
                    break;
                case 'insufficient_funds':
                    console.log(`${networkConfig.name}: ❌ Insufficient funds`);
                    break;
                case 'tx_failed':
                    console.log(`${networkConfig.name}: ❌ Transaction failed`);
                    break;
                default:
                    console.log(`${networkConfig.name}: ❌ ${result.status}`);
            }
        }

        console.log(`\n🎯 Result: ${successCount}/${networksWithContract} networks with contract updated successfully`);
        console.log(`📊 Networks: ${networksWithContract} with contract, ${totalNetworks - networksWithContract} without contract, ${totalNetworks} total`);

        if (Object.keys(this.errors).length > 0) {
            console.log('\n❌ Errors encountered:');
            Object.entries(this.errors).forEach(([network, error]) => {
                console.log(`  ${network}: ${error}`);
            });
        }

        if (networksWithContract === 0) {
            console.log('\n⚠️  No contracts found on any network');
        } else if (successCount === networksWithContract) {
            console.log('\n🎉 Owner successfully replaced across all networks with contracts!');
        } else if (successCount > 0) {
            console.log('\n⚠️  Partial success - some networks with contracts failed');
        } else {
            console.log('\n❌ Failed to replace owner on any network with contracts');
        }
    }
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length < 4) {
        console.log('Usage: node replaceOwner.js <multisig_address> <old_owner> <new_owner> <pin>');
        console.log('');
        console.log('Requirements:');
        console.log('  - zk-SNARK circuit must be compiled (zkbuild/)');
        console.log('  - PRIVATE_KEY environment variable must be set');
        console.log('  - RPC URLs configured in .env');
        console.log('');
        console.log('Examples:');
        console.log('  node replaceOwner.js 0x1234... 0x5678... 0x9abc... 1234');
        console.log('');
        console.log('This will replace the old owner with the new owner using zk-SNARK PIN authentication.');
        console.log('The total number of owners remains the same.');
        console.log('');
        console.log('Note: No nonce tracking required! ✨');
        process.exit(1);
    }
    
    const multisigAddress = args[0];
    const oldOwner = args[1];
    const newOwner = args[2];
    const pin = parseInt(args[3]);
    
    const replacer = new CrossChainOwnerReplacer(multisigAddress, oldOwner, newOwner, pin);
    replacer.replaceOwnerAcrossNetworks().catch(error => {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = { CrossChainOwnerReplacer };
