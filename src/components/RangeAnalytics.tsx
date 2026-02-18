import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSuiClient } from '@mysten/dapp-kit';
import {
  Target,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Zap,
  RefreshCw,
  Activity,
  DollarSign,
  Percent,
  ArrowUpRight,
  Bell,
  BarChart3,
  ChevronRight,
  Info,
  Database,
  Wifi,
  WifiOff,
  Settings,
  GripVertical,
  Eye,
  EyeOff,
  X
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { useWallet } from '@/contexts/WalletContext';
import { fetchPoolsData, fetchPositions, getPoolById } from '@/services/mmtService';
import { VAULT_CONFIG } from '@/services/vaultService';
import { getAllVaultPerformances } from '@/services/performanceService';
import type { VaultPerformance } from '@/types/performance';
import { Vault } from 'lucide-react';

// Persistent timestamp storage (separate from cycles, survives localStorage clear of cycles)
const POSITION_TIMESTAMPS_KEY = 'mmt-position-timestamps';

function getStoredTimestamps(): Record<string, number> {
  try {
    const stored = localStorage.getItem(POSITION_TIMESTAMPS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveTimestamp(positionId: string, timestamp: number): void {
  try {
    const timestamps = getStoredTimestamps();
    timestamps[positionId] = timestamp;
    localStorage.setItem(POSITION_TIMESTAMPS_KEY, JSON.stringify(timestamps));
  } catch (error) {
    console.error('Error saving timestamp:', error);
  }
}
import {
  fetchPriceHistory,
  fetchHistoricalPrice,
  calculateVolatility,
  calculateOptimalRangeWidth,
  calculateImpermanentLoss,
  getPositionCycles,
  trackPositionOpen,
  trackPositionClose,
  updatePositionCycleEarnings,
  updatePositionEntryPrice,
  getCycleStatistics,
  checkPriceAlerts,
  createPriceAlert,
  type PriceHistoryPoint,
  type VolatilityData,
  type PositionCycle
} from '@/services/priceService';
import { formatCurrency } from '@/utils';
import type { Pool, Position } from '@/types';

// Format IL with appropriate precision for small values
function formatIL(il: number): string {
  if (il === 0) return '0.00';
  if (il >= 0.01) return il.toFixed(2);
  if (il >= 0.001) return il.toFixed(3);
  return il.toFixed(4);
}

// Column configuration for Position Cycle History table
const COLUMN_CONFIG_KEY = 'mmt-cycle-table-columns';
const SHOW_TOTALS_KEY = 'mmt-cycle-table-show-totals';

interface ColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  order: number;
  width?: string;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'pool', label: 'Pool', visible: true, order: 0 },
  { id: 'range', label: 'Range', visible: true, order: 1 },
  { id: 'pooled', label: 'Pooled $', visible: true, order: 2 },
  { id: 'opened', label: 'Opened', visible: true, order: 3 },
  { id: 'entryPrice', label: 'Entry Price', visible: true, order: 4 },
  { id: 'status', label: 'Status', visible: true, order: 5 },
  { id: 'duration', label: 'Duration', visible: true, order: 6 },
  { id: 'fees', label: 'Fees', visible: true, order: 7 },
  { id: 'rewards', label: 'Rewards', visible: true, order: 8 },
  { id: 'estIL', label: 'Est. IL', visible: true, order: 9 },
  { id: 'netPnl', label: 'Net P&L', visible: true, order: 10 },
  { id: 'roi', label: 'ROI', visible: false, order: 11 },
  { id: 'volume', label: 'Volume 24h', visible: false, order: 12 },
  { id: 'tvl', label: 'TVL', visible: false, order: 13 },
  { id: 'apr', label: 'APR', visible: false, order: 14 },
  { id: 'dailyEarnings', label: 'Daily Earnings', visible: false, order: 15 },
  { id: 'breakeven', label: 'Break-even', visible: false, order: 16 },
  { id: 'volatility', label: 'Volatility', visible: false, order: 17 },
  { id: 'earnings', label: 'Earnings', visible: false, order: 18 },
  { id: 'priceRange', label: 'Price Range', visible: false, order: 19 },
  { id: 'pnlHodl', label: 'PnL (HODL)', visible: false, order: 20 },
  { id: 'roiHodl', label: 'ROI (HODL)', visible: false, order: 21 },
];

function loadColumnConfig(): ColumnConfig[] {
  try {
    const stored = localStorage.getItem(COLUMN_CONFIG_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle new columns
      const configMap = new Map(parsed.map((c: ColumnConfig) => [c.id, c]));
      return DEFAULT_COLUMNS.map(col => ({
        ...col,
        ...(configMap.get(col.id) || {}),
      })).sort((a, b) => a.order - b.order);
    }
  } catch {}
  return [...DEFAULT_COLUMNS];
}

function saveColumnConfig(config: ColumnConfig[]): void {
  try {
    localStorage.setItem(COLUMN_CONFIG_KEY, JSON.stringify(config));
  } catch {}
}

function loadShowTotals(): boolean {
  try {
    const stored = localStorage.getItem(SHOW_TOTALS_KEY);
    return stored !== null ? JSON.parse(stored) : true; // Default to showing totals
  } catch {
    return true;
  }
}

function saveShowTotals(show: boolean): void {
  try {
    localStorage.setItem(SHOW_TOTALS_KEY, JSON.stringify(show));
  } catch {}
}

interface RangeRecommendation {
  pool: Pool;
  volatility: VolatilityData;
  optimalRange: { narrow: number; optimal: number; wide: number };
  recommendedStrategy: string;
  expectedApr: number;
  riskLevel: 'low' | 'medium' | 'high';
  priceHistory: PriceHistoryPoint[];
  dataSource: 'live' | 'cached' | 'fallback';
}

interface PositionAlert {
  position: Position;
  alertType: 'boundary' | 'il' | 'opportunity';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  action: string;
}

// Position type filter storage
const POSITION_TYPE_FILTER_KEY = 'mmt-position-type-filter';

function loadPositionTypeFilter(): 'all' | 'lp' | 'vault' {
  try {
    const stored = localStorage.getItem(POSITION_TYPE_FILTER_KEY);
    if (stored === 'lp' || stored === 'vault' || stored === 'all') return stored;
  } catch {}
  return 'all';
}

function savePositionTypeFilter(filter: 'all' | 'lp' | 'vault'): void {
  try {
    localStorage.setItem(POSITION_TYPE_FILTER_KEY, filter);
  } catch {}
}

// Unified cycle data type for both LP and Vault positions
interface UnifiedCycleData {
  id: string;
  positionId: string;
  poolId: string;
  poolName: string;
  type: 'lp' | 'vault';
  status: 'open' | 'closed';
  openTimestamp: number;
  closeTimestamp: number | null;
  openValueUsd: number;
  currentValueUsd: number;
  feesEarnedUsd: number;
  rewardsEarnedUsd: number;
  estimatedIL: number;
  netPnl: number | null;
  priceLower?: number;
  priceUpper?: number;
  entryPrice?: number;
  currentPrice?: number;
  cyclesCompleted?: number;
  isInRange?: boolean;
}

export function RangeAnalytics() {
  const { address, isConnected } = useWallet();
  const suiClient = useSuiClient();
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [dataStatus, setDataStatus] = useState<'live' | 'cached' | 'offline'>('live');
  const [positionTimestamps, setPositionTimestamps] = useState<Record<string, number>>(getStoredTimestamps);

  // Position type filter (LP, Vault, or Both)
  const [positionTypeFilter, setPositionTypeFilter] = useState<'all' | 'lp' | 'vault'>(loadPositionTypeFilter);

  // Chart legend toggles
  const [chartVisibility, setChartVisibility] = useState({
    rewards: true,
    fees: true,
    il: true,
  });

  const toggleChartSeries = (series: 'rewards' | 'fees' | 'il') => {
    setChartVisibility(prev => ({ ...prev, [series]: !prev[series] }));
  };

  // Column configuration state
  const [columnConfig, setColumnConfig] = useState<ColumnConfig[]>(loadColumnConfig);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [showTotalsRow, setShowTotalsRow] = useState(loadShowTotals);

  const toggleTotalsRow = () => {
    setShowTotalsRow(prev => {
      const newValue = !prev;
      saveShowTotals(newValue);
      return newValue;
    });
  };

  const toggleColumnVisibility = (columnId: string) => {
    setColumnConfig(prev => {
      const updated = prev.map(col =>
        col.id === columnId ? { ...col, visible: !col.visible } : col
      );
      saveColumnConfig(updated);
      return updated;
    });
  };

  const visibleColumns = useMemo(() =>
    columnConfig.filter(col => col.visible).sort((a, b) => a.order - b.order),
    [columnConfig]
  );

  // Fetch position creation timestamp from blockchain
  const fetchPositionTimestamp = useCallback(async (positionId: string): Promise<number> => {
    // Check cache first
    const cached = positionTimestamps[positionId];
    if (cached) return cached;

    try {
      // Get the position object to find its creation transaction
      const objectData = await suiClient.getObject({
        id: positionId,
        options: { showPreviousTransaction: true }
      });

      const previousTx = objectData.data?.previousTransaction;
      if (!previousTx) return Date.now();

      // Get the transaction block to get its timestamp
      const txBlock = await suiClient.getTransactionBlock({
        digest: previousTx,
        options: { showInput: true }
      });

      if (txBlock.timestampMs) {
        const timestamp = parseInt(txBlock.timestampMs);
        // Save to persistent storage
        saveTimestamp(positionId, timestamp);
        setPositionTimestamps(prev => ({ ...prev, [positionId]: timestamp }));
        return timestamp;
      }

      return Date.now();
    } catch (error) {
      console.warn(`Failed to fetch timestamp for ${positionId}:`, error);
      return Date.now();
    }
  }, [suiClient, positionTimestamps]);

  const { data: pools, isLoading: poolsLoading } = useQuery({
    queryKey: ['pools'],
    queryFn: fetchPoolsData,
    staleTime: 60000,
  });

  const { data: positions, isLoading: positionsLoading } = useQuery({
    queryKey: ['positions', address],
    queryFn: () => fetchPositions(address!),
    enabled: !!address,
    staleTime: 30000,
  });

  // Fetch vault data for analytics
  interface VaultDataWithPool {
    vaultId: string;
    poolId: string;
    poolName: string;
    hasPosition: boolean;
    isActive: boolean;
    cyclesCompleted: number;
    openTimestamp: number;
    totalValueUsd: number;
    feesEarnedUsd: number;
    rewardsEarnedUsd: number;
    estimatedIL: number;
    tickLower?: number;
    tickUpper?: number;
    currentTick?: number;
    isInRange?: boolean;
    tokenASymbol: string;
    tokenBSymbol: string;
    tokenADecimals: number;
    tokenBDecimals: number;
    priceLower?: number;
    priceUpper?: number;
    currentPrice?: number;
    performance?: VaultPerformance;
  }

  const { data: vaultsData, isLoading: vaultsLoading } = useQuery<VaultDataWithPool[]>({
    queryKey: ['vaults-analytics', address],
    queryFn: async (): Promise<VaultDataWithPool[]> => {
      if (!address || !VAULT_CONFIG.isDeployed) return [];

      // Query VaultCreated events to find user's vaults
      const events = await suiClient.queryEvents({
        query: {
          MoveEventType: `${VAULT_CONFIG.packageId}::cycling_vault::VaultCreated`,
        },
        limit: 50,
      });

      const vaultDataList: VaultDataWithPool[] = [];

      for (const event of events.data) {
        const parsedJson = event.parsedJson as any;
        if (parsedJson.owner !== address) continue;

        const vaultId = parsedJson.vault_id;

        try {
          const vaultObj = await suiClient.getObject({
            id: vaultId,
            options: { showContent: true },
          });

          if (vaultObj.data?.content?.dataType !== 'moveObject') continue;

          const fields = (vaultObj.data.content as any).fields;
          const vaultType = vaultObj.data.content.type;

          // Extract token types
          const typeMatch = vaultType.match(/<(.+),\s*(.+)>/);
          const tokenXType = typeMatch ? typeMatch[1].trim() : '';
          const tokenYType = typeMatch ? typeMatch[2].trim() : '';

          const getBalanceValue = (field: unknown): string => {
            if (typeof field === 'string') return field;
            if (typeof field === 'number') return String(field);
            if (field && typeof field === 'object') {
              const obj = field as any;
              return String(obj.fields?.value || obj.value || '0');
            }
            return '0';
          };

          const balanceX = getBalanceValue(fields.balance_x);
          const balanceY = getBalanceValue(fields.balance_y);
          const feesX = getBalanceValue(fields.fees_x);
          const feesY = getBalanceValue(fields.fees_y);

          // Skip empty vaults
          const hasBalance = BigInt(balanceX) > 0 || BigInt(balanceY) > 0;
          const hasFees = BigInt(feesX) > 0 || BigInt(feesY) > 0;
          const hasPosition = fields.has_position;

          if (!hasBalance && !hasFees && !hasPosition) continue;

          // Get token symbols and decimals
          const getTokenSymbol = (type: string) => {
            if (type.includes('::sui::SUI')) return 'SUI';
            if (type.includes('::usdc::USDC')) return 'USDC';
            if (type.includes('::usdt::USDT')) return 'USDT';
            const parts = type.split('::');
            return parts[parts.length - 1] || 'TOKEN';
          };

          const getTokenDecimals = (type: string) => {
            if (type.includes('::usdc::USDC') || type.includes('::usdt::USDT')) return 6;
            return 9;
          };

          const tokenASymbol = getTokenSymbol(tokenXType);
          const tokenBSymbol = getTokenSymbol(tokenYType);
          const tokenADecimals = getTokenDecimals(tokenXType);
          const tokenBDecimals = getTokenDecimals(tokenYType);

          // Get pool info for current price
          let currentTick: number | undefined;
          let isInRange = true;
          let tickLower: number | undefined;
          let tickUpper: number | undefined;

          const pool = await getPoolById(fields.pool_id as string).catch(() => null);

          if (hasPosition) {
            // Get position ticks from dynamic field
            const dynamicFields = await suiClient.getDynamicFields({ parentId: vaultId });
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

                // Handle i32 format for tick indices
                const tickLowerField = posValue.tick_lower_index;
                const tickUpperField = posValue.tick_upper_index;
                let lowerTick = tickLowerField?.fields?.bits ? Number(tickLowerField.fields.bits) : Number(posValue.tick_lower_index || 0);
                let upperTick = tickUpperField?.fields?.bits ? Number(tickUpperField.fields.bits) : Number(posValue.tick_upper_index || 0);

                // Convert from unsigned to signed
                const MAX_I32 = 2147483647;
                const OVERFLOW = 4294967296;
                if (lowerTick > MAX_I32) lowerTick = lowerTick - OVERFLOW;
                if (upperTick > MAX_I32) upperTick = upperTick - OVERFLOW;

                tickLower = lowerTick;
                tickUpper = upperTick;
              }
            }

            if (pool) {
              currentTick = pool.currentTick;
              if (tickLower !== undefined && tickUpper !== undefined) {
                isInRange = currentTick >= tickLower && currentTick <= tickUpper;
              }
            }
          }

          // Get performance data
          const performance = getAllVaultPerformances().find(p => p.vaultId === vaultId);

          // Get current price from pool (price of tokenA in terms of tokenB)
          // For SUI/USDC, this is SUI price in USDC
          const currentPrice = pool?.priceTokenB || 0;

          // Calculate price range using tick-to-price formula with decimal adjustment
          // Price = 1.0001^tick * 10^(decimalsX - decimalsY)
          const decimalAdjustment = Math.pow(10, tokenADecimals - tokenBDecimals);
          const priceLower = tickLower !== undefined
            ? Math.pow(1.0001, tickLower) * decimalAdjustment
            : undefined;
          const priceUpper = tickUpper !== undefined
            ? Math.pow(1.0001, tickUpper) * decimalAdjustment
            : undefined;

          // Calculate USD values - use pool price for token A (e.g., SUI)
          const tokenAPrice = currentPrice; // Price of tokenA in terms of tokenB (USD for stables)
          const tokenBPrice = 1; // Assume tokenB is a stablecoin

          const balanceAUsd = (Number(balanceX) / Math.pow(10, tokenADecimals)) * tokenAPrice;
          const balanceBUsd = (Number(balanceY) / Math.pow(10, tokenBDecimals)) * tokenBPrice;
          const feesAUsd = (Number(feesX) / Math.pow(10, tokenADecimals)) * tokenAPrice;
          const feesBUsd = (Number(feesY) / Math.pow(10, tokenBDecimals)) * tokenBPrice;

          // Calculate total value - use initial deposit for active positions
          // When position is open, balances are just leftover, not the actual LP value
          let totalValueUsd = 0;
          if (hasPosition && performance?.initialSnapshot) {
            // For active positions, use the initial deposit value
            // This represents what's actually deployed in the LP
            totalValueUsd = performance.initialSnapshot.totalValueUsd || 0;
          } else if (hasPosition) {
            // Fallback: Query VaultDeposit event directly for new vaults without performance data
            try {
              const depositEvents = await suiClient.queryEvents({
                query: {
                  MoveEventType: `${VAULT_CONFIG.packageId}::cycling_vault::VaultDeposit`,
                },
                limit: 100,
              });

              const vaultDepositEvent = depositEvents.data.find(
                (e) => (e.parsedJson as any)?.vault_id === vaultId
              );

              if (vaultDepositEvent) {
                const depositData = vaultDepositEvent.parsedJson as any;
                const depositAmountX = Number(depositData.amount_x || 0) / Math.pow(10, tokenADecimals);
                const depositAmountY = Number(depositData.amount_y || 0) / Math.pow(10, tokenBDecimals);
                totalValueUsd = (depositAmountX * tokenAPrice) + (depositAmountY * tokenBPrice);
              } else {
                // No deposit event found, fallback to balances
                totalValueUsd = balanceAUsd + balanceBUsd + feesAUsd + feesBUsd;
              }
            } catch (e) {
              console.warn('Failed to fetch VaultDeposit event for', vaultId, e);
              totalValueUsd = balanceAUsd + balanceBUsd + feesAUsd + feesBUsd;
            }
          } else if (performance?.currentSnapshot.totalValueUsd && performance.currentSnapshot.totalValueUsd > 0) {
            totalValueUsd = performance.currentSnapshot.totalValueUsd;
          } else {
            // Fallback to balances + fees (only accurate when no position)
            totalValueUsd = balanceAUsd + balanceBUsd + feesAUsd + feesBUsd;
          }

          // Calculate fees earned
          const feesEarnedUsd = performance?.metrics.totalFeesUsd ?? (feesAUsd + feesBUsd);

          // Calculate IL - use performance metrics if available
          // divergenceLossPercent is the IL as a percentage (positive = loss)
          let estimatedIL = 0;
          if (performance?.metrics.divergenceLossPercent !== undefined) {
            estimatedIL = performance.metrics.divergenceLossPercent;
          }

          // Get created_at timestamp if available
          const createdAt = fields.created_at ? Number(fields.created_at) : event.timestampMs ? parseInt(event.timestampMs) : Date.now();

          vaultDataList.push({
            vaultId,
            poolId: fields.pool_id,
            poolName: `${tokenASymbol}/${tokenBSymbol}`,
            hasPosition,
            isActive: fields.is_active,
            cyclesCompleted: Number(fields.cycles_completed || 0),
            openTimestamp: createdAt,
            totalValueUsd,
            feesEarnedUsd,
            rewardsEarnedUsd: performance?.metrics.totalRewardsUsd || 0,
            estimatedIL,
            tickLower,
            tickUpper,
            currentTick,
            isInRange,
            tokenASymbol,
            tokenBSymbol,
            tokenADecimals,
            tokenBDecimals,
            priceLower,
            priceUpper,
            currentPrice,
            performance,
          });
        } catch (e) {
          console.warn('Failed to fetch vault data:', vaultId, e);
          continue;
        }
      }

      return vaultDataList;
    },
    enabled: !!address && VAULT_CONFIG.isDeployed,
    staleTime: 30000,
    refetchInterval: 30000,
  });

  // Fetch real price history for pools
  const { data: poolPriceData, isLoading: pricesLoading } = useQuery({
    queryKey: ['poolPrices', pools?.slice(0, 10).map(p => p.id)],
    queryFn: async () => {
      if (!pools) return new Map<string, { history: PriceHistoryPoint[]; volatility: VolatilityData; source: 'live' | 'cached' | 'fallback' }>();

      const priceMap = new Map<string, { history: PriceHistoryPoint[]; volatility: VolatilityData; source: 'live' | 'cached' | 'fallback' }>();

      // Fetch price history for top pools (in parallel with rate limiting)
      const topPools = pools.filter(p => p.tvlUsd > 100000).slice(0, 10);

      for (const pool of topPools) {
        try {
          // Try to get price history for the base token (tokenA)
          const history = await fetchPriceHistory(pool.tokenA.symbol, 30);
          const volatility = calculateVolatility(history);

          // Determine if data is live or fallback
          const isLive = history.length > 0 && history[0].timestamp > Date.now() - 24 * 60 * 60 * 1000;

          priceMap.set(pool.id, {
            history,
            volatility,
            source: isLive ? 'live' : history.length > 10 ? 'cached' : 'fallback'
          });

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          console.error(`Error fetching price for ${pool.tokenA.symbol}:`, error);
        }
      }

      // Update data status
      const sources = Array.from(priceMap.values()).map(v => v.source);
      if (sources.every(s => s === 'live')) {
        setDataStatus('live');
      } else if (sources.some(s => s === 'live' || s === 'cached')) {
        setDataStatus('cached');
      } else {
        setDataStatus('offline');
      }

      return priceMap;
    },
    enabled: !!pools && pools.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });

  // Calculate range recommendations with real data
  const rangeRecommendations = useMemo((): RangeRecommendation[] => {
    if (!pools || !poolPriceData) return [];

    return pools
      .filter(p => p.tvlUsd > 100000 && poolPriceData.has(p.id))
      .slice(0, 10)
      .map(pool => {
        const priceData = poolPriceData.get(pool.id)!;
        const { history, volatility, source } = priceData;

        const optimalRange = calculateOptimalRangeWidth(volatility, pool.feeApr, 'moderate');

        let recommendedStrategy = 'Balanced';
        let riskLevel: 'low' | 'medium' | 'high' = 'medium';

        if (volatility.annualized < 30) {
          recommendedStrategy = 'Tight Range - Low volatility favors concentrated liquidity';
          riskLevel = 'low';
        } else if (volatility.annualized > 80) {
          recommendedStrategy = 'Wide Range - High volatility needs buffer';
          riskLevel = 'high';
        } else {
          recommendedStrategy = 'Optimal Range - Balance between fees and IL risk';
          riskLevel = 'medium';
        }

        // Adjust expected APR based on range tightness
        const rangeMultiplier = optimalRange.optimal < 10 ? 1.5 : optimalRange.optimal < 20 ? 1.2 : 1;

        return {
          pool,
          volatility,
          optimalRange,
          recommendedStrategy,
          expectedApr: pool.apr * rangeMultiplier,
          riskLevel,
          priceHistory: history,
          dataSource: source,
        };
      })
      .sort((a, b) => b.expectedApr - a.expectedApr);
  }, [pools, poolPriceData]);

  // Fetch timestamps for all positions from blockchain (only if not cached)
  useEffect(() => {
    if (!positions || positions.length === 0) return;

    const fetchMissingTimestamps = async () => {
      const storedTimestamps = getStoredTimestamps();

      for (const pos of positions) {
        if (!storedTimestamps[pos.id]) {
          // Fetch from blockchain and store
          await fetchPositionTimestamp(pos.id);
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    };

    fetchMissingTimestamps();
  }, [positions, fetchPositionTimestamp]);

  // Track positions and update cycle data
  useEffect(() => {
    if (!positions || positions.length === 0) return;

    const cycles = getPositionCycles();
    const currentPositionIds = new Set(positions.map(p => p.id));
    const storedTimestamps = getStoredTimestamps();

    // Check for closed positions (positions that were open but no longer exist)
    cycles.forEach(cycle => {
      if (cycle.status === 'open' && !currentPositionIds.has(cycle.positionId)) {
        // Position was closed - mark it
        trackPositionClose(
          cycle.positionId,
          cycle.currentValueUsd || cycle.openValueUsd,
          cycle.feesEarnedUsd,
          cycle.rewardsEarnedUsd,
          cycle.estimatedIL
        );
      }
    });

    positions.forEach(pos => {
      const existingCycle = cycles.find(c => c.positionId === pos.id && c.status === 'open');
      // Use stored blockchain timestamp, fall back to now if not yet fetched
      const openTime = storedTimestamps[pos.id] || Date.now();

      // Get current pool price for IL calculation
      const currentPrice = pos.pool.priceTokenB;

      if (!existingCycle && pos.totalValueUsd > 0) {
        // Track new position with range data, blockchain timestamp, and entry price
        trackPositionOpen(
          pos.id,
          pos.poolId,
          `${pos.pool.tokenA.symbol}/${pos.pool.tokenB.symbol}`,
          pos.totalValueUsd,
          pos.priceLower,
          pos.priceUpper,
          openTime,
          currentPrice // Entry price for IL calculation
        );
      } else if (existingCycle) {
        // Update earnings for existing position with current price for actual IL
        const priceData = poolPriceData?.get(pos.poolId);
        const volatility = priceData?.volatility.weekly || 5;
        const estimatedIL = calculateImpermanentLoss(volatility);

        updatePositionCycleEarnings(
          pos.id,
          pos.uncollectedFeesUsd,
          pos.claimableRewardsUsd, // xSUI rewards only (not including fees)
          estimatedIL,
          pos.totalValueUsd,
          pos.priceLower,
          pos.priceUpper,
          openTime,
          currentPrice // Current price for actual IL calculation
        );
      }

      // Create/update price alerts
      if (alertsEnabled) {
        createPriceAlert(
          pos.id,
          `${pos.pool.tokenA.symbol}/${pos.pool.tokenB.symbol}`,
          pos.priceLower,
          pos.priceUpper,
          pos.pool.priceTokenB,
          5 // Alert at 5% from boundary
        );
      }
    });
  }, [positions, poolPriceData, alertsEnabled]);

  // Fetch historical entry prices for accurate IL calculation
  useEffect(() => {
    if (!positions || positions.length === 0) return;

    const cycles = getPositionCycles();
    const storedTimestamps = getStoredTimestamps();

    const fetchHistoricalEntryPrices = async () => {
      for (const pos of positions) {
        const cycle = cycles.find(c => c.positionId === pos.id && c.status === 'open');
        const timestamp = storedTimestamps[pos.id];

        // Only fetch if:
        // 1. We have a cycle for this position
        // 2. We have a historical timestamp (not current time)
        // 3. The cycle doesn't have a proper entry price yet, or entry price equals current price
        //    (meaning it was set to current price when first tracked)
        if (cycle && timestamp && timestamp < Date.now() - 60000) {
          const hasHistoricalEntryPrice = cycle.entryPrice &&
            cycle.entryPrice !== cycle.currentPrice &&
            Math.abs(cycle.entryPrice - pos.pool.priceTokenB) > 0.001;

          if (!hasHistoricalEntryPrice) {
            // Fetch historical price at position open time
            // For SUI/USDC, we need SUI price in USD
            const tokenSymbol = pos.pool.tokenA.symbol; // Usually SUI
            const historicalPrice = await fetchHistoricalPrice(tokenSymbol, timestamp);

            if (historicalPrice && historicalPrice > 0) {
              updatePositionEntryPrice(pos.id, historicalPrice);
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      }
    };

    fetchHistoricalEntryPrices();
  }, [positions, positionTimestamps]); // Re-run when timestamps are fetched

  // Generate position alerts with real data
  const positionAlerts = useMemo((): PositionAlert[] => {
    if (!positions || !alertsEnabled) return [];

    const alerts: PositionAlert[] = [];

    // Check price alerts (updates localStorage)
    checkPriceAlerts(positions);

    positions.forEach(pos => {
      const currentPrice = pos.pool.priceTokenB;
      const lowerDistance = pos.isInRange ? ((currentPrice - pos.priceLower) / currentPrice) * 100 : 0;
      const upperDistance = pos.isInRange ? ((pos.priceUpper - currentPrice) / currentPrice) * 100 : 0;
      const minDistance = Math.min(lowerDistance, upperDistance);

      // Boundary alerts
      if (!pos.isInRange) {
        alerts.push({
          position: pos,
          alertType: 'boundary',
          severity: 'critical',
          message: `Position is OUT OF RANGE - Not earning fees`,
          action: 'Consider rebalancing or closing position',
        });
      } else if (minDistance < 2) {
        alerts.push({
          position: pos,
          alertType: 'boundary',
          severity: 'critical',
          message: `Price very close to ${lowerDistance < upperDistance ? 'lower' : 'upper'} boundary (${minDistance.toFixed(1)}% away)`,
          action: 'Immediate action may be required',
        });
      } else if (minDistance < 5) {
        alerts.push({
          position: pos,
          alertType: 'boundary',
          severity: 'warning',
          message: `Price approaching ${lowerDistance < upperDistance ? 'lower' : 'upper'} boundary (${minDistance.toFixed(1)}% away)`,
          action: 'Monitor closely or prepare to rebalance',
        });
      }

      // IL alerts using real volatility
      const priceData = poolPriceData?.get(pos.poolId);
      if (priceData) {
        const estimatedIL = calculateImpermanentLoss(priceData.volatility.weekly);
        const ilLossUsd = pos.totalValueUsd * estimatedIL / 100;

        if (ilLossUsd > pos.uncollectedFeesUsd && estimatedIL > 2) {
          alerts.push({
            position: pos,
            alertType: 'il',
            severity: 'warning',
            message: `Estimated IL: ${formatIL(estimatedIL)}% (${formatCurrency(ilLossUsd)})`,
            action: 'Consider collecting fees to offset IL',
          });
        }
      }

    });

    // Calculate total uncollected fees and rewards across ALL positions
    const totalUncollectedFees = positions.reduce((sum, pos) => sum + pos.uncollectedFeesUsd, 0);
    const totalClaimableRewards = positions.reduce((sum, pos) => sum + pos.claimableRewardsUsd, 0);
    const totalClaimable = totalUncollectedFees + totalClaimableRewards;

    // Add a single summary alert for total claimable amount
    if (totalClaimable > 1) { // Show if > $1 total claimable
      // Use the first position as reference for the alert
      const firstPosition = positions[0];
      if (firstPosition) {
        alerts.push({
          position: firstPosition,
          alertType: 'opportunity',
          severity: 'info',
          message: `${formatCurrency(totalUncollectedFees)} fees + ${formatCurrency(totalClaimableRewards)} rewards claimable`,
          action: `Total ${formatCurrency(totalClaimable)} across ${positions.length} position${positions.length > 1 ? 's' : ''}`,
        });
      }
    }

    return alerts.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }, [positions, alertsEnabled, poolPriceData]);

  // Get real cycle data from localStorage and vault data
  const unifiedCycleData = useMemo((): UnifiedCycleData[] => {
    const result: UnifiedCycleData[] = [];

    // Add LP position cycles (if filter includes LP)
    if (positionTypeFilter === 'all' || positionTypeFilter === 'lp') {
      const lpCycles = getPositionCycles();
      lpCycles.forEach(cycle => {
        result.push({
          id: cycle.id,
          positionId: cycle.positionId,
          poolId: cycle.poolId,
          poolName: cycle.poolName,
          type: 'lp',
          status: cycle.status,
          openTimestamp: cycle.openTimestamp,
          closeTimestamp: cycle.closeTimestamp,
          openValueUsd: cycle.openValueUsd,
          currentValueUsd: cycle.currentValueUsd || cycle.openValueUsd,
          feesEarnedUsd: cycle.feesEarnedUsd,
          rewardsEarnedUsd: cycle.rewardsEarnedUsd,
          estimatedIL: cycle.estimatedIL,
          netPnl: cycle.netPnl,
          priceLower: cycle.priceLower,
          priceUpper: cycle.priceUpper,
          entryPrice: cycle.entryPrice,
          currentPrice: cycle.currentPrice,
        });
      });
    }

    // Add vault cycles (if filter includes Vault)
    if ((positionTypeFilter === 'all' || positionTypeFilter === 'vault') && vaultsData) {
      vaultsData.forEach(vault => {
        // Get initial deposit value from performance tracking
        // This is the actual value that was deposited into the LP
        const initialValue = vault.performance?.initialSnapshot.totalValueUsd || vault.totalValueUsd;

        // For active positions, use the initial value as the "current" display value
        // because we can't easily calculate the current CLMM position value
        // The actual current value = initialValue +/- IL + fees + rewards
        const displayValue = vault.hasPosition ? initialValue : vault.totalValueUsd;

        // Calculate net PnL properly
        let netPnl: number | null = null;
        if (vault.performance?.metrics.netPnl !== undefined) {
          netPnl = vault.performance.metrics.netPnl;
        } else {
          // Estimate: fees + rewards - IL loss
          const ilLoss = initialValue * (vault.estimatedIL / 100);
          netPnl = vault.feesEarnedUsd + vault.rewardsEarnedUsd - ilLoss;
        }

        result.push({
          id: `vault-${vault.vaultId}`,
          positionId: vault.vaultId,
          poolId: vault.poolId,
          poolName: vault.poolName,
          type: 'vault',
          status: vault.isActive || vault.hasPosition ? 'open' : 'closed',
          openTimestamp: vault.openTimestamp,
          closeTimestamp: null, // Vaults don't have a close timestamp in the same way
          openValueUsd: initialValue,
          currentValueUsd: displayValue, // Use initial deposit for active positions
          feesEarnedUsd: vault.feesEarnedUsd,
          rewardsEarnedUsd: vault.rewardsEarnedUsd,
          estimatedIL: vault.estimatedIL,
          netPnl,
          priceLower: vault.priceLower, // Already calculated with decimal adjustment
          priceUpper: vault.priceUpper, // Already calculated with decimal adjustment
          currentPrice: vault.currentPrice,
          cyclesCompleted: vault.cyclesCompleted,
          isInRange: vault.isInRange,
        });
      });
    }

    // Sort by open timestamp (newest first)
    return result.sort((a, b) => b.openTimestamp - a.openTimestamp).slice(0, 20);
  }, [positions, vaultsData, positionTypeFilter]);

  // Legacy cycleData for backwards compatibility
  const cycleData = useMemo((): PositionCycle[] => {
    return getPositionCycles().slice(0, 15);
  }, [positions]);

  // Combined stats for LP and Vault positions
  const combinedCycleStats = useMemo(() => {
    const lpStats = getCycleStatistics();

    // Add vault stats
    let vaultStats = {
      totalCycles: 0,
      openCycles: 0,
      closedCycles: 0,
      totalFeesEarned: 0,
      totalRewardsEarned: 0,
      totalIL: 0,
      totalNetPnl: 0,
      avgCycleDuration: 0,
    };

    if (vaultsData && (positionTypeFilter === 'all' || positionTypeFilter === 'vault')) {
      vaultsData.forEach(vault => {
        vaultStats.totalCycles += vault.cyclesCompleted || 1;
        if (vault.isActive || vault.hasPosition) {
          vaultStats.openCycles++;
        } else {
          vaultStats.closedCycles++;
        }
        vaultStats.totalFeesEarned += vault.feesEarnedUsd;
        vaultStats.totalRewardsEarned += vault.rewardsEarnedUsd;
        vaultStats.totalIL += vault.estimatedIL;
        if (vault.performance?.metrics.netPnl) {
          vaultStats.totalNetPnl += vault.performance.metrics.netPnl;
        }
      });
    }

    // Combine stats based on filter
    if (positionTypeFilter === 'vault') {
      return vaultStats;
    } else if (positionTypeFilter === 'lp') {
      return lpStats;
    } else {
      return {
        totalCycles: lpStats.totalCycles + vaultStats.totalCycles,
        openCycles: lpStats.openCycles + vaultStats.openCycles,
        closedCycles: lpStats.closedCycles + vaultStats.closedCycles,
        totalFeesEarned: lpStats.totalFeesEarned + vaultStats.totalFeesEarned,
        totalRewardsEarned: lpStats.totalRewardsEarned + vaultStats.totalRewardsEarned,
        totalIL: lpStats.totalIL + vaultStats.totalIL,
        totalNetPnl: lpStats.totalNetPnl + vaultStats.totalNetPnl,
        avgCycleDuration: lpStats.avgCycleDuration, // Keep LP duration for now
      };
    }
  }, [cycleData, vaultsData, positionTypeFilter]);


  // Rewards vs IL comparison with real data
  const rewardsVsIL = useMemo(() => {
    if (!positions || !poolPriceData) return [];

    return positions.slice(0, 5).map(pos => {
      const priceData = poolPriceData.get(pos.poolId);
      const volatility = priceData?.volatility.weekly || 5;
      const estimatedIL = calculateImpermanentLoss(volatility);
      const ilLoss = pos.totalValueUsd * estimatedIL / 100;

      // Total earnings = trading fees + xSUI rewards
      const totalEarnings = pos.uncollectedFeesUsd + pos.claimableRewardsUsd;

      return {
        name: `${pos.pool.tokenA.symbol}/${pos.pool.tokenB.symbol}`,
        positionId: pos.id.slice(0, 8),
        rewards: pos.claimableRewardsUsd, // xSUI rewards only
        fees: pos.uncollectedFeesUsd, // Trading fees only
        il: ilLoss,
        net: totalEarnings - ilLoss,
        apr: pos.apr,
        isPositive: totalEarnings > ilLoss,
        volatility: volatility,
      };
    });
  }, [positions, poolPriceData]);

  // Break-even analysis with REAL data from position cycles
  const breakEvenAnalysis = useMemo(() => {
    if (!positions || !poolPriceData) return [];
    const cycles = getPositionCycles();

    return positions.slice(0, 6).map(pos => {
      const priceData = poolPriceData.get(pos.poolId);
      const volatility = priceData?.volatility || { daily: 2, weekly: 5, monthly: 10, annualized: 35 };

      // Try to get REAL data from position cycle
      const cycle = cycles.find(c => c.positionId === pos.id && c.status === 'open');

      let dailyEarnings: number;
      let estimatedIL: number;
      let dataQuality: 'real' | 'estimated';

      if (cycle) {
        // Use REAL earnings data from tracked cycle
        const daysActive = Math.max(0.01, (Date.now() - cycle.openTimestamp) / (1000 * 60 * 60 * 24));
        const totalEarnings = cycle.feesEarnedUsd + cycle.rewardsEarnedUsd;
        dailyEarnings = totalEarnings / daysActive;
        estimatedIL = cycle.estimatedIL; // Use tracked IL
        dataQuality = 'real';
      } else {
        // Fall back to APR-based estimate
        dailyEarnings = (pos.totalValueUsd * pos.apr / 100) / 365;
        estimatedIL = calculateImpermanentLoss(volatility.weekly);
        dataQuality = 'estimated';
      }

      // Calculate break-even based on real daily earnings
      const dailyEarningPercent = pos.totalValueUsd > 0 ? (dailyEarnings / pos.totalValueUsd) * 100 : 0;
      const breakEvenDays = dailyEarningPercent > 0 ? estimatedIL / dailyEarningPercent : Infinity;

      return {
        position: pos,
        breakEvenDays: Math.max(0, breakEvenDays),
        confidence: dataQuality === 'real' ? 'high' : pos.apr > 30 ? 'medium' : 'low',
        estimatedIL,
        dailyEarnings,
        volatility: volatility.annualized,
        dataSource: dataQuality === 'real' ? 'tracked' : (priceData?.source || 'fallback'),
        dataQuality,
      };
    });
  }, [positions, poolPriceData]);

  // Price chart with real data
  const priceChartData = useMemo(() => {
    const recommendation = selectedPool
      ? rangeRecommendations.find(r => r.pool.id === selectedPool.id)
      : rangeRecommendations[0];

    if (!recommendation) return [];

    const { priceHistory, optimalRange, pool } = recommendation;

    // Normalize prices to current price for better visualization
    const currentPrice = priceHistory[priceHistory.length - 1]?.price || pool.priceTokenB;

    return priceHistory.slice(-14 * 24).map((p, idx) => ({
      time: new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit' }),
      price: p.price,
      optimalLower: currentPrice * (1 - optimalRange.optimal / 100),
      optimalUpper: currentPrice * (1 + optimalRange.optimal / 100),
      idx,
    }));
  }, [selectedPool, rangeRecommendations]);

  // Data status indicator
  const DataStatusBadge = () => (
    <div className={`data-status ${dataStatus}`}>
      {dataStatus === 'live' ? <Wifi size={14} /> : dataStatus === 'cached' ? <Database size={14} /> : <WifiOff size={14} />}
      <span>{dataStatus === 'live' ? 'Live Data' : dataStatus === 'cached' ? 'Cached' : 'Offline'}</span>
    </div>
  );

  return (
    <div className="range-analytics">
      <div className="page-header">
        <div className="header-content">
          <h1>Range Analytics</h1>
          <p>Optimize your LP positions with real-time data from CoinGecko</p>
        </div>
        <div className="header-actions">
          <DataStatusBadge />
          {/* Position Type Filter */}
          <div className="position-type-filter">
            <button
              className={`filter-btn ${positionTypeFilter === 'all' ? 'active' : ''}`}
              onClick={() => {
                setPositionTypeFilter('all');
                savePositionTypeFilter('all');
              }}
              title="Show all positions"
            >
              All
            </button>
            <button
              className={`filter-btn ${positionTypeFilter === 'lp' ? 'active' : ''}`}
              onClick={() => {
                setPositionTypeFilter('lp');
                savePositionTypeFilter('lp');
              }}
              title="Show only LP positions"
            >
              <BarChart3 size={14} />
              LP
            </button>
            <button
              className={`filter-btn ${positionTypeFilter === 'vault' ? 'active' : ''}`}
              onClick={() => {
                setPositionTypeFilter('vault');
                savePositionTypeFilter('vault');
              }}
              title="Show only Vault positions"
            >
              <Vault size={14} />
              Vault
            </button>
          </div>
          <button
            className={`alert-toggle ${alertsEnabled ? 'active' : ''}`}
            onClick={() => setAlertsEnabled(!alertsEnabled)}
          >
            <Bell size={16} />
            {alertsEnabled ? 'Alerts On' : 'Alerts Off'}
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="quick-stats">
        <StatCard
          title={positionTypeFilter === 'vault' ? 'Vaults Tracked' : positionTypeFilter === 'lp' ? 'Positions Tracked' : 'Total Tracked'}
          value={(() => {
            const lpCount = positions?.length || 0;
            const vaultCount = vaultsData?.length || 0;
            if (positionTypeFilter === 'lp') return lpCount.toString();
            if (positionTypeFilter === 'vault') return vaultCount.toString();
            return (lpCount + vaultCount).toString();
          })()}
          subtitle={positionTypeFilter === 'all' ? `${positions?.length || 0} LP + ${vaultsData?.length || 0} Vault` : undefined}
          icon={positionTypeFilter === 'vault' ? <Vault /> : <BarChart3 />}
          loading={positionsLoading || vaultsLoading}
          gradient="primary"
        />
        <StatCard
          title="Active Alerts"
          value={positionAlerts.filter(a => a.severity !== 'info').length.toString()}
          icon={<AlertTriangle />}
          loading={positionsLoading}
          gradient={positionAlerts.some(a => a.severity === 'critical') ? 'danger' : 'accent'}
        />
        <StatCard
          title="Total Cycles"
          value={combinedCycleStats.totalCycles.toString()}
          subtitle={`${combinedCycleStats.openCycles} open`}
          icon={<RefreshCw />}
          loading={vaultsLoading}
          gradient="info"
        />
        <StatCard
          title="Net Cycle P&L"
          value={formatCurrency(combinedCycleStats.totalNetPnl)}
          change={combinedCycleStats.totalNetPnl}
          icon={combinedCycleStats.totalNetPnl >= 0 ? <TrendingUp /> : <TrendingDown />}
          loading={vaultsLoading}
          gradient={combinedCycleStats.totalNetPnl >= 0 ? 'success' : 'danger'}
        />
      </div>

      {/* Alerts Section */}
      {alertsEnabled && positionAlerts.length > 0 && (
        <section className="alerts-section">
          <h2 className="section-title">
            <Bell size={18} />
            Position Alerts
            <span className="alert-count">{positionAlerts.length}</span>
          </h2>
          <div className="alerts-grid">
            {positionAlerts.slice(0, 4).map((alert, idx) => (
              <AlertCard key={idx} alert={alert} />
            ))}
          </div>
        </section>
      )}

      {/* Main Analytics Grid */}
      <div className="analytics-grid">
        {/* Optimal Range Recommendations */}
        <Card className="analytics-card glass-card">
          <CardHeader>
            <CardTitle className="card-title">
              <Target size={18} />
              Optimal Range Recommendations
              {pricesLoading && <span className="loading-indicator">Fetching prices...</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {poolsLoading || pricesLoading ? (
              <div className="loading-state">
                <Skeleton className="h-16 w-full mb-3" />
                <Skeleton className="h-16 w-full mb-3" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <div className="recommendations-list">
                {rangeRecommendations.slice(0, 5).map((rec) => (
                  <div
                    key={rec.pool.id}
                    className={`recommendation-item ${selectedPool?.id === rec.pool.id ? 'selected' : ''}`}
                    onClick={() => setSelectedPool(rec.pool)}
                  >
                    <div className="rec-header">
                      <div className="pool-info">
                        <div className="token-pair">
                          <img src={rec.pool.tokenA.logoUrl} alt="" className="token-icon" />
                          <img src={rec.pool.tokenB.logoUrl} alt="" className="token-icon overlap" />
                        </div>
                        <div className="pool-details">
                          <span className="pool-name">{rec.pool.tokenA.symbol}/{rec.pool.tokenB.symbol}</span>
                          <span className="pool-fee">{(rec.pool.fee / 10000).toFixed(2)}% fee</span>
                        </div>
                      </div>
                      <div className="rec-badges">
                        <span className={`source-badge ${rec.dataSource}`}>
                          {rec.dataSource === 'live' ? <Wifi size={10} /> : <Database size={10} />}
                          {rec.dataSource}
                        </span>
                        <span className={`risk-badge ${rec.riskLevel}`}>
                          {rec.riskLevel}
                        </span>
                      </div>
                    </div>
                    <div className="rec-body">
                      <div className="range-options">
                        <div className="range-option">
                          <span className="range-label">Tight</span>
                          <span className="range-value">±{rec.optimalRange.narrow.toFixed(1)}%</span>
                        </div>
                        <div className="range-option optimal">
                          <span className="range-label">Optimal</span>
                          <span className="range-value">±{rec.optimalRange.optimal.toFixed(1)}%</span>
                        </div>
                        <div className="range-option">
                          <span className="range-label">Wide</span>
                          <span className="range-value">±{rec.optimalRange.wide.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="rec-stats">
                        <div className="stat-item">
                          <Activity size={14} />
                          <span>Vol: {rec.volatility.annualized.toFixed(1)}%</span>
                        </div>
                        <div className="stat-item">
                          <Percent size={14} />
                          <span>APR: {rec.expectedApr.toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                    <div className="rec-strategy">
                      <Info size={14} />
                      <span>{rec.recommendedStrategy}</span>
                    </div>
                    <ChevronRight size={16} className="chevron" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Price Chart with Range */}
        <Card className="analytics-card glass-card">
          <CardHeader>
            <CardTitle className="card-title">
              <Activity size={18} />
              Price & Optimal Range
              {selectedPool && (
                <span className="selected-pool">
                  {selectedPool.tokenA.symbol}/{selectedPool.tokenB.symbol}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {priceChartData.length === 0 ? (
              <div className="empty-state">
                <p>Select a pool to view price chart</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={priceChartData}>
                  <defs>
                    <linearGradient id="rangeGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00D4AA" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#00D4AA" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="time"
                    stroke="#606070"
                    fontSize={11}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    stroke="#606070"
                    fontSize={11}
                    tickFormatter={(val) => val.toFixed(4)}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(10, 10, 15, 0.95)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '12px',
                      padding: '12px',
                    }}
                    formatter={(value, name) => [
                      typeof value === 'number' ? value.toFixed(6) : String(value),
                      name === 'price' ? 'Price' : String(name)
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="optimalUpper"
                    stroke="none"
                    fill="url(#rangeGradient)"
                  />
                  <ReferenceLine
                    y={priceChartData[0]?.optimalUpper}
                    stroke="#00D4AA"
                    strokeDasharray="5 5"
                    label={{ value: 'Upper', position: 'right', fill: '#00D4AA', fontSize: 10 }}
                  />
                  <ReferenceLine
                    y={priceChartData[0]?.optimalLower}
                    stroke="#00D4AA"
                    strokeDasharray="5 5"
                    label={{ value: 'Lower', position: 'right', fill: '#00D4AA', fontSize: 10 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#00A3FF"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Break-Even Analysis */}
        <Card className="analytics-card glass-card">
          <CardHeader>
            <CardTitle className="card-title">
              <Clock size={18} />
              Break-Even Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!isConnected ? (
              <div className="connect-prompt">
                <p>Connect wallet to see break-even analysis</p>
              </div>
            ) : positionsLoading ? (
              <div className="loading-state">
                <Skeleton className="h-12 w-full mb-2" />
                <Skeleton className="h-12 w-full mb-2" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : breakEvenAnalysis.length === 0 ? (
              <div className="empty-state">
                <p>No positions to analyze</p>
              </div>
            ) : (
              <div className="breakeven-list">
                {breakEvenAnalysis.map((item, idx) => (
                  <div key={idx} className="breakeven-item">
                    <div className="be-header">
                      <span className="pool-name">
                        {item.position.pool.tokenA.symbol}/{item.position.pool.tokenB.symbol}
                      </span>
                      <div className="be-badges">
                        <span className={`source-badge ${item.dataQuality === 'real' ? 'tracked' : item.dataSource}`}>
                          {item.dataQuality === 'real' ? <Database size={10} /> : <Wifi size={10} />}
                        </span>
                        <span className={`confidence-badge ${item.confidence}`}>
                          {item.confidence.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="be-metrics">
                      <div className="be-metric">
                        <span className="metric-label">Break-Even</span>
                        <span className="metric-value">
                          {isFinite(item.breakEvenDays)
                            ? `${Math.round(item.breakEvenDays)} days`
                            : 'N/A'}
                        </span>
                      </div>
                      <div className="be-metric">
                        <span className="metric-label">Daily Earnings</span>
                        <span className="metric-value positive">
                          +{formatCurrency(item.dailyEarnings)}
                        </span>
                      </div>
                      <div className="be-metric">
                        <span className="metric-label">Est. IL</span>
                        <span className="metric-value negative">
                          -{formatIL(item.estimatedIL)}%
                        </span>
                      </div>
                      <div className="be-metric">
                        <span className="metric-label">Volatility</span>
                        <span className="metric-value">
                          {item.volatility.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="be-progress">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${Math.min(100, isFinite(item.breakEvenDays) ? (30 / item.breakEvenDays) * 100 : 0)}%`
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rewards vs IL */}
        <Card className="analytics-card glass-card">
          <CardHeader>
            <CardTitle className="card-title">
              <Zap size={18} />
              Rewards vs Impermanent Loss
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!isConnected ? (
              <div className="connect-prompt">
                <p>Connect wallet to see rewards analysis</p>
              </div>
            ) : positionsLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : rewardsVsIL.length === 0 ? (
              <div className="empty-state">
                <p>No positions to analyze</p>
              </div>
            ) : (
              <>
                {/* Interactive Legend */}
                <div className="chart-legend">
                  <button
                    className={`legend-item ${chartVisibility.rewards ? 'active' : 'inactive'}`}
                    onClick={() => toggleChartSeries('rewards')}
                  >
                    <span className="legend-color" style={{ background: '#00D4AA' }} />
                    <span className="legend-label">xSUI Rewards</span>
                  </button>
                  <button
                    className={`legend-item ${chartVisibility.fees ? 'active' : 'inactive'}`}
                    onClick={() => toggleChartSeries('fees')}
                  >
                    <span className="legend-color" style={{ background: '#00A3FF' }} />
                    <span className="legend-label">Trading Fees</span>
                  </button>
                  <button
                    className={`legend-item ${chartVisibility.il ? 'active' : 'inactive'}`}
                    onClick={() => toggleChartSeries('il')}
                  >
                    <span className="legend-color" style={{ background: '#FF6B6B' }} />
                    <span className="legend-label">IL Loss</span>
                  </button>
                </div>

                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={rewardsVsIL} layout="vertical">
                    <XAxis
                      type="number"
                      stroke="#606070"
                      fontSize={11}
                      tickFormatter={(val) => formatCurrency(Math.abs(val), { compact: true })}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={80}
                      stroke="#606070"
                      fontSize={11}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(10, 10, 15, 0.95)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '12px',
                        padding: '12px',
                      }}
                      formatter={(value, name) => [
                        formatCurrency(Math.abs(typeof value === 'number' ? value : 0)),
                        name === 'rewards' ? 'xSUI Rewards' : name === 'fees' ? 'Trading Fees' : name === 'il' ? 'IL Loss' : 'Net'
                      ]}
                    />
                    {chartVisibility.rewards && (
                      <Bar dataKey="rewards" fill="#00D4AA" radius={[0, 4, 4, 0]} name="rewards" />
                    )}
                    {chartVisibility.fees && (
                      <Bar dataKey="fees" fill="#00A3FF" radius={[0, 4, 4, 0]} name="fees" />
                    )}
                    {chartVisibility.il && (
                      <Bar dataKey="il" fill="#FF6B6B" radius={[0, 4, 4, 0]} name="il">
                        {rewardsVsIL.map((_entry, i) => (
                          <Cell key={`il-${i}`} fill="#FF6B6B" opacity={0.7} />
                        ))}
                      </Bar>
                    )}
                  </BarChart>
                </ResponsiveContainer>

                {/* Net Summary */}
                <div className="chart-summary">
                  {rewardsVsIL.map((item, idx) => (
                    <div key={idx} className={`summary-item ${item.isPositive ? 'positive' : 'negative'}`}>
                      <span className="summary-label">{item.name} Net:</span>
                      <span className="summary-value">
                        {item.net >= 0 ? '+' : ''}{formatCurrency(item.net)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cycle History - Real Data from localStorage and Vault tracking */}
      {unifiedCycleData.length > 0 && (
        <section className="cycle-section">
          <div className="section-header-with-actions">
            <h2 className="section-title">
              <RefreshCw size={18} />
              {positionTypeFilter === 'vault' ? 'Vault Cycle History' : positionTypeFilter === 'lp' ? 'LP Cycle History' : 'Position Cycle History'}
              <span className="cycle-count">
                {unifiedCycleData.length} {positionTypeFilter === 'all'
                  ? `(${unifiedCycleData.filter(c => c.type === 'lp').length} LP + ${unifiedCycleData.filter(c => c.type === 'vault').length} Vault)`
                  : 'tracked'
                }
              </span>
            </h2>
            <button
              className="column-settings-btn"
              onClick={() => setShowColumnSettings(true)}
              title="Customize columns"
            >
              <Settings size={16} />
            </button>
          </div>

          {/* Column Settings Modal */}
          {showColumnSettings && (
            <div className="column-settings-modal-overlay" onClick={() => setShowColumnSettings(false)}>
              <div className="column-settings-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>Customize Columns</h3>
                  <button className="close-btn" onClick={() => setShowColumnSettings(false)}>
                    <X size={18} />
                  </button>
                </div>
                <div className="modal-content">
                  <p className="modal-hint">Toggle visibility and drag to reorder columns</p>
                  <div className="column-list">
                    {columnConfig.map((col) => (
                      <div
                        key={col.id}
                        className={`column-item ${col.visible ? 'visible' : 'hidden'}`}
                        draggable
                        onDragStart={() => setDraggedColumn(col.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedColumn && draggedColumn !== col.id) {
                            setColumnConfig(prev => {
                              const dragIdx = prev.findIndex(c => c.id === draggedColumn);
                              const dropIdx = prev.findIndex(c => c.id === col.id);
                              const updated = [...prev];
                              const [dragged] = updated.splice(dragIdx, 1);
                              updated.splice(dropIdx, 0, dragged);
                              updated.forEach((c, i) => c.order = i);
                              saveColumnConfig(updated);
                              return updated;
                            });
                          }
                          setDraggedColumn(null);
                        }}
                      >
                        <GripVertical size={14} className="drag-handle" />
                        <span className="column-label">{col.label}</span>
                        <button
                          className="visibility-toggle"
                          onClick={() => toggleColumnVisibility(col.id)}
                        >
                          {col.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="totals-toggle">
                    <span className="totals-label">Show Totals Row</span>
                    <button
                      className={`totals-toggle-btn ${showTotalsRow ? 'active' : ''}`}
                      onClick={toggleTotalsRow}
                    >
                      {showTotalsRow ? <Eye size={14} /> : <EyeOff size={14} />}
                      {showTotalsRow ? 'Visible' : 'Hidden'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <Card className="glass-card">
            <CardContent className="cycle-table-container">
              <table className="cycle-table">
                <thead>
                  <tr>
                    <th>#</th>
                    {positionTypeFilter === 'all' && <th>Type</th>}
                    {visibleColumns.map(col => (
                      <th key={col.id}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {unifiedCycleData.map((cycle, index) => {
                    const durationMs = cycle.closeTimestamp
                      ? cycle.closeTimestamp - cycle.openTimestamp
                      : Date.now() - cycle.openTimestamp;

                    // Format duration intelligently
                    const formatDuration = (ms: number) => {
                      const seconds = Math.floor(ms / 1000);
                      const minutes = Math.floor(seconds / 60);
                      const hours = Math.floor(minutes / 60);
                      const days = Math.floor(hours / 24);
                      const weeks = Math.floor(days / 7);
                      const months = Math.floor(days / 30);
                      const years = Math.floor(days / 365);

                      if (years > 0) return `${years}y ${days % 365}d`;
                      if (months > 0) return `${months}mo ${days % 30}d`;
                      if (weeks > 0) return `${weeks}w ${days % 7}d`;
                      if (days > 0) return `${days}d ${hours % 24}h`;
                      if (hours > 0) return `${hours}h ${minutes % 60}m`;
                      if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
                      return `${seconds}s`;
                    };

                    // Calculate values
                    const pooledValue = cycle.currentValueUsd || cycle.openValueUsd;
                    const netPnl = (() => {
                      if (cycle.status === 'closed' && cycle.netPnl !== null) return cycle.netPnl;
                      const currentValue = cycle.currentValueUsd || cycle.openValueUsd;
                      const valueDiff = currentValue - cycle.openValueUsd;
                      const totalEarnings = cycle.feesEarnedUsd + cycle.rewardsEarnedUsd;
                      const ilLoss = cycle.openValueUsd * (cycle.estimatedIL / 100);
                      return valueDiff + totalEarnings - ilLoss;
                    })();
                    const roi = pooledValue > 0 ? (netPnl / pooledValue) * 100 : 0;
                    const daysActive = Math.max(1, durationMs / (1000 * 60 * 60 * 24));
                    const dailyEarnings = (cycle.feesEarnedUsd + cycle.rewardsEarnedUsd) / daysActive;
                    const totalEarnings = cycle.feesEarnedUsd + cycle.rewardsEarnedUsd;

                    // Get pool data for additional columns
                    const poolData = pools?.find(p => p.id === cycle.poolId);
                    const priceData = poolPriceData?.get(cycle.poolId);
                    const currentPrice = cycle.currentPrice || (poolData?.priceTokenB || 0);
                    const isInRange = cycle.isInRange !== undefined
                      ? cycle.isInRange
                      : (cycle.priceLower && cycle.priceUpper && currentPrice
                        ? currentPrice >= cycle.priceLower && currentPrice <= cycle.priceUpper
                        : true);

                    // Render cell based on column ID
                    const renderCell = (colId: string) => {
                      switch (colId) {
                        case 'pool':
                          return (
                            <span className="pool-name-cell">
                              {cycle.poolName}
                              {cycle.type === 'vault' && cycle.cyclesCompleted !== undefined && (
                                <span className="cycles-badge" title={`${cycle.cyclesCompleted} cycles completed`}>
                                  {cycle.cyclesCompleted}x
                                </span>
                              )}
                            </span>
                          );
                        case 'range':
                          return cycle.priceLower && cycle.priceUpper
                            ? `${cycle.priceLower.toFixed(4)} - ${cycle.priceUpper.toFixed(4)}`
                            : '-';
                        case 'pooled':
                          return formatCurrency(pooledValue);
                        case 'opened':
                          return new Date(cycle.openTimestamp).toLocaleDateString();
                        case 'entryPrice':
                          return cycle.entryPrice ? `$${cycle.entryPrice.toFixed(4)}` : '-';
                        case 'status':
                          return cycle.status === 'open'
                            ? <span className="active-badge">Active</span>
                            : <span className="closed-badge">Closed</span>;
                        case 'duration':
                          return formatDuration(durationMs);
                        case 'fees':
                          return <span className="positive">+{formatCurrency(cycle.feesEarnedUsd)}</span>;
                        case 'rewards':
                          return <span className="positive">+{formatCurrency(cycle.rewardsEarnedUsd)}</span>;
                        case 'estIL':
                          return <span className="negative">-{formatIL(cycle.estimatedIL)}%</span>;
                        case 'netPnl':
                          return (
                            <strong className={netPnl >= 0 ? 'positive' : 'negative'}>
                              {netPnl >= 0 ? '+' : ''}{formatCurrency(netPnl)}
                            </strong>
                          );
                        case 'roi':
                          return (
                            <span className={roi >= 0 ? 'positive' : 'negative'}>
                              {roi >= 0 ? '+' : ''}{roi.toFixed(2)}%
                            </span>
                          );
                        case 'volume':
                          return poolData?.volume24h
                            ? formatCurrency(poolData.volume24h, { compact: true })
                            : '-';
                        case 'tvl':
                          return poolData?.tvlUsd
                            ? formatCurrency(poolData.tvlUsd, { compact: true })
                            : '-';
                        case 'apr':
                          return poolData?.apr
                            ? `${poolData.apr.toFixed(1)}%`
                            : '-';
                        case 'dailyEarnings':
                          return <span className="positive">+{formatCurrency(dailyEarnings)}/d</span>;
                        case 'breakeven':
                          const beData = breakEvenAnalysis.find(b => b.position?.id === cycle.positionId);
                          return beData && isFinite(beData.breakEvenDays)
                            ? `${Math.round(beData.breakEvenDays)}d`
                            : '-';
                        case 'volatility':
                          return priceData?.volatility?.annualized
                            ? `${priceData.volatility.annualized.toFixed(1)}%`
                            : '-';
                        case 'earnings':
                          return <span className="positive">+{formatCurrency(totalEarnings)}</span>;
                        case 'priceRange':
                          if (!cycle.priceLower || !cycle.priceUpper || !currentPrice) return '-';
                          const rangeWidth = cycle.priceUpper - cycle.priceLower;
                          const pricePosition = ((currentPrice - cycle.priceLower) / rangeWidth) * 100;
                          return (
                            <div className="price-range-bar">
                              <div className="range-track">
                                <div
                                  className={`range-fill ${isInRange ? 'in-range' : 'out-of-range'}`}
                                  style={{ width: '100%' }}
                                />
                                {isInRange && (
                                  <div
                                    className="current-marker"
                                    style={{ left: `${Math.min(100, Math.max(0, pricePosition))}%` }}
                                  />
                                )}
                              </div>
                            </div>
                          );
                        case 'pnlHodl':
                          // HODL PnL = what you'd have if you just held the tokens
                          const hodlValue = cycle.entryPrice && currentPrice
                            ? pooledValue * (currentPrice / cycle.entryPrice)
                            : pooledValue;
                          const hodlPnl = hodlValue - cycle.openValueUsd;
                          return (
                            <span className={hodlPnl >= 0 ? 'positive' : 'negative'}>
                              {hodlPnl >= 0 ? '+' : ''}{formatCurrency(hodlPnl)}
                            </span>
                          );
                        case 'roiHodl':
                          const hodlVal = cycle.entryPrice && currentPrice
                            ? pooledValue * (currentPrice / cycle.entryPrice)
                            : pooledValue;
                          const hodlRoi = cycle.openValueUsd > 0
                            ? ((hodlVal - cycle.openValueUsd) / cycle.openValueUsd) * 100
                            : 0;
                          return (
                            <span className={hodlRoi >= 0 ? 'positive' : 'negative'}>
                              {hodlRoi >= 0 ? '+' : ''}{hodlRoi.toFixed(2)}%
                            </span>
                          );
                        default:
                          return '-';
                      }
                    };

                    return (
                      <tr key={cycle.id} className={`${cycle.status === 'open' ? 'active-row' : 'closed-row'} ${cycle.type === 'vault' ? 'vault-row' : 'lp-row'}`}>
                        <td className="row-number">{index + 1}</td>
                        {positionTypeFilter === 'all' && (
                          <td className="type-cell">
                            <span className={`type-badge ${cycle.type}`}>
                              {cycle.type === 'vault' ? <Vault size={12} /> : <BarChart3 size={12} />}
                              {cycle.type === 'vault' ? 'Vault' : 'LP'}
                            </span>
                          </td>
                        )}
                        {visibleColumns.map(col => (
                          <td key={col.id} className={
                            col.id === 'range' ? 'range-cell' :
                            col.id === 'entryPrice' ? 'entry-price-cell' :
                            col.id === 'duration' ? 'duration-cell' : ''
                          }>
                            {renderCell(col.id)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
                {showTotalsRow && (
                  <tfoot>
                    <tr>
                      <td><strong>#</strong></td>
                      {positionTypeFilter === 'all' && <td></td>}
                      {visibleColumns.map((col, colIndex) => {
                        // First column shows "Totals" label
                        if (colIndex === 0) {
                          return <td key={col.id}><strong>Totals</strong></td>;
                        }

                        // Render aggregate values for columns that have them
                        switch (col.id) {
                          case 'fees':
                            return (
                              <td key={col.id} className="positive">
                                <strong>+{formatCurrency(combinedCycleStats.totalFeesEarned)}</strong>
                              </td>
                            );
                          case 'rewards':
                            return (
                              <td key={col.id} className="positive">
                                <strong>+{formatCurrency(combinedCycleStats.totalRewardsEarned)}</strong>
                              </td>
                            );
                          case 'estIL':
                            return (
                              <td key={col.id} className="negative">
                                <strong>-{formatIL(combinedCycleStats.totalIL)}%</strong>
                              </td>
                            );
                          case 'netPnl':
                            return (
                              <td key={col.id} className={combinedCycleStats.totalNetPnl >= 0 ? 'positive' : 'negative'}>
                                <strong>
                                  {combinedCycleStats.totalNetPnl >= 0 ? '+' : ''}
                                  {formatCurrency(combinedCycleStats.totalNetPnl)}
                                </strong>
                              </td>
                            );
                          case 'roi': {
                            const totalPooled = unifiedCycleData.reduce((sum, c) => sum + (c.currentValueUsd || c.openValueUsd), 0);
                            const totalRoi = totalPooled > 0 ? (combinedCycleStats.totalNetPnl / totalPooled) * 100 : 0;
                            return (
                              <td key={col.id} className={totalRoi >= 0 ? 'positive' : 'negative'}>
                                <strong>{totalRoi >= 0 ? '+' : ''}{totalRoi.toFixed(2)}%</strong>
                              </td>
                            );
                          }
                          case 'earnings':
                            return (
                              <td key={col.id} className="positive">
                                <strong>+{formatCurrency(combinedCycleStats.totalFeesEarned + combinedCycleStats.totalRewardsEarned)}</strong>
                              </td>
                            );
                          case 'dailyEarnings': {
                            const avgDaily = unifiedCycleData.length > 0
                              ? unifiedCycleData.reduce((sum, c) => {
                                  const days = Math.max(1, (Date.now() - c.openTimestamp) / (1000 * 60 * 60 * 24));
                                  return sum + (c.feesEarnedUsd + c.rewardsEarnedUsd) / days;
                                }, 0)
                              : 0;
                            return (
                              <td key={col.id} className="positive">
                                <strong>+{formatCurrency(avgDaily)}/d</strong>
                              </td>
                            );
                          }
                          case 'pnlHodl': {
                            // Sum of all HODL P&L values
                            const totalHodlPnl = unifiedCycleData.reduce((sum, cycle) => {
                              const pooledValue = cycle.currentValueUsd || cycle.openValueUsd;
                              const currentPrice = cycle.currentPrice || 0;
                              const hodlValue = cycle.entryPrice && currentPrice
                                ? pooledValue * (currentPrice / cycle.entryPrice)
                                : pooledValue;
                              return sum + (hodlValue - cycle.openValueUsd);
                            }, 0);
                            return (
                              <td key={col.id} className={totalHodlPnl >= 0 ? 'positive' : 'negative'}>
                                <strong>{totalHodlPnl >= 0 ? '+' : ''}{formatCurrency(totalHodlPnl)}</strong>
                              </td>
                            );
                          }
                          case 'roiHodl': {
                            // Average HODL ROI
                            const totalOpenValue = unifiedCycleData.reduce((sum, c) => sum + c.openValueUsd, 0);
                            const totalHodlValue = unifiedCycleData.reduce((sum, cycle) => {
                              const pooledValue = cycle.currentValueUsd || cycle.openValueUsd;
                              const currentPrice = cycle.currentPrice || 0;
                              return sum + (cycle.entryPrice && currentPrice
                                ? pooledValue * (currentPrice / cycle.entryPrice)
                                : pooledValue);
                            }, 0);
                            const avgHodlRoi = totalOpenValue > 0
                              ? ((totalHodlValue - totalOpenValue) / totalOpenValue) * 100
                              : 0;
                            return (
                              <td key={col.id} className={avgHodlRoi >= 0 ? 'positive' : 'negative'}>
                                <strong>{avgHodlRoi >= 0 ? '+' : ''}{avgHodlRoi.toFixed(2)}%</strong>
                              </td>
                            );
                          }
                          case 'pooled': {
                            // Sum of all pooled values
                            const totalPooledValue = unifiedCycleData.reduce((sum, c) => sum + (c.currentValueUsd || c.openValueUsd), 0);
                            return (
                              <td key={col.id}>
                                <strong>{formatCurrency(totalPooledValue)}</strong>
                              </td>
                            );
                          }
                          default:
                            // Non-aggregate columns show empty cell
                            return <td key={col.id}></td>;
                        }
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            </CardContent>
          </Card>
        </section>
      )}

      <style>{`
        .range-analytics {
          display: flex;
          flex-direction: column;
          gap: 24px;
          animation: fadeIn 0.4s ease-out;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 24px;
        }

        .header-content h1 {
          font-size: 28px;
          font-weight: 700;
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 8px;
        }

        .header-content p {
          color: #808090;
          font-size: 14px;
        }

        .header-actions {
          display: flex;
          gap: 12px;
          align-items: center;
        }

        .data-status {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 500;
        }

        .data-status.live {
          background: rgba(0, 212, 170, 0.1);
          color: #00D4AA;
          border: 1px solid rgba(0, 212, 170, 0.2);
        }

        .data-status.cached {
          background: rgba(255, 230, 109, 0.1);
          color: #FFE66D;
          border: 1px solid rgba(255, 230, 109, 0.2);
        }

        .data-status.offline {
          background: rgba(255, 107, 107, 0.1);
          color: #FF6B6B;
          border: 1px solid rgba(255, 107, 107, 0.2);
        }

        /* Position Type Filter */
        .position-type-filter {
          display: flex;
          align-items: center;
          gap: 4px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 4px;
        }

        .filter-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: transparent;
          border: none;
          border-radius: 6px;
          color: #808090;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .filter-btn:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #E8E8EC;
        }

        .filter-btn.active {
          background: rgba(0, 212, 170, 0.15);
          color: #00D4AA;
        }

        .filter-btn svg {
          flex-shrink: 0;
        }

        .alert-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          color: #808090;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .alert-toggle:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.12);
        }

        .alert-toggle.active {
          background: rgba(0, 212, 170, 0.1);
          border-color: rgba(0, 212, 170, 0.3);
          color: #00D4AA;
        }

        .quick-stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }

        .section-title {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 18px;
          font-weight: 600;
          color: #E8E8EC;
          margin-bottom: 16px;
        }

        .alert-count, .cycle-count {
          margin-left: auto;
          font-size: 12px;
          font-weight: 500;
          padding: 4px 10px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
          color: #A0A0B0;
        }

        .alerts-section {
          margin-bottom: 8px;
        }

        .alerts-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }

        .analytics-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 20px;
        }

        .analytics-card {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
        }

        .card-title {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 16px;
          font-weight: 600;
          color: #E8E8EC;
        }

        .card-title .selected-pool {
          margin-left: auto;
          font-size: 12px;
          font-weight: 500;
          padding: 4px 10px;
          background: rgba(0, 212, 170, 0.1);
          border-radius: 6px;
          color: #00D4AA;
        }

        .loading-indicator {
          margin-left: auto;
          font-size: 11px;
          color: #808090;
          font-weight: 400;
        }

        .recommendations-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .recommendation-item {
          position: relative;
          padding: 14px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .recommendation-item:hover {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.08);
        }

        .recommendation-item.selected {
          background: rgba(0, 212, 170, 0.08);
          border-color: rgba(0, 212, 170, 0.2);
        }

        .rec-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .pool-info {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .token-pair {
          display: flex;
        }

        .token-icon {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 2px solid #1a1a2e;
        }

        .token-icon.overlap {
          margin-left: -8px;
        }

        .pool-details {
          display: flex;
          flex-direction: column;
        }

        .pool-name {
          font-weight: 600;
          color: #E8E8EC;
          font-size: 14px;
        }

        .pool-fee {
          font-size: 11px;
          color: #808090;
        }

        .rec-badges {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .source-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 500;
          text-transform: uppercase;
        }

        .source-badge.live {
          background: rgba(0, 212, 170, 0.1);
          color: #00D4AA;
        }

        .source-badge.cached {
          background: rgba(255, 230, 109, 0.1);
          color: #FFE66D;
        }

        .source-badge.fallback {
          background: rgba(255, 107, 107, 0.1);
          color: #FF6B6B;
        }

        .risk-badge {
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .risk-badge.low {
          background: rgba(0, 212, 170, 0.1);
          color: #00D4AA;
        }

        .risk-badge.medium {
          background: rgba(255, 230, 109, 0.1);
          color: #FFE66D;
        }

        .risk-badge.high {
          background: rgba(255, 107, 107, 0.1);
          color: #FF6B6B;
        }

        .rec-body {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }

        .range-options {
          display: flex;
          gap: 12px;
        }

        .range-option {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 6px 10px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 8px;
        }

        .range-option.optimal {
          background: rgba(0, 212, 170, 0.1);
          border: 1px solid rgba(0, 212, 170, 0.2);
        }

        .range-label {
          font-size: 10px;
          color: #808090;
        }

        .range-value {
          font-size: 13px;
          font-weight: 600;
          color: #E8E8EC;
        }

        .range-option.optimal .range-value {
          color: #00D4AA;
        }

        .rec-stats {
          display: flex;
          gap: 16px;
        }

        .stat-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #A0A0B0;
        }

        .rec-strategy {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          background: rgba(0, 163, 255, 0.08);
          border-radius: 8px;
          font-size: 11px;
          color: #00A3FF;
        }

        .chevron {
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: #606070;
        }

        .connect-prompt, .empty-state {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px;
          color: #808090;
          font-size: 14px;
        }

        .breakeven-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .breakeven-item {
          padding: 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: 10px;
        }

        .be-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }

        .be-badges {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .confidence-badge {
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .confidence-badge.high {
          background: rgba(0, 212, 170, 0.1);
          color: #00D4AA;
        }

        .confidence-badge.medium {
          background: rgba(255, 230, 109, 0.1);
          color: #FFE66D;
        }

        .confidence-badge.low {
          background: rgba(255, 107, 107, 0.1);
          color: #FF6B6B;
        }

        .be-metrics {
          display: flex;
          gap: 16px;
          margin-bottom: 10px;
        }

        .be-metric {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .metric-label {
          font-size: 10px;
          color: #808090;
        }

        .metric-value {
          font-size: 13px;
          font-weight: 600;
          color: #E8E8EC;
        }

        .metric-value.positive {
          color: #00D4AA;
        }

        .metric-value.negative {
          color: #FF6B6B;
        }

        .be-progress {
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 2px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #00D4AA, #00A3FF);
          border-radius: 2px;
          transition: width 0.3s ease;
        }

        .cycle-section {
          margin-top: 8px;
        }

        .cycle-table-container {
          overflow-x: auto;
        }

        .cycle-table {
          width: 100%;
          border-collapse: collapse;
        }

        .cycle-table th,
        .cycle-table td {
          padding: 12px 16px;
          text-align: left;
          font-size: 13px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }

        .cycle-table th {
          color: #808090;
          font-weight: 500;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .cycle-table td {
          color: #E8E8EC;
        }

        .cycle-table tr.active {
          background: rgba(0, 212, 170, 0.05);
        }

        .cycle-table tfoot tr {
          background: rgba(255, 255, 255, 0.02);
        }

        .pool-name-cell {
          font-weight: 600;
        }

        .active-badge {
          padding: 4px 8px;
          background: rgba(0, 212, 170, 0.1);
          border-radius: 4px;
          color: #00D4AA;
          font-size: 11px;
          font-weight: 600;
        }

        .closed-badge {
          padding: 4px 8px;
          background: rgba(239, 68, 68, 0.1);
          border-radius: 4px;
          color: #ef4444;
          font-size: 11px;
          font-weight: 600;
        }

        .row-number {
          color: #606070;
          font-weight: 500;
          font-size: 12px;
          text-align: center;
        }

        .range-cell {
          font-family: 'Monaco', 'Consolas', monospace;
          font-size: 11px;
          color: #a0a0b0;
          white-space: nowrap;
        }

        .duration-cell {
          font-family: 'Monaco', 'Consolas', monospace;
          font-size: 12px;
          white-space: nowrap;
        }

        .active-row {
          background: rgba(0, 212, 170, 0.03);
        }

        .closed-row {
          opacity: 0.85;
        }

        /* Vault vs LP Row Styles */
        .vault-row.active-row {
          background: rgba(168, 85, 247, 0.05);
        }

        .lp-row.active-row {
          background: rgba(0, 212, 170, 0.03);
        }

        /* Type Badge in Table */
        .type-cell {
          width: 70px;
          text-align: center;
        }

        .type-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
        }

        .type-badge.vault {
          background: rgba(168, 85, 247, 0.15);
          color: #A855F7;
        }

        .type-badge.lp {
          background: rgba(0, 163, 255, 0.15);
          color: #00A3FF;
        }

        /* Cycles Badge in Pool Name */
        .cycles-badge {
          margin-left: 6px;
          padding: 2px 6px;
          background: rgba(168, 85, 247, 0.15);
          color: #A855F7;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
        }

        .cycle-table th:first-child,
        .cycle-table td:first-child {
          width: 40px;
          text-align: center;
        }

        .pending {
          color: #808090;
          font-style: italic;
        }

        .positive {
          color: #00D4AA;
        }

        .negative {
          color: #FF6B6B;
        }

        @media (max-width: 1200px) {
          .quick-stats {
            grid-template-columns: repeat(2, 1fr);
          }

          .analytics-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 768px) {
          .quick-stats {
            grid-template-columns: 1fr;
          }

          .alerts-grid {
            grid-template-columns: 1fr;
          }

          .page-header {
            flex-direction: column;
          }

          .header-actions {
            width: 100%;
            justify-content: space-between;
          }

          .cycle-table {
            font-size: 11px;
          }

          .cycle-table th,
          .cycle-table td {
            padding: 8px 10px;
          }
        }
      `}</style>
    </div>
  );
}

// Stat Card Component
interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  change?: number;
  icon: React.ReactNode;
  loading?: boolean;
  gradient?: 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'danger';
}

function StatCard({ title, value, subtitle, change, icon, loading, gradient = 'primary' }: StatCardProps) {
  const gradientColors = {
    primary: ['#00D4AA', '#00A3FF'],
    secondary: ['#00A3FF', '#9D4EDD'],
    accent: ['#FFE66D', '#FF6B6B'],
    info: ['#6366F1', '#8B5CF6'],
    success: ['#00D4AA', '#10B981'],
    danger: ['#FF6B6B', '#F43F5E'],
  };

  const [color1, color2] = gradientColors[gradient];

  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: `linear-gradient(135deg, ${color1}20, ${color2}20)`, color: color1 }}>
        {icon}
      </div>
      <div className="stat-content">
        <span className="stat-title">{title}</span>
        {loading ? (
          <Skeleton className="h-7 w-20 bg-white/5" />
        ) : (
          <div className="stat-value-row">
            <span className="stat-value">{value}</span>
            {subtitle && <span className="stat-subtitle">{subtitle}</span>}
            {change !== undefined && change !== 0 && (
              <span className={`stat-change ${change >= 0 ? 'positive' : 'negative'}`}>
                {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              </span>
            )}
          </div>
        )}
      </div>
      <style>{`
        .stat-card {
          display: flex;
          gap: 14px;
          padding: 18px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: 14px;
          transition: all 0.3s ease;
        }

        .stat-card:hover {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.08);
        }

        .stat-icon {
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          flex-shrink: 0;
        }

        .stat-content {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .stat-title {
          font-size: 12px;
          color: #808090;
        }

        .stat-value-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .stat-value {
          font-size: 20px;
          font-weight: 600;
          color: #E8E8EC;
        }

        .stat-subtitle {
          font-size: 12px;
          color: #808090;
        }

        .stat-change {
          display: flex;
          align-items: center;
          gap: 3px;
          font-size: 11px;
          font-weight: 500;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .stat-change.positive {
          color: #00D4AA;
          background: rgba(0, 212, 170, 0.1);
        }

        .stat-change.negative {
          color: #FF6B6B;
          background: rgba(255, 107, 107, 0.1);
        }
      `}</style>
    </div>
  );
}

// Alert Card Component
interface AlertCardProps {
  alert: PositionAlert;
}

function AlertCard({ alert }: AlertCardProps) {
  const severityColors = {
    critical: { bg: 'rgba(255, 107, 107, 0.1)', border: 'rgba(255, 107, 107, 0.3)', color: '#FF6B6B' },
    warning: { bg: 'rgba(255, 230, 109, 0.1)', border: 'rgba(255, 230, 109, 0.3)', color: '#FFE66D' },
    info: { bg: 'rgba(0, 163, 255, 0.1)', border: 'rgba(0, 163, 255, 0.3)', color: '#00A3FF' },
  };

  const colors = severityColors[alert.severity];
  const Icon = alert.alertType === 'boundary' ? AlertTriangle :
               alert.alertType === 'il' ? TrendingDown :
               DollarSign;

  return (
    <div
      className="alert-card"
      style={{
        background: colors.bg,
        borderColor: colors.border
      }}
    >
      <div className="alert-icon" style={{ color: colors.color }}>
        <Icon size={18} />
      </div>
      <div className="alert-content">
        <div className="alert-header">
          <span className="alert-pool">
            {alert.position.pool.tokenA.symbol}/{alert.position.pool.tokenB.symbol}
          </span>
          <span className="alert-severity" style={{ color: colors.color }}>
            {alert.severity.toUpperCase()}
          </span>
        </div>
        <p className="alert-message">{alert.message}</p>
        <p className="alert-action">
          <ArrowUpRight size={12} />
          {alert.action}
        </p>
      </div>
      <style>{`
        .alert-card {
          display: flex;
          gap: 12px;
          padding: 14px;
          border: 1px solid;
          border-radius: 12px;
          transition: all 0.2s;
        }

        .alert-card:hover {
          transform: translateY(-2px);
        }

        .alert-icon {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          flex-shrink: 0;
        }

        .alert-content {
          flex: 1;
          min-width: 0;
        }

        .alert-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }

        .alert-pool {
          font-weight: 600;
          color: #E8E8EC;
          font-size: 13px;
        }

        .alert-severity {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.5px;
        }

        .alert-message {
          font-size: 12px;
          color: #C0C0D0;
          margin-bottom: 6px;
          line-height: 1.4;
        }

        .alert-action {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: #A0A0B0;
        }
      `}</style>
    </div>
  );
}
