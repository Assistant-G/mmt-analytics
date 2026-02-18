/**
 * BROWSER CONSOLE DEBUG SCRIPT FOR REWARDS
 *
 * Copy and paste this into your browser console (F12) when viewing the vault page.
 * This will check if RewardsCollected events exist and why they might not be displaying.
 *
 * Usage:
 * 1. Open browser console (F12)
 * 2. Copy this entire script
 * 3. Paste and press Enter
 * 4. Call: await debugRewards('YOUR_VAULT_ID_HERE')
 */

async function debugRewards(vaultId) {
  console.log('🔍 DEBUGGING REWARDS FOR VAULT:', vaultId);
  console.log('═'.repeat(60));

  // Get Sui client from window (injected by dapp-kit)
  const rpcUrl = 'https://fullnode.mainnet.sui.io:443';

  // Create a minimal Sui client
  const queryEvents = async (eventType, limit = 1000) => {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_queryEvents',
        params: [{
          MoveEventType: eventType
        }, null, limit, false]
      })
    });
    const data = await response.json();
    return data.result?.data || [];
  };

  const getObject = async (objectId) => {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sui_getObject',
        params: [objectId, { showContent: true, showType: true }]
      })
    });
    const data = await response.json();
    return data.result?.data;
  };

  try {
    // 1. Get vault object to determine package ID
    console.log('\n1️⃣ Fetching vault object...');
    const vaultObj = await getObject(vaultId);

    if (!vaultObj) {
      console.error('❌ Vault not found!');
      return;
    }

    const vaultType = vaultObj.content?.type;
    console.log('   Vault type:', vaultType);

    const packageMatch = vaultType?.match(/0x[a-f0-9]+/);
    const packageId = packageMatch ? packageMatch[0] : null;
    console.log('   Package ID:', packageId);

    const NEW_PACKAGE = '0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50';
    if (packageId === NEW_PACKAGE) {
      console.log('   ✅ Using NEW package (supports rewards)');
    } else {
      console.log('   ⚠️  Using different package:', packageId);
    }

    // 2. Query RewardsCollected events
    console.log('\n2️⃣ Querying RewardsCollected events...');
    const eventType = `${packageId}::cycling_vault::RewardsCollected`;
    console.log('   Event type:', eventType);

    const allEvents = await queryEvents(eventType, 1000);
    console.log('   Total RewardsCollected events:', allEvents.length);

    // Filter for this vault
    const vaultEvents = allEvents.filter(e => e.parsedJson?.vault_id === vaultId);
    console.log('   Events for this vault:', vaultEvents.length);

    if (vaultEvents.length === 0) {
      console.log('   ❌ NO REWARDS COLLECTED YET');
      console.log('\n   Possible reasons:');
      console.log('   - Backend hasn\'t processed any cycles yet');
      console.log('   - Pool has no rewarders configured');
      console.log('   - Cycles completed but rewards not distributed yet');

      // Check cycles completed
      const cyclesCompleted = vaultObj.content?.fields?.cycles_completed;
      console.log('\n   Vault cycles completed:', cyclesCompleted);

      if (cyclesCompleted === 0) {
        console.log('   💡 Vault hasn\'t completed any cycles - rewards come during cycles');
      }
    } else {
      console.log('   ✅ Found rewards events!');
      console.log('\n3️⃣ Aggregating rewards...');

      // Aggregate by coin type
      const rewardsByCoinType = new Map();
      for (const event of vaultEvents) {
        const coinType = event.parsedJson.coin_type;
        const amount = BigInt(event.parsedJson.amount || 0);

        if (rewardsByCoinType.has(coinType)) {
          rewardsByCoinType.set(coinType, rewardsByCoinType.get(coinType) + amount);
        } else {
          rewardsByCoinType.set(coinType, amount);
        }
      }

      console.log('   Rewards by coin type:');
      for (const [coinType, totalAmount] of rewardsByCoinType.entries()) {
        const symbol = coinType.split('::').pop();
        const decimals = symbol.toLowerCase().includes('x_sui') ? 9 : 9;
        const amountDecimal = Number(totalAmount) / Math.pow(10, decimals);

        console.log(`   - ${symbol}: ${amountDecimal.toFixed(6)} (${totalAmount.toString()} raw)`);
        console.log(`     Coin type: ${coinType}`);

        // Check if this matches the display logic
        const matchesXSUI = symbol === 'xSUI' || coinType.toLowerCase().includes('x_sui');
        console.log(`     Matches xSUI check: ${matchesXSUI ? '✅' : '❌'}`);
      }

      console.log('\n4️⃣ Checking display logic...');
      const rewardsArray = Array.from(rewardsByCoinType.entries()).map(([coinType, amount]) => {
        const symbol = coinType.includes('x_sui') || coinType.includes('XSUI') ? 'xSUI' : coinType.split('::').pop();
        const decimals = 9;
        const amountDecimal = Number(amount) / Math.pow(10, decimals);
        const price = symbol === 'xSUI' ? 2.0 : 0;

        return {
          coinType,
          symbol,
          amount: amountDecimal.toFixed(decimals),
          usdValue: amountDecimal * price
        };
      });

      const xSuiRewards = rewardsArray.find(r =>
        r.symbol === 'xSUI' || r.coinType.toLowerCase().includes('x_sui')
      );

      console.log('   xSUI rewards found:', xSuiRewards);

      if (xSuiRewards) {
        const xSuiAmount = parseFloat(xSuiRewards.amount);
        console.log('   ✅ Should display:', `${xSuiAmount.toFixed(6)} xSUI`);
        console.log('   ✅ USD value:', `$${xSuiRewards.usdValue.toFixed(2)}`);
      } else {
        console.log('   ❌ No xSUI rewards in the array');
      }
    }

    console.log('\n5️⃣ Checking pool rewarders...');
    const poolId = vaultObj.content?.fields?.pool_id;
    const poolObj = await getObject(poolId);

    if (poolObj?.content?.fields?.reward_infos) {
      const rewardInfos = poolObj.content.fields.reward_infos || [];
      console.log('   Pool rewarders configured:', rewardInfos.length);

      if (rewardInfos.length > 0) {
        console.log('   Rewarder details:');
        for (const r of rewardInfos) {
          const coinTypeName = r.fields?.reward_coin_type?.fields?.name;
          const symbol = coinTypeName?.split('::').pop()?.replace('_', '');
          const totalReward = r.fields?.total_reward;
          const totalAllocated = r.fields?.total_reward_allocated;
          const endedAt = r.fields?.ended_at_seconds;
          const currentTime = Math.floor(Date.now() / 1000);
          const isActive = parseInt(endedAt) > currentTime;

          console.log(`   - ${symbol} ${isActive ? '✅ ACTIVE' : '⚠️ EXPIRED'}`);
          console.log(`     Coin type: ${coinTypeName}`);
          console.log(`     Total reward: ${totalReward}`);
          console.log(`     Allocated: ${totalAllocated}`);
          console.log(`     Ends: ${new Date(parseInt(endedAt) * 1000).toLocaleString()}`);
        }
      } else {
        console.log('   ⚠️  Pool has NO rewarders configured');
        console.log('   💡 This pool does not distribute bonus tokens');
      }
    } else {
      console.log('   ⚠️  Could not find reward_infos field');
      console.log('   Pool object fields:', Object.keys(poolObj?.content?.fields || {}));
    }

    console.log('\n' + '═'.repeat(60));
    console.log('✅ Diagnosis complete!');
    console.log('\nNext steps:');
    if (vaultEvents.length === 0) {
      console.log('- Wait for backend to process cycles');
      console.log('- Check if pool has rewarders configured');
      console.log('- Verify vault is active and cycling');
    } else {
      console.log('- Rewards events exist! Check React Query cache');
      console.log('- Look for errors in console');
      console.log('- Try force refreshing the page (Ctrl+Shift+R)');
    }

  } catch (error) {
    console.error('❌ Error during diagnosis:', error);
  }
}

// Instructions
console.log('🔍 Rewards Debug Script Loaded!');
console.log('Usage: await debugRewards("YOUR_VAULT_ID")');
console.log('Example: await debugRewards("0x1234...")');
