import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Activity, 
  Percent,
  ArrowUpRight,
  Wallet,
  ExternalLink
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Area,
  AreaChart
} from 'recharts';
import { useWallet } from '@/contexts/WalletContext';
import { fetchPoolsData, fetchPositions, generateVolumeHistory } from '@/services/mmtService';
import { formatCurrency, getTokenLogo } from '@/utils';
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

  const topPools = pools?.sort((a, b) => b.tvlUsd - a.tvlUsd).slice(0, 6) || [];

  return (
    <div className="dashboard">
      {/* Protocol Stats */}
      <div className="stats-row">
        <StatCard
          label="Total Value Locked"
          value={formatCurrency(totalTvl, { compact: true })}
          change={5.2}
          loading={poolsLoading}
        />
        <StatCard
          label="24h Volume"
          value={formatCurrency(totalVolume24h, { compact: true })}
          change={12.8}
          loading={poolsLoading}
        />
        <StatCard
          label="24h Fees"
          value={formatCurrency(totalFees24h, { compact: true })}
          change={8.4}
          loading={poolsLoading}
        />
        <StatCard
          label="Average APR"
          value={`${avgApr.toFixed(1)}%`}
          change={-2.1}
          loading={poolsLoading}
          valueColor="teal"
        />
      </div>

      {/* Main Content Grid */}
      <div className="content-grid">
        {/* Volume Chart */}
        <div className="chart-card">
          <div className="chart-header">
            <h3>Protocol Volume</h3>
            <span className="chart-period">Last 30 days</span>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={volumeData}>
                <defs>
                  <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14f4c9" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#14f4c9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  stroke="#52525b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  tickFormatter={(val) => formatCurrency(val, { compact: true })}
                  stroke="#52525b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={60}
                />
                <Tooltip 
                  content={<CustomTooltip />}
                  cursor={{ stroke: '#27272a' }}
                />
                <Area
                  type="monotone"
                  dataKey="volume"
                  stroke="#14f4c9"
                  fill="url(#volumeGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Pools */}
        <div className="pools-card">
          <div className="pools-header">
            <h3>Top Pools</h3>
            <span className="pools-count">{pools?.length || 0} total</span>
          </div>
          <div className="pools-list">
            {poolsLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="pool-item skeleton-row">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-16 ml-auto" />
                </div>
              ))
            ) : (
              topPools.map((pool, idx) => (
                <div key={pool.id} className="pool-item">
                  <span className="pool-rank">#{idx + 1}</span>
                  <div className="pool-tokens">
                    <img src={getTokenLogo(pool.tokenA.symbol)} alt="" className="token-icon" />
                    <img src={getTokenLogo(pool.tokenB.symbol)} alt="" className="token-icon overlap" />
                  </div>
                  <div className="pool-info">
                    <span className="pool-name">{pool.tokenA.symbol}/{pool.tokenB.symbol}</span>
                    <span className="pool-tvl">{formatCurrency(pool.tvlUsd, { compact: true })}</span>
                  </div>
                  <span className="pool-apr">{pool.apr.toFixed(1)}%</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* User Portfolio Section */}
      {isConnected ? (
        positions && positions.length > 0 && userTotalValue > 0 ? (
          <div className="portfolio-section">
            <div className="section-header">
              <Wallet size={20} />
              <h2>Your Portfolio</h2>
            </div>
            
            <div className="portfolio-stats">
              <div className="portfolio-stat">
                <span className="stat-label">Total Value</span>
                <span className="stat-value">{formatCurrency(userTotalValue)}</span>
              </div>
              <div className="portfolio-stat">
                <span className="stat-label">Total PnL</span>
                <span className={`stat-value ${userTotalPnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {userTotalPnl >= 0 ? '+' : ''}{formatCurrency(userTotalPnl)}
                </span>
              </div>
              <div className="portfolio-stat">
                <span className="stat-label">Uncollected Fees</span>
                <span className="stat-value text-profit">+{formatCurrency(userTotalFees)}</span>
              </div>
              <div className="portfolio-stat">
                <span className="stat-label">Positions</span>
                <span className="stat-value">{positions.length}</span>
              </div>
            </div>

            {getAllVaultPerformances().length > 0 && (
              <PortfolioSummary />
            )}
          </div>
        ) : (
          <div className="portfolio-section empty">
            <div className="empty-portfolio">
              <Wallet size={32} />
              <h3>No Positions Found</h3>
              <p>Start providing liquidity to see your portfolio here</p>
              <a 
                href="https://app.mmt.finance" 
                target="_blank" 
                rel="noopener noreferrer"
                className="cta-btn"
              >
                <span>Open MMT Finance</span>
                <ExternalLink size={16} />
              </a>
            </div>
          </div>
        )
      ) : (
        <div className="connect-cta">
          <div className="cta-content">
            <Wallet size={28} />
            <div className="cta-text">
              <h3>Connect your wallet</h3>
              <p>Track your LP positions and vault performance</p>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .dashboard {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* Stats Row */
        .stats-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }

        @media (max-width: 1024px) {
          .stats-row {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 640px) {
          .stats-row {
            grid-template-columns: 1fr;
          }
        }

        /* Content Grid */
        .content-grid {
          display: grid;
          grid-template-columns: 1.5fr 1fr;
          gap: 16px;
        }

        @media (max-width: 1024px) {
          .content-grid {
            grid-template-columns: 1fr;
          }
        }

        /* Chart Card */
        .chart-card {
          background: var(--bg-card);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          padding: 24px;
        }

        .chart-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }

        .chart-header h3 {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .chart-period {
          font-size: 13px;
          color: var(--text-muted);
        }

        .chart-container {
          margin: 0 -8px;
        }

        /* Pools Card */
        .pools-card {
          background: var(--bg-card);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          padding: 24px;
        }

        .pools-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }

        .pools-header h3 {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .pools-count {
          font-size: 13px;
          color: var(--text-muted);
        }

        .pools-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .pool-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          border-radius: var(--radius-md);
          transition: background var(--transition-fast);
        }

        .pool-item:hover {
          background: var(--bg-hover);
        }

        .pool-item.skeleton-row {
          gap: 8px;
        }

        .pool-rank {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-dim);
          width: 24px;
        }

        .pool-tokens {
          display: flex;
        }

        .pool-tokens .token-icon {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 2px solid var(--bg-card);
        }

        .pool-tokens .token-icon.overlap {
          margin-left: -10px;
        }

        .pool-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .pool-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .pool-tvl {
          font-size: 12px;
          color: var(--text-muted);
        }

        .pool-apr {
          font-size: 14px;
          font-weight: 700;
          color: var(--color-profit);
          padding: 4px 10px;
          background: var(--color-profit-bg);
          border-radius: var(--radius-full);
        }

        /* Portfolio Section */
        .portfolio-section {
          background: var(--bg-card);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          padding: 24px;
        }

        .portfolio-section .section-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 20px;
          padding-left: 0;
          border-left: none;
        }

        .portfolio-section .section-header svg {
          color: var(--accent-teal);
        }

        .portfolio-section .section-header h2 {
          font-size: 16px;
          font-weight: 600;
        }

        .portfolio-stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }

        @media (max-width: 768px) {
          .portfolio-stats {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        .portfolio-stat {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 16px;
          background: var(--bg-base);
          border-radius: var(--radius-md);
        }

        .portfolio-stat .stat-label {
          font-size: 12px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .portfolio-stat .stat-value {
          font-size: 20px;
          font-weight: 700;
          color: var(--text-primary);
        }

        /* Empty Portfolio */
        .portfolio-section.empty {
          padding: 48px 24px;
        }

        .empty-portfolio {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 12px;
        }

        .empty-portfolio svg {
          color: var(--text-dim);
        }

        .empty-portfolio h3 {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .empty-portfolio p {
          font-size: 14px;
          color: var(--text-muted);
        }

        .cta-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
          padding: 10px 20px;
          background: var(--gradient-primary);
          border-radius: var(--radius-md);
          color: #09090b;
          font-size: 14px;
          font-weight: 600;
          text-decoration: none;
          transition: all var(--transition-base);
        }

        .cta-btn:hover {
          transform: translateY(-1px);
          box-shadow: var(--shadow-glow-teal);
        }

        /* Connect CTA */
        .connect-cta {
          background: linear-gradient(135deg, rgba(20, 244, 201, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%);
          border: 1px solid rgba(20, 244, 201, 0.2);
          border-radius: var(--radius-lg);
          padding: 24px;
        }

        .cta-content {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .cta-content svg {
          color: var(--accent-teal);
        }

        .cta-text h3 {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 4px;
        }

        .cta-text p {
          font-size: 14px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}

// Stat Card Component
interface StatCardProps {
  label: string;
  value: string;
  change?: number;
  loading?: boolean;
  valueColor?: 'default' | 'teal';
}

function StatCard({ label, value, change, loading, valueColor = 'default' }: StatCardProps) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      {loading ? (
        <Skeleton className="h-9 w-28" style={{ background: 'rgba(255,255,255,0.05)' }} />
      ) : (
        <>
          <span 
            className="stat-value" 
            style={{ color: valueColor === 'teal' ? 'var(--accent-teal)' : undefined }}
          >
            {value}
          </span>
          {change !== undefined && (
            <span className={`stat-change ${change >= 0 ? 'positive' : 'negative'}`}>
              {change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {Math.abs(change).toFixed(1)}%
            </span>
          )}
        </>
      )}
    </div>
  );
}

// Custom Tooltip
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">
        {new Date(label).toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          year: 'numeric'
        })}
      </div>
      <div className="chart-tooltip-item">
        Volume: {formatCurrency(payload[0].value, { compact: true })}
      </div>
      <style>{`
        .chart-tooltip {
          background: var(--bg-elevated);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          padding: 12px 16px;
        }
        
        .chart-tooltip-label {
          font-size: 12px;
          color: var(--text-muted);
          margin-bottom: 6px;
        }
        
        .chart-tooltip-item {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }
      `}</style>
    </div>
  );
}
