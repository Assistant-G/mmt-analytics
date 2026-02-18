// PASTE THIS IN BROWSER CONSOLE ON YOUR VERCEL SITE
// It will check what the deployed code is actually doing

(async () => {
  console.clear();
  console.log('🔍 CHECKING DEPLOYED CODE QUERY...\n');

  const VAULT_ID = '0x10c1bae50cddf127548479a7c4acf7625e96dce8f46fc53067b6bb3d98e3204b';
  const PACKAGE_ID = '0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50';

  // Intercept fetch to see what queries the app is making
  const originalFetch = window.fetch;
  const queries = [];

  window.fetch = function(...args) {
    const [url, options] = args;
    if (url.includes('fullnode.mainnet.sui.io') && options?.body) {
      try {
        const body = JSON.parse(options.body);
        if (body.method === 'suix_queryEvents' &&
            body.params[0]?.MoveEventType?.includes('RewardsCollected')) {
          console.log('📡 INTERCEPTED RewardsCollected QUERY:');
          console.log('  Limit:', body.params[2]);
          console.log('  Order (4th param):', body.params[3]);
          console.log('  Full params:', body.params);
          queries.push(body.params);
        }
      } catch(e) {}
    }
    return originalFetch.apply(this, args);
  };

  console.log('✅ Fetch interceptor installed');
  console.log('📋 Now:');
  console.log('1. Navigate to your vault page (if not already there)');
  console.log('2. Wait 10 seconds for query to execute');
  console.log('3. Check the output above to see query parameters');
  console.log('');
  console.log('Meanwhile, testing direct query...\n');

  // Test direct query with descending
  const testQuery = async (descending) => {
    const res = await originalFetch('https://fullnode.mainnet.sui.io', {
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
          descending
        ]
      })
    });

    const data = await res.json();
    const myEvents = data.result.data.filter(e =>
      e.parsedJson?.vault_id === VAULT_ID
    );
    return myEvents.length;
  };

  const withTrue = await testQuery(true);
  const withFalse = await testQuery(false);

  console.log('🧪 DIRECT QUERY RESULTS:');
  console.log(`  With descending=true:  ${withTrue} events`);
  console.log(`  With descending=false: ${withFalse} events`);
  console.log('');

  if (withTrue > 0) {
    console.log('✅ Events EXIST! descending=true works');
    console.log('');
    if (queries.length === 0) {
      console.log('⚠️  BUT: App hasn\'t queried yet');
      console.log('   Wait for page to load/refresh');
    }
  } else {
    console.log('❌ NO EVENTS with either parameter!');
    console.log('   This means your vault truly has no rewards');
  }
})();
