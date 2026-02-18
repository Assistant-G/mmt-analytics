import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Trophy, 
  Medal, 
  ExternalLink,
  Copy,
  Crown
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { fetchLeaderboard } from '@/services/mmtService';
import { formatCurrency, formatPercent, formatAddress, getTokenLogo } from '@/utils';
import type { LeaderboardEntry } from '@/types';

const TIME_FILTERS = [
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: 'all', label: 'All' },
];

const SORT_OPTIONS = [
  { value: 'pnl', label: 'PnL' },
  { value: 'roi', label: 'ROI' },
  { value: 'fees', label: 'Fees' },
  { value: 'apr', label: 'APR' },
];

export function TopPositions() {
  const [timeFilter, setTimeFilter] = useState('30d');
  const [sortBy, setSortBy] = useState('pnl');

  const { data: leaderboard, isLoading } = useQuery({
    queryKey: ['leaderboard', timeFilter, sortBy],
    queryFn: fetchLeaderboard,
    staleTime: 60000,
  });

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    toast.success('Address copied!');
  };

  const topThree = leaderboard?.slice(0, 3) || [];
  const rest = leaderboard?.slice(3) || [];

  return (
    <div className="leaderboard-page">
      {/* Header */}
      <div className="page-header">
        <div className="title-section">
          <Trophy size={32} className="title-icon" />
          <div>
            <h1>LP Leaderboard</h1>
            <p>Top performing liquidity providers on MMT Finance</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <div className="filter-group">
          <span className="filter-label">Period</span>
          <div className="filter-pills">
            {TIME_FILTERS.map(f => (
              <button
                key={f.value}
                className={`filter-pill ${timeFilter === f.value ? 'active' : ''}`}
                onClick={() => setTimeFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Sort by</span>
          <div className="filter-pills">
            {SORT_OPTIONS.map(s => (
              <button
                key={s.value}
                className={`filter-pill ${sortBy === s.value ? 'active' : ''}`}
                onClick={() => setSortBy(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Podium */}
      {!isLoading && topThree.length >= 3 && (
        <div className="podium">
          <PodiumCard entry={topThree[1]} position={2} />
          <PodiumCard entry={topThree[0]} position={1} />
          <PodiumCard entry={topThree[2]} position={3} />
        </div>
      )}

      {/* Rankings Table */}
      <div className="rankings-card">
        <div className="rankings-header">
          <h2>Rankings</h2>
          <span className="count">{leaderboard?.length || 0} traders</span>
        </div>
        
        <div className="rankings-table-container">
          <table className="rankings-table">
            <thead>
              <tr>
                <th className="col-rank">Rank</th>
                <th className="col-trader">Trader</th>
                <th className="col-pool">Pool</th>
                <th className="col-value">Value</th>
                <th className="col-pnl">PnL</th>
                <th className="col-apr">APR</th>
                <th className="col-fees">Fees Earned</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    <td><Skeleton className="h-6 w-10" /></td>
                    <td><Skeleton className="h-6 w-28" /></td>
                    <td><Skeleton className="h-6 w-32" /></td>
                    <td><Skeleton className="h-6 w-20" /></td>
                    <td><Skeleton className="h-6 w-24" /></td>
                    <td><Skeleton className="h-6 w-16" /></td>
                    <td><Skeleton className="h-6 w-20" /></td>
                    <td><Skeleton className="h-6 w-8" /></td>
                  </tr>
                ))
              ) : (
                rest.map(entry => (
                  <tr key={entry.positionId}>
                    <td>
                      <span className="rank-num">#{entry.rank}</span>
                    </td>
                    <td>
                      <div className="trader-cell">
                        <span className="trader-address mono">{formatAddress(entry.address, 6)}</span>
                        <button className="copy-btn" onClick={() => copyAddress(entry.address)}>
                          <Copy size={12} />
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className="pool-cell">
                        <div className="token-pair">
                          <img src={getTokenLogo(entry.pool.tokenA.symbol)} alt="" className="token-icon" />
                          <img src={getTokenLogo(entry.pool.tokenB.symbol)} alt="" className="token-icon overlap" />
                        </div>
                        <span>{entry.pool.tokenA.symbol}/{entry.pool.tokenB.symbol}</span>
                      </div>
                    </td>
                    <td className="mono">{formatCurrency(entry.totalValue, { compact: true })}</td>
                    <td>
                      <div className="pnl-cell">
                        <span className={`pnl-value mono ${entry.totalPnl >= 0 ? 'positive' : 'negative'}`}>
                          {entry.totalPnl >= 0 ? '+' : ''}{formatCurrency(entry.totalPnl, { compact: true })}
                        </span>
                        <span className={`pnl-percent ${entry.pnlPercent >= 0 ? 'positive' : 'negative'}`}>
                          {formatPercent(entry.pnlPercent)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="apr-value">{entry.apr.toFixed(1)}%</span>
                    </td>
                    <td className="mono">{formatCurrency(entry.feesEarned, { compact: true })}</td>
                    <td>
                      <a 
                        href="https://app.mmt.finance" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="view-btn"
                      >
                        <ExternalLink size={14} />
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        .leaderboard-page {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* Header */
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .title-section {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .title-icon {
          color: #fbbf24;
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

        /* Filters */
        .filters-bar {
          display: flex;
          gap: 32px;
          padding: 16px 20px;
          background: var(--bg-card);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
        }

        .filter-group {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .filter-label {
          font-size: 13px;
          color: var(--text-muted);
          font-weight: 500;
        }

        .filter-pills {
          display: flex;
          gap: 4px;
        }

        .filter-pill {
          padding: 6px 14px;
          background: transparent;
          border: 1px solid var(--border-default);
          border-radius: var(--radius-full);
          color: var(--text-muted);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .filter-pill:hover {
          border-color: var(--border-hover);
          color: var(--text-primary);
        }

        .filter-pill.active {
          background: var(--accent-teal);
          border-color: var(--accent-teal);
          color: #09090b;
        }

        /* Podium */
        .podium {
          display: flex;
          justify-content: center;
          align-items: flex-end;
          gap: 16px;
          padding: 24px 0;
        }

        @media (max-width: 768px) {
          .podium {
            flex-direction: column;
            align-items: center;
          }
        }

        /* Rankings */
        .rankings-card {
          background: var(--bg-card);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          overflow: hidden;
        }

        .rankings-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px 24px;
          border-bottom: 1px solid var(--border-default);
        }

        .rankings-header h2 {
          font-size: 16px;
          font-weight: 600;
        }

        .count {
          font-size: 13px;
          color: var(--text-muted);
        }

        .rankings-table-container {
          overflow-x: auto;
        }

        .rankings-table {
          width: 100%;
          min-width: 800px;
          border-collapse: collapse;
        }

        .rankings-table th {
          padding: 12px 16px;
          text-align: left;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          background: var(--bg-elevated);
        }

        .rankings-table td {
          padding: 16px;
          border-bottom: 1px solid var(--border-default);
          font-size: 14px;
        }

        .rankings-table tbody tr {
          transition: background var(--transition-fast);
        }

        .rankings-table tbody tr:hover {
          background: var(--bg-hover);
        }

        .rankings-table tbody tr:last-child td {
          border-bottom: none;
        }

        .rank-num {
          font-weight: 600;
          color: var(--text-secondary);
        }

        .trader-cell {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .trader-address {
          color: var(--text-secondary);
        }

        .copy-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
          background: none;
          border: none;
          color: var(--text-dim);
          cursor: pointer;
          border-radius: var(--radius-sm);
        }

        .copy-btn:hover {
          color: var(--accent-teal);
        }

        .pool-cell {
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
          border: 2px solid var(--bg-card);
        }

        .token-icon.overlap {
          margin-left: -8px;
        }

        .pnl-cell {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .pnl-value {
          font-weight: 600;
        }

        .pnl-value.positive { color: var(--color-profit); }
        .pnl-value.negative { color: var(--color-loss); }

        .pnl-percent {
          font-size: 12px;
        }

        .pnl-percent.positive { color: var(--color-profit); }
        .pnl-percent.negative { color: var(--color-loss); }

        .apr-value {
          color: var(--color-profit);
          font-weight: 600;
        }

        .view-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          background: var(--bg-elevated);
          border-radius: var(--radius-md);
          color: var(--text-muted);
          transition: all var(--transition-fast);
        }

        .view-btn:hover {
          background: rgba(20, 244, 201, 0.1);
          color: var(--accent-teal);
        }

        @media (max-width: 768px) {
          .filters-bar {
            flex-direction: column;
            gap: 16px;
          }
        }
      `}</style>
    </div>
  );
}

// Podium Card Component
function PodiumCard({ entry, position }: { entry: LeaderboardEntry; position: 1 | 2 | 3 }) {
  const config = {
    1: { 
      height: 220, 
      gradient: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
      bg: 'rgba(251, 191, 36, 0.1)',
      border: 'rgba(251, 191, 36, 0.3)',
      icon: <Crown size={24} />
    },
    2: { 
      height: 180, 
      gradient: 'linear-gradient(135deg, #d1d5db 0%, #9ca3af 100%)',
      bg: 'rgba(209, 213, 219, 0.1)',
      border: 'rgba(209, 213, 219, 0.3)',
      icon: <Medal size={20} />
    },
    3: { 
      height: 160, 
      gradient: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
      bg: 'rgba(217, 119, 6, 0.1)',
      border: 'rgba(217, 119, 6, 0.3)',
      icon: <Medal size={18} />
    },
  };

  const { height, gradient, bg, border, icon } = config[position];

  return (
    <div className="podium-card" style={{ minHeight: height, background: bg, borderColor: border }}>
      <div className="podium-badge" style={{ background: gradient }}>
        {icon}
        <span>#{position}</span>
      </div>
      
      <div className="podium-pool">
        <div className="token-pair">
          <img src={getTokenLogo(entry.pool.tokenA.symbol)} alt="" className="token-icon" />
          <img src={getTokenLogo(entry.pool.tokenB.symbol)} alt="" className="token-icon overlap" />
        </div>
        <span className="pool-name">{entry.pool.tokenA.symbol}/{entry.pool.tokenB.symbol}</span>
      </div>
      
      <div className="podium-stats">
        <div className="podium-stat">
          <span className="stat-label">PnL</span>
          <span className={`stat-value ${entry.totalPnl >= 0 ? 'positive' : 'negative'}`}>
            {formatCurrency(entry.totalPnl, { compact: true })}
          </span>
        </div>
        <div className="podium-stat">
          <span className="stat-label">ROI</span>
          <span className={`stat-value ${entry.pnlPercent >= 0 ? 'positive' : 'negative'}`}>
            {formatPercent(entry.pnlPercent)}
          </span>
        </div>
      </div>
      
      <span className="podium-address mono">{formatAddress(entry.address, 6)}</span>

      <style>{`
        .podium-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 200px;
          padding: 20px;
          border: 1px solid;
          border-radius: var(--radius-lg);
          transition: all var(--transition-base);
        }

        .podium-card:hover {
          transform: translateY(-4px);
        }

        .podium-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: var(--radius-full);
          color: #09090b;
          font-weight: 700;
          font-size: 14px;
          margin-bottom: 16px;
        }

        .podium-pool {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          margin-bottom: 16px;
        }

        .podium-pool .token-pair {
          display: flex;
        }

        .podium-pool .token-icon {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid var(--bg-base);
        }

        .podium-pool .token-icon.overlap {
          margin-left: -10px;
        }

        .podium-pool .pool-name {
          font-size: 14px;
          font-weight: 600;
        }

        .podium-stats {
          display: flex;
          gap: 20px;
          margin-bottom: 12px;
        }

        .podium-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        .podium-stat .stat-label {
          font-size: 10px;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .podium-stat .stat-value {
          font-size: 14px;
          font-weight: 600;
        }

        .podium-stat .stat-value.positive { color: var(--color-profit); }
        .podium-stat .stat-value.negative { color: var(--color-loss); }

        .podium-address {
          font-size: 11px;
          color: var(--text-dim);
          margin-top: auto;
        }
      `}</style>
    </div>
  );
}
