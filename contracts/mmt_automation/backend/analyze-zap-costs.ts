import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const VAULT_PACKAGE_ID = '0x4554604e6a3fcc8a412884a45c47d1265588644a99a32029b8070e5ff8067e94';
const VAULT_ID = '0x6da1c9777f95fd2dbd5197e96b42058fcc35d1bbb43f85dd7e29a5f3cb53840b';

interface VaultFields {
  balance_x: { fields?: { value: string } } | string;
  balance_y: { fields?: { value: string } } | string;
  fees_x: { fields?: { value: string } } | string;
  fees_y: { fields?: { value: string } } | string;
  initial_deposit_x: string;
  initial_deposit_y: string;
  total_fees_earned_x: string;
  total_fees_earned_y: string;
  has_position: boolean;
  is_active: boolean;
  cycles_completed: string;
  rebalance_count: string;
  use_zap: boolean;
  auto_rebalance: boolean;
  auto_compound: boolean;
  range_bps: string;
  created_at: string;
  total_rewards_earned: { fields?: { contents: any[] } };
}

async function analyzeZapCosts() {
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });

  console.log('========================================');
  console.log('VAULT ZAP COST ANALYSIS');
  console.log('========================================');
  console.log(`Vault ID: ${VAULT_ID}`);
  console.log('');

  // 1. Fetch vault object
  const vaultObj = await client.getObject({
    id: VAULT_ID,
    options: { showContent: true, showType: true },
  });

  if (!vaultObj.data?.content || vaultObj.data.content.dataType !== 'moveObject') {
    console.log('ERROR: Could not fetch vault data');
    return;
  }

  const vaultType = vaultObj.data.content.type;
  const fields = vaultObj.data.content.fields as unknown as VaultFields;

  // Extract token types from vault type
  const typeMatch = vaultType.match(/Vault<([^,]+),\s*([^>]+)>/);
  const tokenXType = typeMatch ? typeMatch[1] : 'Unknown';
  const tokenYType = typeMatch ? typeMatch[2] : 'Unknown';

  // Parse balances
  const getValue = (field: { fields?: { value: string } } | string): string => {
    if (typeof field === 'string') return field;
    return field?.fields?.value || '0';
  };

  const balanceX = BigInt(getValue(fields.balance_x));
  const balanceY = BigInt(getValue(fields.balance_y));
  const feesX = BigInt(getValue(fields.fees_x));
  const feesY = BigInt(getValue(fields.fees_y));
  const initialX = BigInt(fields.initial_deposit_x);
  const initialY = BigInt(fields.initial_deposit_y);
  const totalFeesEarnedX = BigInt(fields.total_fees_earned_x);
  const totalFeesEarnedY = BigInt(fields.total_fees_earned_y);
  const rebalanceCount = Number(fields.rebalance_count);
  const cyclesCompleted = Number(fields.cycles_completed);
  const rangeBps = Number(fields.range_bps);

  // Get token names for display
  const tokenXName = tokenXType.includes('SUI') ? 'SUI' : tokenXType.split('::').pop() || 'X';
  const tokenYName = tokenYType.includes('USDC') ? 'USDC' : tokenYType.split('::').pop() || 'Y';

  // Determine decimals
  const decimalsX = tokenXType.includes('SUI') ? 9 : 9;
  const decimalsY = tokenYType.includes('USDC') ? 6 : 9;

  console.log('TOKEN PAIR:');
  console.log(`  Token X: ${tokenXName}`);
  console.log(`  Token Y: ${tokenYName}`);
  console.log('');

  console.log('VAULT STATUS:');
  console.log(`  Active: ${fields.is_active}`);
  console.log(`  Has Position: ${fields.has_position}`);
  console.log(`  Use ZAP: ${fields.use_zap}`);
  console.log(`  Auto Rebalance: ${fields.auto_rebalance}`);
  console.log(`  Auto Compound: ${fields.auto_compound}`);
  console.log(`  Range: ${rangeBps / 100}%`);
  console.log('');

  console.log('ACTIVITY SUMMARY:');
  console.log(`  Cycles Completed: ${cyclesCompleted}`);
  console.log(`  Rebalances: ${rebalanceCount}`);
  console.log(`  Total Operations: ${cyclesCompleted + rebalanceCount}`);
  console.log('');

  console.log('CAPITAL TRACKING:');
  console.log(`  Initial Deposit ${tokenXName}: ${formatAmount(initialX, decimalsX)}`);
  console.log(`  Initial Deposit ${tokenYName}: ${formatAmount(initialY, decimalsY)}`);
  console.log(`  Current Balance ${tokenXName}: ${formatAmount(balanceX, decimalsX)}`);
  console.log(`  Current Balance ${tokenYName}: ${formatAmount(balanceY, decimalsY)}`);
  console.log(`  Uncollected Fees ${tokenXName}: ${formatAmount(feesX, decimalsX)}`);
  console.log(`  Uncollected Fees ${tokenYName}: ${formatAmount(feesY, decimalsY)}`);
  console.log(`  Total Fees Earned ${tokenXName}: ${formatAmount(totalFeesEarnedX, decimalsX)}`);
  console.log(`  Total Fees Earned ${tokenYName}: ${formatAmount(totalFeesEarnedY, decimalsY)}`);
  console.log('');

  // 2. Query RebalanceExecuted events for this vault
  console.log('REBALANCE EVENTS:');
  const eventType = `${VAULT_PACKAGE_ID}::cycling_vault::RebalanceExecuted`;

  let zapCount = 0;
  let nonZapCount = 0;
  let cursor: string | null = null;

  do {
    const events = await client.queryEvents({
      query: { MoveEventType: eventType },
      order: 'descending',
      limit: 50,
      cursor: cursor ?? undefined,
    });

    for (const event of events.data) {
      const data = event.parsedJson as { vault_id: string; rebalance_count: number; used_zap: boolean };
      if (data.vault_id === VAULT_ID || data.vault_id === VAULT_ID.toLowerCase()) {
        if (data.used_zap) {
          zapCount++;
        } else {
          nonZapCount++;
        }
      }
    }

    cursor = events.nextCursor ?? null;
  } while (cursor && zapCount + nonZapCount < rebalanceCount);

  console.log(`  Rebalances with ZAP: ${zapCount}`);
  console.log(`  Rebalances without ZAP: ${nonZapCount}`);
  console.log(`  Events found: ${zapCount + nonZapCount} / ${rebalanceCount} recorded`);
  console.log('');

  // 3. Estimate ZAP costs
  console.log('========================================');
  console.log('ZAP COST ESTIMATION');
  console.log('========================================');
  console.log('');
  console.log('ZAP Mode performs flash swaps to balance token ratios.');
  console.log('Costs include: Pool swap fees (0.05%-0.3%) + Price slippage');
  console.log('');

  // Estimate based on typical swap patterns
  // When out of range, typically 30-70% of position needs to be swapped
  // Pool fee is typically 0.05% for stable pairs, 0.25-0.3% for volatile pairs
  const poolFeeRate = tokenYName === 'USDC' ? 0.0025 : 0.0030; // 0.25% or 0.30%
  const avgSwapPercent = 0.45; // Average 45% of position swapped per rebalance
  const slippageEstimate = 0.001; // 0.1% average slippage

  // Estimate total capital that was swapped
  // Each rebalance swaps portion of position value
  const totalCapitalX = initialX + totalFeesEarnedX;
  const totalCapitalY = initialY + totalFeesEarnedY;

  // For SUI/USDC, estimate SUI price (rough)
  const suiPriceUsd = 3.5; // Approximate
  const totalValueUsd = Number(totalCapitalX) / 10**decimalsX * suiPriceUsd + Number(totalCapitalY) / 10**decimalsY;

  // Total swapped value over all rebalances
  const zapRebalances = fields.use_zap ? rebalanceCount : zapCount;
  const totalSwappedValue = totalValueUsd * avgSwapPercent * zapRebalances;

  // Cost = swap fees + slippage
  const swapFeesCost = totalSwappedValue * poolFeeRate;
  const slippageCost = totalSwappedValue * slippageEstimate;
  const totalZapCost = swapFeesCost + slippageCost;

  console.log('ESTIMATED ZAP COSTS (USD):');
  console.log(`  Approx. Position Value: $${totalValueUsd.toFixed(2)}`);
  console.log(`  ZAP-enabled Rebalances: ${zapRebalances}`);
  console.log(`  Est. Avg Swap per Rebalance: ${(avgSwapPercent * 100).toFixed(0)}% of position`);
  console.log(`  Est. Total Value Swapped: $${totalSwappedValue.toFixed(2)}`);
  console.log('');
  console.log(`  Pool Swap Fees (${(poolFeeRate * 100).toFixed(2)}%): $${swapFeesCost.toFixed(2)}`);
  console.log(`  Estimated Slippage (${(slippageEstimate * 100).toFixed(1)}%): $${slippageCost.toFixed(2)}`);
  console.log('  ----------------------------------------');
  console.log(`  TOTAL ESTIMATED ZAP COST: $${totalZapCost.toFixed(2)}`);
  console.log('');

  // Compare to fees earned
  const feesEarnedUsd = Number(totalFeesEarnedX) / 10**decimalsX * suiPriceUsd + Number(totalFeesEarnedY) / 10**decimalsY;
  console.log('COST vs EARNINGS ANALYSIS:');
  console.log(`  Total Fees Earned: $${feesEarnedUsd.toFixed(2)}`);
  console.log(`  Est. ZAP Costs: $${totalZapCost.toFixed(2)}`);
  console.log(`  Net Earnings after ZAP: $${(feesEarnedUsd - totalZapCost).toFixed(2)}`);
  console.log(`  ZAP Cost as % of Fees: ${((totalZapCost / feesEarnedUsd) * 100).toFixed(1)}%`);
  console.log('');

  // Check rewards
  console.log('REWARDS:');
  const rewards = fields.total_rewards_earned?.fields?.contents || [];
  if (rewards.length > 0) {
    for (const reward of rewards) {
      const rewardFields = reward.fields || reward;
      const coinType = rewardFields.key || 'Unknown';
      const amount = rewardFields.value || '0';
      console.log(`  ${coinType.split('::').pop()}: ${formatAmount(BigInt(amount), 9)}`);
    }
  } else {
    console.log('  No rewards recorded');
  }
  console.log('');

  console.log('========================================');
  console.log('NOTE: ZAP costs are NOT explicitly tracked on-chain.');
  console.log('These are estimates based on typical swap patterns.');
  console.log('Actual costs depend on market conditions at each rebalance.');
  console.log('========================================');
}

function formatAmount(amount: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, 4);
  return `${whole.toString()}.${fractionStr}`;
}

analyzeZapCosts().catch(console.error);
