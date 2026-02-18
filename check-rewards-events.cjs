#!/usr/bin/env node

/**
 * Direct blockchain query to check if RewardsCollected events exist
 * Run this with: node check-rewards-events.js <VAULT_ID>
 */

const https = require('https');

const PACKAGE_ID = '0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50';
const VAULT_ID = process.argv[2] || '0x86a5374cf1bb696d4da007d6bb0cc33bcae24a23903ef5a99ca3c6e2ac2e9be2';

console.log('🔍 Checking for RewardsCollected events...');
console.log('📦 Package:', PACKAGE_ID);
console.log('🏦 Vault:', VAULT_ID);
console.log('');

const postData = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'suix_queryEvents',
  params: [
    {
      MoveEventType: `${PACKAGE_ID}::cycling_vault::RewardsCollected`
    },
    null,
    100,
    false
  ]
});

const options = {
  hostname: 'fullnode.mainnet.sui.io',
  port: 443,
  path: '/',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': postData.length
  }
};

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const result = JSON.parse(data);

      if (result.error) {
        console.error('❌ RPC Error:', result.error);
        process.exit(1);
      }

      if (!result.result || !result.result.data) {
        console.log('❌ No RewardsCollected events found at all');
        console.log('   This means either:');
        console.log('   1. No rewards have been collected yet');
        console.log('   2. Backend is not calling deposit_reward');
        console.log('   3. Package ID is incorrect');
        process.exit(1);
      }

      const allEvents = result.result.data;
      console.log(`✅ Found ${allEvents.length} total RewardsCollected events`);
      console.log('');

      // Filter for this specific vault
      const vaultEvents = allEvents.filter(e =>
        e.parsedJson && e.parsedJson.vault_id === VAULT_ID
      );

      if (vaultEvents.length === 0) {
        console.log(`❌ NO events found for vault: ${VAULT_ID}`);
        console.log('');
        console.log('📊 Other vaults with rewards:');
        const vaultGroups = {};
        allEvents.forEach(e => {
          const vid = e.parsedJson?.vault_id;
          if (!vaultGroups[vid]) vaultGroups[vid] = [];
          vaultGroups[vid].push(e);
        });

        Object.entries(vaultGroups).forEach(([vid, events], i) => {
          const xSuiEvents = events.filter(e =>
            e.parsedJson.coin_type.includes('xsui') || e.parsedJson.coin_type.includes('X_SUI')
          );
          const totalXSui = xSuiEvents.reduce((sum, e) => sum + parseInt(e.parsedJson.amount), 0);
          console.log(`   ${i + 1}. ${vid}`);
          console.log(`      xSUI rewards: ${(totalXSui / 1e9).toFixed(9)} xSUI (${xSuiEvents.length} events)`);
        });
        console.log('');
        console.log('🔧 Root Cause:');
        console.log('   Your vault was created with the OLD package');
        console.log('   It lacks the rewards_collected table field');
        console.log('');
        console.log('💡 Solution:');
        console.log('   1. Withdraw from old vault');
        console.log('   2. Create NEW vault through UI');
        console.log('   3. New vault will use new package automatically');
        console.log('');
        console.log('📖 See: SOLUTION.md for detailed instructions');
        process.exit(1);
      }

      console.log(`✅ SUCCESS! Found ${vaultEvents.length} events for your vault!`);
      console.log('');

      vaultEvents.forEach((e, i) => {
        const amount = parseInt(e.parsedJson.amount);
        const amountDecimal = (amount / 1e9).toFixed(9);
        const coinType = e.parsedJson.coin_type;
        const symbol = coinType.includes('xsui') || coinType.includes('XSUI') ? 'xSUI' : 'REWARD';

        console.log(`Event ${i + 1}:`);
        console.log(`  Coin: ${symbol}`);
        console.log(`  Amount: ${amountDecimal} ${symbol}`);
        console.log(`  Timestamp: ${new Date(parseInt(e.timestampMs)).toISOString()}`);
        console.log(`  TX Digest: ${e.id.txDigest}`);
        console.log('');
      });

      const totalXSui = vaultEvents
        .filter(e => e.parsedJson.coin_type.includes('xsui') || e.parsedJson.coin_type.includes('XSUI'))
        .reduce((sum, e) => sum + parseInt(e.parsedJson.amount), 0);

      console.log(`💰 Total xSUI rewards: ${(totalXSui / 1e9).toFixed(9)} xSUI`);
      console.log('');
      console.log('✨ Rewards ARE being tracked on-chain!');
      console.log('');
      console.log('🔍 If UI still shows $0.00:');
      console.log('   1. Check browser console for errors');
      console.log('   2. Clear localStorage: localStorage.clear()');
      console.log('   3. Hard refresh: Ctrl+Shift+R');
      console.log('   4. Check that frontend is deployed from correct branch');

    } catch (e) {
      console.error('❌ Error parsing response:', e.message);
      console.error('Raw data:', data);
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Request failed:', e.message);
  process.exit(1);
});

req.write(postData);
req.end();
