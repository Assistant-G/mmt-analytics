// Paste this into your browser console (F12 → Console) while viewing your vault page

console.log('=== VAULT REWARDS DEBUG ===');

// Get the performance data from localStorage
const vaultId = window.location.pathname.split('/').pop(); // Get vault ID from URL
const perfKey = `vault-performance-${vaultId}`;
const perfData = localStorage.getItem(perfKey);

if (perfData) {
  const performance = JSON.parse(perfData);

  console.log('1. Current Snapshot:');
  console.log('   rewardsCollected:', performance.currentSnapshot?.rewardsCollected);

  console.log('\n2. Metrics:');
  console.log('   totalRewardsUsd:', performance.metrics?.totalRewardsUsd);

  console.log('\n3. Vault ID:', vaultId);

  console.log('\n4. Check if data exists:');
  console.log('   Has rewards array:', !!performance.currentSnapshot?.rewardsCollected);
  console.log('   Array length:', performance.currentSnapshot?.rewardsCollected?.length || 0);

  if (performance.currentSnapshot?.rewardsCollected) {
    console.log('\n5. Rewards Details:');
    performance.currentSnapshot.rewardsCollected.forEach((r, i) => {
      console.log(`   Reward ${i+1}:`, r);
    });
  } else {
    console.log('\n5. NO REWARDS DATA FOUND!');
    console.log('   This means events are not being queried or found.');
  }

  // Check what package the vault is using
  console.log('\n6. Need to check vault object type:');
  console.log('   Run this in console:');
  console.log(`
   fetch('https://fullnode.mainnet.sui.io', {
     method: 'POST',
     headers: {'Content-Type': 'application/json'},
     body: JSON.stringify({
       jsonrpc: '2.0',
       id: 1,
       method: 'sui_getObject',
       params: ['${vaultId}', {showType: true, showContent: true}]
     })
   })
   .then(r => r.json())
   .then(d => {
     const vaultType = d.result?.data?.content?.type;
     console.log('Vault Type:', vaultType);
     const packageId = vaultType?.match(/0x[a-f0-9]+/)?.[0];
     console.log('Package ID:', packageId);
     console.log('Is NEW package?', packageId === '0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50');
     console.log('Is OLD package?', packageId === '0x781c1aa586d9e938bbc07c2d030f8f29f7058c29c8c533fc86670d2c21b4c595');
   });
   `);

} else {
  console.log('No performance data found in localStorage for this vault!');
  console.log('Vault ID:', vaultId);
  console.log('\nMake sure you are on a vault details page.');
}

console.log('\n=== END DEBUG ===');
