const { ethers } = require('ethers');
const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');
const { poseidon1 } = require('poseidon-lite');
require('dotenv').config();

/**
 * Script to remove an owner from MultiSig across all EVM networks using PIN authentication
 * Usage: node removeOwner.js <multisig_address> <owner_to_remove> <pin>
 * 
 * Process:
 * 1. Validate addresses and PIN
 * 2. Check current state across networks
 * 3. Execute removeOwner with PIN on each network
 * 4. Verify results
 */

// MultiSig ABI - functions we need (no nonce - simplified!)
const MULTISIG_ABI = [
    "function removeOwner(address accountOwner, uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC) public",
    "function isOwner(address) view returns (bool)",
    "function getOwners() view returns (address[])",
    "function required() view returns (uint)",
    "function pinHash() view returns (bytes32)",
    "event OwnerRemoval(address indexed owner)",
    "event RequirementChange(uint required)"
];

// Available networks
const NETWORKS = {
    sepolia: {
        name: 'Sepolia',
        rpc: process.env.SEPOLIA_RPC_URL
    },
    'base-sepolia': {
        name: 'Base Sepolia',
        rpc: process.env.BASE_SEPOLIA_RPC_URL
    },
    'arbitrum-sepolia': {
        name: 'Arbitrum Sepolia',
        rpc: process.env.ARBITRUM_SEPOLIA_RPC_URL
    }
};

class CrossChainOwnerRemover {
    constructor(multisigAddress, ownerToRemove, pin) {
        this.multisigAddress = multisigAddress;
        this.ownerToRemove = ownerToRemove;
        this.pin = pin;
        this.results = {};
        this.errors = {};
        this.proof = null;
        this.contractProof = null;
        this.walletAddress = null;
    }

    async removeOwnerAcrossNetworks() {
        console.log(`🗑️  Removing owner ${this.ownerToRemove} from MultiSig ${this.multisigAddress} across all networks using zk-SNARK\n`);

        // Validate addresses
        if (!ethers.isAddress(this.multisigAddress)) {
            throw new Error(`Invalid MultiSig address: ${this.multisigAddress}`);
        }
        if (!ethers.isAddress(this.ownerToRemove)) {
            throw new Error(`Invalid owner address: ${this.ownerToRemove}`);
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

        // Step 3: Execute removeOwner transactions across networks
        await this.executeRemoveOwner();

        // Step 4: Verify results
        await this.verifyResults();

        // Step 5: Summary
        this.printSummary();
    }

    async generateProof() {
        console.log('🔐 Step 0: Generating zk-SNARK proof...\n');

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
                    console.log(`⚠️  ${networkConfig.name}: No contract at address ${this.multisigAddress}`);
                    this.errors[networkKey] = 'Contract not found';
                    continue;
                }

                // Get current owners
                const owners = await multisig.getOwners();
                const required = await multisig.required();
                const isCurrentlyOwner = await multisig.isOwner(this.ownerToRemove);

                console.log(`✅ ${networkConfig.name}:`);
                console.log(`   Current owners: ${owners.length}`);
                console.log(`   Required confirmations: ${required}`);
                console.log(`   Address is currently owner: ${isCurrentlyOwner}`);

                if (!isCurrentlyOwner) {
                    console.log(`   ⚠️  Address is not an owner - will skip this network`);
                    this.errors[networkKey] = 'Not an owner';
                    continue;
                }

                // Check if removing would violate requirement
                if (owners.length - 1 < required) {
                    console.log(`   ⚠️  Warning: Removing will auto-adjust requirement from ${required} to ${owners.length - 1}`);
                }

                this.results[networkKey] = {
                    provider,
                    contract: multisig,
                    currentOwners: owners,
                    required: required,
                    status: 'ready'
                };

            } catch (error) {
                console.log(`❌ ${networkConfig.name}: Error - ${error.message}`);
                this.errors[networkKey] = error.message;
            }
        }

        console.log('');
    }

    async checkBalances() {
        console.log('💰 Step 2: Checking wallet balances...\n');

        const privateKey = process.env.PRIVATE_KEY;
        if (!privateKey) {
            throw new Error('PRIVATE_KEY not found in environment variables');
        }

        for (const [networkKey, result] of Object.entries(this.results)) {
            if (result.status !== 'ready') continue;

            try {
                const wallet = new ethers.Wallet(privateKey);
                const provider = result.provider;
                const balance = await provider.getBalance(wallet.address);
                const gasPrice = await provider.getFeeData();

                // Estimate gas for removeOwner transaction with zk-proof
                const multisig = result.contract.connect(wallet.connect(provider));
                let gasEstimate;
                try {
                    gasEstimate = await multisig.removeOwner.estimateGas(
                        this.ownerToRemove,
                        this.contractProof.pA,
                        this.contractProof.pB,
                        this.contractProof.pC
                    );
                } catch (error) {
                    console.log(`⚠️  ${NETWORKS[networkKey].name}: Cannot estimate gas - ${error.message}`);
                    gasEstimate = ethers.parseUnits('250000', 'wei'); // higher estimate for zk-proof
                }

                const estimatedCost = gasEstimate * (gasPrice.gasPrice || gasPrice.maxFeePerGas);

                console.log(`${NETWORKS[networkKey].name}:`);
                console.log(`   Wallet: ${wallet.address}`);
                console.log(`   Balance: ${ethers.formatEther(balance)} ETH`);
                console.log(`   Estimated gas: ${gasEstimate.toString()}`);
                console.log(`   Estimated cost: ${ethers.formatEther(estimatedCost)} ETH`);

                if (balance < estimatedCost) {
                    console.log(`   ⚠️  Insufficient balance for gas`);
                    this.errors[networkKey] = 'Insufficient balance';
                    result.status = 'insufficient_balance';
                } else {
                    console.log(`   ✅ Sufficient balance`);
                }

            } catch (error) {
                console.log(`❌ ${NETWORKS[networkKey].name}: Error checking balance - ${error.message}`);
                this.errors[networkKey] = error.message;
                result.status = 'error';
            }
        }

        console.log('');
    }

    async executeRemoveOwner() {
        console.log('⚡ Step 3: Executing removeOwner transactions...\n');

        const privateKey = process.env.PRIVATE_KEY;
        const wallet = new ethers.Wallet(privateKey);

        for (const [networkKey, result] of Object.entries(this.results)) {
            if (result.status !== 'ready') {
                console.log(`⏭️  Skipping ${NETWORKS[networkKey].name}: ${result.status}`);
                continue;
            }

            try {
                const provider = result.provider;
                const multisig = result.contract.connect(wallet.connect(provider));

                console.log(`📤 ${NETWORKS[networkKey].name}: Executing removeOwner with zk-proof...`);

                const tx = await multisig.removeOwner(
                    this.ownerToRemove,
                    this.contractProof.pA,
                    this.contractProof.pB,
                    this.contractProof.pC,
                    {
                        gasLimit: 300000 // Higher limit for zk-proof verification
                    }
                );

                console.log(`   Transaction hash: ${tx.hash}`);
                console.log(`   Waiting for confirmation...`);

                const receipt = await tx.wait();

                if (receipt.status === 1) {
                    console.log(`   ✅ Transaction confirmed in block ${receipt.blockNumber}`);
                    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

                    result.txHash = tx.hash;
                    result.blockNumber = receipt.blockNumber;
                    result.gasUsed = receipt.gasUsed.toString();
                    result.status = 'success';
                } else {
                    console.log(`   ❌ Transaction failed`);
                    this.errors[networkKey] = 'Transaction failed';
                    result.status = 'failed';
                }

            } catch (error) {
                console.log(`❌ ${NETWORKS[networkKey].name}: Error - ${error.message}`);
                
                // Parse error message for common issues
                if (error.message.includes('incorrect pin')) {
                    this.errors[networkKey] = 'Incorrect PIN';
                } else if (error.message.includes('not Owner')) {
                    this.errors[networkKey] = 'Wallet is not an owner';
                } else if (error.message.includes('OwnerDoesNotExist')) {
                    this.errors[networkKey] = 'Address is not an owner';
                } else {
                    this.errors[networkKey] = error.message;
                }
                
                result.status = 'error';
            }
        }

        console.log('');
    }

    async verifyResults() {
        console.log('🔍 Step 4: Verifying results...\n');

        for (const [networkKey, result] of Object.entries(this.results)) {
            if (result.status !== 'success') continue;

            try {
                const multisig = result.contract;
                const isStillOwner = await multisig.isOwner(this.ownerToRemove);
                const owners = await multisig.getOwners();
                const newRequired = await multisig.required();

                console.log(`${NETWORKS[networkKey].name}:`);
                console.log(`   Address is still owner: ${isStillOwner}`);
                console.log(`   Total owners: ${owners.length} (was ${result.currentOwners.length})`);
                console.log(`   Required: ${newRequired} (was ${result.required})`);

                if (!isStillOwner && owners.length === result.currentOwners.length - 1) {
                    console.log(`   ✅ Owner successfully removed`);
                    result.verified = true;
                } else {
                    console.log(`   ⚠️  Verification failed`);
                    result.verified = false;
                }

            } catch (error) {
                console.log(`❌ ${NETWORKS[networkKey].name}: Error verifying - ${error.message}`);
                result.verified = false;
            }
        }

        console.log('');
    }

    printSummary() {
        console.log('📊 Summary\n');
        console.log('='.repeat(80));

        const successful = Object.entries(this.results).filter(([_, r]) => r.status === 'success' && r.verified);
        const failed = Object.entries(this.results).filter(([_, r]) => r.status !== 'success' || !r.verified);
        const skipped = Object.keys(this.errors).filter(k => !this.results[k]);

        console.log(`\n✅ Successful: ${successful.length} networks`);
        successful.forEach(([networkKey, result]) => {
            console.log(`   ${NETWORKS[networkKey].name}:`);
            console.log(`      Transaction: ${result.txHash}`);
            console.log(`      Block: ${result.blockNumber}`);
            console.log(`      Gas used: ${result.gasUsed}`);
        });

        if (failed.length > 0) {
            console.log(`\n❌ Failed: ${failed.length} networks`);
            failed.forEach(([networkKey, result]) => {
                console.log(`   ${NETWORKS[networkKey].name}: ${this.errors[networkKey] || result.status}`);
            });
        }

        if (skipped.length > 0) {
            console.log(`\n⏭️  Skipped: ${skipped.length} networks`);
            skipped.forEach(networkKey => {
                console.log(`   ${NETWORKS[networkKey]?.name || networkKey}: ${this.errors[networkKey]}`);
            });
        }

        console.log('\n' + '='.repeat(80));

        if (successful.length === Object.keys(NETWORKS).length) {
            console.log('\n🎉 Owner successfully removed across all networks!');
        } else if (successful.length > 0) {
            console.log('\n⚠️  Owner removed on some networks, but not all. Review errors above.');
        } else {
            console.log('\n❌ Failed to remove owner on any network. Review errors above.');
        }
    }
}

// Main execution
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
        console.log('Usage: node removeOwner.js <multisig_address> <owner_to_remove> <pin>');
        console.log('\nThis will remove the owner across all configured EVM networks using PIN authentication.');
        console.log('\nExample:');
        console.log('  node removeOwner.js 0x1234... 0x5678... 212');
        process.exit(1);
    }
    
    const multisigAddress = args[0];
    const ownerToRemove = args[1];
    const pin = args[2];
    
    const remover = new CrossChainOwnerRemover(multisigAddress, ownerToRemove, pin);
    remover.removeOwnerAcrossNetworks().catch(error => {
        console.error('\n❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = { CrossChainOwnerRemover };
