import { useState, useEffect } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import type { EventId } from '@mysten/sui/client';
import { Vault, RefreshCw, AlertCircle, CheckCircle, Clock, Loader2, Pause, Play, Settings, X, ChevronDown, BarChart3, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import {
  VAULT_CONFIG,
  buildWithdrawVaultTransaction,
  buildClosePositionAndWithdrawTransaction,
  buildPauseVaultTransaction,
  buildResumeVaultTransaction,
  buildUpdateSettingsTransaction,
  buildUpdateRebalanceSettingsTransaction,
} from '@/services/vaultService';
import { getPoolById } from '@/services/mmtService';
import { StrategyPerformance } from './StrategyPerformance';

interface VaultData {
  id: string;
  owner: string;
  poolId: string;
  balanceX: string;
  balanceY: string;
  feesX: string;
  feesY: string;
  isActive: boolean;
  hasPosition: boolean;
  cyclesCompleted: number;
  maxCycles: number;
  tokenXType: string;
  tokenYType: string;
  timerDurationMs: number;
  rangeBps: number;
  nextExecutionAt: number;
  // Position details (when has_position is true)
  positionId?: string;
  positionType?: string; // Full position type including generics
  tickLower?: number;
  tickUpper?: number;
  liquidity?: string;
  // Pool current tick for in-range calculation
  currentTick?: number;
  isInRange?: boolean;
  // Auto-rebalance settings
  autoRebalance?: boolean;
  useZap?: boolean;
  autoCompound?: boolean;
  rebalanceDelayMs?: number;
  rebalanceCount?: number;
  zapCount?: number; // Number of rebalances that actually used ZAP
  maxZapSlippageBps?: number; // Max slippage in basis points for ZAP (e.g., 100 = 1%)
  // Position token amounts (calculated from liquidity)
  positionAmountX?: string;
  positionAmountY?: string;
}

// Convert tick to price (CLMM formula: price = 1.0001^tick)
// Returns price of Y in terms of X (how much X per 1 Y)
function tickToPrice(tick: number, decimalsX: number, decimalsY: number): number {
  const price = Math.pow(1.0001, tick);
  // Adjust for decimal difference
  const decimalAdjustment = Math.pow(10, decimalsX - decimalsY);
  return price * decimalAdjustment;
}

// Calculate token amounts from liquidity using CLMM math
// Based on Uniswap V3 / Cetus concentrated liquidity formulas
function getTokenAmountsFromLiquidity(
  liquidity: string,
  currentTick: number,
  tickLower: number,
  tickUpper: number,
  decimalsX: number,
  decimalsY: number
): { amountX: number; amountY: number } {
  // Convert ticks to sqrt prices
  const sqrtPrice = Math.sqrt(Math.pow(1.0001, currentTick));
  const sqrtPriceLower = Math.sqrt(Math.pow(1.0001, tickLower));
  const sqrtPriceUpper = Math.sqrt(Math.pow(1.0001, tickUpper));

  const liquidityNum = Number(liquidity);

  let amountX = 0;
  let amountY = 0;

  if (currentTick < tickLower) {
    // Price below range - all in token X
    amountX = liquidityNum * (1/sqrtPriceLower - 1/sqrtPriceUpper);
  } else if (currentTick >= tickUpper) {
    // Price above range - all in token Y
    amountY = liquidityNum * (sqrtPriceUpper - sqrtPriceLower);
  } else {
    // In range - split between X and Y
    amountX = liquidityNum * (1/sqrtPrice - 1/sqrtPriceUpper);
    amountY = liquidityNum * (sqrtPrice - sqrtPriceLower);
  }

  // Convert from raw amounts to human-readable (divide by decimals)
  amountX = amountX / Math.pow(10, decimalsX);
  amountY = amountY / Math.pow(10, decimalsY);

  return { amountX, amountY };
}

// Format price for display
function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  } else if (price >= 1) {
    return price.toLocaleString(undefined, { maximumFractionDigits: 4 });
  } else if (price >= 0.0001) {
    return price.toLocaleString(undefined, { maximumFractionDigits: 6 });
  } else {
    return price.toExponential(4);
  }
}

// Format duration in human-readable form
function formatDuration(ms: number): string {
  if (ms <= 0) return 'Just started';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }
  if (hours > 0) {
    const remainingMins = minutes % 60;
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

export function MyVaults() {
  const { address, isConnected } = useWallet();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [vaults, setVaults] = useState<VaultData[]>([]);
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [pausing, setPausing] = useState<string | null>(null);
  const [editingVault, setEditingVault] = useState<VaultData | null>(null);
  const [editSettings, setEditSettings] = useState({
    timerValue: '',
    timerUnit: 's',
    maxCycles: '',
    rangeBps: '',
    // Rebalance settings
    autoRebalance: true,
    useZap: true,
    autoCompound: false,
    rebalanceDelayValue: '',
    rebalanceDelayUnit: 's',
    maxZapSlippageBps: '50', // Default 0.5% max slippage for ZAP
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPerformance, setExpandedPerformance] = useState<string | null>(null);

  const fetchVaults = async (retryCount = 0) => {
    if (!address || !VAULT_CONFIG.isDeployed) {
      setVaults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Query VaultCreated events with retry on failure
      const events = await suiClient.queryEvents({
        query: {
          MoveEventType: `${VAULT_CONFIG.packageId}::cycling_vault::VaultCreated`,
        },
        limit: 50,
      });

      const userVaults: VaultData[] = [];

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

          // Extract token types from vault type: Vault<X, Y>
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

          // Skip empty vaults (no balance, no fees, no position)
          const hasBalance = BigInt(balanceX) > 0 || BigInt(balanceY) > 0;
          const hasFees = BigInt(feesX) > 0 || BigInt(feesY) > 0;
          const hasPosition = fields.has_position;

          if (!hasBalance && !hasFees && !hasPosition) {
            continue; // Skip empty closed vaults
          }

          // Fetch position details if vault has position
          let positionData: {
            positionId?: string;
            positionType?: string;
            tickLower?: number;
            tickUpper?: number;
            liquidity?: string;
          } = {};

          if (hasPosition) {
            try {
              const positionFieldBytes = Array.from('position').map(c => c.charCodeAt(0));
              const positionObject = await suiClient.getDynamicFieldObject({
                parentId: vaultId,
                name: { type: 'vector<u8>', value: positionFieldBytes },
              });

              if (positionObject?.data?.content?.dataType === 'moveObject') {
                const posFields = (positionObject.data.content as any).fields;
                positionData.positionId = positionObject.data.objectId;
                // Get the full position type for later use in close_position
                positionData.positionType = positionObject.data.type || '';

                // Extract tick indices (handle i32 format)
                const tickLowerField = posFields.tick_lower_index;
                const tickUpperField = posFields.tick_upper_index;
                let lowerTick = tickLowerField?.fields?.bits ? Number(tickLowerField.fields.bits) : 0;
                let upperTick = tickUpperField?.fields?.bits ? Number(tickUpperField.fields.bits) : 0;

                // Convert from unsigned to signed
                const MAX_I32 = 2147483647;
                const OVERFLOW = 4294967296;
                if (lowerTick > MAX_I32) lowerTick = lowerTick - OVERFLOW;
                if (upperTick > MAX_I32) upperTick = upperTick - OVERFLOW;

                positionData.tickLower = lowerTick;
                positionData.tickUpper = upperTick;
                positionData.liquidity = String(posFields.liquidity || '0');
              }
            } catch (e) {
              console.warn('Failed to fetch position details:', e);
            }
          }

          // Get pool current tick if position exists (use SDK for accurate data)
          let currentTick: number | undefined;
          let isInRange = true;
          let positionAmountX: string | undefined;
          let positionAmountY: string | undefined;

          if (hasPosition && fields.pool_id) {
            try {
              // Use SDK to get accurate pool data
              const pool = await getPoolById(fields.pool_id as string);
              if (pool) {
                currentTick = pool.currentTick;

                if (positionData.tickLower !== undefined && positionData.tickUpper !== undefined) {
                  isInRange = currentTick >= positionData.tickLower && currentTick <= positionData.tickUpper;
                }
              }
            } catch (e) {
              console.warn('Failed to fetch pool data:', e);
            }
          }

          // Calculate actual token amounts from liquidity using CLMM math
          const decimalsX = (tokenXType.includes('::usdc::USDC') || tokenXType.includes('::usdt::USDT')) ? 6 : 9;
          const decimalsY = (tokenYType.includes('::usdc::USDC') || tokenYType.includes('::usdt::USDT')) ? 6 : 9;

          if (hasPosition && positionData.liquidity && currentTick !== undefined &&
              positionData.tickLower !== undefined && positionData.tickUpper !== undefined) {
            // Use CLMM math to calculate actual token amounts from liquidity
            const { amountX, amountY } = getTokenAmountsFromLiquidity(
              positionData.liquidity,
              currentTick,
              positionData.tickLower,
              positionData.tickUpper,
              decimalsX,
              decimalsY
            );

            if (amountX > 0.0001 || amountY > 0.0001) {
              positionAmountX = amountX.toFixed(4);
              positionAmountY = amountY.toFixed(4);
            }
          }

          userVaults.push({
            id: vaultId,
            owner: fields.owner,
            poolId: fields.pool_id,
            balanceX,
            balanceY,
            feesX,
            feesY,
            isActive: fields.is_active,
            hasPosition,
            cyclesCompleted: Number(fields.cycles_completed || 0),
            maxCycles: Number(fields.max_cycles || 0),
            tokenXType,
            tokenYType,
            timerDurationMs: Number(fields.timer_duration_ms || 0),
            rangeBps: Number(fields.range_bps || 0),
            nextExecutionAt: Number(fields.next_execution_at || 0),
            ...positionData,
            currentTick,
            isInRange,
            autoRebalance: fields.auto_rebalance,
            useZap: fields.use_zap,
            autoCompound: fields.auto_compound,
            rebalanceDelayMs: Number(fields.rebalance_delay_ms || 0),
            rebalanceCount: Number(fields.rebalance_count || 0),
            maxZapSlippageBps: Number(fields.max_zap_slippage_bps || 0),
            positionAmountX,
            positionAmountY,
          });
        } catch (e) {
          // Vault may have been deleted/closed - skip silently
          continue;
        }
      }

      // Fetch ALL RebalanceExecuted events (paginated) to get actual ZAP counts per vault
      if (userVaults.length > 0) {
        try {
          const allRebalanceEvents: any[] = [];
          let cursor: EventId | null | undefined = undefined;
          let hasMore = true;

          while (hasMore) {
            const page = await suiClient.queryEvents({
              query: {
                MoveEventType: `${VAULT_CONFIG.packageId}::cycling_vault::RebalanceExecuted`,
              },
              limit: 50,
              order: 'descending',
              cursor: cursor ?? undefined,
            });
            allRebalanceEvents.push(...page.data);
            cursor = page.nextCursor;
            hasMore = page.hasNextPage;
          }

          // Count ZAPs per vault
          const zapCountMap = new Map<string, number>();
          for (const event of allRebalanceEvents) {
            const data = event.parsedJson as { vault_id: string; used_zap: boolean };
            if (data.used_zap) {
              const count = zapCountMap.get(data.vault_id) || 0;
              zapCountMap.set(data.vault_id, count + 1);
            }
          }

          // Update userVaults with zapCount
          for (const vault of userVaults) {
            vault.zapCount = zapCountMap.get(vault.id) || 0;
          }
        } catch (e) {
          console.warn('Failed to fetch RebalanceExecuted events for ZAP count:', e);
          // Not critical - continue without ZAP counts
        }
      }

      setVaults(userVaults);
      setLoading(false);
    } catch (e: any) {
      console.error('Failed to fetch vaults:', e);

      // Retry up to 2 times with exponential backoff
      if (retryCount < 2) {
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s
        console.log(`Retrying in ${delay}ms... (attempt ${retryCount + 1}/2)`);
        setTimeout(() => fetchVaults(retryCount + 1), delay);
        return; // Keep loading spinner while retrying
      }

      const errorMsg = e?.message || 'Failed to load vaults';
      setError(`${errorMsg}. Please try refreshing the page or check your network connection.`);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVaults();
  }, [address]);

  const handleWithdraw = async (vault: VaultData) => {
    if (!address) return;

    setWithdrawing(vault.id);
    setError(null);

    try {
      let tx;

      if (vault.hasPosition && vault.liquidity && vault.positionType) {
        // Close position first, then withdraw
        tx = buildClosePositionAndWithdrawTransaction(
          vault.id,
          vault.poolId,
          vault.tokenXType,
          vault.tokenYType,
          vault.liquidity,
          address,
          vault.positionType
        );
      } else {
        // No position, just withdraw balance
        tx = buildWithdrawVaultTransaction(
          vault.id,
          vault.tokenXType,
          vault.tokenYType
        );
      }

      await signAndExecute({ transaction: tx });

      // Refresh vaults after withdrawal
      await fetchVaults();
    } catch (e: any) {
      console.error('Withdraw failed:', e);
      setError(e.message || 'Withdraw failed');
    } finally {
      setWithdrawing(null);
    }
  };

  const handlePauseResume = async (vault: VaultData) => {
    setPausing(vault.id);
    setError(null);

    try {
      const tx = vault.isActive
        ? buildPauseVaultTransaction(vault.id, vault.tokenXType, vault.tokenYType)
        : buildResumeVaultTransaction(vault.id, vault.tokenXType, vault.tokenYType);

      await signAndExecute({ transaction: tx });
      await fetchVaults();
    } catch (e: any) {
      console.error('Pause/Resume failed:', e);
      setError(e.message || 'Operation failed');
    } finally {
      setPausing(null);
    }
  };

  const openEditSettings = (vault: VaultData) => {
    // Convert timer ms to appropriate unit
    const ms = vault.timerDurationMs;
    let timerValue: string;
    let timerUnit: string;
    if (ms >= 3600000 && ms % 3600000 === 0) {
      timerValue = String(ms / 3600000);
      timerUnit = 'h';
    } else if (ms >= 60000 && ms % 60000 === 0) {
      timerValue = String(ms / 60000);
      timerUnit = 'm';
    } else {
      timerValue = String(ms / 1000);
      timerUnit = 's';
    }

    // Convert rebalance delay ms to appropriate unit
    const delayMs = vault.rebalanceDelayMs || 0;
    let rebalanceDelayValue: string;
    let rebalanceDelayUnit: string;
    if (delayMs >= 3600000 && delayMs % 3600000 === 0) {
      rebalanceDelayValue = String(delayMs / 3600000);
      rebalanceDelayUnit = 'h';
    } else if (delayMs >= 60000 && delayMs % 60000 === 0) {
      rebalanceDelayValue = String(delayMs / 60000);
      rebalanceDelayUnit = 'm';
    } else {
      rebalanceDelayValue = delayMs > 0 ? String(delayMs / 1000) : '';
      rebalanceDelayUnit = 's';
    }

    setEditSettings({
      timerValue,
      timerUnit,
      maxCycles: vault.maxCycles === 0 ? '' : String(vault.maxCycles),
      rangeBps: String(vault.rangeBps / 100), // Convert to percent
      // Rebalance settings
      autoRebalance: vault.autoRebalance ?? true,
      useZap: vault.useZap ?? true,
      autoCompound: vault.autoCompound ?? false,
      rebalanceDelayValue,
      rebalanceDelayUnit,
      maxZapSlippageBps: String(vault.maxZapSlippageBps ?? 50), // Default 0.5%
    });
    setEditingVault(vault);
  };

  const handleSaveSettings = async () => {
    if (!editingVault) return;
    setSaving(true);
    setError(null);

    try {
      // Calculate timer in ms
      const timerMultiplier = editSettings.timerUnit === 'h' ? 3600000 : editSettings.timerUnit === 'm' ? 60000 : 1000;
      const timerDurationMs = Number(editSettings.timerValue) * timerMultiplier;
      const maxCycles = editSettings.maxCycles === '' ? 0 : Number(editSettings.maxCycles);
      const rangeBps = Number(editSettings.rangeBps) * 100; // Convert percent to bps

      // Calculate rebalance delay in ms
      const delayMultiplier = editSettings.rebalanceDelayUnit === 'h' ? 3600000 : editSettings.rebalanceDelayUnit === 'm' ? 60000 : 1000;
      const rebalanceDelayMs = editSettings.rebalanceDelayValue ? Number(editSettings.rebalanceDelayValue) * delayMultiplier : 0;

      // Build both transactions
      const tx1 = buildUpdateSettingsTransaction(
        editingVault.id,
        editingVault.tokenXType,
        editingVault.tokenYType,
        rangeBps,
        timerDurationMs,
        maxCycles
      );

      const maxZapSlippageBps = Number(editSettings.maxZapSlippageBps) || 0;
      const tx2 = buildUpdateRebalanceSettingsTransaction(
        editingVault.id,
        editingVault.tokenXType,
        editingVault.tokenYType,
        editSettings.autoRebalance,
        editSettings.useZap,
        editSettings.autoCompound,
        rebalanceDelayMs,
        maxZapSlippageBps
      );

      // Execute both transactions
      await signAndExecute({ transaction: tx1 });
      await signAndExecute({ transaction: tx2 });

      setEditingVault(null);
      await fetchVaults();
    } catch (e: any) {
      console.error('Update settings failed:', e);
      setError(e.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const formatBalance = (value: string, decimals: number = 9) => {
    const num = Number(value) / Math.pow(10, decimals);
    return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
  };

  const getTokenSymbol = (type: string) => {
    if (type.includes('::sui::SUI')) return 'SUI';
    if (type.includes('::usdc::USDC')) return 'USDC';
    if (type.includes('::usdt::USDT')) return 'USDT';
    // Extract last part of type
    const parts = type.split('::');
    return parts[parts.length - 1] || 'TOKEN';
  };

  const getTokenDecimals = (type: string) => {
    if (type.includes('::usdc::USDC') || type.includes('::usdt::USDT')) return 6;
    return 9;
  };

  const formatTimer = (ms: number) => {
    if (ms >= 3600000) return `${ms / 3600000}h`;
    if (ms >= 60000) return `${ms / 60000}m`;
    return `${ms / 1000}s`;
  };

  if (!isConnected) {
    return (
      <div className="my-vaults">
        <div className="vaults-header">
          <h2><Vault size={24} /> My Vaults</h2>
        </div>
        <div className="empty-state">
          <p>Connect your wallet to view your vaults</p>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (!VAULT_CONFIG.isDeployed) {
    return (
      <div className="my-vaults">
        <div className="vaults-header">
          <h2><Vault size={24} /> My Vaults</h2>
        </div>
        <div className="empty-state">
          <p>Vault contract not deployed</p>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="my-vaults">
      <div className="vaults-header">
        <h2><Vault size={24} /> My Vaults</h2>
        <button className="refresh-btn" onClick={() => fetchVaults()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spinning' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {loading ? (
        <div className="loading-state">
          <Loader2 size={24} className="spinning" />
          <p>Loading vaults...</p>
        </div>
      ) : vaults.length === 0 ? (
        <div className="empty-state">
          <Vault size={48} />
          <p>No vaults found</p>
          <span>Create a vault to start auto-cycling LP positions</span>
        </div>
      ) : (
        <div className="vaults-list">
          {vaults.map((vault) => {
            const tokenXSymbol = getTokenSymbol(vault.tokenXType);
            const tokenYSymbol = getTokenSymbol(vault.tokenYType);
            const tokenXDecimals = getTokenDecimals(vault.tokenXType);
            const tokenYDecimals = getTokenDecimals(vault.tokenYType);

            const hasBalance = BigInt(vault.balanceX) > 0 || BigInt(vault.balanceY) > 0;
            const hasFees = BigInt(vault.feesX) > 0 || BigInt(vault.feesY) > 0;
            const hasLiquidity = vault.hasPosition && vault.liquidity && vault.positionType && BigInt(vault.liquidity) > 0n;
            // Can withdraw if: has position (will close it), or has balance/fees (no position)
            const canWithdraw = hasLiquidity || hasBalance || hasFees;

            return (
              <div key={vault.id} className="vault-card">
                <div className="vault-header">
                  <div className="vault-pair">
                    <span className="pair-name">{tokenXSymbol}/{tokenYSymbol}</span>
                    <span className={`status-badge ${vault.isActive ? 'active' : 'inactive'}`}>
                      {vault.isActive ? (
                        <><Clock size={12} /> Active</>
                      ) : (
                        <><CheckCircle size={12} /> Completed</>
                      )}
                    </span>
                  </div>
                  <div className="vault-cycles">
                    Cycles: {vault.cyclesCompleted}/{vault.maxCycles || '∞'}
                  </div>
                </div>

                <div className="vault-balances">
                  {vault.hasPosition ? (
                    <>
                      <div className="position-info">
                        <div className="position-header">
                          <Activity size={14} />
                          <span>Active Position</span>
                          <span className={`range-badge ${vault.isInRange ? 'in-range' : 'out-of-range'}`}>
                            {vault.isInRange ? (
                              <><TrendingUp size={12} /> In Range</>
                            ) : (
                              <><TrendingDown size={12} /> Out of Range</>
                            )}
                          </span>
                        </div>
                        {vault.tickLower !== undefined && vault.tickUpper !== undefined && (
                          <div className="price-range">
                            <span className="price-label">Price Range:</span>
                            <span className="price-value">
                              {formatPrice(tickToPrice(vault.tickLower, tokenXDecimals, tokenYDecimals))} → {formatPrice(tickToPrice(vault.tickUpper, tokenXDecimals, tokenYDecimals))} {tokenXSymbol}/{tokenYSymbol}
                            </span>
                          </div>
                        )}
                        {vault.currentTick !== undefined && (
                          <div className="current-price">
                            <span className="price-label">Current Price:</span>
                            <span className="price-value highlight">
                              {formatPrice(tickToPrice(vault.currentTick, tokenXDecimals, tokenYDecimals))} {tokenXSymbol}/{tokenYSymbol}
                            </span>
                          </div>
                        )}
                        {vault.timerDurationMs > 0 && vault.nextExecutionAt > 0 && (
                          <div className="position-duration">
                            <Clock size={12} />
                            <span className="duration-label">Running for:</span>
                            <span className="duration-value">
                              {formatDuration(Date.now() - (vault.nextExecutionAt - vault.timerDurationMs))}
                            </span>
                          </div>
                        )}
                        {/* Position Amounts - show liquidity deployed in position */}
                        {vault.positionAmountX !== undefined && vault.positionAmountY !== undefined && (
                          <div className="position-amounts">
                            <span className="amounts-label">In Position:</span>
                            <span className="amounts-value">
                              {vault.positionAmountX} {tokenXSymbol} + {vault.positionAmountY} {tokenYSymbol}
                            </span>
                          </div>
                        )}
                      </div>
                      {(hasBalance) && (
                        <div className="balance-row leftover">
                          <span className="label">Leftover Balance:</span>
                          <span className="value">
                            {formatBalance(vault.balanceX, tokenXDecimals)} {tokenXSymbol} + {formatBalance(vault.balanceY, tokenYDecimals)} {tokenYSymbol}
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="balance-row">
                      <span className="label">Balance:</span>
                      <span className="value">
                        {formatBalance(vault.balanceX, tokenXDecimals)} {tokenXSymbol} + {formatBalance(vault.balanceY, tokenYDecimals)} {tokenYSymbol}
                      </span>
                    </div>
                  )}
                  {hasFees && (
                    <div className="balance-row fees">
                      <span className="label">Fees Earned:</span>
                      <span className="value">
                        +{formatBalance(vault.feesX, tokenXDecimals)} {tokenXSymbol} + {formatBalance(vault.feesY, tokenYDecimals)} {tokenYSymbol}
                      </span>
                    </div>
                  )}
                </div>

                <div className="vault-settings-row">
                  <span>Range: ±{vault.rangeBps / 100}%</span>
                  {vault.timerDurationMs > 0 && <span>Timer: {formatTimer(vault.timerDurationMs)}</span>}
                  {vault.autoRebalance && <span className="feature-badge">Auto-Rebalance</span>}
                  {vault.useZap && (
                    <span className="feature-badge zap">
                      ZAP {typeof vault.zapCount === 'number' ? vault.zapCount : ''}
                      {vault.maxZapSlippageBps ? ` (${(vault.maxZapSlippageBps / 100).toFixed(2)}%)` : ''}
                    </span>
                  )}
                  {vault.autoCompound && <span className="feature-badge compound">Compound</span>}
                  {vault.rebalanceDelayMs && vault.rebalanceDelayMs > 0 && (
                    <span className="feature-badge delay">Delay: {formatTimer(vault.rebalanceDelayMs)}</span>
                  )}
                  {vault.rebalanceCount ? <span>Rebalances: {vault.rebalanceCount}</span> : null}
                </div>

                {vault.hasPosition && !vault.isInRange && vault.autoRebalance && (
                  <div className="position-notice warning">
                    <AlertCircle size={14} />
                    Position out of range - auto-rebalance will trigger soon
                  </div>
                )}

                <div className="vault-actions">
                  <button
                    className={`action-btn ${vault.isActive ? 'pause-btn' : 'resume-btn'}`}
                    onClick={() => handlePauseResume(vault)}
                    disabled={pausing === vault.id}
                  >
                    {pausing === vault.id ? (
                      <Loader2 size={16} className="spinning" />
                    ) : vault.isActive ? (
                      <><Pause size={16} /> Pause</>
                    ) : (
                      <><Play size={16} /> Resume</>
                    )}
                  </button>
                  <button
                    className="action-btn settings-btn"
                    onClick={() => openEditSettings(vault)}
                  >
                    <Settings size={16} /> Edit
                  </button>
                  <button
                    className="action-btn performance-btn"
                    onClick={() => setExpandedPerformance(expandedPerformance === vault.id ? null : vault.id)}
                  >
                    <BarChart3 size={16} />
                    <ChevronDown
                      size={14}
                      className={`chevron ${expandedPerformance === vault.id ? 'rotated' : ''}`}
                    />
                  </button>
                  <button
                    className="withdraw-btn"
                    onClick={() => handleWithdraw(vault)}
                    disabled={!canWithdraw || withdrawing === vault.id}
                  >
                    {withdrawing === vault.id ? (
                      <><Loader2 size={16} className="spinning" /> {vault.hasPosition ? 'Closing Position...' : 'Withdrawing...'}</>
                    ) : (
                      vault.hasPosition ? 'Close & Withdraw' : 'Withdraw'
                    )}
                  </button>
                </div>

                {expandedPerformance === vault.id && (
                  <div className="performance-section">
                    <StrategyPerformance vaultId={vault.id} />
                  </div>
                )}

                <div className="vault-id">
                  ID: {vault.id.slice(0, 10)}...{vault.id.slice(-8)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Settings Modal */}
      {editingVault && (
        <div className="modal-overlay" onClick={() => setEditingVault(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><Settings size={20} /> Edit Vault Settings</h3>
              <button className="close-btn" onClick={() => setEditingVault(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Cycle Duration</label>
                <div className="timer-input-group">
                  <input
                    type="number"
                    value={editSettings.timerValue}
                    onChange={(e) => setEditSettings({ ...editSettings, timerValue: e.target.value })}
                    min="1"
                  />
                  <select
                    value={editSettings.timerUnit}
                    onChange={(e) => setEditSettings({ ...editSettings, timerUnit: e.target.value })}
                  >
                    <option value="s">seconds</option>
                    <option value="m">minutes</option>
                    <option value="h">hours</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Max Cycles (empty = infinite)</label>
                <input
                  type="number"
                  value={editSettings.maxCycles}
                  onChange={(e) => setEditSettings({ ...editSettings, maxCycles: e.target.value })}
                  placeholder="∞"
                  min="0"
                />
              </div>
              <div className="form-group">
                <label>Range (% from current price)</label>
                <input
                  type="number"
                  value={editSettings.rangeBps}
                  onChange={(e) => setEditSettings({ ...editSettings, rangeBps: e.target.value })}
                  min="0.1"
                  step="0.1"
                />
              </div>

              <div className="section-divider">Rebalance Settings</div>

              <div className="form-group">
                <label>Rebalance Delay (wait before rebalancing when out of range)</label>
                <div className="timer-input-group">
                  <input
                    type="number"
                    value={editSettings.rebalanceDelayValue}
                    onChange={(e) => setEditSettings({ ...editSettings, rebalanceDelayValue: e.target.value })}
                    placeholder="0 (instant)"
                    min="0"
                  />
                  <select
                    value={editSettings.rebalanceDelayUnit}
                    onChange={(e) => setEditSettings({ ...editSettings, rebalanceDelayUnit: e.target.value })}
                  >
                    <option value="s">seconds</option>
                    <option value="m">minutes</option>
                    <option value="h">hours</option>
                  </select>
                </div>
              </div>

              <div className="toggle-group">
                <div className="toggle-row">
                  <label>Auto-Rebalance</label>
                  <span className="toggle-description">Rebalance when position goes out of range</span>
                  <button
                    type="button"
                    className={`toggle-btn ${editSettings.autoRebalance ? 'active' : ''}`}
                    onClick={() => setEditSettings({ ...editSettings, autoRebalance: !editSettings.autoRebalance })}
                  >
                    {editSettings.autoRebalance ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="toggle-row">
                  <label>ZAP Mode</label>
                  <span className="toggle-description">Swap tokens to use ALL capital (no leftovers)</span>
                  <button
                    type="button"
                    className={`toggle-btn ${editSettings.useZap ? 'active' : ''}`}
                    onClick={() => setEditSettings({ ...editSettings, useZap: !editSettings.useZap })}
                  >
                    {editSettings.useZap ? 'ON' : 'OFF'}
                  </button>
                </div>
                {editSettings.useZap && (
                  <div className="setting-row slippage-row">
                    <label>Max ZAP Slippage</label>
                    <span className="setting-description">Skip ZAP if slippage exceeds this (0 = no limit)</span>
                    <div className="input-group">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="10"
                        value={(Number(editSettings.maxZapSlippageBps) / 100).toFixed(1)}
                        onChange={(e) => setEditSettings({ ...editSettings, maxZapSlippageBps: String(Math.round(Number(e.target.value) * 100)) })}
                        placeholder="0.5"
                      />
                      <span className="unit">%</span>
                    </div>
                  </div>
                )}
                <div className="toggle-row">
                  <label>Auto-Compound</label>
                  <span className="toggle-description">Reinvest earned fees back into position</span>
                  <button
                    type="button"
                    className={`toggle-btn ${editSettings.autoCompound ? 'active' : ''}`}
                    onClick={() => setEditSettings({ ...editSettings, autoCompound: !editSettings.autoCompound })}
                  >
                    {editSettings.autoCompound ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setEditingVault(null)}>Cancel</button>
              <button className="save-btn" onClick={handleSaveSettings} disabled={saving}>
                {saving ? <><Loader2 size={16} className="spinning" /> Saving...</> : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .my-vaults {
    padding: 24px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 16px;
    margin-top: 24px;
  }

  .vaults-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  .vaults-header h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 20px;
    font-weight: 600;
    color: #E8E8EC;
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #E8E8EC;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .refresh-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: rgba(255, 107, 107, 0.1);
    border: 1px solid rgba(255, 107, 107, 0.2);
    border-radius: 8px;
    color: #FF6B6B;
    margin-bottom: 16px;
  }

  .loading-state, .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    color: #808090;
    gap: 12px;
  }

  .empty-state span {
    font-size: 13px;
    color: #606070;
  }

  .vaults-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .vault-card {
    padding: 20px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
  }

  .vault-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .vault-pair {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .pair-name {
    font-size: 18px;
    font-weight: 600;
    color: #E8E8EC;
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
  }

  .status-badge.active {
    background: rgba(0, 212, 170, 0.1);
    color: #00D4AA;
  }

  .status-badge.inactive {
    background: rgba(0, 163, 255, 0.1);
    color: #00A3FF;
  }

  .vault-cycles {
    font-size: 13px;
    color: #808090;
  }

  .vault-balances {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .balance-row {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
  }

  .balance-row .label {
    color: #808090;
  }

  .balance-row .value {
    color: #E8E8EC;
    font-family: 'SF Mono', monospace;
  }

  .balance-row.fees .value {
    color: #00D4AA;
  }

  .in-position {
    color: #A855F7;
    font-style: italic;
  }

  .position-info {
    background: rgba(168, 85, 247, 0.08);
    border: 1px solid rgba(168, 85, 247, 0.2);
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 12px;
  }

  .position-header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #A855F7;
    font-weight: 500;
    font-size: 14px;
    margin-bottom: 8px;
  }

  .range-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
  }

  .range-badge.in-range {
    background: rgba(0, 212, 170, 0.15);
    color: #00D4AA;
  }

  .range-badge.out-of-range {
    background: rgba(255, 107, 107, 0.15);
    color: #FF6B6B;
  }

  .price-range, .current-price, .position-duration {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #808090;
    margin-top: 6px;
  }

  .price-label, .duration-label {
    color: #606070;
  }

  .price-value {
    color: #E8E8EC;
    font-family: 'SF Mono', monospace;
  }

  .price-value.highlight {
    color: #00D4AA;
    font-weight: 500;
  }

  .position-duration {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px dashed rgba(255, 255, 255, 0.05);
  }

  .duration-value {
    color: #A855F7;
    font-weight: 500;
  }

  .position-amounts {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    padding: 10px 12px;
    background: rgba(0, 212, 170, 0.08);
    border: 1px solid rgba(0, 212, 170, 0.15);
    border-radius: 8px;
  }

  .amounts-label {
    color: #00D4AA;
    font-size: 12px;
    font-weight: 500;
  }

  .amounts-value {
    color: #E8E8EC;
    font-family: 'SF Mono', 'Monaco', monospace;
    font-size: 13px;
    font-weight: 600;
  }

  .balance-row.leftover {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed rgba(255, 255, 255, 0.05);
  }

  .balance-row.leftover .label {
    color: #606070;
  }

  .balance-row.leftover .value {
    color: #808090;
    font-size: 13px;
  }

  .feature-badge {
    background: rgba(0, 212, 170, 0.1);
    color: #00D4AA;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
  }

  .feature-badge.zap {
    background: rgba(255, 230, 109, 0.15);
    color: #FFE66D;
  }

  .feature-badge.compound {
    background: rgba(0, 163, 255, 0.15);
    color: #00A3FF;
  }

  .feature-badge.delay {
    background: rgba(168, 85, 247, 0.15);
    color: #A855F7;
  }

  .position-notice {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: rgba(255, 230, 109, 0.1);
    border: 1px solid rgba(255, 230, 109, 0.2);
    border-radius: 8px;
    color: #FFE66D;
    font-size: 13px;
    margin-bottom: 16px;
  }

  .position-notice.warning {
    background: rgba(255, 107, 107, 0.1);
    border-color: rgba(255, 107, 107, 0.2);
    color: #FF6B6B;
  }

  .vault-actions {
    display: flex;
    gap: 12px;
  }

  .withdraw-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 20px;
    background: linear-gradient(135deg, #00D4AA, #00A3FF);
    border: none;
    border-radius: 10px;
    color: white;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .withdraw-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(0, 212, 170, 0.3);
  }

  .withdraw-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .vault-id {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 11px;
    color: #606070;
    font-family: 'SF Mono', monospace;
  }

  .vault-settings-row {
    display: flex;
    gap: 16px;
    font-size: 13px;
    color: #808090;
    margin-bottom: 12px;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 16px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .pause-btn {
    background: rgba(255, 107, 107, 0.1);
    color: #FF6B6B;
    border-color: rgba(255, 107, 107, 0.2);
  }

  .pause-btn:hover:not(:disabled) {
    background: rgba(255, 107, 107, 0.2);
  }

  .resume-btn {
    background: rgba(0, 212, 170, 0.1);
    color: #00D4AA;
    border-color: rgba(0, 212, 170, 0.2);
  }

  .resume-btn:hover:not(:disabled) {
    background: rgba(0, 212, 170, 0.2);
  }

  .settings-btn {
    background: rgba(168, 85, 247, 0.1);
    color: #A855F7;
    border-color: rgba(168, 85, 247, 0.2);
  }

  .settings-btn:hover {
    background: rgba(168, 85, 247, 0.2);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .withdraw-btn {
    flex: 1;
  }

  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: #1a1a2e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    width: 90%;
    max-width: 400px;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .modal-header h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 600;
    color: #E8E8EC;
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: #808090;
    cursor: pointer;
    padding: 4px;
    display: flex;
  }

  .close-btn:hover {
    color: #E8E8EC;
  }

  .modal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .form-group label {
    font-size: 13px;
    color: #808090;
  }

  .form-group input, .form-group select {
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #E8E8EC;
    font-size: 14px;
  }

  .form-group input:focus, .form-group select:focus {
    outline: none;
    border-color: #A855F7;
  }

  .timer-input-group {
    display: flex;
    gap: 8px;
  }

  .timer-input-group input {
    flex: 1;
  }

  .timer-input-group select {
    width: 100px;
  }

  .modal-footer {
    display: flex;
    gap: 12px;
    padding: 16px 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .cancel-btn {
    flex: 1;
    padding: 10px 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #E8E8EC;
    font-size: 14px;
    cursor: pointer;
  }

  .cancel-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .save-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    background: linear-gradient(135deg, #A855F7, #8B5CF6);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }

  .save-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(168, 85, 247, 0.3);
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .section-divider {
    font-size: 12px;
    font-weight: 600;
    color: #A855F7;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(168, 85, 247, 0.2);
    margin-top: 8px;
  }

  .toggle-group {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
  }

  .toggle-row label {
    font-size: 13px;
    color: #E8E8EC;
    font-weight: 500;
    margin: 0;
  }

  .toggle-description {
    flex: 1;
    font-size: 11px;
    color: #606070;
    margin-left: 8px;
    margin-right: 12px;
  }

  .toggle-btn {
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: #808090;
    min-width: 50px;
  }

  .toggle-btn.active {
    background: rgba(0, 212, 170, 0.2);
    border-color: rgba(0, 212, 170, 0.4);
    color: #00D4AA;
  }

  .toggle-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .slippage-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: rgba(255, 230, 109, 0.05);
    border: 1px solid rgba(255, 230, 109, 0.15);
    border-radius: 8px;
    margin-left: 16px;
  }

  .slippage-row label {
    font-size: 13px;
    color: #FFE66D;
    font-weight: 500;
    margin: 0;
  }

  .slippage-row .setting-description {
    flex: 1;
    font-size: 11px;
    color: #808070;
    margin-left: 8px;
    margin-right: 12px;
  }

  .slippage-row .input-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .slippage-row input {
    width: 60px;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid rgba(255, 230, 109, 0.3);
    background: rgba(0, 0, 0, 0.3);
    color: #FFE66D;
    font-size: 13px;
    text-align: right;
  }

  .slippage-row .unit {
    font-size: 12px;
    color: #808080;
  }

  .toggle-btn.active:hover {
    background: rgba(0, 212, 170, 0.3);
  }

  .performance-btn {
    background: rgba(0, 163, 255, 0.1);
    color: #00A3FF;
    border-color: rgba(0, 163, 255, 0.2);
  }

  .performance-btn:hover {
    background: rgba(0, 163, 255, 0.2);
  }

  .chevron {
    transition: transform 0.2s ease;
  }

  .chevron.rotated {
    transform: rotate(180deg);
  }

  .performance-section {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    animation: slideDown 0.3s ease;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;
