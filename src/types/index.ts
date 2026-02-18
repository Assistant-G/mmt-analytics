export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
}

export interface Pool {
  id: string;
  address: string;
  tokenA: Token;
  tokenB: Token;
  fee: number;
  tickSpacing: number;
  liquidity: string;
  sqrtPrice: string;
  currentTick: number;
  tvlUsd: number;
  volume24h: number;
  volume7d: number;
  fees24h: number;
  fees7d: number;
  apr: number;
  feeApr: number;
  rewardApr: number;
  priceTokenA: number;
  priceTokenB: number;
  priceChange24h: number;
  createdAt: string;
}

export interface Position {
  id: string;
  owner: string;
  poolId: string;
  pool: Pool;
  // Token types for Exit transaction
  tokenXType?: string;
  tokenYType?: string;
  // Full position type from blockchain (exact type for Exit)
  positionType?: string;
  liquidity: string;
  tickLower: number;
  tickUpper: number;
  priceLower: number;
  priceUpper: number;
  tokenAAmount: string;
  tokenBAmount: string;
  tokenAAmountUsd: number;
  tokenBAmountUsd: number;
  totalValueUsd: number;
  uncollectedFeesA: string;
  uncollectedFeesB: string;
  uncollectedFeesUsd: number;
  claimableRewardsUsd: number; // xSUI rewards only (not including fees)
  depositedTokenA: string;
  depositedTokenB: string;
  depositedValueUsd: number;
  withdrawnTokenA: string;
  withdrawnTokenB: string;
  withdrawnValueUsd: number;
  pnl: number;
  pnlPercent: number;
  divergencePnl: number;
  feePnl: number;
  roi: number;
  apr: number;
  feeApr: number;
  rangeUtilization: number;
  isInRange: boolean;
  createdAt: string;
  lastUpdated: string;
}

export interface PositionHistory {
  timestamp: string;
  valueUsd: number;
  pnl: number;
  feesCollected: number;
}

export interface VolumeData {
  timestamp: string;
  volume: number;
  fees: number;
}

export interface PriceData {
  timestamp: string;
  price: number;
  priceLower?: number;
  priceUpper?: number;
}

export interface LiquidityData {
  tick: number;
  liquidityNet: string;
  price: number;
}

export interface PoolStats {
  poolId: string;
  tvl: number;
  volume24h: number;
  volume7d: number;
  fees24h: number;
  fees7d: number;
  apr: number;
  txCount24h: number;
  uniqueTraders24h: number;
}

export interface LeaderboardEntry {
  rank: number;
  address: string;
  positionId: string;
  pool: Pool;
  totalPnl: number;
  pnlPercent: number;
  totalValue: number;
  apr: number;
  feesEarned: number;
  daysActive: number;
  strategy?: string;
}

export interface WalletState {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  balance?: string;
  walletName?: string;
}

export interface SearchFilters {
  query: string;
  minTvl?: number;
  maxTvl?: number;
  minApr?: number;
  maxApr?: number;
  minVolume?: number;
  tokens?: string[];
  sortBy: 'tvl' | 'apr' | 'volume' | 'fees';
  sortOrder: 'asc' | 'desc';
}

export interface TimeRange {
  label: string;
  value: '1D' | '7D' | '30D' | '90D' | 'ALL';
  days: number;
}

export interface ChartConfig {
  showPrice: boolean;
  showVolume: boolean;
  showLiquidity: boolean;
  showRange: boolean;
  timeRange: TimeRange;
}

// Auto-close timer (in seconds, null means no timer)
export type TimerDuration = number | null;

// Timer unit options
export type TimerUnit = 'sec' | 'min' | 'hour' | 'day';

export interface TimerUnitOption {
  label: string;
  value: TimerUnit;
  multiplier: number; // multiplier to convert to seconds
}

export const TIMER_UNITS: TimerUnitOption[] = [
  { label: 'Seconds', value: 'sec', multiplier: 1 },
  { label: 'Minutes', value: 'min', multiplier: 60 },
  { label: 'Hours', value: 'hour', multiplier: 3600 },
  { label: 'Days', value: 'day', multiplier: 86400 },
];

// Quick preset options
export interface TimerPreset {
  label: string;
  seconds: number | null;
}

export const TIMER_PRESETS: TimerPreset[] = [
  { label: 'No Timer', seconds: null },
  { label: '30 sec', seconds: 30 },
  { label: '1 min', seconds: 60 },
  { label: '5 min', seconds: 300 },
  { label: '1 hour', seconds: 3600 },
  { label: 'Custom', seconds: -1 }, // -1 indicates custom input mode
];

// Auto-close method options
// 'escrow' = deposit position to on-chain escrow, backend executes close (works offline)
export type AutoCloseMethod = 'privateKey' | 'preSigned' | 'escrow';

// Repeat count: number of times to repeat open-close cycle, or 'infinite'
export type RepeatCount = number | 'infinite';

export interface AutoCloseSettings {
  method: AutoCloseMethod;
  privateKey: string | null;
  repeatCount: RepeatCount; // How many times to repeat (0 = no repeat, 'infinite' = forever)
}

// Pre-signed transaction data
export interface PreSignedTransaction {
  positionId: string;
  transactionBytes: string; // base64 encoded
  signature: string;
}

// Parameters needed to recreate a position
export interface PositionParams {
  poolId: string;
  amountA: string;
  amountB: string;
  rangePercent: number; // Store percentage instead of ticks for recalculation
  slippage: number;
  decimalsA: number;
  decimalsB: number;
  tickSpacing: number;
}

export interface ActivePosition {
  positionId: string;
  poolId: string;
  liquidity: string;
  walletAddress: string;
  expiresAt: number; // Unix timestamp
  timerDuration: TimerDuration;
  preSignedTx?: PreSignedTransaction; // For preSigned method
  // For repeat functionality
  positionParams?: PositionParams; // Original position parameters for reopening
  remainingRepeats?: RepeatCount; // How many repeats left
  // For escrow method
  escrowId?: string; // The escrow object ID if deposited to escrow
  isInEscrow?: boolean; // Whether position is currently in escrow
}

// ============ LP Registry Types ============

export interface LPRegistryPosition {
  id: string; // RegisteredPosition object ID
  positionId: string; // MMT Position ID stored inside
  owner: string;
  poolId: string;
  pool?: Pool;
  tokenXType: string;
  tokenYType: string;
  // Full position type from blockchain (exact type for Exit transaction)
  positionType?: string;

  // Feature toggles
  autoRebalance: boolean;
  autoCompound: boolean;
  recurringCount: number; // 0 = infinite

  // Rebalance settings
  rebalanceDelayMs: number; // Wait before rebalancing (ms)
  rangePercentBps: number; // Range width in basis points (500 = 5%)
  useZap: boolean; // Swap excess tokens to use ALL liquidity

  // State
  isPaused: boolean;
  isPositionHeld: boolean; // Currently being operated on
  rebalancePending: boolean;
  outOfRangeSince: number; // Timestamp when went out of range

  // Stats
  rebalanceCount: number;
  compoundCount: number;
  registeredAt: number;
  lastActivityAt: number;

  // Position data (if available)
  tickLower?: number;
  tickUpper?: number;
  currentTick?: number;
  liquidity?: string;
  isInRange?: boolean;
  totalValueUsd?: number;
}

export interface LPRegistrySettings {
  autoRebalance: boolean;
  autoCompound: boolean;
  recurringCount: number; // 0 = infinite, N = N times
  rebalanceDelayMs: number;
  rangePercentBps: number;
  useZap: boolean; // Swap excess tokens to use ALL liquidity
}

// Delay unit type for LP Registry
export type DelayUnit = 's' | 'm' | 'h';

export interface DelayUnitOption {
  label: string;
  value: DelayUnit;
  multiplierMs: number; // multiplier to convert to milliseconds
}

export const DELAY_UNITS: DelayUnitOption[] = [
  { label: 'Seconds', value: 's', multiplierMs: 1000 },
  { label: 'Minutes', value: 'm', multiplierMs: 60000 },
  { label: 'Hours', value: 'h', multiplierMs: 3600000 },
];
