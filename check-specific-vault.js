#!/usr/bin/env node
/**
 * Check specific vault: 0xae5be8b2829553138abb195a94d755b5fc2830da6fca3067747392ec5c3d515b
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
  const rewardersRaw = poolFields.rewarders?.fields?.contents || [];

  console.log('   Pool type:', poolType);
  console.log('   Rewarders configured:', rewardersRaw.length);

  if (rewardersRaw.length === 0) {
    console.log('   ❌ NO REWARDERS ON THIS POOL');
    console.log('\n   📊 CONCLUSION:');
    console.log('   ═'.repeat(80));
    console.log('   This SUI/USDC pool does NOT distribute bonus rewards like xSUI.');
    console.log('   You will ONLY earn trading fees, not additional reward tokens.');
    console.log('   This is EXPECTED BEHAVIOR - not all pools have liquidity mining rewards.');
    console.log('\n   ✅ Your vault is working correctly, it just can\'t show $0.00 for rewards');
    console.log('   because there are no rewards to collect from this pool.');
    return;
  }

  console.log('   ✅ Pool has rewarders:');
  for (const r of rewardersRaw) {
    const coinType = r.fields?.value?.fields?.coin_type || r.fields?.coin_type;
    const symbol = coinType?.split('::').pop();
    console.log('      -', symbol, `(${coinType})`);
  }

  // 3. Check if backend has processed this vault
  console.log('\n3️⃣  Checking cycle execution events...');
  const cycleEvents = await rpcCall('suix_queryEvents', [
    { MoveEventType: `${packageId}::cycling_vault::CycleExecuted` },
    null,
    1000,
    true
  ]);

  const vaultCycleEvents = cycleEvents.data.filter(
    e => e.parsedJson?.vault_id === VAULT_ID
  );

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
    true
  ]);

  const vaultPositionEvents = positionEvents.data.filter(
    e => e.parsedJson?.vault_id === VAULT_ID
  );

  console.log('   PositionOpened events for this vault:', vaultPositionEvents.length);

  // 5. Summary
  console.log('\n📊 SUMMARY');
  console.log('═'.repeat(80));

  if (rewardersRaw.length === 0) {
    console.log('❌ ROOT CAUSE: Pool has no rewarders configured');
    console.log('');
    console.log('This is NORMAL and EXPECTED behavior. Not all pools distribute bonus');
    console.log('reward tokens. Your vault is still earning TRADING FEES, just not');
    console.log('additional bonus tokens like xSUI.');
    console.log('');
    console.log('✅ RECOMMENDATION:');
    console.log('- Update UI to show "No rewards available" instead of "$0.00"');
    console.log('- Or hide the rewards section entirely for pools without rewarders');
  } else if (cyclesCompleted === 0) {
    console.log('⏰ WAITING: Vault hasn\'t completed any cycles yet');
    console.log('');
    console.log('Rewards are collected when the backend processes cycles.');
    console.log('Wait for the backend to execute the first cycle.');
  } else if (vaultCycleEvents.length === 0) {
    console.log('⚠️  ISSUE: Cycles completed but backend hasn\'t processed rewards');
    console.log('');
    console.log('Possible causes:');
    console.log('- Backend service not running');
    console.log('- Backend encountering errors when processing this vault');
    console.log('- Backend skipping this vault for some reason');
  } else {
    console.log('✅ Everything looks correct!');
    console.log('');
    console.log('Rewards should be visible. Try:');
    console.log('- Hard refresh browser (Ctrl+Shift+R)');
    console.log('- Check browser console for errors');
    console.log('- Clear localStorage and refresh');
  }

  console.log('\n');
}

checkVault().catch(console.error);
