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
  ChevronRight,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
              placeholder="0x..."
              value={searchAddress}
              onChange={(e) => setSearchAddress(e.target.value)}
              className="address-input mono"
            />
            <Button type="submit" className="search-btn">
              Search Positions
            </Button>
          </form>
          <div className="example-address">
            <span>Try example:</span>
            <button 
              onClick={() => setSearchAddress('0x' + '1'.repeat(64))}
              className="example-btn mono"
            >
              0x1111...1111
            </button>
          </div>
        </div>
        <style>{`
          .connect-prompt { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; text-align: center; animation: fadeIn 0.4s ease-out; }
          .prompt-icon { width: 100px; height: 100px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, rgba(0,212,170,0.1), rgba(0,163,255,0.1)); border-radius: 24px; color: #00D4AA; margin-bottom: 24px; }
          .connect-prompt h2 { font-size: 28px; font-weight: 700; color: #E8E8EC; margin-bottom: 8px; }
          .connect-prompt p { color: #808090; margin-bottom: 32px; max-width: 400px; }
          .search-form { display: flex; gap: 12px; width: 100%; max-width: 500px; }
          .address-input { flex: 1; height: 52px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); font-size: 14px; }
          .search-btn { height: 52px; padding: 0 24px; background: linear-gradient(135deg, #00D4AA, #00A3FF); font-weight: 600; }
          .example-address { display: flex; align-items: center; gap: 8px; margin-top: 16px; font-size: 13px; color: #606070; }
          .example-btn { background: none; border: none; color: #00D4AA; cursor: pointer; font-size: 13px; }
          .example-btn:hover { text-decoration: underline; }
        `}</style>
      </div>
    );
  }

  return (
    <div className="position-analytics">
      <div className="page-header">
        <div>
          <h1>Position Analytics</h1>
          <p className="mono">{formatAddress(address!, 8)}</p>
        </div>
        <div className="header-actions">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw size={16} className={isRefetching ? 'animate-spin' : ''} />
            Refresh
          </Button>
          <Button variant="outline" size="sm">
            <Download size={16} />
            Export
          </Button>
        </div>
      </div>

      {/* Portfolio Summary */}
      <div className="summary-grid">
        <SummaryCard
          title="Total Value"
          value={formatCurrency(totalValue)}
          icon={<DollarSign />}
          loading={isLoading}
        />
        <SummaryCard
          title="Total PnL"
          value={formatCurrency(Math.abs(totalPnl))}
          subtitle={formatPercent((totalPnl / (totalValue - totalPnl)) * 100)}
          icon={totalPnl >= 0 ? <TrendingUp /> : <TrendingDown />}
          variant={totalPnl >= 0 ? 'positive' : 'negative'}
          loading={isLoading}
        />
        <SummaryCard
          title="Uncollected Fees"
          value={formatCurrency(totalFees)}
          icon={<Activity />}
          variant="accent"
          loading={isLoading}
        />
        <SummaryCard
          title="In Range"
          value={`${inRangeCount}/${positions?.length || 0}`}
          subtitle="Positions active"
          icon={<Target />}
          loading={isLoading}
        />
      </div>

      {/* Positions List */}
      <div className="positions-section">
        <h2 className="section-title">Your Positions ({positions?.length || 0})</h2>
        
        {isLoading ? (
          <div className="positions-grid">
            {Array.from({ length: 3 }).map((_, i) => (
              <PositionCardSkeleton key={i} />
            ))}
          </div>
        ) : positions?.length === 0 ? (
          <div className="empty-state">
            <p>No positions found for this wallet</p>
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

      {/* Position Detail */}
      {selectedPosition && (
        <PositionDetail position={selectedPosition} onClose={() => setSelectedPosition(null)} />
      )}

      <style>{`
        .position-analytics { display: flex; flex-direction: column; gap: 32px; animation: fadeIn 0.4s ease-out; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; }
        .page-header h1 { font-size: 28px; font-weight: 700; color: #E8E8EC; margin-bottom: 4px; }
        .page-header p { color: #808090; font-size: 14px; }
        .header-actions { display: flex; gap: 8px; }
        .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
        .section-title { font-size: 18px; font-weight: 600; color: #E8E8EC; margin-bottom: 16px; }
        .positions-grid { display: grid; gap: 16px; }
        .empty-state { text-align: center; padding: 60px 20px; color: #606070; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 16px; }
        @media (max-width: 1200px) { .summary-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 600px) { .summary-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

interface SummaryCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  variant?: 'default' | 'positive' | 'negative' | 'accent';
  loading?: boolean;
}

function SummaryCard({ title, value, subtitle, icon, variant = 'default', loading }: SummaryCardProps) {
  const colors = {
    default: { bg: 'rgba(255,255,255,0.02)', icon: '#A0A0B0', text: '#E8E8EC' },
    positive: { bg: 'rgba(0,212,170,0.08)', icon: '#00D4AA', text: '#00D4AA' },
    negative: { bg: 'rgba(255,107,107,0.08)', icon: '#FF6B6B', text: '#FF6B6B' },
    accent: { bg: 'rgba(0,163,255,0.08)', icon: '#00A3FF', text: '#00A3FF' },
  };
  const c = colors[variant];

  return (
    <div className="summary-card" style={{ background: c.bg }}>
      <div className="card-icon" style={{ color: c.icon }}>{icon}</div>
      <div className="card-content">
        <span className="card-title">{title}</span>
        {loading ? (
          <Skeleton className="h-8 w-24 bg-white/5" />
        ) : (
          <>
            <span className="card-value mono" style={{ color: c.text }}>{value}</span>
            {subtitle && <span className="card-subtitle" style={{ color: c.text }}>{subtitle}</span>}
          </>
        )}
      </div>
      <style>{`
        .summary-card { display: flex; gap: 16px; padding: 20px; border: 1px solid rgba(255,255,255,0.04); border-radius: 16px; }
        .card-icon { display: flex; align-items: center; justify-content: center; }
        .card-content { display: flex; flex-direction: column; gap: 4px; }
        .card-title { font-size: 13px; color: #808090; }
        .card-value { font-size: 24px; font-weight: 600; }
        .card-subtitle { font-size: 13px; font-weight: 500; }
      `}</style>
    </div>
  );
}

interface PositionCardProps {
  position: Position;
  walletAddress: string;
  isSelected: boolean;
  onSelect: () => void;
  onRefresh: () => void;
}

function PositionCard({ position, walletAddress, isSelected, onSelect, onRefresh }: PositionCardProps) {
  const { pool, isInRange, pnl, pnlPercent, totalValueUsd, uncollectedFeesUsd, apr, rangeUtilization } = position;
  const [actionLoading, setActionLoading] = useState<'add' | 'claim' | 'remove' | null>(null);
  const [isAddLiquidityOpen, setIsAddLiquidityOpen] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { getTimeRemaining, getRemainingRepeats, stopInfiniteMode, isClosing, removePosition } = useAutoClose();

  const remainingRepeats = getRemainingRepeats(position.id);
  const isInfiniteMode = remainingRepeats === 'infinite';
  const hasRepeats = remainingRepeats === 'infinite' || (typeof remainingRepeats === 'number' && remainingRepeats > 0);

  // Update countdown every second
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
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  };

  const handleCancelTimer = (e: React.MouseEvent) => {
    e.stopPropagation();
    removePosition(position.id);
    toast.info('Auto-close timer cancelled');
  };

  const handleStopInfinite = (e: React.MouseEvent) => {
    e.stopPropagation();
    stopInfiniteMode(position.id);
  };

  const isAutoClosing = isClosing(position.id);

  const handleAddLiquidity = () => {
    setIsAddLiquidityOpen(true);
  };

  const handleClaimFees = async () => {
    if (actionLoading) return;
    setActionLoading('claim');

    try {
      const tx = await buildCollectFeesTransaction(
        position.id,
        position.poolId,
        walletAddress
      );

      await signAndExecute({ transaction: tx });

      toast.success('Fees claimed successfully!');
      onRefresh();
    } catch (error) {
      console.error('Failed to claim fees:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to claim fees');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveLiquidity = async () => {
    if (actionLoading) return;
    setActionLoading('remove');

    try {
      const tx = await buildRemoveLiquidityTransaction(
        position.id,
        position.poolId,
        position.liquidity,
        walletAddress
      );

      await signAndExecute({ transaction: tx });

      toast.success('Liquidity removed successfully!');
      onRefresh();
    } catch (error) {
      console.error('Failed to remove liquidity:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to remove liquidity');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className={`position-card glass-card ${isSelected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="position-header">
        <div className="pool-info">
          <div className="token-pair">
            <img src={getTokenLogo(pool.tokenA.symbol)} alt={pool.tokenA.symbol} className="token-icon" />
            <img src={getTokenLogo(pool.tokenB.symbol)} alt={pool.tokenB.symbol} className="token-icon overlap" />
          </div>
          <div className="pool-details">
            <span className="pool-name">{pool.tokenA.symbol}/{pool.tokenB.symbol}</span>
            <div className="badge-row">
              <Badge variant={isInRange ? 'default' : 'destructive'} className={`status-badge ${isInRange ? 'in-range' : 'out-range'}`}>
                {isInRange ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                {isInRange ? 'In Range' : 'Out of Range'}
              </Badge>
              {(countdown !== null && countdown > 0) && (
                <Badge className="timer-badge" onClick={handleCancelTimer}>
                  <Timer size={12} className="animate-pulse" />
                  {formatCountdown(countdown)}
                </Badge>
              )}
              {isInfiniteMode && (
                <Badge className="infinite-badge" onClick={handleStopInfinite} title="Click to stop infinite mode">
                  <Infinity size={12} />
                  Infinite
                  <StopCircle size={10} className="stop-icon" />
                </Badge>
              )}
              {hasRepeats && !isInfiniteMode && typeof remainingRepeats === 'number' && remainingRepeats > 0 && (
                <Badge className="repeat-badge">
                  {remainingRepeats}x left
                </Badge>
              )}
              {isAutoClosing && (
                <Badge className="closing-badge">
                  <Loader2 size={12} className="animate-spin" />
                  Closing...
                </Badge>
              )}
            </div>
          </div>
        </div>
        <ChevronRight size={20} className={`chevron ${isSelected ? 'rotate' : ''}`} />
      </div>

      <div className="position-stats">
        <div className="stat">
          <span className="label">Value</span>
          <span className="value mono">{formatCurrency(totalValueUsd, { compact: true })}</span>
        </div>
        <div className="stat">
          <span className="label">PnL</span>
          <span className={`value mono ${pnl >= 0 ? 'status-positive' : 'status-negative'}`}>
            {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)} ({formatPercent(pnlPercent)})
          </span>
        </div>
        <div className="stat">
          <span className="label">Fees</span>
          <span className="value mono status-positive">+{formatCurrency(uncollectedFeesUsd)}</span>
        </div>
        <div className="stat">
          <span className="label">APR</span>
          <span className="value mono status-positive">{apr.toFixed(1)}%</span>
        </div>
      </div>

      <div className="range-bar">
        <span className="range-label">Range Utilization</span>
        <Progress value={rangeUtilization} className="range-progress" />
        <span className="range-value">{rangeUtilization.toFixed(0)}%</span>
      </div>

      <div className="position-actions" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="outline"
          size="sm"
          className="action-btn add-btn"
          onClick={handleAddLiquidity}
        >
          <Plus size={14} />
          Add
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="action-btn claim-btn"
          onClick={handleClaimFees}
          disabled={actionLoading !== null}
        >
          {actionLoading === 'claim' ? <Loader2 size={14} className="animate-spin" /> : <Coins size={14} />}
          Claim Fees
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="action-btn remove-btn"
          onClick={handleRemoveLiquidity}
          disabled={actionLoading !== null}
        >
          {actionLoading === 'remove' ? <Loader2 size={14} className="animate-spin" /> : <Minus size={14} />}
          Remove
        </Button>
      </div>

      <style>{`
        .position-card { padding: 20px; cursor: pointer; transition: all 0.3s; }
        .position-card:hover { background: rgba(255,255,255,0.04); transform: translateY(-2px); }
        .position-card.selected { background: rgba(0,212,170,0.08); border-color: rgba(0,212,170,0.3); }
        .position-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .pool-info { display: flex; align-items: center; gap: 12px; }
        .token-pair { display: flex; }
        .token-icon { width: 32px; height: 32px; border-radius: 50%; border: 2px solid #1a1a2e; }
        .token-icon.overlap { margin-left: -10px; }
        .pool-details { display: flex; flex-direction: column; gap: 4px; }
        .pool-name { font-size: 16px; font-weight: 600; color: #E8E8EC; }
        .badge-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .status-badge { display: flex; align-items: center; gap: 4px; font-size: 11px; }
        .status-badge.in-range { background: rgba(0,212,170,0.15); color: #00D4AA; }
        .status-badge.out-range { background: rgba(255,107,107,0.15); color: #FF6B6B; }
        .timer-badge { display: flex; align-items: center; gap: 4px; font-size: 11px; background: rgba(255,165,0,0.15); color: #FFA500; cursor: pointer; transition: all 0.2s; }
        .timer-badge:hover { background: rgba(255,165,0,0.25); }
        .infinite-badge { display: flex; align-items: center; gap: 4px; font-size: 11px; background: rgba(147,51,234,0.15); color: #A855F7; cursor: pointer; transition: all 0.2s; }
        .infinite-badge:hover { background: rgba(147,51,234,0.25); }
        .infinite-badge .stop-icon { opacity: 0; transition: opacity 0.2s; margin-left: 2px; }
        .infinite-badge:hover .stop-icon { opacity: 1; }
        .repeat-badge { display: flex; align-items: center; gap: 4px; font-size: 11px; background: rgba(59,130,246,0.15); color: #3B82F6; }
        .closing-badge { display: flex; align-items: center; gap: 4px; font-size: 11px; background: rgba(255,107,107,0.15); color: #FF6B6B; }
        .chevron { color: #606070; transition: transform 0.3s; }
        .chevron.rotate { transform: rotate(90deg); }
        .position-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 16px; }
        .stat { display: flex; flex-direction: column; gap: 2px; }
        .stat .label { font-size: 11px; color: #606070; text-transform: uppercase; }
        .stat .value { font-size: 14px; font-weight: 600; color: #E8E8EC; }
        .range-bar { display: flex; align-items: center; gap: 12px; }
        .range-label { font-size: 11px; color: #606070; white-space: nowrap; }
        .range-progress { flex: 1; height: 6px; background: rgba(255,255,255,0.05); }
        .range-value { font-size: 12px; font-weight: 500; color: #A0A0B0; }
        .position-actions { display: flex; gap: 8px; margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.06); }
        .action-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; font-weight: 500; height: 36px; transition: all 0.2s; }
        .action-btn:hover { transform: translateY(-1px); }
        .add-btn { border-color: rgba(0,212,170,0.3); color: #00D4AA; }
        .add-btn:hover { background: rgba(0,212,170,0.15); border-color: rgba(0,212,170,0.5); }
        .claim-btn { border-color: rgba(0,163,255,0.3); color: #00A3FF; }
        .claim-btn:hover { background: rgba(0,163,255,0.15); border-color: rgba(0,163,255,0.5); }
        .remove-btn { border-color: rgba(255,107,107,0.3); color: #FF6B6B; }
        .remove-btn:hover { background: rgba(255,107,107,0.15); border-color: rgba(255,107,107,0.5); }
        @media (max-width: 768px) { .position-stats { grid-template-columns: repeat(2, 1fr); } .position-actions { flex-wrap: wrap; } .action-btn { flex: 1 1 calc(50% - 4px); } }
      `}</style>

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

function PositionDetail({ position, onClose }: { position: Position; onClose: () => void }) {
  const priceHistory = generatePriceHistory(position.pool.priceTokenA, 30);
  const positionHistory = generatePositionHistory(position, 30);

  return (
    <div className="position-detail">
      <Card className="detail-card glass-card">
        <CardHeader>
          <CardTitle className="detail-title">
            Position Details
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="detail-grid">
            <div className="chart-section">
              <h3>Price Chart with Range</h3>
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={priceHistory}>
                  <defs>
                    <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00D4AA" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#00D4AA" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="timestamp" tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} stroke="#606070" fontSize={11} />
                  <YAxis domain={['auto', 'auto']} stroke="#606070" fontSize={11} tickFormatter={(val) => `$${val.toFixed(2)}`} />
                  <Tooltip contentStyle={{ background: 'rgba(10,10,15,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                  <ReferenceLine y={position.priceLower} stroke="#FF6B6B" strokeDasharray="3 3" label={{ value: 'Lower', fill: '#FF6B6B', fontSize: 10 }} />
                  <ReferenceLine y={position.priceUpper} stroke="#00D4AA" strokeDasharray="3 3" label={{ value: 'Upper', fill: '#00D4AA', fontSize: 10 }} />
                  <Area type="monotone" dataKey="price" stroke="#00D4AA" fill="url(#priceGradient)" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-section">
              <h3>Position Value Over Time</h3>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={positionHistory}>
                  <defs>
                    <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00A3FF" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#00A3FF" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="timestamp" tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} stroke="#606070" fontSize={11} />
                  <YAxis stroke="#606070" fontSize={11} tickFormatter={(val) => formatCurrency(val, { compact: true })} />
                  <Tooltip contentStyle={{ background: 'rgba(10,10,15,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} formatter={(value) => [formatCurrency(Number(value) || 0), 'Value']} />
                  <Area type="monotone" dataKey="valueUsd" stroke="#00A3FF" fill="url(#valueGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="metrics-grid">
            <MetricItem label="Deposited Value" value={formatCurrency(position.depositedValueUsd)} />
            <MetricItem label="Current Value" value={formatCurrency(position.totalValueUsd)} />
            <MetricItem label="Divergence PnL" value={formatCurrency(position.divergencePnl)} variant={position.divergencePnl >= 0 ? 'positive' : 'negative'} />
            <MetricItem label="Fee PnL" value={formatCurrency(position.feePnl)} variant="positive" />
            <MetricItem label="ROI" value={formatPercent(position.roi)} variant={position.roi >= 0 ? 'positive' : 'negative'} />
            <MetricItem label="Fee APR" value={`${position.feeApr.toFixed(1)}%`} variant="positive" />
            <MetricItem label="Price Range" value={`$${position.priceLower.toFixed(2)} - $${position.priceUpper.toFixed(2)}`} />
            <MetricItem label="Created" value={getTimeAgo(position.createdAt)} />
          </div>
        </CardContent>
      </Card>

      <style>{`
        .position-detail { margin-top: 24px; animation: fadeIn 0.3s ease-out; }
        .detail-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); }
        .detail-title { display: flex; justify-content: space-between; align-items: center; font-size: 18px; }
        .detail-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; margin-bottom: 24px; }
        .chart-section h3 { font-size: 14px; color: #A0A0B0; margin-bottom: 16px; }
        .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.04); }
        @media (max-width: 1024px) { .detail-grid { grid-template-columns: 1fr; } .metrics-grid { grid-template-columns: repeat(2, 1fr); } }
      `}</style>
    </div>
  );
}

function MetricItem({ label, value, variant }: { label: string; value: string; variant?: 'positive' | 'negative' }) {
  return (
    <div className="metric-item">
      <span className="metric-label">{label}</span>
      <span className={`metric-value mono ${variant === 'positive' ? 'status-positive' : variant === 'negative' ? 'status-negative' : ''}`}>{value}</span>
      <style>{`
        .metric-item { display: flex; flex-direction: column; gap: 4px; }
        .metric-label { font-size: 12px; color: #606070; }
        .metric-value { font-size: 15px; font-weight: 600; color: #E8E8EC; }
      `}</style>
    </div>
  );
}

function PositionCardSkeleton() {
  return (
    <div className="position-card glass-card">
      <div className="position-header">
        <div className="pool-info">
          <Skeleton className="h-8 w-8 rounded-full bg-white/5" />
          <Skeleton className="h-6 w-32 bg-white/5" />
        </div>
      </div>
      <div className="position-stats">
        <Skeleton className="h-10 w-full bg-white/5" />
        <Skeleton className="h-10 w-full bg-white/5" />
        <Skeleton className="h-10 w-full bg-white/5" />
        <Skeleton className="h-10 w-full bg-white/5" />
      </div>
    </div>
  );
}
