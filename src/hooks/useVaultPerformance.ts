/**
 * Vault Performance Hook
 *
 * Fetches and tracks vault performance in real-time
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSuiClient } from '@mysten/dapp-kit';
import type { VaultPerformance } from '@/types/performance';
import {
  getVaultPerformance,
  saveVaultPerformance,
  createSnapshot,
  calculateMetrics,
  calculateZapCosts,
} from '@/services/performanceService';
import {
  getSuiPriceSync,
  getXSuiPriceSync,
  getTokenPriceSync,
  fetchSuiPrice,
} from '@/services/priceService';
import type { SuiClient, SuiEvent, EventId } from '@mysten/sui/client';

/**
 * Fetch all events with pagination (Sui RPC caps at 50 per page)
 */
async function fetchAllEvents(
  client: SuiClient,
  eventType: string,
  order: 'ascending' | 'descending' = 'descending'
): Promise<SuiEvent[]> {
  const allEvents: SuiEvent[] = [];
  let cursor: EventId | null | undefined = undefined;
  let hasMore = true;

  while (hasMore) {
    const result = await client.queryEvents({
      query: { MoveEventType: eventType },
      limit: 50,
      order,
      cursor: cursor ?? undefined,
    });
    allEvents.push(...result.data);
    cursor = result.nextCursor;
    hasMore = result.hasNextPage;
  }

  return allEvents;
}

// Re-export for backwards compatibility
export function getSuiPrice(): number {
  return getSuiPriceSync();
}

export function getXSuiPrice(): number {
  return getXSuiPriceSync();
}

interface UseVaultPerformanceResult {
  performance: VaultPerformance | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

interface ZapRebalanceData {
  rebalanceNumber: number;
  timestamp: number;
  usedZap: boolean;
  transactionDigest: string;
  // Actual swap data from on-chain event (0 if no swap occurred)
  amountIn: bigint;
  amountOut: bigint;
  swapXtoY: boolean;
}

interface VaultData {
  vaultId: string;
  owner: string;
  poolId: string;
  balanceX: string;
  balanceY: string;
  feesX: string;
  feesY: string;
  hasPosition: boolean;
  cyclesCompleted: number;
  maxCycles: number;
  tickLower?: number;
  tickUpper?: number;
  currentTick?: number;
  tokenXType: string;
  tokenYType: string;
  initialDepositX: string | null;
  initialDepositY: string | null;
  cumulativeFeesX: string;
  cumulativeFeesY: string;
  cumulativeLeftoverX: string;
  cumulativeLeftoverY: string;
  rewardsByCoinType: Map<string, bigint>;
  totalGasUsed: bigint;
  // ZAP tracking
  useZap: boolean;
  rebalanceCount: number;
  zapRebalanceEvents: ZapRebalanceData[];
}

export function useVaultPerformance(vaultId: string): UseVaultPerformanceResult {
  const suiClient = useSuiClient();
  const [performance, setPerformance] = useState<VaultPerformance | null>(null);

  const { data: vaultData, isLoading, error, refetch } = useQuery<VaultData>({
    queryKey: ['vault-performance', vaultId],
    queryFn: async (): Promise<VaultData> => {
      // Fetch fresh prices from DeFiLlama (updates cache)
      await fetchSuiPrice().catch(e => console.warn('[Price] Failed to fetch:', e));

      // Fetch vault object
      const vaultObj = await suiClient.getObject({
        id: vaultId,
        options: { showContent: true, showType: true },
      });

      if (!vaultObj.data?.content || vaultObj.data.content.dataType !== 'moveObject') {
        throw new Error('Vault not found');
      }

      const fields = vaultObj.data.content.fields as any;
      const objectType = vaultObj.data.content.type;

      // Extract token types
      const typeMatch = objectType.match(/Vault<([^,]+),\s*([^>]+)>/);
      if (!typeMatch) throw new Error('Invalid vault type');
      const [, tokenXType, tokenYType] = typeMatch;
      console.log(`[Vault] Token types - X: ${tokenXType}, Y: ${tokenYType}`);

      // Fetch initial deposit amounts from VaultDeposit event
      let initialDepositX: string | null = null;
      let initialDepositY: string | null = null;
      let cumulativeFeesX = BigInt(0);
      let cumulativeFeesY = BigInt(0);
      let cumulativeLeftoverX = BigInt(0);
      let cumulativeLeftoverY = BigInt(0);
      let rewardsByCoinType = new Map<string, bigint>();
      let totalGasUsed = BigInt(0);
      let zapRebalanceEvents: ZapRebalanceData[] = [];

      try {
        // Get package ID from vault type or pool_id
        const vaultType = objectType;
        const packageMatch = vaultType.match(/0x[a-f0-9]+/);
        const packageId = packageMatch ? packageMatch[0] : fields.pool_id.split('::')[0];

        console.log(`[Debug] Vault object type: ${vaultType}`);
        console.log(`[Debug] Package ID for event queries: ${packageId}`);

        // Query all relevant events (paginate RebalanceExecuted since it can exceed 50)
        const [depositEvents, feesCompoundedEvents, leftoverEvents, rewardsEvents, rebalanceEventsData] = await Promise.all([
          suiClient.queryEvents({
            query: {
              MoveEventType: `${packageId}::cycling_vault::VaultDeposit`,
            },
            limit: 50,
          }),
          suiClient.queryEvents({
            query: {
              MoveEventType: `${packageId}::cycling_vault::FeesCompounded`,
            },
            limit: 50,
          }),
          suiClient.queryEvents({
            query: {
              MoveEventType: `${packageId}::cycling_vault::LeftoverDeposited`,
            },
            limit: 50,
          }),
          suiClient.queryEvents({
            query: {
              MoveEventType: `${packageId}::cycling_vault::RewardsCollected`,
            },
            limit: 50,
            order: 'descending',
          }),
          // Paginate to get ALL rebalance events
          fetchAllEvents(suiClient, `${packageId}::cycling_vault::RebalanceExecuted`, 'descending'),
        ]);

        const rebalanceEvents = { data: rebalanceEventsData };

        // Check RebalanceExecuted events for this vault and track ZAP usage
        const vaultRebalanceEvents = rebalanceEvents.data.filter(
          (event) => (event.parsedJson as any)?.vault_id === vaultId
        );
        console.log(`\n--- RebalanceExecuted Events ---`);
        console.log(`Total RebalanceExecuted events in system: ${rebalanceEvents.data.length}`);
        console.log(`Events for this vault: ${vaultRebalanceEvents.length}`);

        // Build ZAP rebalance history with actual swap data
        for (const event of vaultRebalanceEvents) {
          const data = event.parsedJson as any;
          const timestamp = event.timestampMs ? parseInt(event.timestampMs) : Date.now();
          zapRebalanceEvents.push({
            rebalanceNumber: Number(data.rebalance_count || 0),
            timestamp,
            usedZap: Boolean(data.used_zap),
            transactionDigest: event.id?.txDigest || '',
            // Actual swap data from on-chain event (0 if no swap occurred)
            amountIn: data.amount_in ? BigInt(data.amount_in) : BigInt(0),
            amountOut: data.amount_out ? BigInt(data.amount_out) : BigInt(0),
            swapXtoY: Boolean(data.swap_x_to_y),
          });
        }
        // Sort by rebalance number (ascending)
        zapRebalanceEvents.sort((a, b) => a.rebalanceNumber - b.rebalanceNumber);

        if (vaultRebalanceEvents.length > 0) {
          const latestRebalance = vaultRebalanceEvents[0].parsedJson as any;
          console.log(`Latest rebalance_count from event: ${latestRebalance.rebalance_count}`);
          console.log(`ZAP rebalances: ${zapRebalanceEvents.filter(e => e.usedZap).length}`);
          console.log(`Non-ZAP rebalances: ${zapRebalanceEvents.filter(e => !e.usedZap).length}`);
        }

        // Find the first VaultDeposit event for this vault (initial deposit)
        const vaultDepositEvents = depositEvents.data.filter(
          (event) => (event.parsedJson as any)?.vault_id === vaultId
        );

        if (vaultDepositEvents.length > 0) {
          // Sort by timestamp to get the earliest deposit
          vaultDepositEvents.sort((a, b) => {
            const timeA = a.timestampMs ? parseInt(a.timestampMs) : 0;
            const timeB = b.timestampMs ? parseInt(b.timestampMs) : 0;
            return timeA - timeB;
          });

          const firstDeposit = vaultDepositEvents[0].parsedJson as any;
          initialDepositX = firstDeposit.amount_x?.toString() || null;
          initialDepositY = firstDeposit.amount_y?.toString() || null;
        }

        // Calculate cumulative fees from FeesCompounded events
        const vaultFeesEvents = feesCompoundedEvents.data.filter(
          (event) => (event.parsedJson as any)?.vault_id === vaultId
        );

        console.log(`\n========== FEE BREAKDOWN FOR VAULT ==========`);
        console.log(`Vault ID: ${vaultId}`);
        console.log(`Found ${vaultFeesEvents.length} FeesCompounded events\n`);

        if (vaultFeesEvents.length > 0) {
          console.log(`--- Individual FeesCompounded Events ---`);
          // Sort by timestamp for chronological order
          const sortedFeeEvents = [...vaultFeesEvents].sort((a, b) => {
            const timeA = a.timestampMs ? parseInt(a.timestampMs) : 0;
            const timeB = b.timestampMs ? parseInt(b.timestampMs) : 0;
            return timeA - timeB;
          });

          for (let i = 0; i < sortedFeeEvents.length; i++) {
            const event = sortedFeeEvents[i];
            const data = event.parsedJson as any;
            const timestamp = event.timestampMs ? new Date(parseInt(event.timestampMs)).toISOString() : 'unknown';
            const txDigest = event.id?.txDigest || 'unknown';
            const feeX = BigInt(data.compounded_x || 0);
            const feeY = BigInt(data.compounded_y || 0);
            // Assume 9 decimals for display (SUI standard)
            const feeXDisplay = Number(feeX) / 1e9;
            const feeYDisplay = Number(feeY) / 1e9;

            console.log(`Event #${i + 1}: ${timestamp}`);
            console.log(`  TX: ${txDigest}`);
            console.log(`  Fee X: ${feeX} raw = ${feeXDisplay.toFixed(9)} (human)`);
            console.log(`  Fee Y: ${feeY} raw = ${feeYDisplay.toFixed(9)} (human)`);

            cumulativeFeesX += feeX;
            cumulativeFeesY += feeY;
          }
        }

        const eventSumX = cumulativeFeesX;
        const eventSumY = cumulativeFeesY;
        console.log(`\n--- Event Sum ---`);
        console.log(`Sum from ${vaultFeesEvents.length} events:`);
        console.log(`  X: ${eventSumX} raw = ${(Number(eventSumX) / 1e9).toFixed(9)} (human)`);
        console.log(`  Y: ${eventSumY} raw = ${(Number(eventSumY) / 1e9).toFixed(9)} (human)`);

        // Calculate cumulative leftover from LeftoverDeposited events
        const vaultLeftoverEvents = leftoverEvents.data.filter(
          (event) => (event.parsedJson as any)?.vault_id === vaultId
        );

        for (const event of vaultLeftoverEvents) {
          const data = event.parsedJson as any;
          cumulativeLeftoverX += BigInt(data.amount_x || 0);
          cumulativeLeftoverY += BigInt(data.amount_y || 0);
        }

        // Calculate cumulative rewards from RewardsCollected events
        console.log(`\n--- RewardsCollected Events ---`);
        console.log(`Total RewardsCollected events in system: ${rewardsEvents.data.length}`);

        const vaultRewardsEvents = rewardsEvents.data.filter(
          (event) => (event.parsedJson as any)?.vault_id === vaultId
        );
        console.log(`RewardsCollected events for this vault: ${vaultRewardsEvents.length}`);

        // Group rewards by coin type
        rewardsByCoinType = new Map<string, bigint>();
        for (const event of vaultRewardsEvents) {
          const data = event.parsedJson as any;
          const coinType = data.coin_type;
          const amount = BigInt(data.amount || 0);
          const timestamp = event.timestampMs ? new Date(parseInt(event.timestampMs)).toISOString() : 'unknown';

          console.log(`  Reward: ${coinType.split('::').pop()} amount=${amount} (${Number(amount)/1e9} human) at ${timestamp}`);

          if (rewardsByCoinType.has(coinType)) {
            rewardsByCoinType.set(coinType, rewardsByCoinType.get(coinType)! + amount);
          } else {
            rewardsByCoinType.set(coinType, amount);
          }
        }

        // Show totals by coin type
        if (rewardsByCoinType.size > 0) {
          console.log(`\nRewards totals from events:`);
          for (const [coinType, amount] of rewardsByCoinType.entries()) {
            const symbol = coinType.split('::').pop() || 'UNKNOWN';
            console.log(`  ${symbol}: ${amount} raw = ${(Number(amount)/1e9).toFixed(6)} (human)`);
          }
        }

        // Track actual gas costs from cycle events
        // Query CycleExecuted and PositionOpened events to get transaction digests
        totalGasUsed = BigInt(0);
        const cycleExecutedEvents = await suiClient.queryEvents({
          query: {
            MoveEventType: `${packageId}::cycling_vault::CycleExecuted`,
          },
          limit: 100,
        });

        const positionOpenedEvents = await suiClient.queryEvents({
          query: {
            MoveEventType: `${packageId}::cycling_vault::PositionOpened`,
          },
          limit: 100,
        });

        // Get unique transaction digests for this vault
        // Debug: Log all CycleExecuted events to see what vault IDs exist
        console.log(`\n--- CycleExecuted Events Debug ---`);
        console.log(`Looking for vault ID: ${vaultId}`);
        console.log(`Total CycleExecuted events found: ${cycleExecutedEvents.data.length}`);

        // Show first few events' vault IDs for debugging
        for (let i = 0; i < Math.min(5, cycleExecutedEvents.data.length); i++) {
          const event = cycleExecutedEvents.data[i];
          const eventVaultId = (event.parsedJson as any)?.vault_id;
          console.log(`  Event ${i}: vault_id = ${eventVaultId}`);
        }

        const vaultCycleEvents = cycleExecutedEvents.data.filter(
          (event) => (event.parsedJson as any)?.vault_id === vaultId
        );
        const vaultPositionEvents = positionOpenedEvents.data.filter(
          (event) => (event.parsedJson as any)?.vault_id === vaultId
        );

        console.log(`Matched ${vaultCycleEvents.length} CycleExecuted events for this vault`);

        // Log CycleExecuted events with their fee amounts (this is what was collected when closing)
        if (vaultCycleEvents.length > 0) {
          console.log(`\n--- CycleExecuted Events (fees collected on close) ---`);
          let cycleFeeSumX = BigInt(0);
          let cycleFeeSumY = BigInt(0);

          const sortedCycleEvents = [...vaultCycleEvents].sort((a, b) => {
            const timeA = a.timestampMs ? parseInt(a.timestampMs) : 0;
            const timeB = b.timestampMs ? parseInt(b.timestampMs) : 0;
            return timeA - timeB;
          });

          for (let i = 0; i < sortedCycleEvents.length; i++) {
            const event = sortedCycleEvents[i];
            const data = event.parsedJson as any;
            const timestamp = event.timestampMs ? new Date(parseInt(event.timestampMs)).toISOString() : 'unknown';
            const cycleNum = data.cycle_number || (i + 1);
            const feeX = BigInt(data.fees_x || 0);
            const feeY = BigInt(data.fees_y || 0);

            console.log(`Cycle #${cycleNum}: ${timestamp}`);
            console.log(`  Fees collected: X=${(Number(feeX) / 1e9).toFixed(9)}, Y=${(Number(feeY) / 1e9).toFixed(9)}`);

            cycleFeeSumX += feeX;
            cycleFeeSumY += feeY;
          }

          console.log(`\nSum from ${vaultCycleEvents.length} CycleExecuted events:`);
          console.log(`  X: ${cycleFeeSumX} raw = ${(Number(cycleFeeSumX) / 1e9).toFixed(9)} (human)`);
          console.log(`  Y: ${cycleFeeSumY} raw = ${(Number(cycleFeeSumY) / 1e9).toFixed(9)} (human)`);
        }

        const txDigests = new Set<string>();
        for (const event of [...vaultCycleEvents, ...vaultPositionEvents]) {
          if (event.id?.txDigest) {
            txDigests.add(event.id.txDigest);
          }
        }

        // Query gas costs for each transaction
        for (const digest of txDigests) {
          try {
            const txData = await suiClient.getTransactionBlock({
              digest,
              options: { showEffects: true },
            });

            if (txData.effects?.gasUsed) {
              const gasUsed = txData.effects.gasUsed;
              // Net gas = computation + storage - rebate
              // This is the actual amount deducted from user's balance
              const computationCost = BigInt(gasUsed.computationCost);
              const storageCost = BigInt(gasUsed.storageCost);
              const storageRebate = BigInt(gasUsed.storageRebate);
              const netGas = computationCost + storageCost - storageRebate;

              // Sum all transaction costs (can include negative if rebate > cost)
              totalGasUsed += netGas;

              // Debug log
              const netGasSui = Number(netGas) / 1e9;
              console.log(`Gas for ${digest.slice(0, 8)}: net=${netGasSui.toFixed(9)} SUI (comp=${Number(computationCost)/1e9}, stor=${Number(storageCost)/1e9}, rebate=${Number(storageRebate)/1e9})`);
            }
          } catch (e) {
            console.warn('Could not fetch transaction gas:', digest, e);
          }
        }

        // Ensure gas is not negative (if rebates exceed costs overall, show 0)
        if (totalGasUsed < BigInt(0)) {
          totalGasUsed = BigInt(0);
        }

        console.log(`\n--- Gas Summary ---`);
        console.log(`Total gas used: ${(Number(totalGasUsed) / 1e9).toFixed(9)} SUI across ${txDigests.size} transactions`);
      } catch (e) {
        console.warn('Could not fetch vault events:', e);
      }

      // Get balances
      const getBalanceValue = (field: any): string => {
        if (typeof field === 'string') return field;
        if (typeof field === 'number') return String(field);
        if (field && typeof field === 'object') {
          return String(field.fields?.value || field.value || '0');
        }
        return '0';
      };

      const balanceX = getBalanceValue(fields.balance_x);
      const balanceY = getBalanceValue(fields.balance_y);
      const feesX = getBalanceValue(fields.fees_x);
      const feesY = getBalanceValue(fields.fees_y);

      // Try to get stats from contract (new vaults have these fields)
      // Fall back to event-based tracking for older vaults
      const contractInitialDepositX = fields.initial_deposit_x ? String(fields.initial_deposit_x) : null;
      const contractInitialDepositY = fields.initial_deposit_y ? String(fields.initial_deposit_y) : null;
      const contractTotalFeesX = fields.total_fees_earned_x ? String(fields.total_fees_earned_x) : null;
      const contractTotalFeesY = fields.total_fees_earned_y ? String(fields.total_fees_earned_y) : null;

      // Try to read total_rewards_earned from contract Table
      // The Table is stored as a dynamic field, we need to query its entries
      try {
        const totalRewardsTableId = (fields.total_rewards_earned as any)?.fields?.id?.id;
        if (totalRewardsTableId) {
          console.log(`\n--- Reading total_rewards_earned Table ---`);
          console.log(`Table ID: ${totalRewardsTableId}`);

          const tableFields = await suiClient.getDynamicFields({
            parentId: totalRewardsTableId,
          });

          console.log(`Table has ${tableFields.data.length} entries`);

          for (const entry of tableFields.data) {
            // Get the actual value from the dynamic field
            const fieldObj = await suiClient.getObject({
              id: entry.objectId,
              options: { showContent: true },
            });

            if (fieldObj.data?.content?.dataType === 'moveObject') {
              const fieldData = (fieldObj.data.content as any).fields;
              const coinType = fieldData.name || entry.name?.value || 'unknown';
              const amount = BigInt(fieldData.value || 0);

              console.log(`  Contract reward: ${coinType} = ${amount} raw = ${(Number(amount)/1e9).toFixed(6)} (human)`);

              // Update rewardsByCoinType with contract values (more accurate than events)
              if (amount > BigInt(0)) {
                rewardsByCoinType.set(String(coinType), amount);
              }
            }
          }
        }
      } catch (e) {
        console.warn('Could not read total_rewards_earned table:', e);
      }
      // These are available for future use (position duration tracking, etc.)
      const _createdAt = fields.created_at ? Number(fields.created_at) : null;
      const _positionOpenedAt = fields.position_opened_at ? Number(fields.position_opened_at) : null;
      void _createdAt; void _positionOpenedAt; // Suppress unused warnings

      // Use contract values if available, otherwise fall back to event-based values
      const contractRebalanceCount = Number(fields.rebalance_count || 0);
      const contractCyclesCompleted = Number(fields.cycles_completed || 0);

      console.log(`\n--- Contract Fields ---`);
      console.log(`Contract rebalance_count: ${contractRebalanceCount}`);
      console.log(`Contract cycles_completed: ${contractCyclesCompleted}`);
      console.log(`Contract total_fees_earned_x: ${contractTotalFeesX || 'not set'}`);
      console.log(`Contract total_fees_earned_y: ${contractTotalFeesY || 'not set'}`);
      if (contractTotalFeesX) {
        console.log(`  X (SUI, 9 dec): ${contractTotalFeesX} raw = ${(Number(contractTotalFeesX) / 1e9).toFixed(6)} SUI`);
      }
      if (contractTotalFeesY) {
        console.log(`  Y (USDC, 6 dec): ${contractTotalFeesY} raw = ${(Number(contractTotalFeesY) / 1e6).toFixed(6)} USDC`);
      }

      // Calculate fee per rebalance
      if (contractRebalanceCount > 0 && contractTotalFeesX) {
        const feePerRebalanceX = Number(contractTotalFeesX) / contractRebalanceCount / 1e9;
        const feePerRebalanceY = Number(contractTotalFeesY || 0) / contractRebalanceCount / 1e6; // USDC has 6 decimals
        console.log(`\n--- Fee Per Rebalance ---`);
        console.log(`Average fee per rebalance: ${feePerRebalanceX.toFixed(6)} SUI + ${feePerRebalanceY.toFixed(6)} USDC`);
      }

      if (contractInitialDepositX && contractInitialDepositY) {
        initialDepositX = contractInitialDepositX;
        initialDepositY = contractInitialDepositY;
      }

      // Compare event sum vs contract values
      const eventSumXBigInt = cumulativeFeesX;
      const eventSumYBigInt = cumulativeFeesY;

      if (contractTotalFeesX && contractTotalFeesY) {
        const contractX = BigInt(contractTotalFeesX);
        const contractY = BigInt(contractTotalFeesY);
        const diffX = contractX - eventSumXBigInt;
        const diffY = contractY - eventSumYBigInt;

        console.log(`\n--- COMPARISON: Contract vs Events ---`);
        console.log(`Fee X - Contract: ${(Number(contractX) / 1e9).toFixed(9)}, Events: ${(Number(eventSumXBigInt) / 1e9).toFixed(9)}, Diff: ${(Number(diffX) / 1e9).toFixed(9)}`);
        console.log(`Fee Y - Contract: ${(Number(contractY) / 1e9).toFixed(9)}, Events: ${(Number(eventSumYBigInt) / 1e9).toFixed(9)}, Diff: ${(Number(diffY) / 1e9).toFixed(9)}`);

        if (diffX !== BigInt(0) || diffY !== BigInt(0)) {
          console.log(`⚠️ MISMATCH DETECTED! Contract has different values than event sum.`);
          console.log(`   This could mean: track_fees() was called separately, or events were missed.`);
        }

        console.log(`\n✅ USING CONTRACT VALUES (more authoritative)`);
        cumulativeFeesX = contractX;
        cumulativeFeesY = contractY;
      } else {
        console.log(`\n⚠️ Contract fields not set, using event-based sum`);
      }

      console.log(`\n--- FINAL FEE VALUES ---`);
      console.log(`Fee X: ${cumulativeFeesX} raw = ${(Number(cumulativeFeesX) / 1e9).toFixed(9)} (human)`);
      console.log(`Fee Y: ${cumulativeFeesY} raw = ${(Number(cumulativeFeesY) / 1e9).toFixed(9)} (human)`);
      console.log(`==========================================\n`);

      // Get position info if exists
      let tickLower: number | undefined;
      let tickUpper: number | undefined;
      let currentTick: number | undefined;

      if (fields.has_position) {
        // Get pool to find current tick
        const poolObj = await suiClient.getObject({
          id: fields.pool_id,
          options: { showContent: true },
        });

        if (poolObj.data?.content && poolObj.data.content.dataType === 'moveObject') {
          const poolFields = poolObj.data.content.fields as any;
          currentTick = Number(poolFields.current_tick_index || 0);
        }

        // Get position ticks
        const dynamicFields = await suiClient.getDynamicFields({
          parentId: vaultId,
        });

        const positionField = dynamicFields.data.find(
          (field) => field.objectType?.includes('::position::Position')
        );

        if (positionField) {
          const positionObj = await suiClient.getObject({
            id: positionField.objectId,
            options: { showContent: true },
          });

          if (positionObj.data?.content && positionObj.data.content.dataType === 'moveObject') {
            const posFields = positionObj.data.content.fields as any;
            const posValue = posFields.value || posFields;
            tickLower = Number(posValue.tick_lower_index || 0);
            tickUpper = Number(posValue.tick_upper_index || 0);
          }
        }
      }

      return {
        vaultId,
        owner: fields.owner,
        poolId: fields.pool_id,
        balanceX,
        balanceY,
        feesX,
        feesY,
        hasPosition: fields.has_position,
        cyclesCompleted: Number(fields.cycles_completed || 0),
        maxCycles: Number(fields.max_cycles || 0),
        tickLower,
        tickUpper,
        currentTick,
        tokenXType,
        tokenYType,
        initialDepositX,
        initialDepositY,
        cumulativeFeesX: cumulativeFeesX.toString(),
        cumulativeFeesY: cumulativeFeesY.toString(),
        cumulativeLeftoverX: cumulativeLeftoverX.toString(),
        cumulativeLeftoverY: cumulativeLeftoverY.toString(),
        rewardsByCoinType,
        totalGasUsed,
        // ZAP tracking
        useZap: Boolean(fields.use_zap),
        rebalanceCount: Number(fields.rebalance_count || 0),
        zapRebalanceEvents,
      };
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  useEffect(() => {
    if (!vaultData) return;

    // Don't track performance if vault is empty (no balances and no fees)
    const hasBalances = BigInt(vaultData.balanceX) > 0 || BigInt(vaultData.balanceY) > 0;
    const hasFees = BigInt(vaultData.feesX) > 0 || BigInt(vaultData.feesY) > 0;
    if (!hasBalances && !hasFees) {
      return; // Skip tracking until vault has actual value
    }

    // Get or create performance tracking
    let perf = getVaultPerformance(vaultId);

    // Get token symbols and decimals
    const getTokenInfo = (tokenType: string) => {
      if (tokenType.includes('usdc') || tokenType.includes('USDC')) {
        return { symbol: 'USDC', decimals: 6 };
      }
      if (tokenType.includes('sui') || tokenType.includes('SUI')) {
        return { symbol: 'SUI', decimals: 9 };
      }
      if (tokenType.includes('usdt') || tokenType.includes('USDT')) {
        return { symbol: 'USDT', decimals: 6 };
      }
      // Default to 9 decimals for unknown tokens
      return { symbol: 'TOKEN', decimals: 9 };
    };

    const tokenAInfo = getTokenInfo(vaultData.tokenXType);
    const tokenBInfo = getTokenInfo(vaultData.tokenYType);

    // Token prices (from DeFiLlama oracle)
    const tokenAPrice = getTokenPriceSync(tokenAInfo.symbol);
    const tokenBPrice = getTokenPriceSync(tokenBInfo.symbol);

    // Convert balances and fees with correct decimals
    const balanceA = Number(vaultData.balanceX) / Math.pow(10, tokenAInfo.decimals);
    const balanceB = Number(vaultData.balanceY) / Math.pow(10, tokenBInfo.decimals);
    const feesA = Number(vaultData.feesX) / Math.pow(10, tokenAInfo.decimals);
    const feesB = Number(vaultData.feesY) / Math.pow(10, tokenBInfo.decimals);

    // Convert cumulative fees from events
    // NOTE: Only showing trading fees, not leftover (leftover is already in balance, not a "fee")
    console.log(`[Fees] Token info - A: ${tokenAInfo.symbol} (${tokenAInfo.decimals} decimals), B: ${tokenBInfo.symbol} (${tokenBInfo.decimals} decimals)`);
    console.log(`[Fees] Raw cumulativeFeesX: ${vaultData.cumulativeFeesX}, dividing by 10^${tokenAInfo.decimals} = ${Math.pow(10, tokenAInfo.decimals)}`);
    console.log(`[Fees] Raw cumulativeFeesY: ${vaultData.cumulativeFeesY}, dividing by 10^${tokenBInfo.decimals} = ${Math.pow(10, tokenBInfo.decimals)}`);
    const cumulativeFeesA = Number(vaultData.cumulativeFeesX) / Math.pow(10, tokenAInfo.decimals);
    const cumulativeFeesB = Number(vaultData.cumulativeFeesY) / Math.pow(10, tokenBInfo.decimals);
    const cumulativeFeesUsd = cumulativeFeesA * tokenAPrice + cumulativeFeesB * tokenBPrice;
    console.log(`[Fees] Cumulative fees: ${cumulativeFeesA.toFixed(6)} ${tokenAInfo.symbol} ($${(cumulativeFeesA * tokenAPrice).toFixed(2)}) + ${cumulativeFeesB.toFixed(6)} ${tokenBInfo.symbol} ($${(cumulativeFeesB * tokenBPrice).toFixed(2)}) = $${cumulativeFeesUsd.toFixed(2)}`);
    console.log(`[Fees] Prices used: ${tokenAInfo.symbol}=$${tokenAPrice.toFixed(4)}, ${tokenBInfo.symbol}=$${tokenBPrice.toFixed(4)}`);

    // NOTE: Cumulative leftover is tracked separately but not shown as "fees collected"
    // Both fees and leftover are ALREADY included in current balance (they were compounded)
    // So we only show trading fees in the "Fees Collected" metric

    // IMPORTANT: Total value includes BOTH balances AND uncollected fees
    const totalTokenA = balanceA + feesA;
    const totalTokenB = balanceB + feesB;

    // Get ACTUAL initial deposit amounts from blockchain event (REQUIRED!)
    let initialTokenA: number;
    let initialTokenB: number;
    let hasRealInitialData = false;

    if (vaultData.initialDepositX && vaultData.initialDepositY) {
      initialTokenA = Number(vaultData.initialDepositX) / Math.pow(10, tokenAInfo.decimals);
      initialTokenB = Number(vaultData.initialDepositY) / Math.pow(10, tokenBInfo.decimals);
      hasRealInitialData = true;
    } else {
      // Can't track performance without initial deposit data - skip this update
      console.warn('No initial deposit data available for vault', vaultId);
      return;
    }

    // Process rewards data
    const rewardsCollected = [];
    if (vaultData.rewardsByCoinType && vaultData.rewardsByCoinType.size > 0) {
      console.log('[Rewards] Processing rewards, count:', vaultData.rewardsByCoinType.size);
      for (const [coinType, amount] of vaultData.rewardsByCoinType.entries()) {
        console.log('[Rewards] Coin type:', coinType, 'Amount:', amount);

        // Determine decimals and symbol based on coin type
        let decimals = 9;
        let symbol = 'REWARD';
        let price = 0;

        // Normalize coin type for comparison (lowercase)
        const coinTypeLower = coinType.toLowerCase();
        console.log('[Rewards] Lowercase coin type:', coinTypeLower);

        // xSUI is a common reward token (staked SUI)
        // 1 xSUI ≈ 1.00968 SUI (exchange rate)
        if (coinTypeLower.includes('xsui') || coinTypeLower.includes('x_sui') || coinTypeLower.includes('liquid_staking')) {
          decimals = 9;
          symbol = 'xSUI';
          price = getXSuiPrice(); // Uses centralized price config
          console.log('[Rewards] Matched xSUI, price:', price);
        } else if (coinTypeLower.includes('sui')) {
          decimals = 9;
          symbol = 'SUI';
          price = getSuiPrice();
          console.log('[Rewards] Matched SUI, price:', price);
        } else {
          console.log('[Rewards] No match for coin type, price remains 0');
        }

        const amountDecimal = Number(amount) / Math.pow(10, decimals);
        const usdValue = amountDecimal * price;
        console.log('[Rewards] Amount decimal:', amountDecimal, 'USD value:', usdValue);

        rewardsCollected.push({
          coinType,
          amount: amountDecimal.toFixed(decimals),
          symbol,
          usdValue,
        });
      }
    }

    // Create current snapshot with correct decimal conversion
    // feesCollected = ONLY trading fees (not leftover, which isn't really a "fee")
    const currentSnapshot = createSnapshot({
      timestamp: Date.now(),
      cycleNumber: vaultData.cyclesCompleted,
      tokenAAmount: totalTokenA.toFixed(tokenAInfo.decimals),
      tokenBAmount: totalTokenB.toFixed(tokenBInfo.decimals),
      tokenASymbol: tokenAInfo.symbol,
      tokenBSymbol: tokenBInfo.symbol,
      tokenAPrice,
      tokenBPrice,
      hasPosition: vaultData.hasPosition,
      tickLower: vaultData.tickLower,
      tickUpper: vaultData.tickUpper,
      currentTick: vaultData.currentTick,
      feesCollectedA: cumulativeFeesA.toFixed(tokenAInfo.decimals),
      feesCollectedB: cumulativeFeesB.toFixed(tokenBInfo.decimals),
      strategyType: 'smart-rebalance', // TODO: Get from vault config
      initialValue: perf?.initialSnapshot.totalValueUsd,
      rewardsCollected: rewardsCollected.length > 0 ? rewardsCollected : undefined,
    });

    if (!perf) {
      // First time tracking this vault - create initial snapshot with real deposit data
      const initialSnap = hasRealInitialData
        ? createSnapshot({
            timestamp: Date.now(),
            cycleNumber: 0,
            tokenAAmount: initialTokenA.toFixed(tokenAInfo.decimals),
            tokenBAmount: initialTokenB.toFixed(tokenBInfo.decimals),
            tokenASymbol: tokenAInfo.symbol,
            tokenBSymbol: tokenBInfo.symbol,
            tokenAPrice,
            tokenBPrice,
            hasPosition: false,
            feesCollectedA: '0',
            feesCollectedB: '0',
            strategyType: 'smart-rebalance',
            initialValue: undefined,
          })
        : currentSnapshot;

      perf = {
        vaultId,
        owner: vaultData.owner,
        poolId: vaultData.poolId,
        strategyType: 'smart-rebalance',
        initialSnapshot: initialSnap,
        currentSnapshot,
        history: [currentSnapshot],
        metrics: {} as any, // Will be calculated below
      };
    } else {
      // Fix existing vaults with incorrect initial snapshots
      // If we have real initial data AND current initial snapshot is wrong (not from cycle 0 or has fees)
      const initialSnapshotIsWrong =
        perf.initialSnapshot.cycleNumber > 0 ||
        parseFloat(perf.initialSnapshot.feesCollectedA) > 0 ||
        parseFloat(perf.initialSnapshot.feesCollectedB) > 0;

      if (hasRealInitialData && initialSnapshotIsWrong) {
        // Replace with correct initial snapshot
        perf.initialSnapshot = createSnapshot({
          timestamp: perf.initialSnapshot.timestamp, // Keep original timestamp
          cycleNumber: 0,
          tokenAAmount: initialTokenA.toFixed(tokenAInfo.decimals),
          tokenBAmount: initialTokenB.toFixed(tokenBInfo.decimals),
          tokenASymbol: tokenAInfo.symbol,
          tokenBSymbol: tokenBInfo.symbol,
          tokenAPrice,
          tokenBPrice,
          hasPosition: false,
          feesCollectedA: '0',
          feesCollectedB: '0',
          strategyType: 'smart-rebalance',
          initialValue: undefined,
        });
      }

      // Update existing performance
      perf.currentSnapshot = currentSnapshot;

      // Only add to history if cycle number changed
      const lastHistorySnapshot = perf.history[perf.history.length - 1];
      if (lastHistorySnapshot.cycleNumber !== currentSnapshot.cycleNumber) {
        perf.history.push(currentSnapshot);
      } else {
        // Update the last snapshot
        perf.history[perf.history.length - 1] = currentSnapshot;
      }
    }

    // Calculate metrics with actual gas cost and ZAP data
    const actualGasCostSui = Number(vaultData.totalGasUsed) / 1e9;
    perf.metrics = calculateMetrics(perf, {
      actualGasCostSui,
      zapRebalanceEvents: vaultData.zapRebalanceEvents,
    });

    // Calculate ZAP history if there are rebalance events
    if (vaultData.zapRebalanceEvents && vaultData.zapRebalanceEvents.length > 0) {
      const positionValue =
        parseFloat(perf.currentSnapshot.tokenAAmount) * perf.currentSnapshot.tokenAPrice +
        parseFloat(perf.currentSnapshot.tokenBAmount) * perf.currentSnapshot.tokenBPrice;

      const zapCosts = calculateZapCosts({
        positionValueUsd: positionValue,
        zapRebalanceEvents: vaultData.zapRebalanceEvents,
        tokenASymbol: tokenAInfo.symbol,
        tokenBSymbol: tokenBInfo.symbol,
        tokenADecimals: tokenAInfo.decimals,
        tokenBDecimals: tokenBInfo.decimals,
        tokenAPrice: perf.currentSnapshot.tokenAPrice,
        tokenBPrice: perf.currentSnapshot.tokenBPrice,
      });
      perf.zapHistory = zapCosts.zapHistory;
    }

    // Save to localStorage
    saveVaultPerformance(perf);

    setPerformance(perf);
  }, [vaultData, vaultId]);

  return {
    performance,
    isLoading,
    error: error as Error | null,
    refresh: refetch,
  };
}
