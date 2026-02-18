import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Filter,
  ArrowUpDown,
  Plus,
  Star,
  ChevronDown,
  Vault
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchPoolsData } from '@/services/mmtService';
import { formatCurrency, getFeeLabel, getTokenLogo } from '@/utils';
import { AddLiquidityModal } from './AddLiquidityModal';
import { CreateVaultModal } from './CreateVaultModal';
import type { Pool, SearchFilters } from '@/types';

const SORT_OPTIONS = [
  { value: 'tvl', label: 'TVL' },
  { value: 'apr', label: 'APR' },
  { value: 'volume', label: '24h Volume' },
  { value: 'fees', label: '24h Fees' },
] as const;

type SortBy = (typeof SORT_OPTIONS)[number]['value'];

export function PoolDiscovery() {
  const [filters, setFilters] = useState<SearchFilters>({
    query: '',
    sortBy: 'tvl',
    sortOrder: 'desc',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const { data: pools, isLoading } = useQuery({
    queryKey: ['pools'],
    queryFn: fetchPoolsData,
    staleTime: 60000,
  });

  const filteredPools = useMemo(() => {
    if (!pools) return [];
    let result = [...pools];

    if (filters.query) {
      const query = filters.query.toLowerCase();
      result = result.filter(pool =>
        pool.tokenA.symbol.toLowerCase().includes(query) ||
        pool.tokenB.symbol.toLowerCase().includes(query)
      );
    }

    if (filters.minTvl) result = result.filter(pool => pool.tvlUsd >= filters.minTvl!);
    if (filters.minApr) result = result.filter(pool => pool.apr >= filters.minApr!);
    if (filters.minVolume) result = result.filter(pool => pool.volume24h >= filters.minVolume!);

    result.sort((a, b) => {
      const aVal = filters.sortBy === 'apr' ? a.apr : filters.sortBy === 'volume' ? a.volume24h : filters.sortBy === 'fees' ? a.fees24h : a.tvlUsd;
      const bVal = filters.sortBy === 'apr' ? b.apr : filters.sortBy === 'volume' ? b.volume24h : filters.sortBy === 'fees' ? b.fees24h : b.tvlUsd;
      return filters.sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });

    return result;
  }, [pools, filters]);

  const toggleFavorite = (poolId: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(poolId)) {
        next.delete(poolId);
      } else {
        next.add(poolId);
      }
      return next;
    });
  };

  const totalTvl = filteredPools.reduce((sum, p) => sum + p.tvlUsd, 0);
  const avgApr = filteredPools.length ? filteredPools.reduce((sum, p) => sum + p.apr, 0) / filteredPools.length : 0;

  return (
    <div className="pool-discovery">
      <div className="page-header">
        <div>
          <h1>Pool Discovery</h1>
          <p>Explore and compare liquidity pools to find the best opportunities</p>
        </div>
        <div className="header-stats">
          <div className="header-stat"><span className="label">Total TVL</span><span className="value mono">{formatCurrency(totalTvl, { compact: true })}</span></div>
          <div className="header-stat"><span className="label">Avg APR</span><span className="value mono status-positive">{avgApr.toFixed(1)}%</span></div>
          <div className="header-stat"><span className="label">Pools</span><span className="value mono">{filteredPools.length}</span></div>
        </div>
      </div>

      <Card className="filters-card glass-card">
        <CardContent className="filters-content">
          <div className="search-row">
            <div className="search-wrapper">
              <Search className="search-icon" size={18} />
              <Input placeholder="Search by token..." value={filters.query} onChange={(e) => setFilters(prev => ({ ...prev, query: e.target.value }))} className="search-input" />
            </div>
            <div className="sort-wrapper">
              <Select
                value={filters.sortBy}
                onValueChange={(value: string) =>
                  setFilters(prev => ({ ...prev, sortBy: value as SortBy }))
                }
              >
                <SelectTrigger className="sort-trigger"><SelectValue placeholder="Sort by" /></SelectTrigger>
                <SelectContent>{SORT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" size="icon" className="sort-order-btn" onClick={() => setFilters(prev => ({ ...prev, sortOrder: prev.sortOrder === 'desc' ? 'asc' : 'desc' }))}>
                <ArrowUpDown size={16} />
              </Button>
            </div>
            <Button variant="outline" className="filter-toggle" onClick={() => setShowFilters(!showFilters)}>
              <Filter size={16} /><span>Filters</span><ChevronDown size={14} className={showFilters ? 'rotate-180' : ''} />
            </Button>
          </div>
          {showFilters && (
            <div className="advanced-filters">
              <div className="filter-group"><label>Min TVL</label><Input type="number" placeholder="0" value={filters.minTvl || ''} onChange={(e) => setFilters(prev => ({ ...prev, minTvl: e.target.value ? Number(e.target.value) : undefined }))} /></div>
              <div className="filter-group"><label>Min APR %</label><Input type="number" placeholder="0" value={filters.minApr || ''} onChange={(e) => setFilters(prev => ({ ...prev, minApr: e.target.value ? Number(e.target.value) : undefined }))} /></div>
              <div className="filter-group"><label>Min Volume</label><Input type="number" placeholder="0" value={filters.minVolume || ''} onChange={(e) => setFilters(prev => ({ ...prev, minVolume: e.target.value ? Number(e.target.value) : undefined }))} /></div>
              <Button variant="ghost" onClick={() => setFilters({ query: '', sortBy: 'tvl', sortOrder: 'desc' })}>Clear All</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="pools-list">
        {isLoading ? Array.from({ length: 5 }).map((_, i) => <PoolCardSkeleton key={i} />) :
         filteredPools.length === 0 ? <div className="empty-state"><p>No pools match your filters</p></div> :
         filteredPools.map((pool, index) => <PoolCard key={pool.id} pool={pool} rank={index + 1} isFavorite={favorites.has(pool.id)} onToggleFavorite={() => toggleFavorite(pool.id)} />)}
      </div>

      <style>{`
        .pool-discovery { display: flex; flex-direction: column; gap: 24px; animation: fadeIn 0.4s ease-out; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 24px; }
        .page-header h1 { font-size: 28px; font-weight: 700; color: #E8E8EC; margin-bottom: 4px; }
        .page-header p { color: #808090; font-size: 14px; }
        .header-stats { display: flex; gap: 24px; }
        .header-stat { display: flex; flex-direction: column; gap: 4px; padding: 12px 20px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; }
        .header-stat .label { font-size: 11px; color: #606070; text-transform: uppercase; letter-spacing: 0.5px; }
        .header-stat .value { font-size: 18px; font-weight: 600; color: #E8E8EC; }
        .filters-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); }
        .filters-content { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
        .search-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        .search-wrapper { position: relative; flex: 1; min-width: 250px; }
        .search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #606070; }
        .search-input { padding-left: 44px; height: 44px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; color: #E8E8EC; }
        .sort-wrapper { display: flex; gap: 8px; }
        .sort-trigger { width: 140px; height: 44px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); }
        .sort-order-btn { height: 44px; width: 44px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); }
        .filter-toggle { height: 44px; gap: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); }
        .advanced-filters { display: flex; gap: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.04); flex-wrap: wrap; align-items: flex-end; }
        .filter-group { display: flex; flex-direction: column; gap: 6px; }
        .filter-group label { font-size: 12px; color: #808090; }
        .filter-group input { width: 140px; height: 40px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); }
        .pools-list { display: flex; flex-direction: column; gap: 12px; }
        .empty-state { text-align: center; padding: 60px 20px; color: #606070; }
        .rotate-180 { transform: rotate(180deg); }
        @media (max-width: 768px) { .header-stats { flex-wrap: wrap; } .search-row { flex-direction: column; } .search-wrapper { width: 100%; } }
      `}</style>
    </div>
  );
}

function PoolCard({ pool, rank, isFavorite, onToggleFavorite }: { pool: Pool; rank: number; isFavorite: boolean; onToggleFavorite: () => void }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'liquidity' | 'vault'>('liquidity');

  const openModal = (tab: 'liquidity' | 'vault') => {
    setActiveTab(tab);
    setIsModalOpen(true);
  };

  return (
    <div className="pool-card glass-card glass-card-hover">
      <div className="pool-rank">#{rank}</div>
      <button className={`favorite-btn ${isFavorite ? 'active' : ''}`} onClick={onToggleFavorite}><Star size={16} fill={isFavorite ? '#FFE66D' : 'none'} /></button>
      <div className="pool-tokens">
        <div className="token-pair">
          <img src={getTokenLogo(pool.tokenA.symbol)} alt={pool.tokenA.symbol} className="token-icon" />
          <img src={getTokenLogo(pool.tokenB.symbol)} alt={pool.tokenB.symbol} className="token-icon overlap" />
        </div>
        <div className="pool-info">
          <span className="pool-name">{pool.tokenA.symbol}/{pool.tokenB.symbol}</span>
          <Badge variant="secondary" className="fee-badge">{getFeeLabel(pool.fee)}</Badge>
        </div>
      </div>
      <div className="pool-stats">
        <div className="stat-item"><span className="stat-label">TVL</span><span className="stat-value mono">{formatCurrency(pool.tvlUsd, { compact: true })}</span></div>
        <div className="stat-item"><span className="stat-label">24h Volume</span><span className="stat-value mono">{formatCurrency(pool.volume24h, { compact: true })}</span></div>
        <div className="stat-item"><span className="stat-label">24h Fees</span><span className="stat-value mono">{formatCurrency(pool.fees24h, { compact: true })}</span></div>
        <div className="stat-item highlight"><span className="stat-label">APR</span><span className="stat-value mono status-positive">{pool.apr.toFixed(1)}%</span></div>
      </div>
      <div className="pool-actions">
        <button className="action-btn" onClick={() => openModal('liquidity')}><Plus size={14} /><span>Add Position</span></button>
      </div>

      {/* Combined Modal with Tabs - rendered via portal to avoid z-index issues */}
      {isModalOpen && createPortal(
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="combined-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-tabs">
              <button
                className={`modal-tab ${activeTab === 'liquidity' ? 'active' : ''}`}
                onClick={() => setActiveTab('liquidity')}
              >
                <Plus size={16} />
                Add Liquidity
              </button>
              <button
                className={`modal-tab vault ${activeTab === 'vault' ? 'active' : ''}`}
                onClick={() => setActiveTab('vault')}
              >
                <Vault size={16} />
                Create Vault
              </button>
            </div>
            <div className="modal-content-wrapper">
              {activeTab === 'liquidity' ? (
                <AddLiquidityModal
                  pool={pool}
                  isOpen={true}
                  onClose={() => setIsModalOpen(false)}
                  embedded={true}
                />
              ) : (
                <CreateVaultModal
                  pool={pool}
                  isOpen={true}
                  onClose={() => setIsModalOpen(false)}
                  embedded={true}
                />
              )}
            </div>
            <style>{`
              .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 99999; }
              .combined-modal { background: #12121A; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; width: 90%; max-width: 520px; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; }
              .modal-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,0.1); }
              .modal-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 16px; background: transparent; border: none; color: #808090; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; position: relative; }
              .modal-tab:hover { color: #E8E8EC; background: rgba(255,255,255,0.03); }
              .modal-tab.active { color: #00D4AA; background: rgba(0,212,170,0.08); }
              .modal-tab.active::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, #00D4AA, #00A3FF); }
              .modal-tab.vault.active { color: #9333EA; background: rgba(147,51,234,0.08); }
              .modal-tab.vault.active::after { background: linear-gradient(90deg, #9333EA, #7C3AED); }
              .modal-content-wrapper { flex: 1; overflow-y: auto; }
            `}</style>
          </div>
        </div>,
        document.body
      )}

      <style>{`
        .pool-card { display: flex; align-items: center; gap: 16px; padding: 16px 20px; position: relative; }
        .pool-rank { position: absolute; left: -8px; top: 50%; transform: translateY(-50%); background: linear-gradient(135deg, #00D4AA, #00A3FF); color: #0A0A0F; font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; }
        .favorite-btn { background: none; border: none; padding: 8px; cursor: pointer; color: #606070; transition: all 0.2s; }
        .favorite-btn:hover, .favorite-btn.active { color: #FFE66D; }
        .pool-tokens { display: flex; align-items: center; gap: 12px; min-width: 200px; }
        .token-pair { display: flex; }
        .token-icon { width: 36px; height: 36px; border-radius: 50%; border: 2px solid #1a1a2e; }
        .token-icon.overlap { margin-left: -12px; }
        .pool-info { display: flex; flex-direction: column; gap: 4px; }
        .pool-name { font-size: 15px; font-weight: 600; color: #E8E8EC; }
        .fee-badge { background: rgba(255,255,255,0.05); color: #A0A0B0; font-size: 11px; }
        .pool-stats { display: flex; gap: 32px; flex: 1; justify-content: center; }
        .stat-item { display: flex; flex-direction: column; gap: 2px; min-width: 80px; }
        .stat-item.highlight { background: rgba(0,212,170,0.08); padding: 8px 12px; border-radius: 8px; margin: -8px 0; }
        .stat-label { font-size: 11px; color: #606070; }
        .stat-value { font-size: 14px; font-weight: 600; color: #E8E8EC; }
        .pool-actions { display: flex; gap: 8px; }
        .action-btn { display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: linear-gradient(135deg, #00D4AA, #00A3FF); color: #0A0A0F; font-size: 13px; font-weight: 600; border-radius: 10px; text-decoration: none; transition: all 0.3s; border: none; cursor: pointer; }
        .action-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0,212,170,0.3); }

        @media (max-width: 1024px) { .pool-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; } .pool-card { flex-wrap: wrap; } }
      `}</style>
    </div>
  );
}

function PoolCardSkeleton() {
  return <div className="pool-card glass-card"><Skeleton className="h-12 w-12 rounded-full" /><Skeleton className="h-6 w-32" /><Skeleton className="h-6 w-24" /><Skeleton className="h-6 w-24" /><Skeleton className="h-6 w-24" /></div>;
}
