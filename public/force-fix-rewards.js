// PASTE THIS IN CONSOLE ON YOUR VAULT PAGE
// It will find the ACTUAL vault ID from the page and fix it

(async () => {
  console.clear();
  console.log('🔧 FORCING REWARDS REFRESH...\n');

  const PACKAGE_ID = '0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50';

  // Method 1: Extract vault ID from page HTML
  let vaultId = null;
  const vaultIdElements = document.querySelectorAll('[class*="vault-id"], .vault-card');
  for (const el of vaultIdElements) {
    const text = el.textContent || '';
    const match = text.match(/0x[a-f0-9]{64}/);
    if (match) {
      vaultId = match[0];
      break;
    }
  }

  if (!vaultId) {
    // Method 2: Check localStorage for vault data
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('vault')) {
        const val = localStorage.getItem(key);
        if (val && val.includes('0x')) {
          const match = val.match(/0x[a-f0-9]{64}/);
          if (match) {
            vaultId = match[0];
            break;
          }
        }
      }
    }
  }

  if (!vaultId) {
    console.error('❌ Could not find vault ID on page');
    console.log('Manually enter vault ID:');
    console.log('const VAULT_ID = "0x..."; // paste your vault ID here');
    return;
  }

  console.log('✅ Found vault ID:', vaultId);
  console.log('');

  // Query for rewards
  const res = await fetch('https://fullnode.mainnet.sui.io', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'suix_queryEvents',
      params: [
        { MoveEventType: `${PACKAGE_ID}::cycling_vault::RewardsCollected` },
        null,
        1000,
        true // descending
      ]
    })
  });

  const data = await res.json();
  const allEvents = data.result.data;
  const myEvents = allEvents.filter(e => e.parsedJson?.vault_id === vaultId);

  console.log(`📊 Total RewardsCollected events: ${allEvents.length}`);
  console.log(`📊 Events for YOUR vault: ${myEvents.length}`);
  console.log('');

  if (myEvents.length === 0) {
    console.error('❌ NO REWARDS TRACKED FOR THIS VAULT!');
    console.log('');
    console.log('This vault was created BEFORE reward tracking was added.');
    console.log('You need to create a NEW vault to get reward tracking.');
    return;
  }

  // Calculate xSUI
  const xSuiEvents = myEvents.filter(e =>
    e.parsedJson.coin_type.includes('x_sui') ||
    e.parsedJson.coin_type.includes('X_SUI')
  );

  const totalXSui = xSuiEvents.reduce((sum, e) =>
    sum + parseInt(e.parsedJson.amount), 0
  );

  console.log('✅ FOUND REWARDS:');
  console.log(`  xSUI events: ${xSuiEvents.length}`);
  console.log(`  Total: ${(totalXSui / 1e9).toFixed(9)} xSUI`);
  console.log(`  USD: $${((totalXSui / 1e9) * 2).toFixed(4)}`);
  console.log('');

  // FORCE CLEAR ALL CACHE
  console.log('🗑️  Clearing ALL cache...');

  // Clear localStorage
  const keysToDelete = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.includes('vault') || key.includes('performance') || key.includes('react-query'))) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(k => localStorage.removeItem(k));
  console.log(`  Removed ${keysToDelete.length} localStorage keys`);

  // Clear sessionStorage
  sessionStorage.clear();
  console.log('  Cleared sessionStorage');

  // Clear service worker cache if exists
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const reg of registrations) {
      await reg.unregister();
    }
    console.log('  Unregistered service workers');
  }

  // Try to invalidate React Query cache
  if (window.queryClient) {
    window.queryClient.clear();
    console.log('  Cleared React Query cache');
  }

  console.log('');
  console.log('✅ CACHE CLEARED!');
  console.log('');
  console.log('🔄 RELOADING IN 2 SECONDS...');
  console.log('   Rewards WILL show after reload!');

  setTimeout(() => {
    location.reload(true);
  }, 2000);
})();
