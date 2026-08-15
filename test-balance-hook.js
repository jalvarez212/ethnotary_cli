/**
 * Test script to verify the balance hook functionality
 * Run with: node test-balance-hook.js
 */

const BalanceHook = require('./public/scripts/balanceHook.js');

async function testBalanceHook() {
    console.log('🧪 Testing Balance Hook...');
    
    const hook = new BalanceHook();
    
    try {
        // Test currency detection
        console.log('\n1. Testing currency detection...');
        const currency = await hook.detectUserCurrency();
        console.log('✅ Detected currency:', currency);
        
        // Test ETH price fetching
        console.log('\n2. Testing ETH price fetching...');
        const ethPrice = await hook.getEthPrice(currency);
        console.log('✅ ETH price:', hook.formatCurrency(ethPrice, currency));
        
        // Test balance analysis
        console.log('\n3. Testing portfolio analysis...');
        const portfolio = await hook.analyzePortfolio(hook.defaultContract, currency);
        console.log('✅ Portfolio analysis complete:');
        console.log('   Total ETH:', portfolio.total_eth_balance);
        console.log('   Total Value:', hook.formatCurrency(portfolio.total_value, currency));
        console.log('   Holdings:', portfolio.holdings.length);
        
        console.log('\n🎉 All tests passed!');
        return portfolio;
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        throw error;
    }
}

// Run test if this file is executed directly
if (require.main === module) {
    testBalanceHook().catch(console.error);
}

module.exports = testBalanceHook;
