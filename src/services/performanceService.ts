/**
 * Performance Tracking Service
 *
 * Tracks vault performance metrics including PnL, IL, fees, and strategy effectiveness.
 * Stores snapshots locally and provides analytics.
 */

import type {
  PerformanceSnapshot,
  VaultPerformance,
  PortfolioSummary,
  PerformanceComparison,
  CycleEvent,
  ZapRebalanceEvent,
} from '@/types/performance';
import { getSuiPrice } from '@/hooks/useVaultPerformance';

const STORAGE_KEY = 'mmt_vault_performance';
const CYCLE_EVENTS_KEY = 'mmt_cycle_events';
const MIGRATION_VERSION_KEY = 'mmt_perf_migration_version';
const CURRENT_MIGRATION_VERSION = 1;

// ============ BigInt Serialization Helpers ============

/**
 * JSON replacer function that converts BigInt to a tagged string format
 * This allows BigInt values to be safely serialized to JSON
 */
function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return { __type: 'bigint', value: value.toString() };
  }
  return value;
}

/**
 * JSON reviver function that converts tagged strings back to BigInt
 * This restores BigInt values when parsing JSON from localStorage
 */
function bigIntReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && (value as Record<string, unknown>).__type === 'bigint') {
    return BigInt((value as Record<string, string>).value);
  }
  return value;
}

// ============ Data Migration ============

/**
 * Detects and clears invalid performance data
 * Run this once to clean up data from before the initial deposit tracking fix
 */
export function migratePerformanceData(): void {
  const currentVersion = parseInt(localStorage.getItem(MIGRATION_VERSION_KEY) || '0');

  if (currentVersion >= CURRENT_MIGRATION_VERSION) {
    return; // Already migrated
  }

  console.log('[Performance] Running data migration v1: clearing invalid initial snapshots');

  // Find all performance data
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_KEY)) {
      const data = localStorage.getItem(key);
      if (data) {
        try {
          const perf: VaultPerformance = JSON.parse(data, bigIntReviver);

          // Check if initial snapshot is invalid (has cycle > 0 or has fees)
          const isInvalid =
            perf.initialSnapshot.cycleNumber > 0 ||
            parseFloat(perf.initialSnapshot.feesCollectedA) > 0 ||
            parseFloat(perf.initialSnapshot.feesCollectedB) > 0;

          if (isInvalid) {
            keysToRemove.push(key);
          }
        } catch (e) {
          // Invalid JSON, remove it
          keysToRemove.push(key);
        }
      }
    }
  }

  // Remove invalid data
  keysToRemove.forEach(key => {
    console.log(`[Performance] Removing invalid data for ${key}`);
    localStorage.removeItem(key);
  });

  // Mark migration as complete
  localStorage.setItem(MIGRATION_VERSION_KEY, String(CURRENT_MIGRATION_VERSION));

  console.log(`[Performance] Migration complete. Removed ${keysToRemove.length} invalid entries`);
}

// ============ Storage Functions ============

export function getVaultPerformance(vaultId: string): VaultPerformance | null {
  const data = localStorage.getItem(`${STORAGE_KEY}_${vaultId}`);
  if (!data) return null;
  return JSON.parse(data, bigIntReviver);
}

export function saveVaultPerformance(performance: VaultPerformance): void {
  localStorage.setItem(
    `${STORAGE_KEY}_${performance.vaultId}`,
    JSON.stringify(performance, bigIntReplacer)
  );
}

export function getAllVaultPerformances(): VaultPerformance[] {
  const performances: VaultPerformance[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_KEY)) {
      const data = localStorage.getItem(key);
      if (data) {
        performances.push(JSON.parse(data, bigIntReviver));
      }
    }
  }
  return performances;
}

export function getCycleEvents(vaultId: string): CycleEvent[] {
  const data = localStorage.getItem(`${CYCLE_EVENTS_KEY}_${vaultId}`);
  if (!data) return [];
  return JSON.parse(data);
}

export function saveCycleEvent(event: CycleEvent): void {
  const events = getCycleEvents(event.vaultId);
  events.push(event);
  localStorage.setItem(
    `${CYCLE_EVENTS_KEY}_${event.vaultId}`,
    JSON.stringify(events)
  );
}

// ============ Snapshot Creation ============

export function createSnapshot(data: {
  timestamp: number;
  cycleNumber: number;
  tokenAAmount: string;
  tokenBAmount: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  tokenAPrice: number;
  tokenBPrice: number;
  hasPosition: boolean;
  tickLower?: number;
  tickUpper?: number;
  currentTick?: number;
  feesCollectedA?: string;
  feesCollectedB?: string;
  strategyType: string;
  executionReason?: string;
  initialValue?: number;
  rewardsCollected?: Array<{
    coinType: string;
    amount: string;
    symbol: string;
    usdValue: number;
  }>;
}): PerformanceSnapshot {
  const tokenAAmountNum = parseFloat(data.tokenAAmount) || 0;
  const tokenBAmountNum = parseFloat(data.tokenBAmount) || 0;
  const feesA = parseFloat(data.feesCollectedA || '0');
  const feesB = parseFloat(data.feesCollectedB || '0');

  const totalValueUsd =
    tokenAAmountNum * data.tokenAPrice + tokenBAmountNum * data.tokenBPrice;
  const feesCollectedUsd = feesA * data.tokenAPrice + feesB * data.tokenBPrice;

  const isInRange = data.currentTick !== undefined && data.tickLower !== undefined && data.tickUpper !== undefined
    ? data.currentTick >= data.tickLower && data.currentTick <= data.tickUpper
    : undefined;

  // Calculate PnL
  const initialValue = data.initialValue || totalValueUsd;
  const totalPnl = totalValueUsd - initialValue;
  const totalPnlPercent = initialValue > 0 ? (totalPnl / initialValue) * 100 : 0;

  // Calculate IL (simplified - actual IL needs more complex calculation)
  const divergenceLoss = 0; // TODO: Implement proper IL calculation
  const divergenceLossPercent = 0;

  return {
    timestamp: data.timestamp,
    cycleNumber: data.cycleNumber,
    tokenAAmount: data.tokenAAmount,
    tokenBAmount: data.tokenBAmount,
    tokenASymbol: data.tokenASymbol,
    tokenBSymbol: data.tokenBSymbol,
    tokenAPrice: data.tokenAPrice,
    tokenBPrice: data.tokenBPrice,
    totalValueUsd,
    hasPosition: data.hasPosition,
    tickLower: data.tickLower,
    tickUpper: data.tickUpper,
    currentTick: data.currentTick,
    isInRange,
    feesCollectedA: data.feesCollectedA || '0',
    feesCollectedB: data.feesCollectedB || '0',
    feesCollectedUsd,
    rewardsCollected: data.rewardsCollected,
    unrealizedPnl: totalPnl,
    unrealizedPnlPercent: totalPnlPercent,
    realizedPnl: 0,
    totalPnl,
    totalPnlPercent,
    divergenceLoss,
    divergenceLossPercent,
    strategyType: data.strategyType,
    executionReason: data.executionReason,
  };
}

// ============ ZAP Cost Calculation ============

interface ZapCostParams {
  positionValueUsd: number;
  zapRebalanceEvents: Array<{
    rebalanceNumber: number;
    timestamp: number;
    usedZap: boolean;
    transactionDigest: string;
    // Actual swap data from on-chain event
    amountIn: bigint;
    amountOut: bigint;
    swapXtoY: boolean;
  }>;
  tokenASymbol: string;
  tokenBSymbol: string;
  tokenADecimals: number;
  tokenBDecimals: number;
  tokenAPrice: number;
  tokenBPrice: number;
}

/**
 * Calculate ZAP costs based on actual on-chain swap data
 * Uses real swap amounts from RebalanceExecuted events
 */
export function calculateZapCosts(params: ZapCostParams): {
  totalZapCostUsd: number;
  zapRebalanceCount: number;
  nonZapRebalanceCount: number;
  avgZapCostPerRebalance: number;
  zapHistory: ZapRebalanceEvent[];
} {
  const {
    positionValueUsd,
    zapRebalanceEvents,
    tokenASymbol,
    tokenBSymbol,
    tokenADecimals,
    tokenBDecimals,
    tokenAPrice,
    tokenBPrice,
  } = params;

  // Determine pool fee rate based on token pair
  const isStablePair = ['USDC', 'USDT'].includes(tokenASymbol) && ['USDC', 'USDT'].includes(tokenBSymbol);
  const poolFeeRate = isStablePair ? 0.0005 : 0.0025; // 0.05% for stable, 0.25% for volatile

  const zapHistory: ZapRebalanceEvent[] = [];
  let totalZapCostUsd = 0;
  let zapRebalanceCount = 0;
  let nonZapRebalanceCount = 0;

  for (const event of zapRebalanceEvents) {
    if (event.usedZap) {
      zapRebalanceCount++;

      // Use actual swap data from on-chain event
      const hasActualData = event.amountIn > BigInt(0);

      let swapValueUsd: number;
      let amountOutUsd: number;
      let poolFeeUsd: number;
      let slippageUsd: number;

      if (hasActualData) {
        // Calculate USD values from actual swap amounts
        // swapXtoY: true means swapping token X (A) to token Y (B)
        if (event.swapXtoY) {
          // Swapped token A to get token B
          const amountInHuman = Number(event.amountIn) / Math.pow(10, tokenADecimals);
          const amountOutHuman = Number(event.amountOut) / Math.pow(10, tokenBDecimals);
          swapValueUsd = amountInHuman * tokenAPrice;
          amountOutUsd = amountOutHuman * tokenBPrice;
        } else {
          // Swapped token B to get token A
          const amountInHuman = Number(event.amountIn) / Math.pow(10, tokenBDecimals);
          const amountOutHuman = Number(event.amountOut) / Math.pow(10, tokenADecimals);
          swapValueUsd = amountInHuman * tokenBPrice;
          amountOutUsd = amountOutHuman * tokenAPrice;
        }

        // Pool fee is charged on the input
        poolFeeUsd = swapValueUsd * poolFeeRate;

        // Slippage is the difference between expected and actual output
        // Expected output (no slippage) = swapValueUsd * (1 - poolFeeRate)
        // Positive = unfavorable (lost money), Negative = favorable (got better price)
        const expectedOutputUsd = swapValueUsd * (1 - poolFeeRate);
        slippageUsd = expectedOutputUsd - amountOutUsd;
      } else {
        // Fallback to estimate if no actual data (for historical events before upgrade)
        const avgSwapPercent = 0.45;
        const slippageRate = 0.001;
        swapValueUsd = positionValueUsd * avgSwapPercent;
        poolFeeUsd = swapValueUsd * poolFeeRate;
        slippageUsd = swapValueUsd * slippageRate;
      }

      const totalCostUsd = poolFeeUsd + slippageUsd;
      totalZapCostUsd += totalCostUsd;

      zapHistory.push({
        rebalanceNumber: event.rebalanceNumber,
        timestamp: event.timestamp,
        usedZap: true,
        transactionDigest: event.transactionDigest,
        amountIn: event.amountIn,
        amountOut: event.amountOut,
        swapXtoY: event.swapXtoY,
        positionValueUsd,
        swapValueUsd,
        poolFeeUsd,
        slippageUsd,
        totalCostUsd,
        poolFeeRate,
      });
    } else {
      nonZapRebalanceCount++;

      // Non-ZAP rebalances have no swap cost
      zapHistory.push({
        rebalanceNumber: event.rebalanceNumber,
        timestamp: event.timestamp,
        usedZap: false,
        transactionDigest: event.transactionDigest,
        amountIn: BigInt(0),
        amountOut: BigInt(0),
        swapXtoY: false,
        positionValueUsd,
        swapValueUsd: 0,
        poolFeeUsd: 0,
        slippageUsd: 0,
        totalCostUsd: 0,
        poolFeeRate,
      });
    }
  }

  const avgZapCostPerRebalance = zapRebalanceCount > 0
    ? totalZapCostUsd / zapRebalanceCount
    : 0;

  return {
    totalZapCostUsd,
    zapRebalanceCount,
    nonZapRebalanceCount,
    avgZapCostPerRebalance,
    zapHistory,
  };
}

// ============ Metrics Calculation ============

interface MetricsOptions {
  actualGasCostSui?: number;
  zapRebalanceEvents?: Array<{
    rebalanceNumber: number;
    timestamp: number;
    usedZap: boolean;
    transactionDigest: string;
    // Actual swap data from on-chain event
    amountIn: bigint;
    amountOut: bigint;
    swapXtoY: boolean;
  }>;
}

export function calculateMetrics(
  performance: VaultPerformance,
  options?: MetricsOptions | number
): VaultPerformance['metrics'] {
  // Handle backwards compatibility - old signature was (performance, actualGasCostSui)
  const opts: MetricsOptions = typeof options === 'number'
    ? { actualGasCostSui: options }
    : options || {};
  const { actualGasCostSui, zapRebalanceEvents } = opts;
  const { initialSnapshot, currentSnapshot, history } = performance;

  const totalPnl = currentSnapshot.totalPnl;
  const totalPnlPercent = currentSnapshot.totalPnlPercent;
  const totalFeesUsd = currentSnapshot.feesCollectedUsd;

  // Calculate total rewards (e.g., xSUI)
  const totalRewardsUsd = currentSnapshot.rewardsCollected
    ? currentSnapshot.rewardsCollected.reduce((sum, r) => sum + r.usdValue, 0)
    : 0;

  // HODL calculation - what initial tokens would be worth at current prices
  const initialTokenAAmount = parseFloat(initialSnapshot.tokenAAmount);
  const initialTokenBAmount = parseFloat(initialSnapshot.tokenBAmount);
  const hodlValue =
    initialTokenAAmount * currentSnapshot.tokenAPrice +
    initialTokenBAmount * currentSnapshot.tokenBPrice;

  // Current position value (tokens only, excluding fees/rewards)
  const currentTokenAAmount = parseFloat(currentSnapshot.tokenAAmount);
  const currentTokenBAmount = parseFloat(currentSnapshot.tokenBAmount);
  const positionValue =
    currentTokenAAmount * currentSnapshot.tokenAPrice +
    currentTokenBAmount * currentSnapshot.tokenBPrice;

  // Impermanent Loss (Divergence Loss) = HODL value - Position value
  // Positive = lost value from rebalancing (bad)
  // Negative = gained value from rebalancing (good - rare)
  const totalDivergenceLoss = hodlValue - positionValue;
  const divergenceLossPercent = hodlValue > 0
    ? (totalDivergenceLoss / hodlValue) * 100
    : 0;

  // Net PnL = Fees + Rewards - IL (if IL is positive, it reduces net PnL)
  const netPnl = totalFeesUsd + totalRewardsUsd - Math.max(0, totalDivergenceLoss);
  const netPnlPercent = hodlValue > 0
    ? (netPnl / hodlValue) * 100
    : 0;

  // LP Value includes position value + fees + rewards
  const lpValue = positionValue + totalFeesUsd + totalRewardsUsd;
  const vsHodlPercent = hodlValue > 0 ? ((lpValue - hodlValue) / hodlValue) * 100 : 0;

  // Time in range (only count snapshots that have position data)
  const snapshotsWithPosition = history.filter((s) => s.hasPosition && s.isInRange !== undefined);
  const inRangeSnapshots = snapshotsWithPosition.filter((s) => s.isInRange).length;
  const avgTimeInRange = snapshotsWithPosition.length > 0
    ? (inRangeSnapshots / snapshotsWithPosition.length) * 100
    : 0;

  // Time active
  const totalTimeActive = currentSnapshot.timestamp - initialSnapshot.timestamp;

  // Cycles
  const numberOfCycles = currentSnapshot.cycleNumber;
  const avgFeesPerCycle = numberOfCycles > 0 ? totalFeesUsd / numberOfCycles : 0;

  // Range stats
  const ranges = history.map((s) => {
    if (s.tickLower !== undefined && s.tickUpper !== undefined) {
      return Math.abs(s.tickUpper - s.tickLower);
    }
    return 0;
  }).filter((r) => r > 0);
  const avgRangeWidth = ranges.length > 0
    ? ranges.reduce((sum, r) => sum + r, 0) / ranges.length
    : 0;
  // Range changes = number of times we opened a new position with different range
  // Should be at least 0 (not negative)
  const rangeChanges = Math.max(0, ranges.length - 1);

  // Max drawdown
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let peak = initialSnapshot.totalValueUsd;
  for (const snapshot of history) {
    if (snapshot.totalValueUsd > peak) {
      peak = snapshot.totalValueUsd;
    }
    const drawdown = peak - snapshot.totalValueUsd;
    const drawdownPercent = peak > 0 ? (drawdown / peak) * 100 : 0;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = drawdownPercent;
    }
  }

  // Gas costs - use actual if available, otherwise estimate
  let gasCostUsd: number;

  if (actualGasCostSui !== undefined && actualGasCostSui >= 0) {
    // Use actual gas cost from transaction effects
    const suiPrice = getSuiPrice();
    gasCostUsd = actualGasCostSui * suiPrice;
    console.log(`[Performance] Actual gas: ${actualGasCostSui.toFixed(6)} SUI × $${suiPrice} = $${gasCostUsd.toFixed(4)}`);
  } else {
    // Fall back to estimate
    // Per cycle: ~0.025 SUI (open + close + compound + deposit leftover)
    const suiPrice = getSuiPrice();
    const gasPerCycle = 0.025 * suiPrice; // ~$0.039 per cycle at $1.56/SUI
    gasCostUsd = numberOfCycles * gasPerCycle;
    console.log(`[Performance] Estimated gas: ${numberOfCycles} cycles × ${gasPerCycle.toFixed(4)} = $${gasCostUsd.toFixed(4)}`);
  }

  const netAfterGas = netPnl - gasCostUsd;

  // ZAP cost calculation
  let totalZapCostUsd = 0;
  let zapRebalanceCount = 0;
  let nonZapRebalanceCount = 0;
  let avgZapCostPerRebalance = 0;

  if (zapRebalanceEvents && zapRebalanceEvents.length > 0) {
    // Determine decimals based on token symbol (default to 9 for SUI tokens)
    const getDecimals = (symbol: string) => {
      if (['USDC', 'USDT'].includes(symbol)) return 6;
      return 9; // Default for SUI and most other tokens
    };

    const zapCosts = calculateZapCosts({
      positionValueUsd: positionValue,
      zapRebalanceEvents,
      tokenASymbol: currentSnapshot.tokenASymbol,
      tokenBSymbol: currentSnapshot.tokenBSymbol,
      tokenADecimals: getDecimals(currentSnapshot.tokenASymbol),
      tokenBDecimals: getDecimals(currentSnapshot.tokenBSymbol),
      tokenAPrice: currentSnapshot.tokenAPrice,
      tokenBPrice: currentSnapshot.tokenBPrice,
    });
    totalZapCostUsd = zapCosts.totalZapCostUsd;
    zapRebalanceCount = zapCosts.zapRebalanceCount;
    nonZapRebalanceCount = zapCosts.nonZapRebalanceCount;
    avgZapCostPerRebalance = zapCosts.avgZapCostPerRebalance;
  }

  const netAfterZap = netAfterGas - totalZapCostUsd;

  // APY calculation
  const daysActive = totalTimeActive / (1000 * 60 * 60 * 24);
  const annualizedReturn = daysActive > 0
    ? (totalPnlPercent / daysActive) * 365
    : 0;
  const currentApy = annualizedReturn;

  return {
    totalPnl,
    totalPnlPercent,
    totalFeesUsd,
    totalRewardsUsd,
    totalDivergenceLoss,
    divergenceLossPercent,
    netPnl,
    netPnlPercent,
    hodlValue,
    lpValue,
    vsHodlPercent,
    numberOfCycles,
    avgTimeInRange,
    totalTimeActive,
    avgFeesPerCycle,
    rangeChanges,
    avgRangeWidth,
    maxDrawdown,
    maxDrawdownPercent,
    sharpeRatio: undefined, // TODO: Calculate Sharpe ratio
    estimatedGasCostUsd: gasCostUsd,
    netAfterGas,
    // ZAP metrics
    totalZapCostUsd,
    zapRebalanceCount,
    nonZapRebalanceCount,
    avgZapCostPerRebalance,
    netAfterZap,
    annualizedReturn,
    currentApy,
  };
}

// ============ Portfolio Summary ============

export function getPortfolioSummary(): PortfolioSummary {
  const performances = getAllVaultPerformances();

  const totalVaults = performances.length;
  const activeVaults = performances.filter((p) => p.currentSnapshot.hasPosition).length;
  const totalValueUsd = performances.reduce((sum, p) => sum + p.currentSnapshot.totalValueUsd, 0);

  const totalPnl = performances.reduce((sum, p) => sum + p.metrics.totalPnl, 0);
  const totalPnlPercent = totalValueUsd > 0
    ? (totalPnl / totalValueUsd) * 100
    : 0;
  const totalFeesUsd = performances.reduce((sum, p) => sum + p.metrics.totalFeesUsd, 0);
  const totalDivergenceLoss = performances.reduce((sum, p) => sum + p.metrics.totalDivergenceLoss, 0);

  // Best/worst performers
  let bestPerformer = { vaultId: '', pnlPercent: -Infinity };
  let worstPerformer = { vaultId: '', pnlPercent: Infinity };
  for (const perf of performances) {
    if (perf.metrics.totalPnlPercent > bestPerformer.pnlPercent) {
      bestPerformer = {
        vaultId: perf.vaultId,
        pnlPercent: perf.metrics.totalPnlPercent,
      };
    }
    if (perf.metrics.totalPnlPercent < worstPerformer.pnlPercent) {
      worstPerformer = {
        vaultId: perf.vaultId,
        pnlPercent: perf.metrics.totalPnlPercent,
      };
    }
  }

  // By strategy
  const byStrategy: PortfolioSummary['byStrategy'] = {};
  for (const perf of performances) {
    const strategy = perf.strategyType;
    if (!byStrategy[strategy]) {
      byStrategy[strategy] = {
        vaultCount: 0,
        totalValueUsd: 0,
        avgPnlPercent: 0,
        totalFeesUsd: 0,
      };
    }
    byStrategy[strategy].vaultCount++;
    byStrategy[strategy].totalValueUsd += perf.currentSnapshot.totalValueUsd;
    byStrategy[strategy].avgPnlPercent += perf.metrics.totalPnlPercent;
    byStrategy[strategy].totalFeesUsd += perf.metrics.totalFeesUsd;
  }

  // Average PnL per strategy
  for (const strategy in byStrategy) {
    byStrategy[strategy].avgPnlPercent /= byStrategy[strategy].vaultCount;
  }

  return {
    totalVaults,
    activeVaults,
    totalValueUsd,
    totalPnl,
    totalPnlPercent,
    totalFeesUsd,
    totalDivergenceLoss,
    bestPerformer,
    worstPerformer,
    byStrategy,
  };
}

// ============ Comparison ============

export function comparePerformance(vaultId: string): PerformanceComparison | null {
  const performance = getVaultPerformance(vaultId);
  if (!performance) return null;

  const { initialSnapshot, currentSnapshot } = performance;

  const tokenADelta = (
    parseFloat(currentSnapshot.tokenAAmount) -
    parseFloat(initialSnapshot.tokenAAmount)
  ).toString();
  const tokenBDelta = (
    parseFloat(currentSnapshot.tokenBAmount) -
    parseFloat(initialSnapshot.tokenBAmount)
  ).toString();

  const tokenADeltaPercent =
    parseFloat(initialSnapshot.tokenAAmount) > 0
      ? (parseFloat(tokenADelta) / parseFloat(initialSnapshot.tokenAAmount)) * 100
      : 0;
  const tokenBDeltaPercent =
    parseFloat(initialSnapshot.tokenBAmount) > 0
      ? (parseFloat(tokenBDelta) / parseFloat(initialSnapshot.tokenBAmount)) * 100
      : 0;

  const valueDelta = currentSnapshot.totalValueUsd - initialSnapshot.totalValueUsd;
  const valueDeltaPercent =
    initialSnapshot.totalValueUsd > 0
      ? (valueDelta / initialSnapshot.totalValueUsd) * 100
      : 0;

  const timeElapsed = currentSnapshot.timestamp - initialSnapshot.timestamp;

  return {
    vaultId,
    strategyType: performance.strategyType,
    before: {
      timestamp: initialSnapshot.timestamp,
      tokenAAmount: initialSnapshot.tokenAAmount,
      tokenBAmount: initialSnapshot.tokenBAmount,
      totalValueUsd: initialSnapshot.totalValueUsd,
    },
    current: {
      timestamp: currentSnapshot.timestamp,
      tokenAAmount: currentSnapshot.tokenAAmount,
      tokenBAmount: currentSnapshot.tokenBAmount,
      totalValueUsd: currentSnapshot.totalValueUsd,
    },
    changes: {
      tokenADelta,
      tokenBDelta,
      tokenADeltaPercent,
      tokenBDeltaPercent,
      valueDelta,
      valueDeltaPercent,
      timeElapsed,
    },
    whatIf: {
      hodl: {
        currentValue: performance.metrics.hodlValue,
        pnlVsStrategy: performance.metrics.vsHodlPercent,
      },
      wideRange: {
        estimatedValue: initialSnapshot.totalValueUsd * 1.05, // Rough estimate
        pnlVsStrategy: -5, // Rough estimate
      },
    },
  };
}
