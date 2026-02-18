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
          <p>Track LP positions and discover opportunities on Sui's leading CLMM DEX</p>
        </div>
        <div className="header-badge">
          <Sparkles size={14} />
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
            icon={<DollarSign size={20} />}
            loading={poolsLoading}
            gradient="primary"
          />
          <StatCard
            title="24h Volume"
            value={formatCurrency(totalVolume24h, { compact: true })}
            change={12.8}
            icon={<Activity size={20} />}
            loading={poolsLoading}
            gradient="secondary"
          />
          <StatCard
            title="24h Fees"
            value={formatCurrency(totalFees24h, { compact: true })}
            change={8.4}
            icon={<TrendingUp size={20} />}
            loading={poolsLoading}
            gradient="accent"
          />
          <StatCard
            title="Average APR"
            value={`${avgApr.toFixed(1)}%`}
            change={-2.1}
            icon={<Users size={20} />}
            loading={poolsLoading}
            gradient="info"
          />
        </div>
      </section>

      {/* User Portfolio Summary */}
      {isConnected && positions && positions.length > 0 && userTotalValue > 0 && (
        <section className="stats-section" style={{ animationDelay: '0.1s' }}>
          <h2 className="section-title">Your Portfolio</h2>
          <div className="stats-grid">
            <StatCard
              title="Total Position Value"
              value={formatCurrency(userTotalValue, { compact: true })}
              icon={<DollarSign size={20} />}
              loading={positionsLoading}
              gradient="primary"
            />
            <StatCard
              title="Total PnL"
              value={formatCurrency(Math.abs(userTotalPnl), { compact: true })}
              change={userTotalPnl >= 0 ? (userTotalPnl / (userTotalValue - userTotalPnl)) * 100 : -(Math.abs(userTotalPnl) / (userTotalValue + Math.abs(userTotalPnl))) * 100}
              icon={userTotalPnl >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
              loading={positionsLoading}
              gradient={userTotalPnl >= 0 ? 'success' : 'danger'}
            />
            <StatCard
              title="Uncollected Fees"
              value={formatCurrency(userTotalFees, { compact: true })}
              icon={<ArrowUpRight size={20} />}
              loading={positionsLoading}
              gradient="accent"
            />
            <StatCard
              title="Average APR"
              value={`${userAvgApr.toFixed(1)}%`}
              icon={<Activity size={20} />}
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
          <CardHeader className="chart-header">
            <CardTitle className="chart-title">Protocol Volume & Fees</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={volumeData}>
                <defs>
                  <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00D4AA" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#00D4AA" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  stroke="#3a3f52"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  yAxisId="left"
                  tickFormatter={(val) => formatCurrency(val, { compact: true })}
                  stroke="#3a3f52"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(val) => formatCurrency(val, { compact: true })}
                  stroke="#3a3f52"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip 
                  contentStyle={{
                    background: 'rgba(15, 17, 23, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: '#8b8fa3', marginBottom: '6px' }}
                  itemStyle={{ color: '#e6e8ed', padding: '2px 0' }}
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
                  strokeWidth={1.5}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="fees"
                  stroke="#00A3FF"
                  strokeWidth={1.5}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="chart-card glass-card">
          <CardHeader className="chart-header">
            <CardTitle className="chart-title">Top Pools by TVL</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
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
                  stroke="#3a3f52"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  type="category" 
                  dataKey="name" 
                  width={85}
                  stroke="#3a3f52"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip 
                  contentStyle={{
                    background: 'rgba(15, 17, 23, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: '#8b8fa3', marginBottom: '6px' }}
                  itemStyle={{ color: '#e6e8ed', padding: '2px 0' }}
                  formatter={(value, name) => [
                    name === 'tvl' ? formatCurrency(Number(value) || 0, { compact: true }) : `${(Number(value) || 0).toFixed(1)}%`,
                    name === 'tvl' ? 'TVL' : 'APR'
                  ]}
                />
                <Bar 
                  dataKey="tvl" 
                  fill="url(#barGradient)" 
                  radius={[0, 5, 5, 0]}
                />
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#00D4AA" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#00A3FF" stopOpacity={0.8} />
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
          animation: fadeIn 0.5s var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1));
        }

        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 24px;
        }

        .header-content h1 {
          font-size: 28px;
          font-weight: 800;
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 6px;
          letter-spacing: -0.03em;
        }

        .header-content p {
          color: #6b7084;
          font-size: 14px;
          max-width: 500px;
          line-height: 1.5;
        }

        .header-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: rgba(0, 212, 170, 0.06);
          border: 1px solid rgba(0, 212, 170, 0.12);
          border-radius: 20px;
          color: #00D4AA;
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
        }

        .stats-section {
          display: flex;
          flex-direction: column;
          gap: 14px;
          animation: fadeInUp 0.5s var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1)) backwards;
        }

        .section-title {
          font-size: 16px;
          font-weight: 600;
          color: #e6e8ed;
          letter-spacing: -0.01em;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
        }

        .charts-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
          animation: fadeInUp 0.6s var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1)) 0.15s backwards;
        }

        .chart-card {
          background: rgba(255, 255, 255, 0.015) !important;
          border: 1px solid rgba(255, 255, 255, 0.04) !important;
          overflow: hidden;
        }

        .chart-header {
          padding-bottom: 8px !important;
        }

        .chart-title {
          font-size: 14px !important;
          font-weight: 600 !important;
          color: #e6e8ed !important;
          letter-spacing: -0.01em;
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
            font-size: 22px;
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
    danger: ['#FF5C5C', '#F43F5E'],
  };

  const [color1, color2] = gradientColors[gradient];

  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: `linear-gradient(135deg, ${color1}12, ${color2}12)`, color: color1 }}>
        {icon}
      </div>
      <div className="stat-content">
        <span className="stat-title">{title}</span>
        {loading ? (
          <Skeleton className="h-7 w-20 bg-white/5" />
        ) : (
          <div className="stat-value-row">
            <span className="stat-value mono">{value}</span>
            {change !== undefined && (
              <span className={`stat-change ${change >= 0 ? 'positive' : 'negative'}`}>
                {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {Math.abs(change).toFixed(1)}%
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
          background: rgba(255, 255, 255, 0.018);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: 14px;
          transition: all 0.3s var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1));
        }

        .stat-card:hover {
          background: rgba(255, 255, 255, 0.035);
          border-color: rgba(255, 255, 255, 0.08);
          transform: translateY(-1px);
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
        }

        .stat-icon {
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 11px;
          flex-shrink: 0;
        }

        .stat-content {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }

        .stat-title {
          font-size: 12px;
          color: #6b7084;
          font-weight: 500;
        }

        .stat-value-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .stat-value {
          font-size: 22px;
          font-weight: 700;
          color: #e6e8ed;
          letter-spacing: -0.02em;
        }

        .stat-change {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-size: 11px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 5px;
        }

        .stat-change.positive {
          color: #00D4AA;
          background: rgba(0, 212, 170, 0.08);
        }

        .stat-change.negative {
          color: #FF5C5C;
          background: rgba(255, 92, 92, 0.08);
        }
      `}</style>
    </div>
  );
}
