import { useState, useEffect, useMemo } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import {
  X,
  Loader2,
  Layers,
  Zap,
  Repeat,
  Clock,
  ChevronRight,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { buildRegisterPositionTransactionAsync } from '@/services/lpRegistryService';
import { fetchPositions as fetchMMTPositions } from '@/services/mmtService';
import type { LPRegistrySettings, DelayUnit } from '@/types';
import { DELAY_UNITS } from '@/types';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

interface UserPosition {
  id: string;
  poolId: string;
  tokenXType: string;
  tokenYType: string;
  tokenXSymbol: string;
  tokenYSymbol: string;
  liquidity: string;
  // Additional info for display
  totalValueUsd: number;
  isInRange: boolean;
  priceLower: number;
  priceUpper: number;
  currentPrice: number;
  uncollectedFeesUsd: number;
  apr: number;
}

export function RegisterPositionModal({ onClose, onSuccess }: Props) {
  const { address } = useWallet();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [step, setStep] = useState<'select' | 'configure'>('select');
  const [positions, setPositions] = useState<UserPosition[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(true);
  const [selectedPosition, setSelectedPosition] = useState<UserPosition | null>(null);

  // Range settings
  const [rangeMode, setRangeMode] = useState<'percent' | 'manual'>('percent');
  const [rangePercent, setRangePercent] = useState(5); // 5% default
  const [manualMinPrice, setManualMinPrice] = useState('');
  const [manualMaxPrice, setManualMaxPrice] = useState('');

  // Delay settings
  const [delayValue, setDelayValue] = useState('1');
  const [delayUnit, setDelayUnit] = useState<DelayUnit>('m');

  const [settings, setSettings] = useState<LPRegistrySettings>({
    autoRebalance: true,
    autoCompound: false,
    recurringCount: 0,
    rebalanceDelayMs: 60000, // 1 minute default
    rangePercentBps: 500, // 5% default
    useZap: true, // Default ON for better liquidity utilization
  });
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate delay in milliseconds from value and unit
  const calculateDelayMs = (): number => {
    const val = parseFloat(delayValue) || 0;
    const unit = DELAY_UNITS.find(u => u.value === delayUnit);
    return Math.round(val * (unit?.multiplierMs || 1000));
  };

  // Calculate range in basis points from percent
  const calculateRangeBps = (): number => {
    if (rangeMode === 'percent') {
      return Math.round(rangePercent * 100); // 5% -> 500 bps
    }
    // For manual mode, calculate from prices
    if (selectedPosition && manualMinPrice && manualMaxPrice) {
      const min = parseFloat(manualMinPrice);
      const max = parseFloat(manualMaxPrice);
      const current = selectedPosition.currentPrice;
      if (min > 0 && max > 0 && current > 0 && min < max) {
        // Calculate approximate range percentage from current price
        const lowerDiff = Math.abs((current - min) / current);
        const upperDiff = Math.abs((max - current) / current);
        const avgPercent = (lowerDiff + upperDiff) / 2;
        return Math.round(avgPercent * 10000); // Convert to bps
      }
    }
    return 500; // Default 5%
  };

  // Format delay for display
  const formatDelay = (): string => {
    const ms = calculateDelayMs();
    if (ms === 0) return 'Immediate';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h`;
  };

  // Fetch user's MMT positions using the SDK (same as My Positions page)
  useEffect(() => {
    const loadPositions = async () => {
      if (!address) return;

      setLoadingPositions(true);
      setError(null);
      try {
        // Use the MMT SDK to fetch positions (same method as My Positions page)
        const mmtPositions = await fetchMMTPositions(address);

        const userPositions: UserPosition[] = mmtPositions.map(pos => ({
          id: pos.id,
          poolId: pos.poolId,
          tokenXType: pos.pool.tokenA.address,
          tokenYType: pos.pool.tokenB.address,
          tokenXSymbol: pos.pool.tokenA.symbol,
          tokenYSymbol: pos.pool.tokenB.symbol,
          liquidity: pos.liquidity,
          totalValueUsd: pos.totalValueUsd,
          isInRange: pos.isInRange,
          priceLower: pos.priceLower,
          priceUpper: pos.priceUpper,
          currentPrice: pos.pool.priceTokenB,
          uncollectedFeesUsd: pos.uncollectedFeesUsd,
          apr: pos.apr,
        }));

        setPositions(userPositions);
      } catch (e) {
        console.error('Failed to fetch positions:', e);
        setError('Failed to load positions');
      } finally {
        setLoadingPositions(false);
      }
    };

    loadPositions();
  }, [address]);

  // When position is selected, initialize manual prices
  useEffect(() => {
    if (selectedPosition && rangeMode === 'manual') {
      const current = selectedPosition.currentPrice;
      const percent = rangePercent / 100;
      setManualMinPrice((current * (1 - percent)).toPrecision(6));
      setManualMaxPrice((current * (1 + percent)).toPrecision(6));
    }
  }, [selectedPosition, rangeMode]);

  const handleSelectPosition = (position: UserPosition) => {
    setSelectedPosition(position);
    setStep('configure');
  };

  // Calculate display range based on mode
  const displayRange = useMemo(() => {
    if (!selectedPosition) return { min: 0, max: 0, percent: rangePercent };

    if (rangeMode === 'percent') {
      const current = selectedPosition.currentPrice;
      const percent = rangePercent / 100;
      return {
        min: current * (1 - percent),
        max: current * (1 + percent),
        percent: rangePercent,
      };
    }

    const min = parseFloat(manualMinPrice) || 0;
    const max = parseFloat(manualMaxPrice) || 0;
    const current = selectedPosition.currentPrice;
    let percent = 0;
    if (min > 0 && max > 0 && current > 0) {
      const lowerDiff = Math.abs((current - min) / current) * 100;
      const upperDiff = Math.abs((max - current) / current) * 100;
      percent = (lowerDiff + upperDiff) / 2;
    }
    return { min, max, percent };
  }, [selectedPosition, rangeMode, rangePercent, manualMinPrice, manualMaxPrice]);

  const handleRegister = async () => {
    if (!selectedPosition) return;

    setRegistering(true);
    setError(null);

    try {
      const finalSettings: LPRegistrySettings = {
        ...settings,
        rebalanceDelayMs: calculateDelayMs(),
        rangePercentBps: calculateRangeBps(),
      };

      // Use async version that fetches the actual position type from blockchain
      const tx = await buildRegisterPositionTransactionAsync(
        selectedPosition.id,
        selectedPosition.poolId,
        finalSettings
      );

      await signAndExecute({ transaction: tx });
      onSuccess();
    } catch (e: unknown) {
      console.error('Registration failed:', e);
      const errorMessage = e instanceof Error ? e.message : 'Failed to register position';
      setError(errorMessage);
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <Layers size={20} />
            {step === 'select' ? 'Select Position' : 'Configure Settings'}
          </h3>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="error-banner">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {step === 'select' ? (
          <div className="modal-body">
            <p className="description">
              Select an MMT position to register for automated management.
              The position will be transferred to the LP Registry contract.
            </p>

            {loadingPositions ? (
              <div className="loading">
                <Loader2 size={24} className="spinning" />
                <span>Loading positions...</span>
              </div>
            ) : positions.length === 0 ? (
              <div className="empty">
                <Layers size={32} />
                <span>No MMT positions found</span>
                <p>Open a position on MMT Finance first</p>
              </div>
            ) : (
              <div className="positions-list">
                {positions.map((position) => (
                  <button
                    key={position.id}
                    className="position-item"
                    onClick={() => handleSelectPosition(position)}
                  >
                    <div className="position-main">
                      <div className="position-header-row">
                        <span className="pair">
                          {position.tokenXSymbol}/{position.tokenYSymbol}
                        </span>
                        <span className={`range-badge ${position.isInRange ? 'in-range' : 'out-of-range'}`}>
                          {position.isInRange ? 'In Range' : 'Out of Range'}
                        </span>
                      </div>
                      <div className="position-details">
                        <div className="detail">
                          <span className="label">Value</span>
                          <span className="value">${position.totalValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="detail">
                          <span className="label">Fees</span>
                          <span className="value fees">+${position.uncollectedFeesUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="detail">
                          <span className="label">APR</span>
                          <span className="value">{position.apr.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="position-range">
                        <span className="range-text">
                          Range: {position.priceLower.toFixed(4)} - {position.priceUpper.toFixed(4)}
                        </span>
                      </div>
                      <span className="id">
                        {position.id.slice(0, 10)}...{position.id.slice(-8)}
                      </span>
                    </div>
                    <ChevronRight size={18} className="chevron-icon" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="modal-body">
            <div className="selected-position">
              <CheckCircle size={16} />
              <div className="selected-info">
                <span className="selected-pair">
                  {selectedPosition?.tokenXSymbol}/{selectedPosition?.tokenYSymbol}
                </span>
                <span className="selected-value">
                  ${selectedPosition?.totalValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </div>
              <button className="change-btn" onClick={() => setStep('select')}>
                Change
              </button>
            </div>

            <div className="settings-section">
              <h4>Automation Features</h4>

              <label className="feature-toggle">
                <input
                  type="checkbox"
                  checked={settings.autoRebalance}
                  onChange={(e) => setSettings({ ...settings, autoRebalance: e.target.checked })}
                />
                <div className="toggle-content">
                  <Zap size={16} />
                  <div>
                    <span className="toggle-title">Auto-Rebalance</span>
                    <span className="toggle-desc">Automatically rebalance when price exits range</span>
                  </div>
                </div>
              </label>

              <label className="feature-toggle">
                <input
                  type="checkbox"
                  checked={settings.autoCompound}
                  onChange={(e) => setSettings({ ...settings, autoCompound: e.target.checked })}
                />
                <div className="toggle-content">
                  <Repeat size={16} />
                  <div>
                    <span className="toggle-title">Auto-Compound</span>
                    <span className="toggle-desc">Reinvest trading fees into position</span>
                  </div>
                </div>
              </label>

              <label className="feature-toggle">
                <input
                  type="checkbox"
                  checked={settings.useZap}
                  onChange={(e) => setSettings({ ...settings, useZap: e.target.checked })}
                />
                <div className="toggle-content">
                  <Zap size={16} />
                  <div>
                    <span className="toggle-title">ZAP Mode</span>
                    <span className="toggle-desc">Swap excess tokens to use ALL liquidity</span>
                  </div>
                </div>
              </label>
            </div>

            <div className="settings-section">
              <h4>Rebalance Settings</h4>

              {/* Rebalance Delay - Custom input with units */}
              <div className="form-group">
                <label>
                  <Clock size={14} />
                  Rebalance Delay
                </label>
                <div className="delay-input-group">
                  <input
                    type="number"
                    value={delayValue}
                    onChange={(e) => setDelayValue(e.target.value)}
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
                        className={`delay-unit-btn ${delayUnit === unit.value ? 'active' : ''}`}
                        onClick={() => setDelayUnit(unit.value)}
                      >
                        {unit.value}
                      </button>
                    ))}
                  </div>
                </div>
                <span className="hint">
                  Wait {formatDelay()} before rebalancing - price may return to range
                </span>
              </div>

              {/* Range Width - By Percent or Manual Price */}
              <div className="form-group">
                <label>Range Width</label>

                {/* Mode Toggle */}
                <div className="range-mode-toggle">
                  <button
                    type="button"
                    className={`range-mode-btn ${rangeMode === 'percent' ? 'active' : ''}`}
                    onClick={() => setRangeMode('percent')}
                  >
                    By Percent
                  </button>
                  <button
                    type="button"
                    className={`range-mode-btn ${rangeMode === 'manual' ? 'active' : ''}`}
                    onClick={() => setRangeMode('manual')}
                  >
                    Manual Price
                  </button>
                </div>

                {/* Percent Mode - Slider */}
                {rangeMode === 'percent' && (
                  <div className="percent-slider-container">
                    <input
                      type="range"
                      min="0.1"
                      max="100"
                      step="0.1"
                      value={rangePercent}
                      onChange={(e) => setRangePercent(parseFloat(e.target.value))}
                      className="range-slider"
                    />
                    <div className="slider-labels">
                      <span>Narrow</span>
                      <span className="current-percent">±{rangePercent.toFixed(1)}%</span>
                      <span>Wide</span>
                    </div>
                  </div>
                )}

                {/* Manual Mode - Price inputs */}
                {rangeMode === 'manual' && selectedPosition && (
                  <div className="manual-price-inputs">
                    <div className="price-input-group">
                      <label className="price-label">Min Price</label>
                      <input
                        type="number"
                        value={manualMinPrice}
                        onChange={(e) => setManualMinPrice(e.target.value)}
                        placeholder="0.00"
                        step="any"
                        className="price-input"
                      />
                    </div>
                    <div className="current-price-display">
                      Current: {selectedPosition.currentPrice.toPrecision(6)}
                    </div>
                    <div className="price-input-group">
                      <label className="price-label">Max Price</label>
                      <input
                        type="number"
                        value={manualMaxPrice}
                        onChange={(e) => setManualMaxPrice(e.target.value)}
                        placeholder="0.00"
                        step="any"
                        className="price-input"
                      />
                    </div>
                  </div>
                )}

                {/* Range Summary */}
                <div className="range-summary">
                  <div className="range-summary-item">
                    <span className="range-label">Min Price</span>
                    <span className="range-value">{displayRange.min.toPrecision(6)}</span>
                  </div>
                  <div className="range-summary-item">
                    <span className="range-label">Max Price</span>
                    <span className="range-value">{displayRange.max.toPrecision(6)}</span>
                  </div>
                </div>

                <span className="hint">
                  Range width for new position after rebalance (~{displayRange.percent.toFixed(1)}%)
                </span>
              </div>

              <div className="form-group">
                <label>Cycles</label>
                <input
                  type="number"
                  value={settings.recurringCount}
                  onChange={(e) => setSettings({ ...settings, recurringCount: Number(e.target.value) })}
                  min="0"
                  placeholder="0 = infinite"
                  className="cycles-input"
                />
                <span className="hint">
                  Number of rebalance cycles (0 = unlimited)
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="modal-footer">
          {step === 'configure' && (
            <>
              <button className="cancel-btn" onClick={() => setStep('select')}>
                Back
              </button>
              <button
                className="register-btn"
                onClick={handleRegister}
                disabled={registering}
              >
                {registering ? (
                  <>
                    <Loader2 size={16} className="spinning" />
                    Registering...
                  </>
                ) : (
                  <>
                    <Layers size={16} />
                    Register Position
                  </>
                )}
              </button>
            </>
          )}
        </div>

        <style>{styles}</style>
      </div>
    </div>
  );
}

const styles = `
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
    max-width: 500px;
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
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

  .error-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    background: rgba(255, 107, 107, 0.1);
    border-bottom: 1px solid rgba(255, 107, 107, 0.2);
    color: #FF6B6B;
    font-size: 13px;
  }

  .modal-body {
    padding: 24px;
    overflow-y: auto;
    flex: 1;
  }

  .description {
    font-size: 14px;
    color: #808090;
    margin: 0 0 20px;
    line-height: 1.5;
  }

  .loading, .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    color: #808090;
    gap: 12px;
  }

  .empty p {
    font-size: 13px;
    color: #606070;
    margin: 0;
  }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .positions-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .position-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
    width: 100%;
    text-align: left;
    color: #E8E8EC;
  }

  .position-item:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(0, 212, 170, 0.3);
  }

  .position-main {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
  }

  .position-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .pair {
    font-size: 16px;
    font-weight: 600;
  }

  .range-badge {
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 11px;
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

  .position-details {
    display: flex;
    gap: 16px;
  }

  .position-details .detail {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .position-details .label {
    font-size: 10px;
    color: #606070;
    text-transform: uppercase;
  }

  .position-details .value {
    font-size: 14px;
    font-weight: 500;
    color: #E8E8EC;
  }

  .position-details .value.fees {
    color: #00D4AA;
  }

  .position-range {
    padding: 6px 10px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 6px;
  }

  .range-text {
    font-size: 11px;
    color: #808090;
  }

  .id {
    font-size: 11px;
    color: #505060;
    font-family: 'SF Mono', monospace;
  }

  .chevron-icon {
    color: #606070;
    flex-shrink: 0;
    margin-left: 12px;
  }

  .selected-position {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    background: rgba(0, 212, 170, 0.1);
    border: 1px solid rgba(0, 212, 170, 0.2);
    border-radius: 10px;
    margin-bottom: 24px;
    color: #00D4AA;
    font-weight: 500;
  }

  .selected-info {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .selected-pair {
    font-weight: 600;
  }

  .selected-value {
    font-size: 13px;
    color: #E8E8EC;
    padding: 2px 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }

  .change-btn {
    margin-left: auto;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 6px;
    color: #E8E8EC;
    font-size: 12px;
    cursor: pointer;
  }

  .change-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .settings-section {
    margin-bottom: 24px;
  }

  .settings-section h4 {
    font-size: 13px;
    font-weight: 600;
    color: #A0A0B0;
    margin: 0 0 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .feature-toggle {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    cursor: pointer;
    margin-bottom: 10px;
    transition: all 0.2s;
  }

  .feature-toggle:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .feature-toggle input {
    width: 18px;
    height: 18px;
    accent-color: #00D4AA;
    margin-top: 2px;
  }

  .toggle-content {
    display: flex;
    gap: 12px;
    flex: 1;
  }

  .toggle-content > svg {
    color: #00D4AA;
    margin-top: 2px;
  }

  .toggle-title {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: #E8E8EC;
    margin-bottom: 2px;
  }

  .toggle-desc {
    font-size: 12px;
    color: #606070;
  }

  .form-group {
    margin-bottom: 20px;
  }

  .form-group > label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 500;
    color: #A0A0B0;
    margin-bottom: 10px;
  }

  .form-group .hint {
    display: block;
    font-size: 11px;
    color: #606070;
    margin-top: 8px;
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

  /* Range mode toggle */
  .range-mode-toggle {
    display: flex;
    gap: 4px;
    margin-bottom: 12px;
  }

  .range-mode-btn {
    flex: 1;
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

  .range-mode-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #E8E8EC;
  }

  .range-mode-btn.active {
    background: rgba(0, 163, 255, 0.15);
    border-color: rgba(0, 163, 255, 0.3);
    color: #00A3FF;
  }

  /* Percent slider */
  .percent-slider-container {
    padding: 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    margin-bottom: 12px;
  }

  .range-slider {
    width: 100%;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    outline: none;
    cursor: pointer;
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
    align-items: center;
    margin-top: 10px;
    font-size: 11px;
    color: #606070;
  }

  .current-percent {
    font-size: 14px;
    font-weight: 600;
    color: #00D4AA;
  }

  /* Manual price inputs */
  .manual-price-inputs {
    padding: 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    margin-bottom: 12px;
  }

  .price-input-group {
    margin-bottom: 12px;
  }

  .price-input-group:last-child {
    margin-bottom: 0;
  }

  .price-label {
    display: block;
    font-size: 11px;
    color: #606070;
    margin-bottom: 6px;
    text-transform: uppercase;
  }

  .price-input {
    width: 100%;
    padding: 10px 12px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #E8E8EC;
    font-size: 14px;
    font-family: 'SF Mono', monospace;
  }

  .price-input:focus {
    outline: none;
    border-color: #00A3FF;
  }

  .current-price-display {
    text-align: center;
    padding: 8px;
    font-size: 12px;
    color: #00A3FF;
    background: rgba(0, 163, 255, 0.1);
    border-radius: 6px;
    margin-bottom: 12px;
  }

  /* Range summary */
  .range-summary {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    margin-top: 12px;
  }

  .range-summary-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .range-label {
    font-size: 10px;
    color: #606070;
    text-transform: uppercase;
  }

  .range-value {
    font-size: 13px;
    color: #E8E8EC;
    font-family: 'SF Mono', monospace;
  }

  /* Cycles input */
  .cycles-input {
    width: 100%;
    padding: 12px 14px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    color: #E8E8EC;
    font-size: 14px;
    transition: all 0.2s;
  }

  .cycles-input:focus {
    outline: none;
    border-color: #00D4AA;
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

  .register-btn {
    flex: 2;
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

  .register-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(0, 212, 170, 0.3);
  }

  .register-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;
