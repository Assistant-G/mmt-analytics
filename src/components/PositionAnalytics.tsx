import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Activity,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Download,
  Coins,
  Minus,
  Loader2,
  Plus,
  Timer,
  Infinity,
  StopCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ComposedChart
} from 'recharts';
import { toast } from 'sonner';
import { useWallet } from '@/contexts/WalletContext';
import { useAutoClose } from '@/contexts/AutoCloseContext';
import {
  fetchPositions,
  generatePriceHistory,
  generatePositionHistory,
  buildCollectFeesTransaction,
  buildRemoveLiquidityTransaction
} from '@/services/mmtService';
import { formatCurrency, formatPercent, formatAddress, getTimeAgo, getTokenLogo } from '@/utils';
import { AddLiquidityModal } from './AddLiquidityModal';
import type { Position } from '@/types';

export function PositionAnalytics() {
  const { address, isConnected, setAddress } = useWallet();
  const [searchAddress, setSearchAddress] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);

  const { data: positions, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['positions', address],
    queryFn: () => fetchPositions(address!),
    enabled: !!address,
    staleTime: 30000,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchAddress.startsWith('0x') && searchAddress.length >= 42) {
      setAddress(searchAddress);
    }
  };

  const totalValue = positions?.reduce((sum, p) => sum + p.totalValueUsd, 0) || 0;
  const totalPnl = positions?.reduce((sum, p) => sum + p.pnl, 0) || 0;
  const totalFees = positions?.reduce((sum, p) => sum + p.uncollectedFeesUsd, 0) || 0;
  const inRangeCount = positions?.filter(p => p.isInRange).length || 0;

  if (!isConnected) {
    return (
      <div className="position-analytics">
        <div className="connect-prompt">
          <div className="prompt-icon">
            <Wallet size={48} />
          </div>
          <h2>View Your Positions</h2>
          <p>Enter a wallet address to view LP positions on MMT Finance</p>
          <form onSubmit={handleSearch} className="search-form">
            <Input
              type="text"
              placeholder="Enter wallet address (0x...)"
              value={searchAddress}
              onChange={(e) => setSearchAddress(e.target.value)}
              className="address-input"
            />
            <Button type="submit" className="search-btn">
              Search
            </Button>
          </form>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="position-analytics">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>My Positions</h1>
          <p className="mono">{formatAddress(address!, 8)}</p>
        </div>
        <div className="header-actions">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw size={16} className={isRefetching ? 'loading-spinner' : ''} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="summary-row">
        <SummaryCard
          title="Total Value"
          value={formatCurrency(totalValue)}
          icon={<DollarSign size={20} />}
          loading={isLoading}
        />
        <SummaryCard
          title="Total PnL"
          value={formatCurrency(Math.abs(totalPnl))}
          subtitle={totalPnl !== 0 ? formatPercent((totalPnl / (totalValue - totalPnl)) * 100) : undefined}
          icon={totalPnl >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
          variant={totalPnl >= 0 ? 'profit' : 'loss'}
          loading={isLoading}
        />
        <SummaryCard
          title="Uncollected Fees"
          value={formatCurrency(totalFees)}
          icon={<Coins size={20} />}
          variant="profit"
          loading={isLoading}
        />
        <SummaryCard
          title="In Range"
          value={`${inRangeCount}/${positions?.length || 0}`}
          icon={<Target size={20} />}
          loading={isLoading}
        />
      </div>

      {/* Positions Grid */}
      <div className="positions-section">
        <div className="section-header">
          <h2>Your Positions</h2>
          <span className="count">{positions?.length || 0}</span>
        </div>
        
        {isLoading ? (
          <div className="positions-grid">
            {Array.from({ length: 3 }).map((_, i) => (
              <PositionCardSkeleton key={i} />
            ))}
          </div>
        ) : positions?.length === 0 ? (
          <div className="empty-state">
            <Wallet size={40} />
            <h3>No Positions Found</h3>
            <p>This wallet has no active LP positions</p>
          </div>
        ) : (
          <div className="positions-grid">
            {positions?.map(position => (
              <PositionCard
                key={position.id}
                position={position}
                walletAddress={address!}
                isSelected={selectedPosition?.id === position.id}
                onSelect={() => setSelectedPosition(
                  selectedPosition?.id === position.id ? null : position
                )}
                onRefresh={refetch}
              />
            ))}
          </div>
        )}
      </div>

      {/* Position Detail Modal */}
      {selectedPosition && (
        <PositionDetail 
          position={selectedPosition} 
          onClose={() => setSelectedPosition(null)} 
        />
      )}

      <style>{styles}</style>
    </div>
  );
}

// Summary Card Component
interface SummaryCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  variant?: 'default' | 'profit' | 'loss';
  loading?: boolean;
}

function SummaryCard({ title, value, subtitle, icon, variant = 'default', loading }: SummaryCardProps) {
  return (
    <div className={`summary-card ${variant}`}>
      <div className="summary-icon">{icon}</div>
      <div className="summary-content">
        <span className="summary-title">{title}</span>
        {loading ? (
          <Skeleton className="h-7 w-24" style={{ background: 'rgba(255,255,255,0.05)' }} />
        ) : (
          <div className="summary-value-row">
            <span className="summary-value">{value}</span>
            {subtitle && <span className="summary-subtitle">{subtitle}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// Position Card Component
interface PositionCardProps {
  position: Position;
  walletAddress: string;
  isSelected: boolean;
  onSelect: () => void;
  onRefresh: () => void;
}

function PositionCard({ position, walletAddress, isSelected, onSelect, onRefresh }: PositionCardProps) {
  const { pool, isInRange, pnl, pnlPercent, totalValueUsd, uncollectedFeesUsd, apr, rangeUtilization } = position;
  const [actionLoading, setActionLoading] = useState<'claim' | 'remove' | null>(null);
  const [isAddLiquidityOpen, setIsAddLiquidityOpen] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { getTimeRemaining, getRemainingRepeats, stopInfiniteMode, isClosing, removePosition } = useAutoClose();

  const remainingRepeats = getRemainingRepeats(position.id);
  const isInfiniteMode = remainingRepeats === 'infinite';

  useEffect(() => {
    const updateCountdown = () => {
      const remaining = getTimeRemaining(position.id);
      setCountdown(remaining);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [position.id, getTimeRemaining]);

  const formatCountdown = (ms: number): string => {
    const totalSeconds = Math.ceil(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  };

  const handleClaimFees = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (actionLoading) return;
    setActionLoading('claim');
    try {
      const tx = await buildCollectFeesTransaction(position.id, position.poolId, walletAddress);
      await signAndExecute({ transaction: tx });
      toast.success('Fees claimed successfully!');
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to claim fees');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveLiquidity = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (actionLoading) return;
    setActionLoading('remove');
    try {
      const tx = await buildRemoveLiquidityTransaction(position.id, position.poolId, position.liquidity, walletAddress);
      await signAndExecute({ transaction: tx });
      toast.success('Liquidity removed successfully!');
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove liquidity');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className={`position-card ${isSelected ? 'selected' : ''}`} onClick={onSelect}>
      {/* Header */}
      <div className="position-header">
        <div className="pool-info">
          <div className="token-pair">
            <img src={getTokenLogo(pool.tokenA.symbol)} alt="" className="token-icon" />
            <img src={getTokenLogo(pool.tokenB.symbol)} alt="" className="token-icon overlap" />
          </div>
          <span className="pool-name">{pool.tokenA.symbol}/{pool.tokenB.symbol}</span>
        </div>
        <div className={`status-badge ${isInRange ? 'in-range' : 'out-range'}`}>
          {isInRange ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {isInRange ? 'In Range' : 'Out of Range'}
        </div>
      </div>

      {/* Range Bar */}
      <div className="range-section">
        <div className="range-header">
          <span className="range-label">Range</span>
          <span className={`range-percent ${rangeUtilization > 80 ? 'high' : rangeUtilization > 40 ? 'medium' : 'low'}`}>
            {rangeUtilization.toFixed(0)}%
          </span>
        </div>
        <div className="range-bar">
          <div 
            className={`range-fill ${isInRange ? 'in-range' : 'out-range'}`}
            style={{ width: `${Math.min(rangeUtilization, 100)}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="position-stats">
        <div className="stat">
          <span className="label">Value</span>
          <span className="value mono">{formatCurrency(totalValueUsd, { compact: true })}</span>
        </div>
        <div className="stat">
          <span className="label">PnL</span>
          <span className={`value mono ${pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
            {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
          </span>
        </div>
        <div className="stat">
          <span className="label">Fees</span>
          <span className="value mono text-profit">+{formatCurrency(uncollectedFeesUsd)}</span>
        </div>
        <div className="stat">
          <span className="label">APR</span>
          <span className="value mono text-teal">{apr.toFixed(1)}%</span>
        </div>
      </div>

      {/* Actions */}
      <div className="position-actions" onClick={e => e.stopPropagation()}>
        <button className="action-btn add" onClick={() => setIsAddLiquidityOpen(true)}>
          <Plus size={14} />
          Add
        </button>
        <button className="action-btn claim" onClick={handleClaimFees} disabled={actionLoading !== null}>
          {actionLoading === 'claim' ? <Loader2 size={14} className="loading-spinner" /> : <Coins size={14} />}
          Claim
        </button>
        <button className="action-btn remove" onClick={handleRemoveLiquidity} disabled={actionLoading !== null}>
          {actionLoading === 'remove' ? <Loader2 size={14} className="loading-spinner" /> : <Minus size={14} />}
          Remove
        </button>
      </div>

      <AddLiquidityModal
        pool={pool}
        isOpen={isAddLiquidityOpen}
        onClose={() => {
          setIsAddLiquidityOpen(false);
          onRefresh();
        }}
      />
    </div>
  );
}

// Position Detail Component
function PositionDetail({ position, onClose }: { position: Position; onClose: () => void }) {
  const priceHistory = generatePriceHistory(position.pool.priceTokenA, 30);
  const positionHistory = generatePositionHistory(position, 30);

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-modal" onClick={e => e.stopPropagation()}>
        <div className="detail-header">
          <h3>Position Details</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="detail-content">
          <div className="chart-section">
            <h4>Price History with Range</h4>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={priceHistory}>
                <defs>
                  <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14f4c9" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#14f4c9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="timestamp" tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} stroke="#52525b" fontSize={11} />
                <YAxis domain={['auto', 'auto']} stroke="#52525b" fontSize={11} tickFormatter={(val) => `$${val.toFixed(2)}`} />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine y={position.priceLower} stroke="#ef4444" strokeDasharray="3 3" />
                <ReferenceLine y={position.priceUpper} stroke="#22c55e" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="price" stroke="#14f4c9" fill="url(#priceGradient)" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="metrics-grid">
            <MetricItem label="Deposited Value" value={formatCurrency(position.depositedValueUsd)} />
            <MetricItem label="Current Value" value={formatCurrency(position.totalValueUsd)} />
            <MetricItem label="Divergence Loss" value={formatCurrency(position.divergencePnl)} variant={position.divergencePnl >= 0 ? 'profit' : 'loss'} />
            <MetricItem label="Fee Earnings" value={formatCurrency(position.feePnl)} variant="profit" />
            <MetricItem label="ROI" value={formatPercent(position.roi)} variant={position.roi >= 0 ? 'profit' : 'loss'} />
            <MetricItem label="Fee APR" value={`${position.feeApr.toFixed(1)}%`} variant="profit" />
            <MetricItem label="Price Range" value={`$${position.priceLower.toFixed(2)} - $${position.priceUpper.toFixed(2)}`} />
            <MetricItem label="Created" value={getTimeAgo(position.createdAt)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricItem({ label, value, variant }: { label: string; value: string; variant?: 'profit' | 'loss' }) {
  return (
    <div className="metric-item">
      <span className="metric-label">{label}</span>
      <span className={`metric-value mono ${variant === 'profit' ? 'text-profit' : variant === 'loss' ? 'text-loss' : ''}`}>
        {value}
      </span>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tooltip-label">{new Date(label).toLocaleDateString()}</div>
      <div className="tooltip-value">Price: ${payload[0]?.value?.toFixed(4)}</div>
    </div>
  );
}

function PositionCardSkeleton() {
  return (
    <div className="position-card skeleton">
      <div className="position-header">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-6 w-20" />
      </div>
      <Skeleton className="h-2 w-full mt-4" />
      <div className="position-stats mt-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

const styles = `
  .position-analytics {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  /* Connect Prompt */
  .connect-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    text-align: center;
    gap: 16px;
  }

  .prompt-icon {
    width: 100px;
    height: 100px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(20, 244, 201, 0.15), rgba(59, 130, 246, 0.15));
    border-radius: 24px;
    color: var(--accent-teal);
  }

  .connect-prompt h2 {
    font-size: 24px;
    font-weight: 700;
  }

  .connect-prompt p {
    color: var(--text-muted);
    max-width: 400px;
  }

  .search-form {
    display: flex;
    gap: 12px;
    width: 100%;
    max-width: 480px;
    margin-top: 16px;
  }

  .address-input {
    flex: 1;
    font-family: 'JetBrains Mono', monospace;
  }

  .search-btn {
    background: var(--gradient-primary);
    color: #09090b;
    font-weight: 600;
  }

  /* Header */
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .page-header h1 {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 4px;
  }

  .page-header p {
    color: var(--text-muted);
    font-size: 14px;
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }

  /* Summary Row */
  .summary-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }

  @media (max-width: 1024px) {
    .summary-row { grid-template-columns: repeat(2, 1fr); }
  }

  @media (max-width: 640px) {
    .summary-row { grid-template-columns: 1fr; }
  }

  .summary-card {
    display: flex;
    gap: 16px;
    padding: 20px;
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
  }

  .summary-card.profit { background: linear-gradient(135deg, rgba(34, 197, 94, 0.08), transparent); }
  .summary-card.loss { background: linear-gradient(135deg, rgba(239, 68, 68, 0.08), transparent); }

  .summary-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    color: var(--text-muted);
  }

  .summary-card.profit .summary-icon { color: var(--color-profit); background: var(--color-profit-bg); }
  .summary-card.loss .summary-icon { color: var(--color-loss); background: var(--color-loss-bg); }

  .summary-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .summary-title {
    font-size: 13px;
    color: var(--text-muted);
  }

  .summary-value-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .summary-value {
    font-size: 24px;
    font-weight: 700;
  }

  .summary-card.profit .summary-value { color: var(--color-profit); }
  .summary-card.loss .summary-value { color: var(--color-loss); }

  .summary-subtitle {
    font-size: 14px;
    font-weight: 600;
  }

  .summary-card.profit .summary-subtitle { color: var(--color-profit); }
  .summary-card.loss .summary-subtitle { color: var(--color-loss); }

  /* Positions Section */
  .positions-section .section-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding-left: 12px;
    border-left: 3px solid var(--accent-teal);
  }

  .positions-section .section-header h2 {
    font-size: 18px;
    font-weight: 600;
  }

  .positions-section .count {
    font-size: 14px;
    color: var(--text-muted);
    background: var(--bg-elevated);
    padding: 2px 10px;
    border-radius: var(--radius-full);
  }

  .positions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 16px;
  }

  /* Position Card */
  .position-card {
    padding: 20px;
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition: all var(--transition-base);
  }

  .position-card:hover {
    border-color: var(--border-hover);
    transform: translateY(-2px);
  }

  .position-card.selected {
    border-color: var(--accent-teal);
    box-shadow: var(--shadow-glow-teal);
  }

  .position-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
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
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--bg-card);
  }

  .token-icon.overlap {
    margin-left: -8px;
  }

  .pool-name {
    font-size: 16px;
    font-weight: 600;
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: var(--radius-full);
    font-size: 12px;
    font-weight: 600;
  }

  .status-badge.in-range {
    background: var(--color-profit-bg);
    color: var(--color-profit);
  }

  .status-badge.out-range {
    background: var(--color-loss-bg);
    color: var(--color-loss);
  }

  /* Range Section */
  .range-section {
    margin-bottom: 16px;
  }

  .range-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .range-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .range-percent {
    font-size: 12px;
    font-weight: 600;
  }

  .range-percent.high { color: var(--color-profit); }
  .range-percent.medium { color: var(--color-warning); }
  .range-percent.low { color: var(--color-loss); }

  .range-bar {
    height: 6px;
    background: var(--border-default);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .range-fill {
    height: 100%;
    border-radius: var(--radius-full);
    transition: width var(--transition-base);
  }

  .range-fill.in-range {
    background: var(--gradient-primary);
  }

  .range-fill.out-range {
    background: var(--color-loss);
  }

  /* Position Stats */
  .position-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 16px;
    padding: 12px;
    background: var(--bg-base);
    border-radius: var(--radius-md);
  }

  .position-stats .stat {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: center;
  }

  .position-stats .label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .position-stats .value {
    font-size: 14px;
    font-weight: 600;
  }

  /* Position Actions */
  .position-actions {
    display: flex;
    gap: 8px;
  }

  .action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px;
    border-radius: var(--radius-md);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition-fast);
    border: 1px solid;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn.add {
    background: rgba(20, 244, 201, 0.1);
    border-color: rgba(20, 244, 201, 0.3);
    color: var(--accent-teal);
  }

  .action-btn.add:hover:not(:disabled) {
    background: rgba(20, 244, 201, 0.2);
  }

  .action-btn.claim {
    background: rgba(59, 130, 246, 0.1);
    border-color: rgba(59, 130, 246, 0.3);
    color: var(--accent-blue);
  }

  .action-btn.claim:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.2);
  }

  .action-btn.remove {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: var(--color-loss);
  }

  .action-btn.remove:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.2);
  }

  /* Detail Overlay */
  .detail-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 24px;
  }

  .detail-modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xl);
    width: 100%;
    max-width: 800px;
    max-height: 90vh;
    overflow-y: auto;
  }

  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid var(--border-default);
  }

  .detail-header h3 {
    font-size: 18px;
    font-weight: 600;
  }

  .close-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-hover);
    border: none;
    border-radius: var(--radius-md);
    color: var(--text-muted);
    font-size: 20px;
    cursor: pointer;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .detail-content {
    padding: 24px;
  }

  .chart-section {
    margin-bottom: 24px;
  }

  .chart-section h4 {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 12px;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    padding-top: 24px;
    border-top: 1px solid var(--border-default);
  }

  @media (max-width: 768px) {
    .metrics-grid { grid-template-columns: repeat(2, 1fr); }
  }

  .metric-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .metric-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .metric-value {
    font-size: 15px;
    font-weight: 600;
  }

  /* Empty State */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px;
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    text-align: center;
    gap: 12px;
  }

  .empty-state svg {
    color: var(--text-dim);
  }

  .empty-state h3 {
    font-size: 16px;
    font-weight: 600;
  }

  .empty-state p {
    color: var(--text-muted);
    font-size: 14px;
  }

  /* Chart Tooltip */
  .chart-tooltip {
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: 10px 14px;
  }

  .tooltip-label {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 4px;
  }

  .tooltip-value {
    font-size: 14px;
    font-weight: 600;
  }
`;
