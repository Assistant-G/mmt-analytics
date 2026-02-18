/**
 * Backtesting Page
 *
 * Full-featured backtesting dashboard with:
 * - Configuration panel (pool, strategy, time period, capital)
 * - Interactive price chart with range visualization
 * - Results metrics
 * - Strategy comparison table
 * - Monte Carlo simulation
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Play,
  Settings,
  TrendingUp,
  DollarSign,
  BarChart3,
  Shuffle,
  ChevronDown,
  Check,
  Loader2,
  RefreshCw,
  Target,
  Percent,
  Activity,
  Zap,
  Shield,
  Info,
  AlertTriangle,
  Database,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  runBacktest,
  compareStrategies,
  runMonteCarloSimulation,
  TIME_PRESETS,
  type BacktestConfig,
  type BacktestResult,
  type StrategyComparison,
  type MonteCarloResult,
} from '@/services/backtestService';
import { fetchPoolsData } from '@/services/mmtService';
import { STRATEGY_PRESETS, type StrategyPreset } from '@/types/strategies';
import { formatCurrency, getTokenLogo } from '@/utils';
import type { Pool } from '@/types';

type TimePresetId = typeof TIME_PRESETS[number]['id'];

// Custom strategy preset
const createCustomStrategy = (rangeBps: number): StrategyPreset => ({
  id: 'custom',
  name: 'Custom',
  description: 'User-defined range and settings',
  riskLevel: 'custom',
  expectedAprMultiplier: 'Variable',
  gasCostLevel: 'medium',
  bestFor: ['Advanced users', 'Custom strategies'],
  strategy: {
    id: 'custom-user',
    name: 'Custom Strategy',
    description: 'User-defined range',
    riskLevel: 'custom',
    enabled: true,
    type: 'smart-rebalance',
    rangeBps,
    checkOutOfRange: true,
    checkIntervalMs: 60000,
    maxTimerMs: 24 * 3600 * 1000,
    maxDivergenceLossPercent: 5,
    minTimeBetweenRebalancesMs: 1800000,
  },
});

export function Backtesting() {
  // Configuration state
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyPreset>(STRATEGY_PRESETS[0]);
  const [isCustomStrategy, setIsCustomStrategy] = useState(false);
  const [customRangeType, setCustomRangeType] = useState<'percent' | 'price'>('percent');
  const [customRangePercent, setCustomRangePercent] = useState('3');
  const [customPriceLower, setCustomPriceLower] = useState('');
  const [customPriceUpper, setCustomPriceUpper] = useState('');
  const [autoRebalance, setAutoRebalance] = useState(true);
  const [timePreset, setTimePreset] = useState<TimePresetId>('1d');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [initialCapital, setInitialCapital] = useState('1000');
  const [poolApr, setPoolApr] = useState('50');

  // Results state
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [comparisons, setComparisons] = useState<StrategyComparison[]>([]);
  const [monteCarloResult, setMonteCarloResult] = useState<MonteCarloResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [showPoolSelector, setShowPoolSelector] = useState(false);
  const [showStrategySelector, setShowStrategySelector] = useState(false);
  const [activeTab, setActiveTab] = useState<'single' | 'compare' | 'montecarlo'>('single');
  const [monteCarloSimulations, setMonteCarloSimulations] = useState([100]);

  // Fetch pools
  const { data: pools } = useQuery({
    queryKey: ['pools'],
    queryFn: fetchPoolsData,
  });

  // Calculate time range
  const timeRange = useMemo(() => {
    if (timePreset === 'custom') {
      return {
        start: customStartDate ? new Date(customStartDate).getTime() : Date.now() - 24 * 60 * 60 * 1000,
        end: customEndDate ? new Date(customEndDate).getTime() : Date.now(),
      };
    }
    const preset = TIME_PRESETS.find(p => p.id === timePreset);
    const ms = preset?.ms || 24 * 60 * 60 * 1000;
    return {
      start: Date.now() - ms,
      end: Date.now(),
    };
  }, [timePreset, customStartDate, customEndDate]);

  // Run backtest
  const handleRunBacktest = async () => {
    if (!selectedPool) return;

    setIsRunning(true);
    setResult(null);
    setComparisons([]);
    setMonteCarloResult(null);
    setError(null);

    try {
      // Calculate effective range for custom strategy
      let effectiveRangeBps = parseFloat(customRangePercent) * 100; // Default: convert % to bps

      if (isCustomStrategy && customRangeType === 'price' && customPriceLower && customPriceUpper) {
        const lower = parseFloat(customPriceLower);
        const upper = parseFloat(customPriceUpper);
        if (lower > 0 && upper > lower) {
          // Calculate range width as percentage of midpoint
          const midPrice = (lower + upper) / 2;
          const rangePercent = ((upper - lower) / midPrice) * 100;
          effectiveRangeBps = (rangePercent / 2) * 100; // Convert half-width % to bps (since rangeBps is ±X%)
        }
      }

      // Use custom strategy if enabled
      const strategyToUse = isCustomStrategy
        ? createCustomStrategy(effectiveRangeBps)
        : selectedStrategy;

      const config: BacktestConfig = {
        poolId: selectedPool.id,
        tokenA: selectedPool.tokenA.symbol,
        tokenB: selectedPool.tokenB.symbol,
        strategy: strategyToUse,
        initialCapital: parseFloat(initialCapital) || 1000,
        startTime: timeRange.start,
        endTime: timeRange.end,
        poolApr: parseFloat(poolApr) || 50,
        autoRebalance,
      };

      if (activeTab === 'single') {
        const backtestResult = await runBacktest(config);
        setResult(backtestResult);
      } else if (activeTab === 'compare') {
        const comparisonResults = await compareStrategies({
          poolId: config.poolId,
          tokenA: config.tokenA,
          tokenB: config.tokenB,
          initialCapital: config.initialCapital,
          startTime: config.startTime,
          endTime: config.endTime,
          poolApr: config.poolApr,
        });
        setComparisons(comparisonResults);
        if (comparisonResults.length > 0) {
          setResult(comparisonResults[0].result);
        }
      } else if (activeTab === 'montecarlo') {
        const [backtestResult, mcResult] = await Promise.all([
          runBacktest(config),
          runMonteCarloSimulation(config, monteCarloSimulations[0]),
        ]);
        setResult(backtestResult);
        setMonteCarloResult(mcResult);
      }
    } catch (err) {
      console.error('Backtest failed:', err);
      setError(err instanceof Error ? err.message : 'Backtest failed. Please try again.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="backtesting-page">
      <div className="page-header">
        <div>
          <h1>Strategy Backtesting</h1>
          <p>Test strategies against historical data before deploying capital</p>
        </div>
      </div>

      <div className="backtest-layout">
        {/* Configuration Panel */}
        <Card className="config-panel glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings size={18} />
              Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="config-content">
            {/* Pool Selector */}
            <div className="config-section">
              <label>Select Pool</label>
              <div className="dropdown-wrapper" onClick={() => setShowPoolSelector(!showPoolSelector)}>
                <div className="dropdown-trigger">
                  {selectedPool ? (
                    <div className="pool-selected">
                      <div className="token-pair">
                        <img src={getTokenLogo(selectedPool.tokenA.symbol)} alt="" />
                        <img src={getTokenLogo(selectedPool.tokenB.symbol)} alt="" className="overlap" />
                      </div>
                      <span>{selectedPool.tokenA.symbol}/{selectedPool.tokenB.symbol}</span>
                    </div>
                  ) : (
                    <span className="placeholder">Choose a pool...</span>
                  )}
                  <ChevronDown size={16} className={showPoolSelector ? 'rotated' : ''} />
                </div>
                {showPoolSelector && pools && (
                  <div className="dropdown-menu">
                    {pools.map(pool => (
                      <button
                        key={pool.id}
                        className={`dropdown-item ${selectedPool?.id === pool.id ? 'selected' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPool(pool);
                          setShowPoolSelector(false);
                        }}
                      >
                        <div className="token-pair small">
                          <img src={getTokenLogo(pool.tokenA.symbol)} alt="" />
                          <img src={getTokenLogo(pool.tokenB.symbol)} alt="" className="overlap" />
                        </div>
                        <span>{pool.tokenA.symbol}/{pool.tokenB.symbol}</span>
                        <span className="apr">{pool.apr.toFixed(1)}% APR</span>
                        {selectedPool?.id === pool.id && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Strategy Selector */}
            <div className="config-section">
              <label>Strategy</label>
              <div className="dropdown-wrapper" onClick={() => setShowStrategySelector(!showStrategySelector)}>
                <div className="dropdown-trigger">
                  <div className="strategy-selected">
                    <StrategyIcon id={isCustomStrategy ? 'custom' : selectedStrategy.id} />
                    <span>{isCustomStrategy ? 'Custom' : selectedStrategy.name}</span>
                    {isCustomStrategy ? (
                      <span className="custom-range-badge">
                        {customRangeType === 'percent'
                          ? `±${customRangePercent}%`
                          : customPriceLower && customPriceUpper
                            ? `${customPriceLower}-${customPriceUpper}`
                            : 'Set range'}
                      </span>
                    ) : (
                      <RiskBadge risk={selectedStrategy.riskLevel} />
                    )}
                  </div>
                  <ChevronDown size={16} className={showStrategySelector ? 'rotated' : ''} />
                </div>
                {showStrategySelector && (
                  <div className="dropdown-menu strategy-dropdown">
                    {STRATEGY_PRESETS.map(strategy => {
                      // Get strategy details for display
                      const s = strategy.strategy;
                      const rangeBps = 'rangeBps' in s ? s.rangeBps : 'neutralRangeBps' in s ? s.neutralRangeBps : 0;
                      const rangePercent = (rangeBps / 100).toFixed(1);

                      return (
                        <button
                          key={strategy.id}
                          className={`dropdown-item strategy-item ${!isCustomStrategy && selectedStrategy.id === strategy.id ? 'selected' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedStrategy(strategy);
                            setIsCustomStrategy(false);
                            setShowStrategySelector(false);
                          }}
                        >
                          <StrategyIcon id={strategy.id} />
                          <div className="strategy-info">
                            <span className="name">{strategy.name}</span>
                            <span className="strategy-details">
                              ±{rangePercent}% range • {strategy.expectedAprMultiplier} APR
                            </span>
                          </div>
                          <RiskBadge risk={strategy.riskLevel} small />
                          {!isCustomStrategy && selectedStrategy.id === strategy.id && <Check size={14} />}
                        </button>
                      );
                    })}
                    {/* Custom Strategy Option */}
                    <button
                      className={`dropdown-item strategy-item custom-option ${isCustomStrategy ? 'selected' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsCustomStrategy(true);
                        setShowStrategySelector(false);
                      }}
                    >
                      <Settings size={16} />
                      <div className="strategy-info">
                        <span className="name">Custom Strategy</span>
                        <span className="strategy-details">
                          Set your own range width
                        </span>
                      </div>
                      <Badge variant="outline" className="custom-badge">Custom</Badge>
                      {isCustomStrategy && <Check size={14} />}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Custom Range Settings */}
            {isCustomStrategy && (
              <div className="config-section custom-strategy-config">
                <label>Custom Range Type</label>
                <div className="range-type-toggle">
                  <button
                    className={`toggle-btn ${customRangeType === 'percent' ? 'active' : ''}`}
                    onClick={() => setCustomRangeType('percent')}
                  >
                    <Percent size={14} />
                    By Percentage
                  </button>
                  <button
                    className={`toggle-btn ${customRangeType === 'price' ? 'active' : ''}`}
                    onClick={() => setCustomRangeType('price')}
                  >
                    <DollarSign size={14} />
                    By Price
                  </button>
                </div>

                {customRangeType === 'percent' ? (
                  <>
                    <label className="sub-label">Range Width (%)</label>
                    <div className="range-input-container">
                      <input
                        type="range"
                        min="0.5"
                        max="20"
                        step="0.5"
                        value={customRangePercent}
                        onChange={(e) => setCustomRangePercent(e.target.value)}
                        className="range-slider"
                      />
                      <div className="range-value">
                        <span>±</span>
                        <Input
                          type="number"
                          value={customRangePercent}
                          onChange={(e) => setCustomRangePercent(e.target.value)}
                          min="0.1"
                          max="50"
                          step="0.1"
                        />
                        <span>%</span>
                      </div>
                    </div>
                    <span className="hint">
                      Tighter range = higher fees, more rebalances. Wider = fewer fees, less IL risk.
                    </span>
                  </>
                ) : (
                  <>
                    <label className="sub-label">Price Range Bounds</label>
                    <div className="price-range-inputs">
                      <div className="price-input-group">
                        <label>Lower Price</label>
                        <div className="input-with-icon">
                          <DollarSign size={16} />
                          <Input
                            type="number"
                            value={customPriceLower}
                            onChange={(e) => setCustomPriceLower(e.target.value)}
                            placeholder="e.g., 3.50"
                            step="0.0001"
                          />
                        </div>
                      </div>
                      <div className="price-input-group">
                        <label>Upper Price</label>
                        <div className="input-with-icon">
                          <DollarSign size={16} />
                          <Input
                            type="number"
                            value={customPriceUpper}
                            onChange={(e) => setCustomPriceUpper(e.target.value)}
                            placeholder="e.g., 4.50"
                            step="0.0001"
                          />
                        </div>
                      </div>
                    </div>
                    {selectedPool && customPriceLower && customPriceUpper && (
                      <div className="price-range-preview">
                        <span>Range: {customPriceLower} - {customPriceUpper}</span>
                        <span className="range-width">
                          Width: {(((parseFloat(customPriceUpper) - parseFloat(customPriceLower)) /
                            ((parseFloat(customPriceUpper) + parseFloat(customPriceLower)) / 2)) * 100).toFixed(2)}%
                        </span>
                      </div>
                    )}
                    <span className="hint">
                      Set exact price bounds for your position. The backtest will simulate rebalancing when price exits this range.
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Time Period */}
            <div className="config-section">
              <label>Time Period</label>
              <div className="time-presets">
                {TIME_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    className={`preset-btn ${timePreset === preset.id ? 'active' : ''}`}
                    onClick={() => setTimePreset(preset.id)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {timePreset === 'custom' && (
                <div className="custom-dates">
                  <Input
                    type="datetime-local"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    placeholder="Start"
                  />
                  <span>to</span>
                  <Input
                    type="datetime-local"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    placeholder="End"
                  />
                </div>
              )}
            </div>

            {/* Initial Capital */}
            <div className="config-section">
              <label>Initial Capital (USD)</label>
              <div className="input-with-icon">
                <DollarSign size={16} />
                <Input
                  type="number"
                  value={initialCapital}
                  onChange={(e) => setInitialCapital(e.target.value)}
                  placeholder="1000"
                />
              </div>
            </div>

            {/* Pool APR */}
            <div className="config-section">
              <label>Estimated Pool APR (%)</label>
              <div className="input-with-icon">
                <Percent size={16} />
                <Input
                  type="number"
                  value={poolApr}
                  onChange={(e) => setPoolApr(e.target.value)}
                  placeholder="50"
                />
              </div>
              <span className="hint">Used for fee estimation</span>
            </div>

            {/* Auto Rebalance Toggle */}
            <div className="config-section">
              <label>Rebalance Behavior</label>
              <div className="rebalance-toggle">
                <button
                  className={`rebalance-btn ${autoRebalance ? 'active' : ''}`}
                  onClick={() => setAutoRebalance(true)}
                >
                  <RefreshCw size={14} />
                  Auto Rebalance
                </button>
                <button
                  className={`rebalance-btn ${!autoRebalance ? 'active' : ''}`}
                  onClick={() => setAutoRebalance(false)}
                >
                  <Activity size={14} />
                  Wait for Return
                </button>
              </div>
              <span className="hint">
                {autoRebalance
                  ? 'Rebalance immediately when price exits range'
                  : 'Wait for price to return to range (no rebalancing)'}
              </span>
            </div>

            {/* Mode Tabs */}
            <div className="config-section">
              <label>Backtest Mode</label>
              <div className="mode-tabs">
                <button
                  className={`mode-tab ${activeTab === 'single' ? 'active' : ''}`}
                  onClick={() => setActiveTab('single')}
                >
                  <Target size={14} />
                  Single
                </button>
                <button
                  className={`mode-tab ${activeTab === 'compare' ? 'active' : ''}`}
                  onClick={() => setActiveTab('compare')}
                >
                  <BarChart3 size={14} />
                  Compare All
                </button>
                <button
                  className={`mode-tab ${activeTab === 'montecarlo' ? 'active' : ''}`}
                  onClick={() => setActiveTab('montecarlo')}
                >
                  <Shuffle size={14} />
                  Monte Carlo
                </button>
              </div>
            </div>

            {/* Monte Carlo Settings */}
            {activeTab === 'montecarlo' && (
              <div className="config-section">
                <label>Simulations: {monteCarloSimulations[0]}</label>
                <Slider
                  value={monteCarloSimulations}
                  onValueChange={setMonteCarloSimulations}
                  min={50}
                  max={500}
                  step={50}
                />
              </div>
            )}

            {/* Run Button */}
            <Button
              className="run-btn"
              onClick={handleRunBacktest}
              disabled={!selectedPool || isRunning}
            >
              {isRunning ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play size={18} />
                  Run Backtest
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Results Panel */}
        <div className="results-panel">
          {/* Error Display */}
          {error && (
            <Card className="error-card glass-card">
              <CardContent>
                <div className="error-content">
                  <AlertTriangle size={24} className="error-icon" />
                  <div>
                    <h3>Backtest Failed</h3>
                    <p>{error}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!result && !comparisons.length && !error && (
            <Card className="empty-state glass-card">
              <CardContent>
                <Activity size={48} className="empty-icon" />
                <h3>Configure and Run a Backtest</h3>
                <p>Select a pool, strategy, and time period, then click "Run Backtest" to see results.</p>
              </CardContent>
            </Card>
          )}

          {/* Data Quality Banner */}
          {result && (
            <DataQualityBanner result={result} />
          )}

          {/* Single Result */}
          {result && activeTab === 'single' && (
            <>
              <ResultsMetrics result={result} />
              <PriceChart result={result} />
              <PositionHistory result={result} pool={selectedPool} />
            </>
          )}

          {/* Strategy Comparison */}
          {comparisons.length > 0 && activeTab === 'compare' && (
            <>
              <StrategyComparisonTable comparisons={comparisons} />
              {result && <PriceChart result={result} />}
            </>
          )}

          {/* Monte Carlo Results */}
          {result && monteCarloResult && activeTab === 'montecarlo' && (
            <>
              <MonteCarloResults result={monteCarloResult} baseResult={result} />
              <ResultsMetrics result={result} />
              <PriceChart result={result} />
            </>
          )}
        </div>
      </div>

      <style>{`
        .backtesting-page {
          display: flex;
          flex-direction: column;
          gap: 24px;
          animation: fadeIn 0.4s ease-out;
        }

        /* Fix card title and text colors */
        .backtesting-page .glass-card {
          color: #E8E8EC;
        }

        .backtesting-page .glass-card [class*="CardTitle"],
        .backtesting-page .glass-card h1,
        .backtesting-page .glass-card h2,
        .backtesting-page .glass-card h3 {
          color: #E8E8EC !important;
        }

        .backtesting-page .glass-card svg {
          color: #A0A0B0;
        }

        .page-header h1 {
          font-size: 28px;
          font-weight: 700;
          color: #E8E8EC;
          margin-bottom: 4px;
        }

        .page-header p {
          color: #808090;
          font-size: 14px;
        }

        .backtest-layout {
          display: grid;
          grid-template-columns: 320px 1fr;
          gap: 24px;
        }

        @media (max-width: 1024px) {
          .backtest-layout {
            grid-template-columns: 1fr;
          }
        }

        .config-panel {
          height: fit-content;
          position: sticky;
          top: 24px;
        }

        .config-content {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .config-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .config-section > label {
          font-size: 12px;
          color: #808090;
          font-weight: 500;
        }

        .config-section input,
        .config-section input[type="number"],
        .config-section input[type="text"],
        .config-section input[type="datetime-local"] {
          width: 100%;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.03) !important;
          border: 1px solid rgba(255, 255, 255, 0.1) !important;
          border-radius: 8px;
          color: #E8E8EC !important;
          font-size: 13px;
          transition: all 0.2s;
        }

        .config-section input:focus {
          outline: none;
          border-color: rgba(0, 212, 170, 0.5) !important;
          background: rgba(255, 255, 255, 0.05) !important;
        }

        .config-section input::placeholder {
          color: #606070 !important;
        }

        .input-with-icon {
          position: relative;
        }

        .input-with-icon svg {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: #606070;
          z-index: 1;
          pointer-events: none;
        }

        .input-with-icon input {
          padding-left: 38px !important;
        }

        .dropdown-wrapper {
          position: relative;
        }

        .dropdown-trigger {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .dropdown-trigger:hover {
          border-color: rgba(0, 212, 170, 0.5);
        }

        .dropdown-menu {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: #1a1a24;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          margin-top: 4px;
          max-height: 240px;
          overflow-y: auto;
          z-index: 100;
        }

        .dropdown-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          background: none;
          border: none;
          cursor: pointer;
          transition: all 0.15s;
          text-align: left;
          color: #E8E8EC;
          font-size: 13px;
        }

        .dropdown-item:hover {
          background: rgba(0, 212, 170, 0.1);
        }

        .dropdown-item.selected {
          background: rgba(0, 212, 170, 0.15);
        }

        .dropdown-item .apr {
          margin-left: auto;
          color: #22c55e;
          font-size: 11px;
        }

        .token-pair {
          display: flex;
        }

        .token-pair img {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 2px solid #1a1a24;
        }

        .token-pair img.overlap {
          margin-left: -8px;
        }

        .token-pair.small img {
          width: 20px;
          height: 20px;
        }

        .pool-selected, .strategy-selected {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #E8E8EC;
          font-size: 13px;
        }

        .placeholder {
          color: #606070;
          font-size: 13px;
        }

        .rotated {
          transform: rotate(180deg);
        }

        .strategy-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
        }

        .strategy-info .name {
          font-size: 13px;
          color: #E8E8EC;
        }

        .strategy-info .apy {
          font-size: 11px;
          color: #22c55e;
        }

        .strategy-info .strategy-details {
          font-size: 11px;
          color: #808090;
        }

        .strategy-dropdown {
          max-height: 320px;
        }

        .strategy-item {
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }

        .strategy-item:last-child {
          border-bottom: none;
        }

        .custom-option {
          background: rgba(0, 163, 255, 0.05);
          border-top: 1px solid rgba(0, 163, 255, 0.2);
        }

        .custom-badge {
          font-size: 10px;
          padding: 2px 6px;
          background: rgba(0, 163, 255, 0.2);
          border-color: rgba(0, 163, 255, 0.4);
          color: #00A3FF;
        }

        .custom-range-badge {
          font-size: 11px;
          padding: 2px 8px;
          background: rgba(0, 163, 255, 0.15);
          border-radius: 4px;
          color: #00A3FF;
        }

        .custom-strategy-config {
          background: rgba(0, 163, 255, 0.05);
          border: 1px solid rgba(0, 163, 255, 0.2);
          border-radius: 8px;
          padding: 12px;
        }

        .custom-strategy-config .sub-label {
          font-size: 11px;
          color: #808090;
          margin-top: 8px;
        }

        .range-type-toggle {
          display: flex;
          gap: 6px;
        }

        .toggle-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: #808090;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .toggle-btn:hover {
          border-color: rgba(0, 163, 255, 0.5);
          color: #B0B0C0;
        }

        .toggle-btn.active {
          background: rgba(0, 163, 255, 0.2);
          border-color: rgba(0, 163, 255, 0.5);
          color: #00A3FF;
        }

        .price-range-inputs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .price-input-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .price-input-group > label {
          font-size: 10px;
          color: #606070;
        }

        .price-range-preview {
          display: flex;
          justify-content: space-between;
          padding: 8px 12px;
          background: rgba(0, 212, 170, 0.1);
          border: 1px solid rgba(0, 212, 170, 0.2);
          border-radius: 6px;
          font-size: 12px;
          color: #00D4AA;
          margin-top: 8px;
        }

        .price-range-preview .range-width {
          color: #B0B0C0;
        }

        .range-input-container {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .range-slider {
          width: 100%;
          height: 6px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
          -webkit-appearance: none;
          appearance: none;
          cursor: pointer;
        }

        .range-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          background: #00A3FF;
          border-radius: 50%;
          cursor: pointer;
        }

        .range-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: #00A3FF;
          border-radius: 50%;
          cursor: pointer;
          border: none;
        }

        .range-value {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .range-value span {
          color: #808090;
          font-size: 13px;
        }

        .range-value input {
          width: 70px;
          text-align: center;
        }

        .time-presets {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .preset-btn {
          padding: 6px 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: #808090;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .preset-btn:hover {
          border-color: rgba(0, 212, 170, 0.5);
          color: #E8E8EC;
        }

        .preset-btn.active {
          background: rgba(0, 212, 170, 0.2);
          border-color: rgba(0, 212, 170, 0.5);
          color: #00D4AA;
        }

        .custom-dates {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
        }

        .custom-dates span {
          color: #606070;
          font-size: 12px;
        }

        .custom-dates input {
          flex: 1;
          font-size: 12px;
        }

        .hint {
          font-size: 11px;
          color: #606070;
        }

        .mode-tabs {
          display: flex;
          gap: 4px;
        }

        .mode-tab {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: #808090;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .mode-tab:hover {
          border-color: rgba(0, 212, 170, 0.5);
        }

        .mode-tab.active {
          background: rgba(0, 212, 170, 0.15);
          border-color: rgba(0, 212, 170, 0.5);
          color: #00D4AA;
        }

        .rebalance-toggle {
          display: flex;
          gap: 6px;
        }

        .rebalance-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: #808090;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .rebalance-btn:hover {
          border-color: rgba(0, 212, 170, 0.5);
          color: #B0B0C0;
        }

        .rebalance-btn.active {
          background: rgba(0, 212, 170, 0.15);
          border-color: rgba(0, 212, 170, 0.5);
          color: #00D4AA;
        }

        .run-btn {
          width: 100%;
          height: 44px;
          background: linear-gradient(135deg, #00D4AA, #00A3FF);
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 8px;
        }

        .run-btn:hover:not(:disabled) {
          opacity: 0.9;
        }

        .run-btn:disabled {
          opacity: 0.5;
        }

        .results-panel {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 20px;
          text-align: center;
        }

        .empty-icon {
          color: #404050;
          margin-bottom: 16px;
        }

        .empty-state h3 {
          font-size: 18px;
          color: #E8E8EC;
          margin-bottom: 8px;
        }

        .empty-state p {
          color: #606070;
          font-size: 14px;
        }

        .error-card {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .error-content {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 12px 0;
        }

        .error-icon {
          color: #ef4444;
          flex-shrink: 0;
        }

        .error-content h3 {
          font-size: 15px;
          font-weight: 600;
          color: #ef4444;
          margin-bottom: 4px;
        }

        .error-content p {
          font-size: 13px;
          color: #fca5a5;
        }
      `}</style>
    </div>
  );
}

// Sub-components

function DataQualityBanner({ result }: { result: BacktestResult }) {
  const qualityColors = {
    high: { bg: 'rgba(34, 197, 94, 0.1)', border: 'rgba(34, 197, 94, 0.3)', text: '#22c55e' },
    medium: { bg: 'rgba(234, 179, 8, 0.1)', border: 'rgba(234, 179, 8, 0.3)', text: '#eab308' },
    low: { bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.3)', text: '#ef4444' },
    simulated: { bg: 'rgba(168, 85, 247, 0.1)', border: 'rgba(168, 85, 247, 0.3)', text: '#a855f7' },
  };

  const colors = qualityColors[result.dataQuality];

  return (
    <div className="data-quality-banner" style={{ background: colors.bg, borderColor: colors.border }}>
      <div className="quality-header">
        <Database size={16} style={{ color: colors.text }} />
        <span className="quality-label">Data Source: <strong>{result.dataSource.toUpperCase()}</strong></span>
        <span className="quality-badge" style={{ background: colors.border, color: colors.text }}>
          {result.dataQuality.toUpperCase()} QUALITY
        </span>
        <span className="data-points">{result.priceData.length} price points</span>
      </div>

      {result.warnings.length > 0 && (
        <div className="warnings-list">
          {result.warnings.map((warning, idx) => (
            <div key={idx} className="warning-item">
              <AlertTriangle size={12} />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .data-quality-banner {
          padding: 12px 16px;
          border: 1px solid;
          border-radius: 8px;
          margin-bottom: 8px;
        }

        .quality-header {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .quality-label {
          font-size: 13px;
          color: #B0B0C0;
        }

        .quality-label strong {
          color: #E8E8EC;
        }

        .quality-badge {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
        }

        .data-points {
          font-size: 11px;
          color: #808090;
          margin-left: auto;
        }

        .warnings-list {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .warning-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #eab308;
        }
      `}</style>
    </div>
  );
}

function StrategyIcon({ id }: { id: string }) {
  const icons: Record<string, typeof Shield> = {
    'smart-rebalance': Shield,
    'aggressive-yield': Zap,
    'conservative': Shield,
    'stablecoin-farmer': DollarSign,
    'trend-follower': TrendingUp,
    'custom': Settings,
  };
  const Icon = icons[id] || Activity;
  return <Icon size={16} />;
}

function RiskBadge({ risk, small = false }: { risk: string; small?: boolean }) {
  const colors: Record<string, string> = {
    low: 'bg-green-500/20 text-green-500',
    medium: 'bg-yellow-500/20 text-yellow-500',
    high: 'bg-red-500/20 text-red-500',
    custom: 'bg-blue-500/20 text-blue-500',
  };
  return (
    <span className={`risk-badge ${colors[risk] || ''} ${small ? 'small' : ''}`}>
      {risk.toUpperCase()}
      <style>{`
        .risk-badge {
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
        }
        .risk-badge.small {
          padding: 1px 4px;
          font-size: 9px;
        }
        .bg-green-500\\/20 { background: rgba(34, 197, 94, 0.2); }
        .text-green-500 { color: #22c55e; }
        .bg-yellow-500\\/20 { background: rgba(234, 179, 8, 0.2); }
        .text-yellow-500 { color: #eab308; }
        .bg-red-500\\/20 { background: rgba(239, 68, 68, 0.2); }
        .text-red-500 { color: #ef4444; }
      `}</style>
    </span>
  );
}

function ResultsMetrics({ result }: { result: BacktestResult }) {
  const isPositive = result.totalReturnPercent >= 0;

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 size={18} />
          Results Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="metrics-grid">
          <div className="metric-card highlight">
            <span className="metric-label">Final Value</span>
            <span className={`metric-value large ${isPositive ? 'positive' : 'negative'}`}>
              {formatCurrency(result.finalValue)}
            </span>
            <span className={`metric-change ${isPositive ? 'positive' : 'negative'}`}>
              {isPositive ? '+' : ''}{result.totalReturnPercent.toFixed(2)}%
            </span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Fees Earned</span>
            <span className="metric-value positive">+{formatCurrency(result.feesEarned)}</span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Impermanent Loss</span>
            <span className="metric-value negative">-{formatCurrency(result.impermanentLoss)}</span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Gas Costs</span>
            <span className="metric-value">-{formatCurrency(result.gasCosts)}</span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Time in Range</span>
            <span className="metric-value">{result.timeInRange.toFixed(1)}%</span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Rebalances</span>
            <span className="metric-value">{result.rebalanceCount}</span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Max Drawdown</span>
            <span className="metric-value negative">-{result.maxDrawdownPercent.toFixed(2)}%</span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Sharpe Ratio</span>
            <span className="metric-value">{result.sharpeRatio.toFixed(2)}</span>
          </div>
        </div>

        <style>{`
          .metrics-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
          }

          @media (max-width: 768px) {
            .metrics-grid {
              grid-template-columns: repeat(2, 1fr);
            }
          }

          .metric-card {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 12px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 8px;
          }

          .metric-card.highlight {
            background: rgba(0, 212, 170, 0.08);
            border-color: rgba(0, 212, 170, 0.2);
            grid-column: span 2;
          }

          .metric-label {
            font-size: 11px;
            color: #606070;
          }

          .metric-value {
            font-size: 16px;
            font-weight: 600;
            color: #E8E8EC;
            font-family: 'JetBrains Mono', monospace;
          }

          .metric-value.large {
            font-size: 24px;
          }

          .metric-value.positive, .metric-change.positive {
            color: #22c55e;
          }

          .metric-value.negative, .metric-change.negative {
            color: #ef4444;
          }

          .metric-change {
            font-size: 13px;
            font-weight: 500;
          }
        `}</style>
      </CardContent>
    </Card>
  );
}

function PriceChart({ result }: { result: BacktestResult }) {
  // Simple ASCII-style chart visualization
  const { priceData, ranges, rebalances } = result;

  if (!priceData.length) return null;

  const prices = priceData.map(p => p.price);
  const minPrice = Math.min(...prices) * 0.95;
  const maxPrice = Math.max(...prices) * 1.05;
  const priceRange = maxPrice - minPrice;

  const chartHeight = 200;
  const chartWidth = 600;

  // Create SVG path for price line
  const pricePath = priceData.map((point, i) => {
    const x = (i / (priceData.length - 1)) * chartWidth;
    const y = chartHeight - ((point.price - minPrice) / priceRange) * chartHeight;
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  // Get current range for visualization
  const currentRange = ranges[ranges.length - 1] || { lower: minPrice, upper: maxPrice };
  const lowerY = chartHeight - ((currentRange.lower - minPrice) / priceRange) * chartHeight;
  const upperY = chartHeight - ((currentRange.upper - minPrice) / priceRange) * chartHeight;

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp size={18} />
          Price & Range Chart
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="chart-container">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="price-chart">
            {/* Range bands */}
            <rect
              x="0"
              y={upperY}
              width={chartWidth}
              height={lowerY - upperY}
              fill="rgba(0, 212, 170, 0.1)"
            />
            <line x1="0" y1={upperY} x2={chartWidth} y2={upperY} stroke="#00D4AA" strokeDasharray="4" opacity="0.5" />
            <line x1="0" y1={lowerY} x2={chartWidth} y2={lowerY} stroke="#00D4AA" strokeDasharray="4" opacity="0.5" />

            {/* Price line */}
            <path d={pricePath} fill="none" stroke="#00A3FF" strokeWidth="2" />

            {/* Rebalance markers */}
            {rebalances.map((rb, i) => {
              const dataIndex = priceData.findIndex(p => p.timestamp >= rb.timestamp);
              if (dataIndex < 0) return null;
              const x = (dataIndex / (priceData.length - 1)) * chartWidth;
              const y = chartHeight - ((rb.price - minPrice) / priceRange) * chartHeight;
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r="4"
                  fill="#FFE66D"
                  stroke="#0A0A0F"
                  strokeWidth="1"
                />
              );
            })}
          </svg>

          <div className="chart-legend">
            <div className="legend-item">
              <span className="legend-color price"></span>
              <span>Price</span>
            </div>
            <div className="legend-item">
              <span className="legend-color range"></span>
              <span>Position Range</span>
            </div>
            <div className="legend-item">
              <span className="legend-color rebalance"></span>
              <span>Rebalance ({rebalances.length})</span>
            </div>
          </div>

          <div className="chart-labels">
            <span className="label-top">{maxPrice.toFixed(4)}</span>
            <span className="label-bottom">{minPrice.toFixed(4)}</span>
          </div>
        </div>

        <style>{`
          .chart-container {
            position: relative;
            padding: 20px 40px 20px 60px;
          }

          .price-chart {
            width: 100%;
            height: 200px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 8px;
          }

          .chart-legend {
            display: flex;
            gap: 20px;
            justify-content: center;
            margin-top: 12px;
          }

          .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: #808090;
          }

          .legend-color {
            width: 12px;
            height: 12px;
            border-radius: 2px;
          }

          .legend-color.price {
            background: #00A3FF;
          }

          .legend-color.range {
            background: rgba(0, 212, 170, 0.3);
            border: 1px dashed #00D4AA;
          }

          .legend-color.rebalance {
            background: #FFE66D;
            border-radius: 50%;
          }

          .chart-labels {
            position: absolute;
            left: 0;
            top: 20px;
            bottom: 20px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            font-size: 10px;
            color: #606070;
            font-family: 'JetBrains Mono', monospace;
          }
        `}</style>
      </CardContent>
    </Card>
  );
}

// Helper to format duration in human readable format
function formatDuration(ms: number): string {
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

// Format large numbers: 1000 -> 1K, 1000000 -> 1M, 1000000000 -> 1B
function formatCompactNumber(num: number): string {
  if (num >= 1_000_000_000) {
    return `$${(num / 1_000_000_000).toFixed(2)}B`;
  }
  if (num >= 1_000_000) {
    return `$${(num / 1_000_000).toFixed(2)}M`;
  }
  if (num >= 1_000) {
    return `$${(num / 1_000).toFixed(1)}K`;
  }
  return `$${num.toFixed(0)}`;
}

function PositionHistory({ result, pool }: { result: BacktestResult; pool: Pool | null }) {
  const { rebalances, config, priceData, outOfRangePeriods } = result;
  const [showAll, setShowAll] = useState(false);
  const [viewMode, setViewMode] = useState<'basic' | 'detailed'>('basic');

  if (!rebalances.length && (!outOfRangePeriods || outOfRangePeriods.length === 0)) {
    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw size={18} />
            Position History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="no-rebalances">No position events occurred during this period.</p>
        </CardContent>
      </Card>
    );
  }

  const displayedRebalances = showAll ? rebalances : rebalances.slice(0, 10);
  const hiddenCount = rebalances.length - 10;
  const initialPrice = priceData[0]?.price || rebalances[0]?.price || 1;

  // Calculate detailed data for each rebalance
  const getRebalanceDetails = (rb: typeof rebalances[0], index: number) => {
    const positionValue = rb.positionValue || config.initialCapital;

    // Token amounts calculation (50/50 split at rebalance)
    const tokenBValue = positionValue / 2;
    const tokenAValue = positionValue / 2;
    const tokenBAmount = tokenBValue; // In quote currency (USDC)
    const tokenAAmount = tokenAValue / rb.price; // In base currency

    // Calculate IL from initial price
    const priceRatio = rb.price / initialPrice;
    const ilFactor = 2 * Math.sqrt(priceRatio) / (1 + priceRatio) - 1;
    const estimatedIL = Math.abs(ilFactor * config.initialCapital);

    // Get fees earned during this cycle
    const prevFees = index > 0 ? rebalances[index - 1].feesCollected : 0;
    const cycleFeesEarned = rb.feesCollected - prevFees;

    // Calculate time since last rebalance
    const prevTimestamp = index > 0 ? rebalances[index - 1].timestamp : config.startTime;
    const cycleDurationHours = (rb.timestamp - prevTimestamp) / (1000 * 60 * 60);

    // Calculate APR for this cycle based on fees earned
    const cycleAPR = cycleDurationHours > 0
      ? (cycleFeesEarned / positionValue) * (365 * 24 / cycleDurationHours) * 100
      : 0;

    // Break-even check: fees should cover IL + gas
    const totalCosts = estimatedIL + rb.gasCost;
    const isBreakEven = rb.feesCollected >= totalCosts;

    // Earnings projections based on cycle fees
    const hourlyRate = cycleDurationHours > 0 ? cycleFeesEarned / cycleDurationHours : 0;
    const earnings = {
      hourly: hourlyRate,
      daily: hourlyRate * 24,
      h3: hourlyRate * 3,
      h6: hourlyRate * 6,
      h12: hourlyRate * 12,
    };

    return {
      tokenAAmount,
      tokenBAmount,
      positionValue,
      cycleFeesEarned,
      totalFees: rb.feesCollected,
      estimatedIL,
      cycleAPR,
      isBreakEven,
      cycleDurationHours,
      earnings,
    };
  };

  // Reason explanations
  const reasonTooltips: Record<string, string> = {
    'position-opened': 'Position opened with initial liquidity',
    'out-of-range': 'Rebalanced: price moved outside position range',
    'timer': 'Rebalanced: max timer triggered (24h backup)',
    'divergence': 'Rebalanced: IL exceeded threshold',
    'profit-target': 'Rebalanced: profit target reached',
    'stop-loss': 'Rebalanced: stop loss triggered',
    'price-exit-range': 'Price exited the position range',
    'price-enter-range': 'Price entered the position range',
    'return-to-range': 'Price returned to range (no rebalance needed)',
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="rebalance-header">
          <CardTitle className="flex items-center gap-2">
            <RefreshCw size={18} />
            Position History ({rebalances.length} events)
          </CardTitle>
          <div className="view-toggle">
            <button
              className={`toggle-view-btn ${viewMode === 'basic' ? 'active' : ''}`}
              onClick={() => setViewMode('basic')}
            >
              Basic
            </button>
            <button
              className={`toggle-view-btn ${viewMode === 'detailed' ? 'active' : ''}`}
              onClick={() => setViewMode('detailed')}
            >
              Detailed
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {viewMode === 'basic' ? (
          <div className="rebalance-table">
            <div className="table-header">
              <span>#</span>
              <span>Time</span>
              <span>Price</span>
              <span>Event</span>
              <span>Duration</span>
              <span>Old Range</span>
              <span>New Range</span>
            </div>
            {displayedRebalances.map((rb, i) => (
              <div key={i} className="table-row">
                <span className="mono">{i + 1}</span>
                <span className="mono">{new Date(rb.timestamp).toLocaleString()}</span>
                <span className="mono">{rb.price.toFixed(4)}</span>
                <span>
                  <Badge
                    variant="outline"
                    className={`reason-${rb.reason}`}
                    title={reasonTooltips[rb.reason] || rb.reason}
                  >
                    {rb.reason === 'position-opened' ? 'opened' :
                     rb.reason === 'out-of-range' ? 'rebalanced' :
                     rb.reason === 'timer' ? 'rebalanced' :
                     rb.reason === 'price-exit-range' ? 'exited' :
                     rb.reason === 'return-to-range' ? 'returned' :
                     rb.reason}
                  </Badge>
                </span>
                <span className="mono duration-cell">
                  {rb.outOfRangeDurationMs
                    ? `${formatDuration(rb.outOfRangeDurationMs)} (out)`
                    : rb.inRangeDurationMs
                    ? `${formatDuration(rb.inRangeDurationMs)} (in)`
                    : '-'}
                </span>
                <span className="mono old-range">
                  {rb.oldRange.lower.toFixed(4)} - {rb.oldRange.upper.toFixed(4)}
                </span>
                <span className="mono new-range">
                  {rb.newRange.lower.toFixed(4)} - {rb.newRange.upper.toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rebalance-table-detailed">
            <div className="table-header-detailed">
              <span>#</span>
              <span>Time</span>
              <span>Price</span>
              <span>Old Range</span>
              <span>New Range</span>
              <span>{config.tokenA}</span>
              <span>{config.tokenB}</span>
              <span>Pooled $</span>
              <span>Vol 24h</span>
              <span>TVL</span>
              <span>Fees $</span>
              <span>Est. IL</span>
              <span>APR</span>
              <span>B/E</span>
            </div>
            {displayedRebalances.map((rb, i) => {
              const details = getRebalanceDetails(rb, i);
              // Use real pool data for Volume 24h and TVL
              const volume24h = pool?.volume24h || 0;
              const tvl = pool?.tvlUsd || 0;
              return (
                <div key={i} className="table-row-detailed">
                  <span className="mono">{i + 1}</span>
                  <span className="mono time-col">
                    {new Date(rb.timestamp).toLocaleDateString()}<br/>
                    <small>{new Date(rb.timestamp).toLocaleTimeString()}</small>
                  </span>
                  <span className="mono">{rb.price.toFixed(4)}</span>
                  <span className="mono old-range range-col">
                    {rb.oldRange.lower.toFixed(3)}<br/>
                    <small>{rb.oldRange.upper.toFixed(3)}</small>
                  </span>
                  <span className="mono new-range range-col">
                    {rb.newRange.lower.toFixed(3)}<br/>
                    <small>{rb.newRange.upper.toFixed(3)}</small>
                  </span>
                  <span className="mono token-amount">{details.tokenAAmount.toFixed(2)}</span>
                  <span className="mono token-amount">{details.tokenBAmount.toFixed(2)}</span>
                  <span className="mono">${details.positionValue.toFixed(0)}</span>
                  <span className="mono vol-col">{formatCompactNumber(volume24h)}</span>
                  <span className="mono tvl-col">{formatCompactNumber(tvl)}</span>
                  <span className="mono positive">+${details.cycleFeesEarned.toFixed(2)}</span>
                  <span className="mono negative">-${details.estimatedIL.toFixed(2)}</span>
                  <span className={`mono ${details.cycleAPR > 100 ? 'positive' : details.cycleAPR > 50 ? '' : 'warning'}`}>
                    {details.cycleAPR.toFixed(0)}%
                  </span>
                  <span className="break-even-cell">
                    {details.isBreakEven ? (
                      <span className="be-positive">✓</span>
                    ) : (
                      <span className="be-negative">✗</span>
                    )}
                  </span>
                </div>
              );
            })}
            {displayedRebalances.length > 0 && (
              <div className="table-row-totals">
                <span className="mono">Σ</span>
                <span>TOTALS</span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span className="mono">${result.finalValue.toFixed(0)}</span>
                <span></span>
                <span></span>
                <span className="mono positive">+${result.feesEarned.toFixed(2)}</span>
                <span className="mono negative">-${result.impermanentLoss.toFixed(2)}</span>
                <span></span>
                <span className="break-even-cell">
                  {result.feesEarned > result.impermanentLoss + result.gasCosts ? (
                    <span className="be-positive">✓</span>
                  ) : (
                    <span className="be-negative">✗</span>
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Earnings Projection Section (only in detailed view) */}
        {viewMode === 'detailed' && rebalances.length > 0 && (
          <div className="earnings-projection">
            <h4>Projected Earnings (based on avg cycle)</h4>
            {(() => {
              const avgCycleFees = result.feesEarned / rebalances.length;
              const totalDuration = (config.endTime - config.startTime) / (1000 * 60 * 60);
              const avgCycleDuration = totalDuration / rebalances.length;
              const hourlyRate = avgCycleDuration > 0 ? avgCycleFees / avgCycleDuration : 0;

              return (
                <div className="earnings-grid">
                  <div className="earning-item">
                    <span className="earning-label">1h</span>
                    <span className="earning-value">${hourlyRate.toFixed(4)}</span>
                  </div>
                  <div className="earning-item">
                    <span className="earning-label">3h</span>
                    <span className="earning-value">${(hourlyRate * 3).toFixed(4)}</span>
                  </div>
                  <div className="earning-item">
                    <span className="earning-label">6h</span>
                    <span className="earning-value">${(hourlyRate * 6).toFixed(4)}</span>
                  </div>
                  <div className="earning-item">
                    <span className="earning-label">12h</span>
                    <span className="earning-value">${(hourlyRate * 12).toFixed(4)}</span>
                  </div>
                  <div className="earning-item highlight">
                    <span className="earning-label">Daily</span>
                    <span className="earning-value">${(hourlyRate * 24).toFixed(4)}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {rebalances.length > 10 && (
          <button
            className="show-more-btn"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll
              ? '← Show less'
              : `Show all ${rebalances.length} events (+${hiddenCount} more)`
            }
          </button>
        )}

        <div className="reason-legend">
          <span className="legend-title">Legend:</span>
          <span className="legend-item">
            <Badge variant="outline" className="reason-position-opened">opened</Badge>
            <span>Position opened</span>
          </span>
          <span className="legend-item">
            <Badge variant="outline" className="reason-price-exit-range">exited</Badge>
            <span>Price left range</span>
          </span>
          <span className="legend-item">
            <Badge variant="outline" className="reason-return-to-range">returned</Badge>
            <span>Price returned</span>
          </span>
          <span className="legend-item">
            <Badge variant="outline" className="reason-out-of-range">rebalanced</Badge>
            <span>Auto rebalanced</span>
          </span>
          <span className="legend-item">
            <span className="be-positive">✓</span>
            <span>Break-even</span>
          </span>
          <span className="legend-item">
            <span className="be-negative">✗</span>
            <span>Not break-even</span>
          </span>
        </div>

        <style>{`
          .no-rebalances {
            text-align: center;
            color: #606070;
            padding: 20px;
          }

          .rebalance-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
          }

          .view-toggle {
            display: flex;
            gap: 4px;
            background: rgba(255, 255, 255, 0.03);
            padding: 3px;
            border-radius: 6px;
          }

          .toggle-view-btn {
            padding: 4px 12px;
            font-size: 11px;
            background: none;
            border: none;
            color: #808090;
            cursor: pointer;
            border-radius: 4px;
            transition: all 0.2s;
          }

          .toggle-view-btn:hover {
            color: #E8E8EC;
          }

          .toggle-view-btn.active {
            background: rgba(0, 212, 170, 0.2);
            color: #00D4AA;
          }

          .rebalance-table, .rebalance-table-detailed {
            display: flex;
            flex-direction: column;
            gap: 2px;
            overflow-x: auto;
          }

          .table-header, .table-row {
            display: grid;
            grid-template-columns: 40px 150px 80px 100px 80px 130px 130px;
            gap: 10px;
            padding: 10px 12px;
            font-size: 12px;
            min-width: 750px;
          }

          .table-header-detailed, .table-row-detailed, .table-row-totals {
            display: grid;
            grid-template-columns: 30px 75px 60px 65px 65px 50px 50px 55px 50px 50px 55px 50px 40px 30px;
            gap: 6px;
            padding: 8px 10px;
            font-size: 10px;
            min-width: 900px;
            align-items: center;
          }

          .table-header, .table-header-detailed {
            color: #606070;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          }

          .table-row, .table-row-detailed {
            color: #B0B0C0;
            background: rgba(255, 255, 255, 0.02);
            border-radius: 4px;
          }

          .table-row:hover, .table-row-detailed:hover {
            background: rgba(255, 255, 255, 0.04);
          }

          .table-row-totals {
            color: #E8E8EC;
            background: rgba(0, 212, 170, 0.1);
            border: 1px solid rgba(0, 212, 170, 0.2);
            border-radius: 4px;
            font-weight: 600;
            margin-top: 4px;
          }

          .time-col {
            font-size: 9px;
            line-height: 1.3;
          }

          .time-col small {
            color: #606070;
          }

          .range-col {
            font-size: 9px;
            line-height: 1.3;
          }

          .range-col small {
            display: block;
          }

          .token-amount {
            color: #A0A0B0;
            font-size: 9px;
          }

          .vol-col {
            color: #80C0FF;
            font-size: 9px;
          }

          .tvl-col {
            color: #A0A0B0;
            font-size: 9px;
          }

          .mono {
            font-family: 'JetBrains Mono', monospace;
          }

          .old-range {
            color: #808090;
          }

          .new-range {
            color: #00D4AA;
          }

          .positive {
            color: #22c55e;
          }

          .negative {
            color: #ef4444;
          }

          .warning {
            color: #eab308;
          }

          .break-even-cell {
            display: flex;
            justify-content: center;
          }

          .be-positive {
            color: #22c55e;
            font-weight: bold;
            font-size: 14px;
          }

          .be-negative {
            color: #ef4444;
            font-weight: bold;
            font-size: 14px;
          }

          .reason-out-of-range {
            border-color: #eab308;
            color: #eab308;
            background: rgba(234, 179, 8, 0.1);
          }

          .reason-timer {
            border-color: #00A3FF;
            color: #00A3FF;
            background: rgba(0, 163, 255, 0.1);
          }

          .reason-return-to-range {
            border-color: #22c55e;
            color: #22c55e;
            background: rgba(34, 197, 94, 0.1);
          }

          .reason-position-opened {
            border-color: #a855f7;
            color: #a855f7;
            background: rgba(168, 85, 247, 0.1);
          }

          .reason-price-exit-range {
            border-color: #f97316;
            color: #f97316;
            background: rgba(249, 115, 22, 0.1);
          }

          .reason-price-enter-range {
            border-color: #22c55e;
            color: #22c55e;
            background: rgba(34, 197, 94, 0.1);
          }

          .duration-cell {
            font-size: 11px;
          }

          .out-of-range-duration {
            color: #eab308;
            font-size: 11px;
          }

          .earnings-projection {
            margin-top: 16px;
            padding: 12px;
            background: rgba(0, 163, 255, 0.05);
            border: 1px solid rgba(0, 163, 255, 0.2);
            border-radius: 8px;
          }

          .earnings-projection h4 {
            font-size: 12px;
            color: #808090;
            margin-bottom: 10px;
            font-weight: 500;
          }

          .earnings-grid {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
          }

          .earning-item {
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.03);
            border-radius: 6px;
            min-width: 60px;
          }

          .earning-item.highlight {
            background: rgba(0, 212, 170, 0.15);
            border: 1px solid rgba(0, 212, 170, 0.3);
          }

          .earning-label {
            font-size: 10px;
            color: #606070;
          }

          .earning-value {
            font-size: 13px;
            font-weight: 600;
            color: #22c55e;
            font-family: 'JetBrains Mono', monospace;
          }

          .show-more-btn {
            width: 100%;
            padding: 12px;
            margin-top: 8px;
            background: rgba(0, 163, 255, 0.1);
            border: 1px solid rgba(0, 163, 255, 0.3);
            border-radius: 6px;
            color: #00A3FF;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
          }

          .show-more-btn:hover {
            background: rgba(0, 163, 255, 0.2);
            border-color: rgba(0, 163, 255, 0.5);
          }

          .reason-legend {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            font-size: 11px;
            flex-wrap: wrap;
          }

          .legend-title {
            color: #606070;
          }

          .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
            color: #808090;
          }
        `}</style>
      </CardContent>
    </Card>
  );
}

function StrategyComparisonTable({ comparisons }: { comparisons: StrategyComparison[] }) {
  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 size={18} />
          Strategy Comparison
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="comparison-table">
          <div className="comp-header">
            <span>Rank</span>
            <span>Strategy</span>
            <span>Return</span>
            <span>Fees</span>
            <span>IL</span>
            <span>Rebalances</span>
            <span>In Range</span>
            <span>Risk</span>
          </div>
          {comparisons.map((comp, i) => {
            const r = comp.result;
            const isPositive = r.totalReturnPercent >= 0;
            return (
              <div key={comp.strategyId} className={`comp-row ${i === 0 ? 'winner' : ''}`}>
                <span className="rank">{i === 0 ? '🏆' : i + 1}</span>
                <span className="strategy-name">
                  <StrategyIcon id={comp.strategyId} />
                  {comp.strategyName}
                </span>
                <span className={`mono ${isPositive ? 'positive' : 'negative'}`}>
                  {isPositive ? '+' : ''}{r.totalReturnPercent.toFixed(2)}%
                </span>
                <span className="mono positive">+{formatCurrency(r.feesEarned)}</span>
                <span className="mono negative">-{formatCurrency(r.impermanentLoss)}</span>
                <span className="mono">{r.rebalanceCount}</span>
                <span className="mono">{r.timeInRange.toFixed(0)}%</span>
                <span>
                  <RiskBadge risk={STRATEGY_PRESETS.find(s => s.id === comp.strategyId)?.riskLevel || 'medium'} small />
                </span>
              </div>
            );
          })}
        </div>

        <style>{`
          .comparison-table {
            display: flex;
            flex-direction: column;
            gap: 2px;
            overflow-x: auto;
          }

          .comp-header, .comp-row {
            display: grid;
            grid-template-columns: 50px 180px repeat(6, 90px);
            gap: 8px;
            padding: 10px 12px;
            font-size: 12px;
            min-width: 800px;
          }

          .comp-header {
            color: #606070;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          }

          .comp-row {
            color: #B0B0C0;
            background: rgba(255, 255, 255, 0.02);
            border-radius: 4px;
            align-items: center;
          }

          .comp-row.winner {
            background: rgba(0, 212, 170, 0.1);
            border: 1px solid rgba(0, 212, 170, 0.2);
          }

          .comp-row:hover {
            background: rgba(255, 255, 255, 0.04);
          }

          .rank {
            font-size: 14px;
            text-align: center;
          }

          .strategy-name {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #E8E8EC;
          }

          .mono {
            font-family: 'JetBrains Mono', monospace;
          }

          .positive {
            color: #22c55e;
          }

          .negative {
            color: #ef4444;
          }
        `}</style>
      </CardContent>
    </Card>
  );
}

function MonteCarloResults({ result, baseResult }: { result: MonteCarloResult; baseResult: BacktestResult }) {
  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shuffle size={18} />
          Monte Carlo Simulation ({result.simulations} runs)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="monte-carlo-grid">
          <div className="mc-card probability">
            <span className="mc-label">Probability of Profit</span>
            <span className={`mc-value large ${result.probabilityOfProfit >= 50 ? 'positive' : 'negative'}`}>
              {result.probabilityOfProfit.toFixed(1)}%
            </span>
          </div>

          <div className="mc-card">
            <span className="mc-label">Expected Return</span>
            <span className={`mc-value ${result.mean >= 0 ? 'positive' : 'negative'}`}>
              {result.mean >= 0 ? '+' : ''}{result.mean.toFixed(2)}%
            </span>
          </div>

          <div className="mc-card">
            <span className="mc-label">Std Deviation</span>
            <span className="mc-value">{result.stdDev.toFixed(2)}%</span>
          </div>

          <div className="mc-card best">
            <span className="mc-label">Best Case (95th)</span>
            <span className="mc-value positive">+{result.percentiles.p95.toFixed(2)}%</span>
          </div>

          <div className="mc-card worst">
            <span className="mc-label">Worst Case (5th)</span>
            <span className="mc-value negative">{result.percentiles.p5.toFixed(2)}%</span>
          </div>

          <div className="mc-card median">
            <span className="mc-label">Median (50th)</span>
            <span className={`mc-value ${result.percentiles.p50 >= 0 ? 'positive' : 'negative'}`}>
              {result.percentiles.p50 >= 0 ? '+' : ''}{result.percentiles.p50.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="percentile-bar">
          <div className="bar-track">
            <div
              className="bar-range"
              style={{
                left: `${Math.max(0, (result.percentiles.p5 + 50) / 100 * 100)}%`,
                width: `${Math.min(100, (result.percentiles.p95 - result.percentiles.p5) / 100 * 100)}%`,
              }}
            />
            <div
              className="bar-median"
              style={{ left: `${Math.max(0, Math.min(100, (result.percentiles.p50 + 50) / 100 * 100))}%` }}
            />
          </div>
          <div className="bar-labels">
            <span>-50%</span>
            <span>0%</span>
            <span>+50%</span>
          </div>
        </div>

        <div className="mc-info">
          <Info size={14} />
          <span>
            Based on {result.simulations} simulated price paths using historical volatility.
            Your actual backtest result: <strong className={baseResult.totalReturnPercent >= 0 ? 'positive' : 'negative'}>
              {baseResult.totalReturnPercent >= 0 ? '+' : ''}{baseResult.totalReturnPercent.toFixed(2)}%
            </strong>
          </span>
        </div>

        <style>{`
          .monte-carlo-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin-bottom: 20px;
          }

          @media (max-width: 768px) {
            .monte-carlo-grid {
              grid-template-columns: repeat(2, 1fr);
            }
          }

          .mc-card {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 12px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 8px;
          }

          .mc-card.probability {
            grid-column: span 3;
            background: rgba(0, 212, 170, 0.08);
            border-color: rgba(0, 212, 170, 0.2);
            text-align: center;
          }

          @media (max-width: 768px) {
            .mc-card.probability {
              grid-column: span 2;
            }
          }

          .mc-card.best {
            border-color: rgba(34, 197, 94, 0.3);
          }

          .mc-card.worst {
            border-color: rgba(239, 68, 68, 0.3);
          }

          .mc-label {
            font-size: 11px;
            color: #606070;
          }

          .mc-value {
            font-size: 18px;
            font-weight: 600;
            color: #E8E8EC;
            font-family: 'JetBrains Mono', monospace;
          }

          .mc-value.large {
            font-size: 32px;
          }

          .mc-value.positive, .positive {
            color: #22c55e;
          }

          .mc-value.negative, .negative {
            color: #ef4444;
          }

          .percentile-bar {
            margin-bottom: 16px;
          }

          .bar-track {
            position: relative;
            height: 24px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            overflow: hidden;
          }

          .bar-range {
            position: absolute;
            top: 4px;
            bottom: 4px;
            background: linear-gradient(90deg, #ef4444, #eab308, #22c55e);
            border-radius: 8px;
            opacity: 0.6;
          }

          .bar-median {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 3px;
            background: #00D4AA;
            transform: translateX(-50%);
          }

          .bar-labels {
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: #606070;
            margin-top: 4px;
          }

          .mc-info {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 12px;
            background: rgba(0, 163, 255, 0.1);
            border-radius: 8px;
            font-size: 12px;
            color: #80C0FF;
          }

          .mc-info strong {
            font-weight: 600;
          }
        `}</style>
      </CardContent>
    </Card>
  );
}
