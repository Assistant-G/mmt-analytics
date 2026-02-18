import { useState, useEffect, useMemo } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import {
  Layers,
  RefreshCw,
  AlertCircle,
  Loader2,
  Pause,
  Play,
  Settings,
  X,
  LogOut,
  Clock,
  Zap,
  Repeat,
  TrendingUp,
  Plus,
  DollarSign,
  Percent,
  Gift,
} from 'lucide-react';
import {
  LP_REGISTRY_CONFIG,
  buildPauseTransaction,
  buildResumeTransaction,
  buildExitTransaction,
  buildUpdateSettingsTransaction,
  buildUpdateSettingsWithRebalanceNowTransaction,
  formatRebalanceDelay,
  formatRangePercent,
  formatRecurringCount,
  getPositionStatus,
  getTimeUntilRebalance,
  getPoolTokenTypes,
} from '@/services/lpRegistryService';
import { fetchPositionDetails } from '@/services/mmtService';
import type { LPRegistryPosition, LPRegistrySettings, DelayUnit, Position } from '@/types';
import { DELAY_UNITS } from '@/types';
import { RegisterPositionModal } from './RegisterPositionModal';

// Extended position data with stats
interface PositionWithStats extends LPRegistryPosition {
  positionData?: Position | null;
}

export function LPRegistry() {
  const { address, isConnected } = useWallet();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [positions, setPositions] = useState<PositionWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editingPosition, setEditingPosition] = useState<PositionWithStats | null>(null);
  const [editSettings, setEditSettings] = useState<LPRegistrySettings>({
    autoRebalance: true,
    autoCompound: false,
    recurringCount: 0,
    rebalanceDelayMs: 60000,
    rangePercentBps: 500,
    useZap: true, // Default to true for better liquidity utilization
  });
  // Edit modal state for delay input
  const [editDelayValue, setEditDelayValue] = useState('1');
  const [editDelayUnit, setEditDelayUnit] = useState<DelayUnit>('m');
  // Edit modal state for range input
  const [editRangePercent, setEditRangePercent] = useState(5);
  // Edit modal - range mode (percent or manual price)
  const [editRangeMode, setEditRangeMode] = useState<'percent' | 'manual'>('percent');
  const [editManualMinPrice, setEditManualMinPrice] = useState('');
  const [editManualMaxPrice, setEditManualMaxPrice] = useState('');
  // Edit modal - rebalance now option
  const [rebalanceNow, setRebalanceNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRegisterModal, setShowRegisterModal] = useState(false);

  // Calculate delay in milliseconds from value and unit
  const calculateEditDelayMs = (): number => {
    const val = parseFloat(editDelayValue) || 0;
    const unit = DELAY_UNITS.find(u => u.value === editDelayUnit);
    return Math.round(val * (unit?.multiplierMs || 1000));
  };

  // Format delay for display
  const formatEditDelay = (): string => {
    const ms = calculateEditDelayMs();
    if (ms === 0) return 'Immediate';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h`;
  };

  const fetchPositions = async () => {
    if (!address) {
      setPositions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Query PositionRegistered events
      const events = await suiClient.queryEvents({
        query: {
          MoveEventType: `${LP_REGISTRY_CONFIG.packageId}::lp_registry::PositionRegistered`,
        },
        limit: 100,
      });

      const userPositions: PositionWithStats[] = [];

      for (const event of events.data) {
        const parsedJson = event.parsedJson as Record<string, unknown>;
        if (parsedJson.owner !== address) continue;

        const registryId = parsedJson.registry_id as string;
        const positionId = parsedJson.position_id as string;

        try {
          const regPosObj = await suiClient.getObject({
            id: registryId,
            options: { showContent: true, showType: true },
          });

          if (regPosObj.data?.content?.dataType !== 'moveObject') continue;

          const fields = (regPosObj.data.content as { fields: Record<string, unknown> }).fields;
          const poolId = parsedJson.pool_id as string;

          // Fetch detailed position data from MMT SDK
          // Pass registryId since position is stored in RegisteredPosition's dynamic field
          const positionData = await fetchPositionDetails(registryId);

          // Get token types - prefer from position object (most reliable), fallback to pool
          let tokenXType = positionData?.tokenXType || positionData?.pool?.tokenA?.address || '';
          let tokenYType = positionData?.tokenYType || positionData?.pool?.tokenB?.address || '';

          // If token types are still missing, get them directly from pool lookup
          if (!tokenXType || !tokenYType) {
            const poolTokenTypes = await getPoolTokenTypes(poolId);
            if (poolTokenTypes) {
              tokenXType = tokenXType || poolTokenTypes.tokenXType;
              tokenYType = tokenYType || poolTokenTypes.tokenYType;
            }
          }

          // Get the exact position type from blockchain (most reliable for Exit)
          const positionType = positionData?.positionType || '';
          console.log('Token types for position:', { tokenXType, tokenYType, positionType, poolId });

          userPositions.push({
            id: registryId,
            positionId,
            owner: parsedJson.owner as string,
            poolId,
            tokenXType,
            tokenYType,
            positionType,

            autoRebalance: (fields.auto_rebalance as boolean) || false,
            autoCompound: (fields.auto_compound as boolean) || false,
            recurringCount: Number(fields.recurring_count || 0),

            rebalanceDelayMs: Number(fields.rebalance_delay_ms || 0),
            rangePercentBps: Number(fields.range_percent_bps || 500),
            useZap: (fields.use_zap as boolean) ?? true, // Default to true for better UX

            isPaused: (fields.is_paused as boolean) || false,
            isPositionHeld: (fields.is_position_held as boolean) || false,
            rebalancePending: (fields.rebalance_pending as boolean) || false,
            outOfRangeSince: Number(fields.out_of_range_since || 0),

            rebalanceCount: Number(fields.rebalance_count || 0),
            compoundCount: Number(fields.compound_count || 0),
            registeredAt: Number(fields.registered_at || 0),
            lastActivityAt: Number(fields.last_activity_at || 0),

            // Add position stats
            isInRange: positionData?.isInRange,
            totalValueUsd: positionData?.totalValueUsd,
            tickLower: positionData?.tickLower,
            tickUpper: positionData?.tickUpper,
            currentTick: positionData?.pool?.currentTick,
            liquidity: positionData?.liquidity,

            // Extended data
            positionData,
          });
        } catch (e) {
          // Position may have been exited
          continue;
        }
      }

      setPositions(userPositions);
    } catch (e: any) {
      console.error('Failed to fetch positions:', e);
      setError('Failed to load positions. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPositions();
  }, [address]);

  const handlePauseResume = async (position: LPRegistryPosition) => {
    setActionLoading(position.id);
    setError(null);

    try {
      const tx = position.isPaused
        ? buildResumeTransaction(position.id)
        : buildPauseTransaction(position.id);

      await signAndExecute({ transaction: tx });
      await fetchPositions();
    } catch (e: any) {
      console.error('Pause/Resume failed:', e);
      setError(e.message || 'Operation failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleExit = async (position: LPRegistryPosition) => {
    if (!confirm('Are you sure you want to exit and retrieve your position?')) return;

    setActionLoading(position.id);
    setError(null);

    try {
      const tx = buildExitTransaction(
        position.id,
        position.tokenXType,
        position.tokenYType,
        position.positionType // Pass exact type from blockchain
      );

      await signAndExecute({ transaction: tx });
      await fetchPositions();
    } catch (e: any) {
      console.error('Exit failed:', e);
      setError(e.message || 'Exit failed');
    } finally {
      setActionLoading(null);
    }
  };

  const openEditSettings = (position: PositionWithStats) => {
    setEditSettings({
      autoRebalance: position.autoRebalance,
      autoCompound: position.autoCompound,
      recurringCount: position.recurringCount,
      rebalanceDelayMs: position.rebalanceDelayMs,
      rangePercentBps: position.rangePercentBps,
      useZap: position.useZap,
    });
    // Initialize delay input from position
    const delayMs = position.rebalanceDelayMs;
    if (delayMs >= 3600000) {
      setEditDelayValue(String(delayMs / 3600000));
      setEditDelayUnit('h');
    } else if (delayMs >= 60000) {
      setEditDelayValue(String(delayMs / 60000));
      setEditDelayUnit('m');
    } else {
      setEditDelayValue(String(delayMs / 1000));
      setEditDelayUnit('s');
    }
    // Initialize range from position (bps to percent)
    setEditRangePercent(position.rangePercentBps / 100);
    // Reset range mode to percent and initialize manual prices
    setEditRangeMode('percent');
    if (position.positionData?.pool?.priceTokenB) {
      const currentPrice = position.positionData.pool.priceTokenB;
      const percent = position.rangePercentBps / 10000;
      setEditManualMinPrice((currentPrice * (1 - percent)).toPrecision(6));
      setEditManualMaxPrice((currentPrice * (1 + percent)).toPrecision(6));
    }
    // Reset rebalance now
    setRebalanceNow(false);
    setEditingPosition(position);
  };

  // Calculate range BPS from manual prices for Edit modal
  const calculateEditRangeBps = (): number => {
    if (editRangeMode === 'percent') {
      return Math.round(editRangePercent * 100);
    }
    // For manual mode, calculate from prices
    if (editingPosition?.positionData?.pool?.priceTokenB && editManualMinPrice && editManualMaxPrice) {
      const min = parseFloat(editManualMinPrice);
      const max = parseFloat(editManualMaxPrice);
      const current = editingPosition.positionData.pool.priceTokenB;
      if (min > 0 && max > 0 && current > 0 && min < max) {
        const lowerDiff = Math.abs((current - min) / current);
        const upperDiff = Math.abs((max - current) / current);
        const avgPercent = (lowerDiff + upperDiff) / 2;
        return Math.round(avgPercent * 10000);
      }
    }
    return Math.round(editRangePercent * 100);
  };

  // Calculate display range for Edit modal
  const editDisplayRange = useMemo(() => {
    if (!editingPosition?.positionData?.pool?.priceTokenB) {
      return { min: 0, max: 0, percent: editRangePercent };
    }
    const current = editingPosition.positionData.pool.priceTokenB;

    if (editRangeMode === 'percent') {
      const percent = editRangePercent / 100;
      return {
        min: current * (1 - percent),
        max: current * (1 + percent),
        percent: editRangePercent,
      };
    }

    const min = parseFloat(editManualMinPrice) || 0;
    const max = parseFloat(editManualMaxPrice) || 0;
    let percent = 0;
    if (min > 0 && max > 0 && current > 0) {
      const lowerDiff = Math.abs((current - min) / current) * 100;
      const upperDiff = Math.abs((max - current) / current) * 100;
      percent = (lowerDiff + upperDiff) / 2;
    }
    return { min, max, percent };
  }, [editingPosition, editRangeMode, editRangePercent, editManualMinPrice, editManualMaxPrice]);

  const handleSaveSettings = async () => {
    if (!editingPosition) return;
    setSaving(true);
    setError(null);

    try {
      const finalSettings: LPRegistrySettings = {
        ...editSettings,
        rebalanceDelayMs: calculateEditDelayMs(),
        rangePercentBps: calculateEditRangeBps(),
      };

      // If "Rebalance Now" is checked, use the combined transaction that also requests rebalance
      const tx = rebalanceNow
        ? buildUpdateSettingsWithRebalanceNowTransaction(
            editingPosition.id,
            finalSettings
          )
        : buildUpdateSettingsTransaction(editingPosition.id, finalSettings);

      await signAndExecute({ transaction: tx });
      setEditingPosition(null);
      await fetchPositions();
    } catch (e: unknown) {
      console.error('Update settings failed:', e);
      const errorMessage = e instanceof Error ? e.message : 'Update failed';
      setError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const formatTime = (ms: number) => {
    if (ms === 0) return 'Never';
    const date = new Date(ms);
    return date.toLocaleString();
  };

  if (!isConnected) {
    return (
      <div className="lp-registry">
        <div className="registry-header">
          <h2><Layers size={24} /> LP Registry</h2>
        </div>
        <div className="empty-state">
          <p>Connect your wallet to view your registered positions</p>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="lp-registry">
      <div className="registry-header">
        <div className="header-left">
          <h2><Layers size={24} /> LP Registry</h2>
          <span className="subtitle">Automated position management</span>
        </div>
        <div className="header-actions">
          <button className="register-btn" onClick={() => setShowRegisterModal(true)}>
            <Plus size={16} />
            Register Position
          </button>
          <button className="refresh-btn" onClick={fetchPositions} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="features-info">
        <div className="feature">
          <Zap size={16} />
          <span>Auto-Rebalance</span>
        </div>
        <div className="feature">
          <Repeat size={16} />
          <span>Auto-Compound</span>
        </div>
        <div className="feature">
          <Clock size={16} />
          <span>Delay Timer</span>
        </div>
        <div className="feature">
          <TrendingUp size={16} />
          <span>Hidden from Trackers</span>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">
          <Loader2 size={24} className="spinning" />
          <p>Loading positions...</p>
        </div>
      ) : positions.length === 0 ? (
        <div className="empty-state">
          <Layers size={48} />
          <p>No registered positions</p>
          <span>Register a position to enable automated management</span>
          <button className="cta-btn" onClick={() => setShowRegisterModal(true)}>
            <Plus size={16} />
            Register Your First Position
          </button>
        </div>
      ) : (
        <div className="positions-list">
          {positions.map((position) => {
            const status = getPositionStatus(position);
            const timeUntilRebalance = getTimeUntilRebalance(position);
            const posData = position.positionData;

            // Calculate APY from APR (compound daily)
            const apr = posData?.apr || 0;
            const apy = apr > 0 ? (Math.pow(1 + apr / 100 / 365, 365) - 1) * 100 : 0;

            return (
              <div key={position.id} className="position-card">
                <div className="position-header">
                  <div className="position-info">
                    {posData?.pool ? (
                      <span className="position-pair">
                        {posData.pool.tokenA.symbol}/{posData.pool.tokenB.symbol}
                      </span>
                    ) : (
                      <span className="position-id">
                        {position.id.slice(0, 8)}...{position.id.slice(-6)}
                      </span>
                    )}
                    <span className={`status-badge ${status.color}`}>
                      {status.label}
                    </span>
                    {posData && (
                      <span className={`range-badge ${posData.isInRange ? 'in-range' : 'out-of-range'}`}>
                        {posData.isInRange ? 'In Range' : 'Out of Range'}
                      </span>
                    )}
                  </div>
                  <div className="position-pool">
                    Pool: {position.poolId.slice(0, 8)}...
                  </div>
                </div>

                {/* Value Stats Section */}
                {posData && (
                  <div className="value-stats">
                    <div className="value-stat main">
                      <DollarSign size={16} />
                      <div className="value-content">
                        <span className="value-label">Current Value</span>
                        <span className="value-amount">${posData.totalValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                    <div className="value-stat">
                      <span className="value-label">Deposited</span>
                      <span className="value-amount">${posData.depositedValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="value-stat">
                      <span className="value-label">ROI</span>
                      <span className={`value-amount ${posData.roi >= 0 ? 'positive' : 'negative'}`}>
                        {posData.roi >= 0 ? '+' : ''}{posData.roi.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                )}

                {/* APR/Fees/Rewards Section */}
                {posData && (
                  <div className="performance-stats">
                    <div className="perf-stat">
                      <Percent size={14} />
                      <div>
                        <span className="perf-label">APR</span>
                        <span className="perf-value">{apr.toFixed(2)}%</span>
                      </div>
                    </div>
                    <div className="perf-stat">
                      <TrendingUp size={14} />
                      <div>
                        <span className="perf-label">APY</span>
                        <span className="perf-value">{apy.toFixed(2)}%</span>
                      </div>
                    </div>
                    <div className="perf-stat">
                      <DollarSign size={14} />
                      <div>
                        <span className="perf-label">Fees</span>
                        <span className="perf-value fees">+${posData.uncollectedFeesUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                    <div className="perf-stat">
                      <Gift size={14} />
                      <div>
                        <span className="perf-label">Rewards</span>
                        <span className="perf-value rewards">+${posData.claimableRewardsUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Price Range */}
                {posData && (
                  <div className="price-range-info">
                    <span className="range-label">Range:</span>
                    <span className="range-prices">
                      {posData.priceLower.toPrecision(6)} - {posData.priceUpper.toPrecision(6)}
                    </span>
                    <span className="current-price">
                      Current: {posData.pool.priceTokenB.toPrecision(6)}
                    </span>
                  </div>
                )}

                <div className="position-features">
                  <div className={`feature-toggle ${position.autoRebalance ? 'enabled' : 'disabled'}`}>
                    <Zap size={14} />
                    Auto-Rebalance
                  </div>
                  <div className={`feature-toggle ${position.autoCompound ? 'enabled' : 'disabled'}`}>
                    <Repeat size={14} />
                    Auto-Compound
                  </div>
                </div>

                <div className="position-settings">
                  <div className="setting">
                    <span className="label">Rebalance Delay:</span>
                    <span className="value">{formatRebalanceDelay(position.rebalanceDelayMs)}</span>
                  </div>
                  <div className="setting">
                    <span className="label">New Range:</span>
                    <span className="value">{formatRangePercent(position.rangePercentBps)}</span>
                  </div>
                  <div className="setting">
                    <span className="label">Cycles Left:</span>
                    <span className="value">{formatRecurringCount(position.recurringCount)}</span>
                  </div>
                  <div className="setting">
                    <span className="label">ZAP Mode:</span>
                    <span className="value">{position.useZap ? 'ON' : 'OFF'}</span>
                  </div>
                </div>

                {position.rebalancePending && timeUntilRebalance !== null && (
                  <div className="pending-notice">
                    <Clock size={14} />
                    Rebalance in {Math.ceil(timeUntilRebalance / 1000)}s
                  </div>
                )}

                <div className="position-stats">
                  <div className="stat">
                    <span className="stat-value">{position.rebalanceCount}</span>
                    <span className="stat-label">Rebalances</span>
                  </div>
                  <div className="stat">
                    <span className="stat-value">{position.compoundCount}</span>
                    <span className="stat-label">Compounds</span>
                  </div>
                  <div className="stat">
                    <span className="stat-value">{formatTime(position.lastActivityAt)}</span>
                    <span className="stat-label">Last Activity</span>
                  </div>
                </div>

                <div className="position-actions">
                  <button
                    className={`action-btn ${position.isPaused ? 'resume-btn' : 'pause-btn'}`}
                    onClick={() => handlePauseResume(position)}
                    disabled={actionLoading === position.id || position.isPositionHeld}
                  >
                    {actionLoading === position.id ? (
                      <Loader2 size={16} className="spinning" />
                    ) : position.isPaused ? (
                      <><Play size={16} /> Resume</>
                    ) : (
                      <><Pause size={16} /> Pause</>
                    )}
                  </button>
                  <button
                    className="action-btn settings-btn"
                    onClick={() => openEditSettings(position)}
                    disabled={position.isPositionHeld}
                  >
                    <Settings size={16} /> Edit
                  </button>
                  <button
                    className="action-btn exit-btn"
                    onClick={() => handleExit(position)}
                    disabled={actionLoading === position.id || position.isPositionHeld}
                  >
                    <LogOut size={16} /> Exit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Settings Modal */}
      {editingPosition && (
        <div className="modal-overlay" onClick={() => setEditingPosition(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><Settings size={20} /> Edit Position Settings</h3>
              <button className="close-btn" onClick={() => setEditingPosition(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Features</label>
                <div className="toggle-row">
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={editSettings.autoRebalance}
                      onChange={(e) => setEditSettings({ ...editSettings, autoRebalance: e.target.checked })}
                    />
                    <span>Auto-Rebalance</span>
                  </label>
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={editSettings.autoCompound}
                      onChange={(e) => setEditSettings({ ...editSettings, autoCompound: e.target.checked })}
                    />
                    <span>Auto-Compound</span>
                  </label>
                </div>
                <div className="toggle-row" style={{ marginTop: '8px' }}>
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={editSettings.useZap}
                      onChange={(e) => setEditSettings({ ...editSettings, useZap: e.target.checked })}
                    />
                    <span>ZAP Mode (use ALL liquidity)</span>
                  </label>
                </div>
                <p className="hint" style={{ marginTop: '4px', fontSize: '11px', color: '#888' }}>
                  ZAP swaps excess tokens to maximize liquidity in new position
                </p>
              </div>

              <div className="form-group">
                <label>Rebalance Delay</label>
                <div className="delay-input-group">
                  <input
                    type="number"
                    value={editDelayValue}
                    onChange={(e) => setEditDelayValue(e.target.value)}
                    min="0"
                    step="1"
                    placeholder="1"
                    className="delay-value-input"
                  />
                  <div className="delay-unit-buttons">
                    {DELAY_UNITS.map((unit) => (
                      <button
                        key={unit.value}
                        type="button"
                        className={`delay-unit-btn ${editDelayUnit === unit.value ? 'active' : ''}`}
                        onClick={() => setEditDelayUnit(unit.value)}
                      >
                        {unit.value}
                      </button>
                    ))}
                  </div>
                </div>
                <span className="hint">Wait {formatEditDelay()} before rebalancing (price may return to range)</span>
              </div>

              {/* Range Width - By Percent or Manual Price */}
              <div className="form-group">
                <label>Range Width</label>

                {/* Mode Toggle */}
                <div className="range-mode-toggle">
                  <button
                    type="button"
                    className={`range-mode-btn ${editRangeMode === 'percent' ? 'active' : ''}`}
                    onClick={() => setEditRangeMode('percent')}
                  >
                    By Percent
                  </button>
                  <button
                    type="button"
                    className={`range-mode-btn ${editRangeMode === 'manual' ? 'active' : ''}`}
                    onClick={() => setEditRangeMode('manual')}
                  >
                    Manual Price
                  </button>
                </div>

                {/* Percent Mode - Slider */}
                {editRangeMode === 'percent' && (
                  <div className="percent-slider-container">
                    <input
                      type="range"
                      min="0.1"
                      max="100"
                      step="0.1"
                      value={editRangePercent}
                      onChange={(e) => setEditRangePercent(parseFloat(e.target.value))}
                      className="range-slider"
                    />
                    <div className="slider-labels">
                      <span>Narrow</span>
                      <span className="current-percent">±{editRangePercent.toFixed(1)}%</span>
                      <span>Wide</span>
                    </div>
                  </div>
                )}

                {/* Manual Mode - Price inputs */}
                {editRangeMode === 'manual' && editingPosition?.positionData?.pool && (
                  <div className="manual-price-inputs">
                    <div className="price-input-group">
                      <label className="price-label">Min Price</label>
                      <input
                        type="number"
                        value={editManualMinPrice}
                        onChange={(e) => setEditManualMinPrice(e.target.value)}
                        placeholder="0.00"
                        step="any"
                        className="price-input"
                      />
                    </div>
                    <div className="current-price-display">
                      Current: {editingPosition.positionData.pool.priceTokenB.toPrecision(6)}
                    </div>
                    <div className="price-input-group">
                      <label className="price-label">Max Price</label>
                      <input
                        type="number"
                        value={editManualMaxPrice}
                        onChange={(e) => setEditManualMaxPrice(e.target.value)}
                        placeholder="0.00"
                        step="any"
                        className="price-input"
                      />
                    </div>
                  </div>
                )}

                {/* Range Preview */}
                <div className="range-preview">
                  <span>Range: {editDisplayRange.min.toPrecision(6)} - {editDisplayRange.max.toPrecision(6)}</span>
                  <span className="range-percent">(±{editDisplayRange.percent.toFixed(1)}%)</span>
                </div>
              </div>

              <div className="form-group">
                <label>Recurring Cycles (0 = infinite)</label>
                <input
                  type="number"
                  value={editSettings.recurringCount}
                  onChange={(e) => setEditSettings({ ...editSettings, recurringCount: Number(e.target.value) })}
                  min="0"
                  placeholder="0"
                />
              </div>

              {/* Rebalance NOW option */}
              <div className="form-group rebalance-now-section">
                <label className="toggle-label rebalance-now-toggle">
                  <input
                    type="checkbox"
                    checked={rebalanceNow}
                    onChange={(e) => setRebalanceNow(e.target.checked)}
                  />
                  <Zap size={16} className="zap-icon" />
                  <span>Rebalance NOW</span>
                </label>
                {rebalanceNow && (
                  <span className="hint warning">
                    Position will rebalance immediately on next check (within ~30 seconds)
                  </span>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setEditingPosition(null)}>Cancel</button>
              <button
                className={`save-btn ${rebalanceNow ? 'rebalance-now' : ''}`}
                onClick={handleSaveSettings}
                disabled={saving}
              >
                {saving ? (
                  <><Loader2 size={16} className="spinning" /> Saving...</>
                ) : rebalanceNow ? (
                  <><Zap size={16} /> Save & Rebalance</>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Register Position Modal */}
      {showRegisterModal && (
        <RegisterPositionModal
          onClose={() => setShowRegisterModal(false)}
          onSuccess={() => {
            setShowRegisterModal(false);
            fetchPositions();
          }}
        />
      )}

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .lp-registry {
    padding: 24px;
  }

  .registry-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  }

  .header-left h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 24px;
    font-weight: 600;
    color: #E8E8EC;
    margin: 0;
  }

  .subtitle {
    font-size: 14px;
    color: #808090;
    margin-top: 4px;
  }

  .header-actions {
    display: flex;
    gap: 12px;
  }

  .register-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: linear-gradient(135deg, #00D4AA, #00A3FF);
    border: none;
    border-radius: 10px;
    color: white;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .register-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(0, 212, 170, 0.3);
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    color: #E8E8EC;
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

  .features-info {
    display: flex;
    gap: 24px;
    padding: 16px 20px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 12px;
    margin-bottom: 24px;
  }

  .features-info .feature {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #00D4AA;
  }

  .loading-state, .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 24px;
    color: #808090;
    gap: 12px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 16px;
  }

  .empty-state span {
    font-size: 13px;
    color: #606070;
  }

  .cta-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    padding: 12px 24px;
    background: linear-gradient(135deg, #00D4AA, #00A3FF);
    border: none;
    border-radius: 10px;
    color: white;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }

  .positions-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: 20px;
  }

  .position-card {
    padding: 20px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    transition: all 0.2s;
  }

  .position-card:hover {
    border-color: rgba(255, 255, 255, 0.1);
  }

  .position-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;
  }

  .position-info {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .position-id {
    font-family: 'SF Mono', monospace;
    font-size: 14px;
    color: #E8E8EC;
  }

  .status-badge {
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .status-badge.green {
    background: rgba(0, 212, 170, 0.15);
    color: #00D4AA;
  }

  .status-badge.yellow {
    background: rgba(255, 230, 109, 0.15);
    color: #FFE66D;
  }

  .status-badge.red {
    background: rgba(255, 107, 107, 0.15);
    color: #FF6B6B;
  }

  .status-badge.blue {
    background: rgba(0, 163, 255, 0.15);
    color: #00A3FF;
  }

  .status-badge.gray {
    background: rgba(128, 128, 144, 0.15);
    color: #808090;
  }

  .position-pool {
    font-size: 12px;
    color: #606070;
    font-family: 'SF Mono', monospace;
  }

  .position-pair {
    font-size: 18px;
    font-weight: 600;
    color: #E8E8EC;
  }

  .range-badge {
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .range-badge.in-range {
    background: rgba(0, 212, 170, 0.15);
    color: #00D4AA;
  }

  .range-badge.out-of-range {
    background: rgba(255, 107, 107, 0.15);
    color: #FF6B6B;
  }

  /* Value Stats Section */
  .value-stats {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: 12px;
    padding: 16px;
    background: linear-gradient(135deg, rgba(0, 212, 170, 0.1), rgba(0, 163, 255, 0.1));
    border: 1px solid rgba(0, 212, 170, 0.2);
    border-radius: 12px;
    margin-bottom: 16px;
  }

  .value-stat {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .value-stat.main {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
  }

  .value-stat.main svg {
    color: #00D4AA;
  }

  .value-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .value-label {
    font-size: 11px;
    color: #808090;
    text-transform: uppercase;
  }

  .value-amount {
    font-size: 18px;
    font-weight: 600;
    color: #E8E8EC;
  }

  .value-stat:not(.main) .value-amount {
    font-size: 14px;
  }

  .value-amount.positive {
    color: #00D4AA;
  }

  .value-amount.negative {
    color: #FF6B6B;
  }

  /* Performance Stats Section */
  .performance-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    padding: 14px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 10px;
    margin-bottom: 16px;
  }

  .perf-stat {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .perf-stat svg {
    color: #606070;
  }

  .perf-stat > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .perf-label {
    font-size: 10px;
    color: #606070;
    text-transform: uppercase;
  }

  .perf-value {
    font-size: 14px;
    font-weight: 600;
    color: #E8E8EC;
  }

  .perf-value.fees {
    color: #00D4AA;
  }

  .perf-value.rewards {
    color: #A855F7;
  }

  /* Price Range Info */
  .price-range-info {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    margin-bottom: 16px;
    font-size: 12px;
  }

  .price-range-info .range-label {
    color: #606070;
    text-transform: uppercase;
    font-size: 10px;
  }

  .range-prices {
    color: #E8E8EC;
    font-family: 'SF Mono', monospace;
  }

  .current-price {
    margin-left: auto;
    color: #00A3FF;
    font-family: 'SF Mono', monospace;
  }

  .position-features {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
  }

  .feature-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
  }

  .feature-toggle.enabled {
    background: rgba(0, 212, 170, 0.1);
    color: #00D4AA;
  }

  .feature-toggle.disabled {
    background: rgba(128, 128, 144, 0.1);
    color: #606070;
  }

  .position-settings {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 10px;
    margin-bottom: 16px;
  }

  .setting {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .setting .label {
    font-size: 11px;
    color: #606070;
    text-transform: uppercase;
  }

  .setting .value {
    font-size: 14px;
    color: #E8E8EC;
    font-weight: 500;
  }

  .pending-notice {
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

  .position-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 16px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .stat-value {
    font-size: 16px;
    font-weight: 600;
    color: #E8E8EC;
  }

  .stat-label {
    font-size: 11px;
    color: #606070;
  }

  .position-actions {
    display: flex;
    gap: 10px;
  }

  .action-btn {
    flex: 1;
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

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

  .settings-btn:hover:not(:disabled) {
    background: rgba(168, 85, 247, 0.2);
  }

  .exit-btn {
    background: rgba(255, 159, 64, 0.1);
    color: #FF9F40;
    border-color: rgba(255, 159, 64, 0.2);
  }

  .exit-btn:hover:not(:disabled) {
    background: rgba(255, 159, 64, 0.2);
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
    max-width: 480px;
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .modal-header h3 {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 18px;
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
    border-radius: 6px;
    transition: all 0.2s;
  }

  .close-btn:hover {
    color: #E8E8EC;
    background: rgba(255, 255, 255, 0.1);
  }

  .modal-body {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .form-group label {
    font-size: 13px;
    font-weight: 500;
    color: #A0A0B0;
  }

  .form-group input[type="number"],
  .form-group select {
    padding: 12px 14px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    color: #E8E8EC;
    font-size: 14px;
    transition: all 0.2s;
  }

  .form-group input[type="number"]:focus,
  .form-group select:focus {
    outline: none;
    border-color: #00D4AA;
  }

  .form-group .hint {
    font-size: 11px;
    color: #606070;
    margin-top: 4px;
  }

  /* Delay input group */
  .delay-input-group {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .delay-value-input {
    width: 80px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    color: #E8E8EC;
    font-size: 14px;
    text-align: center;
  }

  .delay-value-input:focus {
    outline: none;
    border-color: #00D4AA;
  }

  .delay-unit-buttons {
    display: flex;
    gap: 4px;
  }

  .delay-unit-btn {
    padding: 10px 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #808090;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .delay-unit-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #E8E8EC;
  }

  .delay-unit-btn.active {
    background: rgba(0, 212, 170, 0.15);
    border-color: rgba(0, 212, 170, 0.3);
    color: #00D4AA;
  }

  /* Range slider */
  .range-slider {
    width: 100%;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    outline: none;
    cursor: pointer;
    margin: 8px 0;
  }

  .range-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    background: linear-gradient(135deg, #00D4AA, #00A3FF);
    border-radius: 50%;
    cursor: pointer;
    border: 2px solid #1a1a2e;
  }

  .range-slider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    background: linear-gradient(135deg, #00D4AA, #00A3FF);
    border-radius: 50%;
    cursor: pointer;
    border: 2px solid #1a1a2e;
  }

  .slider-labels {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #606070;
    margin-bottom: 4px;
  }

  .toggle-row {
    display: flex;
    gap: 16px;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 14px;
    color: #E8E8EC;
  }

  .toggle-label input {
    width: 18px;
    height: 18px;
    accent-color: #00D4AA;
  }

  .modal-footer {
    display: flex;
    gap: 12px;
    padding: 20px 24px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .cancel-btn {
    flex: 1;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    color: #E8E8EC;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
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
    padding: 12px 16px;
    background: linear-gradient(135deg, #00D4AA, #00A3FF);
    border: none;
    border-radius: 10px;
    color: white;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .save-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(0, 212, 170, 0.3);
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .save-btn.rebalance-now {
    background: linear-gradient(135deg, #FFE66D, #FF9500);
  }

  .save-btn.rebalance-now:hover:not(:disabled) {
    box-shadow: 0 4px 20px rgba(255, 230, 109, 0.3);
  }

  /* Range Mode Toggle */
  .range-mode-toggle {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .range-mode-btn {
    flex: 1;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #808090;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .range-mode-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .range-mode-btn.active {
    background: rgba(0, 212, 170, 0.15);
    border-color: #00D4AA;
    color: #00D4AA;
  }

  /* Percent Slider Container */
  .percent-slider-container {
    margin-bottom: 8px;
  }

  .current-percent {
    color: #00D4AA;
    font-weight: 600;
  }

  /* Manual Price Inputs */
  .manual-price-inputs {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }

  .price-input-group {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .price-label {
    font-size: 11px;
    color: #808090;
    text-transform: uppercase;
  }

  .price-input {
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #E8E8EC;
    font-size: 14px;
    width: 100%;
  }

  .price-input:focus {
    outline: none;
    border-color: #00D4AA;
  }

  .current-price-display {
    font-size: 12px;
    color: #00D4AA;
    white-space: nowrap;
    padding-top: 20px;
  }

  /* Range Preview */
  .range-preview {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #808090;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 6px;
    margin-top: 8px;
  }

  .range-preview .range-percent {
    color: #00D4AA;
  }

  /* Rebalance Now Section */
  .rebalance-now-section {
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    padding-top: 16px;
    margin-top: 8px;
  }

  .rebalance-now-toggle {
    color: #FFE66D;
  }

  .rebalance-now-toggle .zap-icon {
    color: #FFE66D;
  }

  .hint.warning {
    color: #FFE66D;
  }
`;
