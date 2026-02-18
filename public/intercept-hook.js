// PASTE IN CONSOLE - INTERCEPT HOOK DATA
(async () => {
  console.clear();
  console.log('🔍 INTERCEPTING HOOK DATA...\n');

  const originalFetch = window.fetch;
  let rewardsQueryIntercepted = false;

  window.fetch = function(...args) {
    const [url, options] = args;

    if (url.includes('fullnode.mainnet.sui.io') && options?.body) {
      try {
        const body = JSON.parse(options.body);

        if (body.method === 'suix_queryEvents' &&
            body.params[0]?.MoveEventType?.includes('RewardsCollected') &&
            !rewardsQueryIntercepted) {

          rewardsQueryIntercepted = true;

          console.log('📡 INTERCEPTED REWARDS QUERY:');
          console.log('  Method:', body.method);
          console.log('  Event type:', body.params[0].MoveEventType);
          console.log('  Limit:', body.params[2]);
          console.log('  Order:', body.params[3]);

          // Call original fetch and intercept response
          return originalFetch.apply(this, args).then(async (response) => {
            const clone = response.clone();
            const data = await clone.json();

            console.log('\n📥 RESPONSE:');
            console.log('  Total events:', data.result.data.length);

            const VAULT_ID = '0x1e9cb28216c42030d88b274115742dcb5073573085ffba2576f10603b2934d9f';
            const myEvents = data.result.data.filter(e =>
              e.parsedJson?.vault_id === VAULT_ID
            );

            console.log('  Events for vault:', myEvents.length);

            if (myEvents.length > 0) {
              // Group by coin type
              const map = new Map();
              for (const e of myEvents) {
                const c = e.parsedJson.coin_type;
                const a = BigInt(e.parsedJson.amount || 0);
                map.set(c, (map.get(c) || 0n) + a);
              }

              console.log('  Grouped by coin type:');
              for (const [c, a] of map.entries()) {
                const amt = Number(a) / 1e9;
                const symbol = c.includes('x_sui') || c.includes('X_SUI') ? 'xSUI' : c.split('::').pop();
                console.log(`    ${symbol}: ${amt.toFixed(9)}`);
              }

              console.log('\n✅ Data looks correct!');
              console.log('❌ Hook should process this but isn\'t!');
            } else {
              console.log('\n❌ NO EVENTS FOR YOUR VAULT!');
              console.log('   Query returned wrong vault events');
            }

            return response;
          });
        }
      } catch(e) {}
    }

    return originalFetch.apply(this, args);
  };

  console.log('✅ Fetch interceptor installed');
  console.log('\n📋 Now:');
  console.log('1. Close the performance panel (click chart icon)');
  console.log('2. Wait 2 seconds');
  console.log('3. Open it again (click chart icon)');
  console.log('4. Check output above');
  console.log('\nThis will show if hook is querying and what it receives');
})();
