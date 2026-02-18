// PASTE THIS IN CONSOLE - ULTIMATE DEBUG
(async () => {
  console.clear();
  console.log('🐛 DEEP DEBUG - Finding the bug...\n');

  const PACKAGE_ID = '0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50';
  const VAULT_ID = '0x1e9cb28216c42030d88b274115742dcb5073573085ffba2576f10603b2934d9f';

  // Step 1: Query blockchain for events
  console.log('Step 1: Querying blockchain...');
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
        true
      ]
    })
  });

  const data = await res.json();
  const allEvents = data.result.data;
  const myEvents = allEvents.filter(e => e.parsedJson?.vault_id === VAULT_ID);

  console.log(`  ✅ Total events: ${allEvents.length}`);
  console.log(`  ✅ My vault events: ${myEvents.length}`);

  // Step 2: Group by coin type (simulate hook logic)
  console.log('\nStep 2: Grouping by coin type...');
  const rewardsByCoinType = new Map();
  for (const event of myEvents) {
    const coinType = event.parsedJson.coin_type;
    const amount = BigInt(event.parsedJson.amount || 0);

    if (rewardsByCoinType.has(coinType)) {
      rewardsByCoinType.set(coinType, rewardsByCoinType.get(coinType) + amount);
    } else {
      rewardsByCoinType.set(coinType, amount);
    }
  }

  console.log(`  ✅ Coin types: ${rewardsByCoinType.size}`);
  for (const [coinType, amount] of rewardsByCoinType.entries()) {
    const amountDecimal = Number(amount) / 1e9;
    const isXSui = coinType.includes('x_sui') || coinType.includes('X_SUI');
    console.log(`  ${isXSui ? '✅' : '  '} ${coinType.split('::').pop()}: ${amountDecimal.toFixed(9)}`);
  }

  // Step 3: Create rewardsCollected array (simulate hook logic)
  console.log('\nStep 3: Creating rewardsCollected array...');
  const rewardsCollected = [];
  for (const [coinType, amount] of rewardsByCoinType.entries()) {
    let decimals = 9;
    let symbol = 'REWARD';
    let price = 0;

    if (coinType.includes('x_sui') || coinType.includes('XSUI')) {
      decimals = 9;
      symbol = 'xSUI';
      price = 2.0;
    }

    const amountDecimal = Number(amount) / Math.pow(10, decimals);
    const usdValue = amountDecimal * price;

    rewardsCollected.push({
      coinType,
      amount: amountDecimal.toFixed(decimals),
      symbol,
      usdValue,
    });
  }

  console.log(`  ✅ rewardsCollected array: ${rewardsCollected.length} items`);
  rewardsCollected.forEach(r => {
    console.log(`    - ${r.symbol}: ${r.amount} ($${r.usdValue.toFixed(4)})`);
  });

  // Step 4: Find xSUI (simulate component logic)
  console.log('\nStep 4: Finding xSUI (component logic)...');
  const xSuiRewards = rewardsCollected.find(r =>
    r.symbol === 'xSUI' || r.coinType.toLowerCase().includes('x_sui')
  );

  if (xSuiRewards) {
    const xSuiAmount = parseFloat(xSuiRewards.amount);
    console.log(`  ✅ FOUND xSUI: ${xSuiAmount.toFixed(6)} xSUI`);
    console.log(`  ✅ This SHOULD display as: "${xSuiAmount.toFixed(6)} xSUI"`);
  } else {
    console.log('  ❌ xSUI NOT FOUND!');
    console.log('  This is the BUG!');
  }

  // Step 5: Check what React Query has cached
  console.log('\nStep 5: Checking React Query cache...');

  // Try to find the performance data in localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.includes('vault-performance') || key.includes(VAULT_ID))) {
      console.log(`  Found cache key: ${key}`);
      try {
        const val = JSON.parse(localStorage.getItem(key));
        if (val?.state?.data) {
          const perfData = val.state.data;
          console.log('  Performance data in cache:');
          console.log('    rewardsByCoinType size:', perfData.rewardsByCoinType?.size || 0);
          console.log('    currentSnapshot.rewardsCollected:', perfData.currentSnapshot?.rewardsCollected?.length || 0);

          if (perfData.currentSnapshot?.rewardsCollected) {
            perfData.currentSnapshot.rewardsCollected.forEach(r => {
              console.log(`      - ${r.symbol}: ${r.amount}`);
            });
          }
        }
      } catch(e) {}
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DIAGNOSIS:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (xSuiRewards) {
    console.log('✅ Logic is CORRECT');
    console.log('❌ Problem: React Query cache or hook not running');
    console.log('');
    console.log('💡 Try:');
    console.log('1. Click "Refresh" button on page');
    console.log('2. Close vault performance panel and reopen');
    console.log('3. If still broken, the hook has a bug');
  } else {
    console.log('❌ Logic BUG in hook or component');
  }
})();
