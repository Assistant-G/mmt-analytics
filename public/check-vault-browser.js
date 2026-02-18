/**
 * PASTE THIS IN BROWSER CONSOLE TO CHECK YOUR VAULT
 *
 * This will tell you exactly why rewards aren't showing
 */

const VAULT_ID = '0xae5be8b2829553138abb195a94d755b5fc2830da6fca3067747392ec5c3d515b';
const RPC_URL = 'https://fullnode.mainnet.sui.io:443';

async function rpcCall(method, params) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    })
  });
  const data = await response.json();
  return data.result;
}

async function checkVault() {
  console.log('\n🔍 CHECKING VAULT:', VAULT_ID);
  console.log('═'.repeat(80));

  // 1. Get vault object
  console.log('\n1️⃣  Fetching vault details...');
  const vaultObj = await rpcCall('sui_getObject', [
    VAULT_ID,
    { showContent: true, showType: true }
  ]);

  if (!vaultObj?.data?.content) {
    console.error('❌ Vault not found!');
    return;
  }

  const fields = vaultObj.data.content.fields;
  const vaultType = vaultObj.data.content.type;

  const packageId = vaultType.match(/0x[a-f0-9]+/)?.[0];
  const poolId = fields.pool_id;
  const cyclesCompleted = Number(fields.cycles_completed || 0);
  const hasPosition = fields.has_position;
  const isActive = fields.is_active;

  console.log('   Package ID:', packageId);
  console.log('   Pool ID:', poolId);
  console.log('   Cycles completed:', cyclesCompleted);
  console.log('   Has position:', hasPosition);
  console.log('   Is active:', isActive);

  // 2. Check pool rewarders
  console.log('\n2️⃣  Checking pool rewarders...');
  const poolObj = await rpcCall('sui_getObject', [
    poolId,
    { showContent: true, showType: true }
  ]);

  if (!poolObj?.data?.content) {
    console.error('❌ Pool not found!');
    return;
  }

  const poolFields = poolObj.data.content.fields;
  const poolType = poolObj.data.content.type;
  const rewardInfos = poolFields.reward_infos || [];

  console.log('   Pool type:', poolType);
  console.log('   Rewarders configured:', rewardInfos.length);

  if (rewardInfos.length === 0) {
    console.log('%c   ❌ NO REWARDERS ON THIS POOL', 'color: red; font-weight: bold; font-size: 14px');
    console.log('\n%c   📊 ROOT CAUSE FOUND:', 'color: orange; font-weight: bold; font-size: 16px');
    console.log('   ═'.repeat(80));
    console.log('%c   This SUI/USDC pool does NOT distribute bonus rewards like xSUI.', 'color: yellow');
    console.log('%c   You will ONLY earn trading fees, not additional reward tokens.', 'color: yellow');
    console.log('%c   This is EXPECTED BEHAVIOR - not all pools have liquidity mining.', 'color: yellow');
    console.log('\n%c   ✅ SOLUTION:', 'color: green; font-weight: bold');
    console.log('   Your vault IS working correctly!');
    console.log('   The UI should display "No rewards available" instead of "$0.00"');
    console.log('   or hide the rewards section for pools without rewarders.');
    console.log('\n   You ARE still earning trading fees - just not bonus tokens.');
    return;
  }

  console.log('   ✅ Pool has rewarders:');
  const currentTime = Math.floor(Date.now() / 1000);
  for (const r of rewardInfos) {
    const coinTypeName = r.fields?.reward_coin_type?.fields?.name;
    const symbol = coinTypeName?.split('::').pop()?.replace('_', '');
    const totalReward = r.fields?.total_reward;
    const totalAllocated = r.fields?.total_reward_allocated;
    const endedAt = r.fields?.ended_at_seconds;
    const isActive = parseInt(endedAt) > currentTime;

    console.log(`      - ${symbol} ${isActive ? '✅ ACTIVE' : '⚠️ EXPIRED'}`);
    console.log(`        Coin type: ${coinTypeName}`);
    console.log(`        Total: ${totalReward}, Allocated: ${totalAllocated}`);
    console.log(`        Ends: ${new Date(parseInt(endedAt) * 1000).toLocaleString()}`);
  }

  // 3. Check if backend has processed this vault
  console.log('\n3️⃣  Checking cycle execution events...');
  const cycleEvents = await rpcCall('suix_queryEvents', [
    { MoveEventType: `${packageId}::cycling_vault::CycleExecuted` },
    null,
    1000,
    false
  ]);

  const vaultCycleEvents = cycleEvents?.data?.filter(
    e => e.parsedJson?.vault_id === VAULT_ID
  ) || [];

  console.log('   CycleExecuted events for this vault:', vaultCycleEvents.length);

  if (vaultCycleEvents.length === 0 && cyclesCompleted > 0) {
    console.log('   ⚠️  Cycles completed but no CycleExecuted events found');
    console.log('   This might be from an older vault version');
  }

  // 4. Check position opened events
  console.log('\n4️⃣  Checking position events...');
  const positionEvents = await rpcCall('suix_queryEvents', [
    { MoveEventType: `${packageId}::cycling_vault::PositionOpened` },
    null,
    1000,
    false
  ]);

  const vaultPositionEvents = positionEvents?.data?.filter(
    e => e.parsedJson?.vault_id === VAULT_ID
  ) || [];

  console.log('   PositionOpened events for this vault:', vaultPositionEvents.length);

  // 5. Summary
  console.log('\n%c📊 SUMMARY', 'color: cyan; font-weight: bold; font-size: 18px');
  console.log('═'.repeat(80));

  if (cyclesCompleted === 0) {
    console.log('%c⏰ WAITING: Vault hasn\'t completed any cycles yet', 'color: yellow; font-weight: bold');
    console.log('');
    console.log('Rewards are collected when the backend processes cycles.');
    console.log('Wait for the backend to execute the first cycle.');
  } else if (vaultCycleEvents.length === 0) {
    console.log('%c⚠️  ISSUE: Cycles completed but backend hasn\'t processed rewards', 'color: orange; font-weight: bold');
    console.log('');
    console.log('Possible causes:');
    console.log('- Backend service not running on Railway');
    console.log('- Backend encountering errors when processing this vault');
    console.log('- Backend skipping this vault for some reason');
    console.log('\nCheck Railway logs for backend service errors.');
  } else {
    console.log('%c✅ Everything looks correct!', 'color: green; font-weight: bold');
    console.log('');
    console.log('Rewards should be visible. Try:');
    console.log('- Hard refresh browser (Ctrl+Shift+R)');
    console.log('- Check browser console for errors');
    console.log('- Clear localStorage and refresh');
  }

  console.log('\n');
}

// Auto-run
checkVault().catch(console.error);
