#!/usr/bin/env node

/**
 * Generate bytecode for MSAFactory deployment
 * Used by setup.js for CREATE2 deployment
 */

const { execSync } = require('child_process');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Build contracts
console.log('🔨 Building contracts...');
try {
    execSync('forge build --silent', { stdio: 'inherit' });
} catch (error) {
    console.error('❌ Failed to build contracts');
    process.exit(1);
}

// Read MSAFactory artifact
const artifactPath = path.join(__dirname, 'out', 'MultiSig.sol', 'MSAFactory.json');

if (!fs.existsSync(artifactPath)) {
    console.error('❌ MSAFactory artifact not found at:', artifactPath);
    console.error('Make sure contracts are compiled with: forge build');
    process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const creationCode = artifact.bytecode.object;

// MSAFactory has pinVerifier hardcoded as constant - no constructor args needed
console.log('📍 PinVerifier: 0x65ee46C4d21405f4a4C8e9d0F8a3832c1B885ab4 (hardcoded constant)');

// Full bytecode = creation code only (no constructor args)
const fullBytecode = creationCode;

console.log('✅ Bytecode generated');
console.log(`📦 Size: ${(fullBytecode.length / 2 - 1).toLocaleString()} bytes`);

// Output bytecode to stdout for setup.js to capture
process.stdout.write(fullBytecode);
