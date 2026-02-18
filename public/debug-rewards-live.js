console.log('%c=== REWARDS DEBUG SCRIPT ===', 'color: blue; font-size: 16px; font-weight: bold');

// Get your vault ID from the URL
const vaultId = window.location.pathname.split('/').filter(Boolean).pop();
console.log('1. Vault ID:', vaultId);

// Check localStorage for cached performance data
const perfKey = `vault-performance-${vaultId}`;
const perfData = localStorage.getItem(perfKey);

if (perfData) {
  const perf = JSON.parse(perfData);

  console.log('\n2. Performance Data Found:');
  console.log('   - Total PnL:', perf.metrics?.totalPnl);
  console.log('   - Total Rewards USD:', perf.metrics?.totalRewardsUsd);
  console.log('   - Rewards Array:', perf.currentSnapshot?.rewardsCollected);

  if (perf.currentSnapshot?.rewardsCollected) {
    console.log('\n✅ Rewards data EXISTS!');
    console.log('   Details:', perf.currentSnapshot.rewardsCollected);
  } else {
    console.log('\n❌ NO rewards data in currentSnapshot!');
    console.log('   This means RewardsCollected events were not found.');
  }
} else {
  console.log('\n❌ No performance data in localStorage');
}

// Now let's query the blockchain directly to see if events exist
console.log('\n3. Querying blockchain for RewardsCollected events...');

const packageId = '0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50';

fetch('https://fullnode.mainnet.sui.io', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'suix_queryEvents',
    params: [
      {
        MoveEventType: `${packageId}::cycling_vault::RewardsCollected`
      },
      null,
      100,
      false
    ]
  })
})
.then(r => r.json())
.then(result => {
  console.log('\n4. RewardsCollected Events Query Result:');

  if (result.result && result.result.data) {
    const allEvents = result.result.data;
    console.log('   Total events found:', allEvents.length);

    // Filter for this specific vault
    const vaultEvents = allEvents.filter(e =>
      e.parsedJson && e.parsedJson.vault_id === vaultId
    );

    console.log('   Events for YOUR vault:', vaultEvents.length);

    if (vaultEvents.length > 0) {
      console.log('\n✅ SUCCESS! Rewards events exist for your vault:');
      vaultEvents.forEach((e, i) => {
        console.log(`   Event ${i+1}:`, {
          vault_id: e.parsedJson.vault_id,
          coin_type: e.parsedJson.coin_type,
          amount: e.parsedJson.amount,
          amount_readable: (parseInt(e.parsedJson.amount) / 1e9).toFixed(9) + ' xSUI'
        });
      });

      console.log('\n💡 ISSUE FOUND:');
      console.log('   Events exist on blockchain, but frontend is not loading them!');
      console.log('   This could be:');
      console.log('   - Browser cache issue (hard refresh: Ctrl+Shift+R)');
      console.log('   - localStorage cache issue (clear it and refresh)');
      console.log('   - Frontend query using wrong package ID');

    } else {
      console.log('\n⚠️  No events found for your vault ID');
      console.log('   All events:', allEvents.map(e => ({
        vault: e.parsedJson?.vault_id?.substring(0, 10) + '...',
        amount: e.parsedJson?.amount
      })));
    }
  } else {
    console.log('   ❌ No events found at all');
    console.log('   Result:', result);
  }
})
.catch(err => {
  console.error('   ❌ Error querying events:', err);
});

console.log('\n5. Next Step:');
console.log('   Wait for the query above to complete...');
console.log('   If events exist but frontend doesn\'t show them:');
console.log('   → Clear localStorage: localStorage.clear()');
console.log('   → Hard refresh: Ctrl+Shift+R');
console.log('   → Reload page');

console.log('\n%c=== END DEBUG ===', 'color: blue; font-size: 16px; font-weight: bold');
