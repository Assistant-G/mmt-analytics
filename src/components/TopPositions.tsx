import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Trophy, 
  Medal, 
  ExternalLink,
  Copy,
  Crown
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from 'sonner';
import { fetchLeaderboard } from '@/services/mmtService';
import { formatCurrency, formatPercent, formatAddress, getTokenLogo } from '@/utils';
import type { LeaderboardEntry } from '@/types';

const TIME_FILTERS = [
  { value: '24h', label: '24 Hours' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: 'all', label: 'All Time' },
];

const SORT_OPTIONS = [
  { value: 'pnl', label: 'Total PnL' },
  { value: 'roi', label: 'ROI %' },
  { value: 'fees', label: 'Fees Earned' },
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
    toast.success('Address copied to clipboard');
  };

  const topThree = leaderboard?.slice(0, 3) || [];
  const rest = leaderboard?.slice(3) || [];

  return (
    <div className="top-positions">
      <div className="page-header">
        <div>
          <h1>
            <Trophy className="title-icon" />
            LP Leaderboard
          </h1>
          <p>Discover top-performing LP positions and learn from successful strategies</p>
        </div>
      </div>

      {/* Filters */}
      <Card className="filters-card glass-card">
        <CardContent className="filters-content">
          <div className="filter-group">
            <label>Time Period</label>
            <Select value={timeFilter} onValueChange={setTimeFilter}>
              <SelectTrigger className="filter-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_FILTERS.map(f => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="filter-group">
            <label>Sort By</label>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="filter-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Top 3 Podium */}
      {!isLoading && topThree.length >= 3 && (
        <div className="podium">
          <PodiumCard entry={topThree[1]} position={2} />
          <PodiumCard entry={topThree[0]} position={1} />
          <PodiumCard entry={topThree[2]} position={3} />
        </div>
      )}

      {/* Leaderboard Table */}
      <Card className="leaderboard-card glass-card">
        <CardHeader>
          <CardTitle>Rankings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="leaderboard-table">
            <div className="table-header">
              <span className="col-rank">Rank</span>
              <span className="col-wallet">Wallet</span>
              <span className="col-pool">Pool</span>
              <span className="col-value">Value</span>
              <span className="col-pnl">PnL</span>
              <span className="col-apr">APR</span>
              <span className="col-fees">Fees Earned</span>
              <span className="col-strategy">Strategy</span>
              <span className="col-actions"></span>
            </div>
            
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <LeaderboardRowSkeleton key={i} />
              ))
            ) : (
              rest.map(entry => (
                <LeaderboardRow 
                  key={entry.positionId} 
                  entry={entry}
                  onCopy={() => copyAddress(entry.address)}
                />
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <style>{`
        .top-positions { display: flex; flex-direction: column; gap: 24px; animation: fadeIn 0.4s ease-out; }
        .page-header h1 { display: flex; align-items: center; gap: 12px; font-size: 28px; font-weight: 700; color: #E8E8EC; margin-bottom: 4px; }
        .title-icon { color: #FFE66D; }
        .page-header p { color: #808090; font-size: 14px; }
        .filters-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); }
        .filters-content { display: flex; gap: 24px; padding: 20px; }
        .filter-group { display: flex; flex-direction: column; gap: 6px; }
        .filter-group label { font-size: 12px; color: #808090; }
        .filter-trigger { width: 160px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); }
        
        .podium { display: flex; justify-content: center; align-items: flex-end; gap: 16px; margin: 24px 0; }
        
        .leaderboard-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); }
        .leaderboard-table { display: flex; flex-direction: column; }
        .table-header { display: grid; grid-template-columns: 60px 140px 180px 100px 120px 80px 100px 100px 60px; gap: 16px; padding: 12px 16px; background: rgba(255,255,255,0.02); border-radius: 8px; margin-bottom: 8px; font-size: 11px; color: #606070; text-transform: uppercase; letter-spacing: 0.5px; }
        
        @media (max-width: 1200px) {
          .table-header { display: none; }
          .podium { flex-direction: column; align-items: center; }
        }
      `}</style>
    </div>
  );
}

function PodiumCard({ entry, position }: { entry: LeaderboardEntry; position: 1 | 2 | 3 }) {
  const heights = { 1: 200, 2: 160, 3: 140 };
  const colors = { 
    1: { bg: 'linear-gradient(135deg, #FFE66D 0%, #FFD700 100%)', text: '#1a1a2e' },
    2: { bg: 'linear-gradient(135deg, #C0C0C0 0%, #A8A8A8 100%)', text: '#1a1a2e' },
    3: { bg: 'linear-gradient(135deg, #CD7F32 0%, #B8860B 100%)', text: '#1a1a2e' },
  };
  const icons = { 1: <Crown size={24} />, 2: <Medal size={20} />, 3: <Medal size={18} /> };

  return (
    <div className={`podium-card position-${position}`} style={{ height: heights[position] }}>
      <div className="podium-rank" style={{ background: colors[position].bg, color: colors[position].text }}>
        {icons[position]}
        <span>#{position}</span>
      </div>
      
      <div className="podium-content">
        <div className="podium-pool">
          <div className="token-pair">
            <img src={getTokenLogo(entry.pool.tokenA.symbol)} alt="" className="token-icon" />
            <img src={getTokenLogo(entry.pool.tokenB.symbol)} alt="" className="token-icon overlap" />
          </div>
          <span className="pool-name">{entry.pool.tokenA.symbol}/{entry.pool.tokenB.symbol}</span>
        </div>
        
        <div className="podium-stats">
          <div className="stat">
            <span className="label">PnL</span>
            <span className={`value mono ${entry.totalPnl >= 0 ? 'status-positive' : 'status-negative'}`}>
              {formatCurrency(entry.totalPnl, { compact: true })}
            </span>
          </div>
          <div className="stat">
            <span className="label">ROI</span>
            <span className={`value mono ${entry.pnlPercent >= 0 ? 'status-positive' : 'status-negative'}`}>
              {formatPercent(entry.pnlPercent)}
            </span>
          </div>
        </div>
        
        <span className="podium-wallet mono">{formatAddress(entry.address, 6)}</span>
      </div>

      <style>{`
        .podium-card { display: flex; flex-direction: column; align-items: center; width: 220px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 16px; padding: 20px; transition: all 0.3s; }
        .podium-card:hover { transform: translateY(-4px); background: rgba(255,255,255,0.04); }
        .podium-card.position-1 { border-color: rgba(255,230,109,0.3); box-shadow: 0 8px 32px rgba(255,230,109,0.15); }
        .podium-rank { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 20px; font-weight: 700; font-size: 14px; margin-bottom: 16px; }
        .podium-content { display: flex; flex-direction: column; align-items: center; gap: 12px; flex: 1; }
        .podium-pool { display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .token-pair { display: flex; }
        .token-icon { width: 28px; height: 28px; border-radius: 50%; border: 2px solid #1a1a2e; }
        .token-icon.overlap { margin-left: -8px; }
        .pool-name { font-size: 14px; font-weight: 600; color: #E8E8EC; }
        .podium-stats { display: flex; gap: 20px; }
        .stat { display: flex; flex-direction: column; align-items: center; gap: 2px; }
        .stat .label { font-size: 10px; color: #606070; text-transform: uppercase; }
        .stat .value { font-size: 14px; font-weight: 600; }
        .podium-wallet { font-size: 11px; color: #606070; margin-top: auto; }
      `}</style>
    </div>
  );
}

function LeaderboardRow({ entry, onCopy }: { entry: LeaderboardEntry; onCopy: () => void }) {
  return (
    <div className="leaderboard-row">
      <span className="col-rank">
        <span className="rank-badge">#{entry.rank}</span>
      </span>
      <span className="col-wallet">
        <span className="wallet-text mono">{formatAddress(entry.address, 6)}</span>
        <button className="copy-btn" onClick={onCopy}><Copy size={12} /></button>
      </span>
      <span className="col-pool">
        <div className="pool-cell">
          <div className="token-pair-small">
            <img src={getTokenLogo(entry.pool.tokenA.symbol)} alt="" className="token-icon-sm" />
            <img src={getTokenLogo(entry.pool.tokenB.symbol)} alt="" className="token-icon-sm overlap" />
          </div>
          <span>{entry.pool.tokenA.symbol}/{entry.pool.tokenB.symbol}</span>
        </div>
      </span>
      <span className="col-value mono">{formatCurrency(entry.totalValue, { compact: true })}</span>
      <span className={`col-pnl mono ${entry.totalPnl >= 0 ? 'status-positive' : 'status-negative'}`}>
        {entry.totalPnl >= 0 ? '+' : ''}{formatCurrency(entry.totalPnl, { compact: true })}
        <small>{formatPercent(entry.pnlPercent)}</small>
      </span>
      <span className="col-apr mono status-positive">{entry.apr.toFixed(1)}%</span>
      <span className="col-fees mono">{formatCurrency(entry.feesEarned, { compact: true })}</span>
      <span className="col-strategy">
        <Badge variant="secondary" className="strategy-badge">{entry.strategy}</Badge>
      </span>
      <span className="col-actions">
        <a href={`https://app.mmt.finance`} target="_blank" rel="noopener noreferrer" className="view-btn">
          <ExternalLink size={14} />
        </a>
      </span>

      <style>{`
        .leaderboard-row { display: grid; grid-template-columns: 60px 140px 180px 100px 120px 80px 100px 100px 60px; gap: 16px; padding: 16px; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.2s; }
        .leaderboard-row:hover { background: rgba(255,255,255,0.02); }
        .rank-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 36px; padding: 4px 8px; background: rgba(255,255,255,0.05); border-radius: 6px; font-size: 12px; font-weight: 600; color: #A0A0B0; }
        .col-wallet { display: flex; align-items: center; gap: 6px; }
        .wallet-text { font-size: 13px; color: #A0A0B0; }
        .copy-btn { background: none; border: none; padding: 4px; color: #606070; cursor: pointer; }
        .copy-btn:hover { color: #00D4AA; }
        .pool-cell { display: flex; align-items: center; gap: 8px; }
        .token-pair-small { display: flex; }
        .token-icon-sm { width: 20px; height: 20px; border-radius: 50%; border: 1px solid #1a1a2e; }
        .token-icon-sm.overlap { margin-left: -6px; }
        .col-pnl { display: flex; flex-direction: column; }
        .col-pnl small { font-size: 10px; opacity: 0.7; }
        .strategy-badge { font-size: 10px; background: rgba(255,255,255,0.05); }
        .view-btn { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: rgba(255,255,255,0.03); border-radius: 8px; color: #606070; transition: all 0.2s; }
        .view-btn:hover { background: rgba(0,212,170,0.1); color: #00D4AA; }
        
        @media (max-width: 1200px) {
          .leaderboard-row { grid-template-columns: 1fr; gap: 8px; padding: 16px; background: rgba(255,255,255,0.02); border-radius: 12px; margin-bottom: 8px; border: none; }
          .leaderboard-row:before { content: none; }
        }
      `}</style>
    </div>
  );
}

function LeaderboardRowSkeleton() {
  return (
    <div className="leaderboard-row">
      <Skeleton className="h-6 w-10 bg-white/5" />
      <Skeleton className="h-6 w-24 bg-white/5" />
      <Skeleton className="h-6 w-32 bg-white/5" />
      <Skeleton className="h-6 w-20 bg-white/5" />
      <Skeleton className="h-6 w-20 bg-white/5" />
      <Skeleton className="h-6 w-16 bg-white/5" />
      <Skeleton className="h-6 w-20 bg-white/5" />
      <Skeleton className="h-6 w-20 bg-white/5" />
      <Skeleton className="h-6 w-8 bg-white/5" />
    </div>
  );
}
