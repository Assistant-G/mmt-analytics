#!/usr/bin/env node
/**
 * Diagnostic script to check why xSUI rewards are not showing in UI
 *
 * This script checks:
 * 1. Which package version the vault is using
 * 2. Whether the pool has rewarders configured
 * 3. Whether RewardsCollected events exist for this vault
 * 4. Whether the backend is actually depositing rewards
 */

import { SuiClient } from '@mysten/sui/client';

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io:443';
const NEW_PACKAGE = '0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50';
const OLD_PACKAGE = '0x781c1aa586d9e938bbc07c2d030f8f29f7058c29c8c533fc86670d2c21b4c595';

async function diagnose(vaultId) {
  const client = new SuiClient({ url: MAINNET_RPC });

  console.log('\n🔍 REWARDS DIAGNOSTIC TOOL\n');
  console.log('Vault ID:', vaultId);
  console.log('─'.repeat(60));

  // 1. Check vault package version
  console.log('\n1️⃣  Checking vault package version...');
  const vaultObj = await client.getObject({
    id: vaultId,
    options: { showContent: true, showType: true },
  });

  if (!vaultObj.data?.content || vaultObj.data.content.dataType !== 'moveObject') {
    console.error('❌ Vault not found or invalid');
    return;
  }

  const vaultType = vaultObj.data.content.type;
  const packageMatch = vaultType.match(/0x[a-f0-9]+/);
  const packageId = packageMatch ? packageMatch[0] : null;

  console.log('   Vault Type:', vaultType);
  console.log('   Package ID:', packageId);

  if (packageId === NEW_PACKAGE) {
    console.log('   ✅ Using NEW package (supports deposit_reward)');
  } else if (packageId === OLD_PACKAGE) {
    console.log('   ⚠️  Using OLD package (may not support rewards tracking)');
    console.log('   💡 Recommendation: Create a new vault with the updated package');
  } else {
    console.log('   ⚠️  Unknown package version');
  }

  // 2. Check pool rewarders
  console.log('\n2️⃣  Checking pool rewarders configuration...');
  const fields = vaultObj.data.content.fields;
  const poolId = fields.pool_id;

  const poolObj = await client.getObject({
    id: poolId,
    options: { showContent: true, showType: true },
  });

  if (!poolObj.data?.content || poolObj.data.content.dataType !== 'moveObject') {
    console.error('❌ Pool not found or invalid');
    return;
  }

  const poolFields = poolObj.data.content.fields;
  const poolType = poolObj.data.content.type;

  // Extract token types
  const poolTypeMatch = poolType.match(/Pool<([^,]+),\s*([^>]+)>/);
  const tokenXType = poolTypeMatch ? poolTypeMatch[1].trim() : 'Unknown';
  const tokenYType = poolTypeMatch ? poolTypeMatch[2].trim() : 'Unknown';

  console.log('   Pool ID:', poolId);
  console.log('   Pool Type:', tokenXType.split('::').pop() + '/' + tokenYType.split('::').pop());

  const rewardersRaw = poolFields.rewarders?.fields?.contents || [];
  console.log('   Rewarders configured:', rewardersRaw.length);

  if (rewardersRaw.length === 0) {
    console.log('   ❌ NO REWARDERS CONFIGURED ON THIS POOL');
    console.log('   💡 This pool does not distribute reward tokens (like xSUI)');
    console.log('   💡 You will only earn trading fees, not additional rewards');
  } else {
    console.log('   ✅ Pool has rewarders:');
    for (const r of rewardersRaw) {
      const coinType = r.fields?.value?.fields?.coin_type || r.fields?.coin_type;
      const coinSymbol = coinType ? coinType.split('::').pop() : 'Unknown';
      console.log('      -', coinSymbol, `(${coinType})`);
    }
  }

  // 3. Check for RewardsCollected events
  console.log('\n3️⃣  Checking for RewardsCollected events...');

  try {
    const rewardsEvents = await client.queryEvents({
      query: {
        MoveEventType: `${packageId}::cycling_vault::RewardsCollected`,
      },
      limit: 1000,
      order: 'descending',
    });

    const vaultRewards = rewardsEvents.data.filter(
      (event) => event.parsedJson?.vault_id === vaultId
    );

    console.log('   Total RewardsCollected events for this vault:', vaultRewards.length);

    if (vaultRewards.length === 0) {
      console.log('   ❌ NO REWARDS COLLECTED YET');
      if (rewardersRaw.length === 0) {
        console.log('   💡 Reason: Pool has no rewarders configured');
      } else {
        console.log('   💡 Possible reasons:');
        console.log('      - Vault hasn\'t completed any cycles yet');
        console.log('      - Backend hasn\'t processed cycles yet');
        console.log('      - Rewarders are configured but not distributing yet');
      }
    } else {
      console.log('   ✅ Rewards have been collected:');

      // Aggregate rewards by coin type
      const rewardsByCoinType = new Map();
      for (const event of vaultRewards) {
        const data = event.parsedJson;
        const coinType = data.coin_type;
        const amount = BigInt(data.amount || 0);

        if (rewardsByCoinType.has(coinType)) {
          rewardsByCoinType.set(coinType, rewardsByCoinType.get(coinType) + amount);
        } else {
          rewardsByCoinType.set(coinType, amount);
        }
      }

      for (const [coinType, totalAmount] of rewardsByCoinType.entries()) {
        const coinSymbol = coinType.split('::').pop();
        const decimals = coinSymbol.includes('xsui') || coinSymbol.includes('XSUI') ? 9 : 9;
        const amountDecimal = Number(totalAmount) / Math.pow(10, decimals);
        console.log(`      - ${coinSymbol}: ${amountDecimal.toFixed(6)} (${totalAmount.toString()} raw)`);
      }
    }
  } catch (error) {
    console.error('   ❌ Error querying events:', error.message);
  }

  // 4. Check vault cycles
  console.log('\n4️⃣  Checking vault cycle status...');
  const cyclesCompleted = Number(fields.cycles_completed || 0);
  const hasPosition = fields.has_position;

  console.log('   Cycles completed:', cyclesCompleted);
  console.log('   Has active position:', hasPosition);

  if (cyclesCompleted === 0) {
    console.log('   ⚠️  Vault hasn\'t completed any cycles yet');
    console.log('   💡 Rewards are collected when closing positions during cycles');
  }

  // Summary
  console.log('\n📊 SUMMARY\n' + '─'.repeat(60));

  if (packageId !== NEW_PACKAGE) {
    console.log('❌ ISSUE: Vault using old package without rewards support');
    console.log('✅ FIX: Create a new vault with the updated package');
  } else if (rewardersRaw.length === 0) {
    console.log('❌ ISSUE: Pool has no rewarders configured');
    console.log('ℹ️  INFO: This is normal - not all pools distribute extra rewards');
    console.log('ℹ️  INFO: You will still earn trading fees, just not bonus tokens like xSUI');
  } else if (cyclesCompleted === 0) {
    console.log('⚠️  ISSUE: Vault hasn\'t completed any cycles yet');
    console.log('✅ FIX: Wait for the backend to process the first cycle');
  } else {
    console.log('✅ Everything looks configured correctly!');
    console.log('ℹ️  If rewards still don\'t show, check frontend code is querying events correctly');
  }

  console.log('\n');
}

// Get vault ID from command line or use default
const vaultId = process.argv[2];

if (!vaultId) {
  console.error('Usage: node diagnose-rewards.js <vault-id>');
  console.error('Example: node diagnose-rewards.js 0x123abc...');
  process.exit(1);
}

diagnose(vaultId).catch(console.error);
