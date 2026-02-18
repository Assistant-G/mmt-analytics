import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Activity, 
  Users,
  ArrowUpRight,
  Sparkles
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  ComposedChart,
  Line,
  Area
} from 'recharts';
import { useWallet } from '@/contexts/WalletContext';
import { fetchPoolsData, fetchPositions, generateVolumeHistory } from '@/services/mmtService';
import { formatCurrency } from '@/utils';
import { PortfolioSummary } from './PortfolioSummary';
import { getAllVaultPerformances } from '@/services/performanceService';

export function Dashboard() {
  const { address, isConnected } = useWallet();
  const [volumeData] = useState(generateVolumeHistory(30));

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

  const totalTvl = pools?.reduce((sum, p) => sum + p.tvlUsd, 0) || 0;
  const totalVolume24h = pools?.reduce((sum, p) => sum + p.volume24h, 0) || 0;
  const totalFees24h = pools?.reduce((sum, p) => sum + p.fees24h, 0) || 0;
  const avgApr = pools?.length ? pools.reduce((sum, p) => sum + p.apr, 0) / pools.length : 0;

  const userTotalValue = positions?.reduce((sum, p) => sum + p.totalValueUsd, 0) || 0;
  const userTotalPnl = positions?.reduce((sum, p) => sum + p.pnl, 0) || 0;
  const userTotalFees = positions?.reduce((sum, p) => sum + p.uncollectedFeesUsd, 0) || 0;
  const userAvgApr = positions?.length 
    ? positions.reduce((sum, p) => sum + p.apr, 0) / positions.length 
    : 0;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="header-content">
          <h1>MMT Finance Analytics</h1>
          <p>Track your LP positions and discover opportunities on Sui's leading CLMM DEX</p>
        </div>
        <div className="header-badge">
          <Sparkles size={16} />
          <span>Live Data</span>
        </div>
      </div>

      {/* Protocol Stats */}
      <section className="stats-section">
        <h2 className="section-title">Protocol Overview</h2>
        <div className="stats-grid">
          <StatCard
            title="Total Value Locked"
            value={formatCurrency(totalTvl, { compact: true })}
            change={5.2}
            icon={<DollarSign />}
            loading={poolsLoading}
            gradient="primary"
          />
          <StatCard
            title="24h Volume"
            value={formatCurrency(totalVolume24h, { compact: true })}
            change={12.8}
            icon={<Activity />}
            loading={poolsLoading}
            gradient="secondary"
          />
          <StatCard
            title="24h Fees"
            value={formatCurrency(totalFees24h, { compact: true })}
            change={8.4}
            icon={<TrendingUp />}
            loading={poolsLoading}
            gradient="accent"
          />
          <StatCard
            title="Average APR"
            value={`${avgApr.toFixed(1)}%`}
            change={-2.1}
            icon={<Users />}
            loading={poolsLoading}
            gradient="info"
          />
        </div>
      </section>

      {/* User Portfolio Summary - only show if user has positions with actual value */}
      {isConnected && positions && positions.length > 0 && userTotalValue > 0 && (
        <section className="stats-section">
          <h2 className="section-title">Your Portfolio</h2>
          <div className="stats-grid">
            <StatCard
              title="Total Position Value"
              value={formatCurrency(userTotalValue, { compact: true })}
              icon={<DollarSign />}
              loading={positionsLoading}
              gradient="primary"
            />
            <StatCard
              title="Total PnL"
              value={formatCurrency(Math.abs(userTotalPnl), { compact: true })}
              change={userTotalPnl >= 0 ? (userTotalPnl / (userTotalValue - userTotalPnl)) * 100 : -(Math.abs(userTotalPnl) / (userTotalValue + Math.abs(userTotalPnl))) * 100}
              icon={userTotalPnl >= 0 ? <TrendingUp /> : <TrendingDown />}
              loading={positionsLoading}
              gradient={userTotalPnl >= 0 ? 'success' : 'danger'}
            />
            <StatCard
              title="Uncollected Fees"
              value={formatCurrency(userTotalFees, { compact: true })}
              icon={<ArrowUpRight />}
              loading={positionsLoading}
              gradient="accent"
            />
            <StatCard
              title="Average APR"
              value={`${userAvgApr.toFixed(1)}%`}
              icon={<Activity />}
              loading={positionsLoading}
              gradient="info"
            />
          </div>
        </section>
      )}

      {/* Vault Performance Tracking */}
      {isConnected && getAllVaultPerformances().length > 0 && (
        <section className="stats-section">
          <h2 className="section-title">Vault Performance Tracking</h2>
          <PortfolioSummary />
        </section>
      )}

      {/* Charts */}
      <div className="charts-grid">
        <Card className="chart-card glass-card">
          <CardHeader>
            <CardTitle className="chart-title">Protocol Volume & Fees</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={volumeData}>
                <defs>
                  <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00D4AA" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#00D4AA" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  stroke="#606070"
                  fontSize={11}
                />
                <YAxis 
                  yAxisId="left"
                  tickFormatter={(val) => formatCurrency(val, { compact: true })}
                  stroke="#606070"
                  fontSize={11}
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(val) => formatCurrency(val, { compact: true })}
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
                  labelFormatter={(val) => new Date(val).toLocaleDateString()}
                  formatter={(value, name) => [
                    formatCurrency(Number(value) || 0, { compact: true }),
                    name === 'volume' ? 'Volume' : 'Fees'
                  ]}
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="volume"
                  stroke="#00D4AA"
                  fill="url(#volumeGradient)"
                  strokeWidth={2}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="fees"
                  stroke="#00A3FF"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="chart-card glass-card">
          <CardHeader>
            <CardTitle className="chart-title">Top Pools by TVL</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart 
                data={pools?.sort((a, b) => b.tvlUsd - a.tvlUsd).slice(0, 8).map(p => ({
                  name: `${p.tokenA.symbol}/${p.tokenB.symbol}`,
                  tvl: p.tvlUsd,
                  apr: p.apr,
                }))}
                layout="vertical"
              >
                <XAxis 
                  type="number" 
                  tickFormatter={(val) => formatCurrency(val, { compact: true })}
                  stroke="#606070"
                  fontSize={11}
                />
                <YAxis 
                  type="category" 
                  dataKey="name" 
                  width={90}
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
                    name === 'tvl' ? formatCurrency(Number(value) || 0, { compact: true }) : `${(Number(value) || 0).toFixed(1)}%`,
                    name === 'tvl' ? 'TVL' : 'APR'
                  ]}
                />
                <Bar 
                  dataKey="tvl" 
                  fill="url(#barGradient)" 
                  radius={[0, 6, 6, 0]}
                />
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#00D4AA" />
                    <stop offset="100%" stopColor="#00A3FF" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <style>{`
        .dashboard {
          display: flex;
          flex-direction: column;
          gap: 32px;
          animation: fadeIn 0.4s ease-out;
        }

        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 24px;
        }

        .header-content h1 {
          font-size: 32px;
          font-weight: 700;
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 8px;
        }

        .header-content p {
          color: #808090;
          font-size: 15px;
          max-width: 500px;
        }

        .header-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          background: rgba(0, 212, 170, 0.1);
          border: 1px solid rgba(0, 212, 170, 0.2);
          border-radius: 20px;
          color: #00D4AA;
          font-size: 13px;
          font-weight: 500;
        }

        .stats-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .section-title {
          font-size: 18px;
          font-weight: 600;
          color: #E8E8EC;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }

        .charts-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 24px;
        }

        .chart-card {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
        }

        .chart-title {
          font-size: 16px;
          font-weight: 600;
          color: #E8E8EC;
        }

        @media (max-width: 1200px) {
          .stats-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 900px) {
          .charts-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 600px) {
          .stats-grid {
            grid-template-columns: 1fr;
          }
          
          .dashboard-header {
            flex-direction: column;
          }
          
          .header-content h1 {
            font-size: 24px;
          }
        }
      `}</style>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  change?: number;
  icon: React.ReactNode;
  loading?: boolean;
  gradient?: 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'danger';
}

function StatCard({ title, value, change, icon, loading, gradient = 'primary' }: StatCardProps) {
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
          <Skeleton className="h-8 w-24 bg-white/5" />
        ) : (
          <div className="stat-value-row">
            <span className="stat-value mono">{value}</span>
            {change !== undefined && (
              <span className={`stat-change ${change >= 0 ? 'positive' : 'negative'}`}>
                {change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {Math.abs(change).toFixed(1)}%
              </span>
            )}
          </div>
        )}
      </div>
      <style>{`
        .stat-card {
          display: flex;
          gap: 16px;
          padding: 20px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: 16px;
          transition: all 0.3s ease;
        }

        .stat-card:hover {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.08);
          transform: translateY(-2px);
        }

        .stat-icon {
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          flex-shrink: 0;
        }

        .stat-content {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }

        .stat-title {
          font-size: 13px;
          color: #808090;
        }

        .stat-value-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .stat-value {
          font-size: 24px;
          font-weight: 600;
          color: #E8E8EC;
        }

        .stat-change {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 500;
          padding: 2px 6px;
          border-radius: 6px;
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
