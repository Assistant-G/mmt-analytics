// Copy and paste this ENTIRE script into your browser console on the vault page

(async () => {
  console.clear();
  console.log('🔍 DEBUGGING REWARDS DISPLAY...\n');

  const PACKAGE_ID = '0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50';
  const VAULT_ID = '0x10c1bae50cddf127548479a7c4acf7625e96dce8f46fc53067b6bb3d98e3204b';

  console.log('Expected Package ID:', PACKAGE_ID);
  console.log('Expected Vault ID:', VAULT_ID);
  console.log('');

  // Check what the frontend is using
  console.log('📋 Step 1: Checking frontend config...');
  const configElement = document.querySelector('[data-vault-id]');
  if (configElement) {
    console.log('  Frontend Vault ID:', configElement.dataset.vaultId);
  }

  // Check localStorage
  console.log('\n📋 Step 2: Checking localStorage cache...');
  const cacheKeys = Object.keys(localStorage).filter(k => k.includes('vault') || k.includes('performance'));
  if (cacheKeys.length > 0) {
    console.log('  Found cached data:', cacheKeys);
    cacheKeys.forEach(key => {
      const data = localStorage.getItem(key);
      if (data && data.includes(VAULT_ID)) {
        console.log(`  ✅ Cache contains your vault ID in key: ${key}`);
        try {
          const parsed = JSON.parse(data);
          console.log('  Cached data:', parsed);
        } catch(e) {}
      }
    });
  } else {
    console.log('  No vault cache found');
  }

  // Query blockchain directly
  console.log('\n📋 Step 3: Querying blockchain for RewardsCollected events...');

  try {
    const response = await fetch('https://fullnode.mainnet.sui.io', {
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
          false
        ]
      })
    });

    const result = await response.json();

    if (result.error) {
      console.error('  ❌ RPC Error:', result.error);
      return;
    }

    const allEvents = result.result.data;
    console.log(`  ✅ Total RewardsCollected events: ${allEvents.length}`);

    const vaultEvents = allEvents.filter(e => e.parsedJson?.vault_id === VAULT_ID);
    console.log(`  ✅ Events for YOUR vault: ${vaultEvents.length}`);

    if (vaultEvents.length === 0) {
      console.error('  ❌ NO EVENTS FOR YOUR VAULT!');
      console.log('\n  Other vaults with events:');
      const vaults = {};
      allEvents.forEach(e => {
        const vid = e.parsedJson?.vault_id;
        if (!vaults[vid]) vaults[vid] = 0;
        vaults[vid]++;
      });
      Object.entries(vaults).forEach(([vid, count]) => {
        console.log(`    ${vid}: ${count} events`);
      });
      return;
    }

    console.log('\n📋 Step 4: Calculating xSUI rewards...');
    const xSuiEvents = vaultEvents.filter(e =>
      e.parsedJson.coin_type.includes('x_sui') ||
      e.parsedJson.coin_type.includes('X_SUI')
    );

    console.log(`  xSUI events: ${xSuiEvents.length}`);

    let totalXSui = 0;
    xSuiEvents.forEach((e, i) => {
      const amount = parseInt(e.parsedJson.amount);
      totalXSui += amount;
      console.log(`  Event ${i+1}: ${amount} (${(amount/1e9).toFixed(9)} xSUI)`);
    });

    const xSuiDecimal = totalXSui / 1e9;
    const usdValue = xSuiDecimal * 2.0; // Assuming $2 per xSUI

    console.log('\n✅ BLOCKCHAIN TOTAL:');
    console.log(`  ${xSuiDecimal.toFixed(9)} xSUI`);
    console.log(`  ≈ $${usdValue.toFixed(6)} USD`);

    // Check what frontend is showing
    console.log('\n📋 Step 5: Checking what UI is displaying...');
    const rewardsElement = document.querySelector('[class*="Reward"]');
    if (rewardsElement) {
      console.log('  UI shows:', rewardsElement.textContent);
    }

    // Try to find React Query cache
    console.log('\n📋 Step 6: Checking React Query cache...');
    if (window.__REACT_QUERY_DEVTOOLS__) {
      console.log('  React Query DevTools found, check the cache');
    }

    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SUMMARY:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Blockchain: ${xSuiDecimal.toFixed(9)} xSUI ✅`);
    console.log(`Events found: ${vaultEvents.length} ✅`);
    console.log('');
    console.log('If UI shows $0.00, the problem is:');
    console.log('1. Frontend not fetching with limit: 1000');
    console.log('2. Vercel not deployed with latest code');
    console.log('3. Browser using cached old code');
    console.log('');
    console.log('FIX:');
    console.log('1. Hard refresh: Ctrl+Shift+F5');
    console.log('2. Clear cache: localStorage.clear()');
    console.log('3. Check Vercel deployment status');

  } catch (error) {
    console.error('❌ Error:', error);
  }
})();
