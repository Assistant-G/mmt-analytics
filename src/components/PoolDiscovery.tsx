import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Filter,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Plus,
  Star,
  ChevronDown,
  Vault,
  X
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [modalTab, setModalTab] = useState<'liquidity' | 'vault'>('liquidity');

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

  const toggleFavorite = (poolId: string, e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleSort = (column: SortBy) => {
    setFilters(prev => ({
      ...prev,
      sortBy: column,
      sortOrder: prev.sortBy === column && prev.sortOrder === 'desc' ? 'asc' : 'desc',
    }));
  };

  const openModal = (pool: Pool, tab: 'liquidity' | 'vault') => {
    setSelectedPool(pool);
    setModalTab(tab);
  };

  const SortIcon = ({ column }: { column: SortBy }) => {
    if (filters.sortBy !== column) return <ArrowUpDown size={14} className="sort-icon" />;
    return filters.sortOrder === 'desc' 
      ? <ArrowDown size={14} className="sort-icon active" /> 
      : <ArrowUp size={14} className="sort-icon active" />;
  };

  return (
    <div className="pool-discovery">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Pool Discovery</h1>
          <p>Find the best liquidity pools and start earning</p>
        </div>
        <div className="header-stats">
          <div className="header-stat">
            <span className="label">Total Pools</span>
            <span className="value">{filteredPools.length}</span>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="search-section">
        <div className="search-bar">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Search by token name or symbol..."
            value={filters.query}
            onChange={(e) => setFilters(prev => ({ ...prev, query: e.target.value }))}
            className="search-input"
          />
          {filters.query && (
            <button className="clear-btn" onClick={() => setFilters(prev => ({ ...prev, query: '' }))}>
              <X size={16} />
            </button>
          )}
        </div>
        <button 
          className={`filter-btn ${showFilters ? 'active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter size={16} />
          <span>Filters</span>
          <ChevronDown size={14} className={showFilters ? 'rotated' : ''} />
        </button>
      </div>

      {/* Advanced Filters */}
      {showFilters && (
        <div className="filters-panel animate-slide-down">
          <div className="filter-group">
            <label>Min TVL</label>
            <Input
              type="number"
              placeholder="0"
              value={filters.minTvl || ''}
              onChange={(e) => setFilters(prev => ({ 
                ...prev, 
                minTvl: e.target.value ? Number(e.target.value) : undefined 
              }))}
            />
          </div>
          <div className="filter-group">
            <label>Min APR %</label>
            <Input
              type="number"
              placeholder="0"
              value={filters.minApr || ''}
              onChange={(e) => setFilters(prev => ({ 
                ...prev, 
                minApr: e.target.value ? Number(e.target.value) : undefined 
              }))}
            />
          </div>
          <div className="filter-group">
            <label>Min Volume 24h</label>
            <Input
              type="number"
              placeholder="0"
              value={filters.minVolume || ''}
              onChange={(e) => setFilters(prev => ({ 
                ...prev, 
                minVolume: e.target.value ? Number(e.target.value) : undefined 
              }))}
            />
          </div>
          <Button
            variant="ghost"
            onClick={() => setFilters({ query: filters.query, sortBy: 'tvl', sortOrder: 'desc' })}
            className="clear-filters-btn"
          >
            Clear Filters
          </Button>
        </div>
      )}

      {/* Pool Table */}
      <div className="pools-table-container">
        <table className="pools-table">
          <thead>
            <tr>
              <th className="col-favorite"></th>
              <th className="col-pool">Pool</th>
              <th className="col-tvl sortable" onClick={() => handleSort('tvl')}>
                TVL <SortIcon column="tvl" />
              </th>
              <th className="col-volume sortable" onClick={() => handleSort('volume')}>
                Volume 24h <SortIcon column="volume" />
              </th>
              <th className="col-fees sortable" onClick={() => handleSort('fees')}>
                Fees 24h <SortIcon column="fees" />
              </th>
              <th className="col-apr sortable" onClick={() => handleSort('apr')}>
                APR <SortIcon column="apr" />
              </th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  <td><Skeleton className="h-4 w-4" /></td>
                  <td><Skeleton className="h-10 w-48" /></td>
                  <td><Skeleton className="h-5 w-20" /></td>
                  <td><Skeleton className="h-5 w-20" /></td>
                  <td><Skeleton className="h-5 w-16" /></td>
                  <td><Skeleton className="h-6 w-14" /></td>
                  <td><Skeleton className="h-8 w-24" /></td>
                </tr>
              ))
            ) : filteredPools.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-cell">
                  <div className="empty-state">
                    <p>No pools match your filters</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredPools.map((pool) => (
                <tr key={pool.id}>
                  <td>
                    <button 
                      className={`favorite-btn ${favorites.has(pool.id) ? 'active' : ''}`}
                      onClick={(e) => toggleFavorite(pool.id, e)}
                    >
                      <Star size={16} fill={favorites.has(pool.id) ? 'currentColor' : 'none'} />
                    </button>
                  </td>
                  <td>
                    <div className="pool-cell">
                      <div className="token-pair">
                        <img src={getTokenLogo(pool.tokenA.symbol)} alt="" className="token-icon" />
                        <img src={getTokenLogo(pool.tokenB.symbol)} alt="" className="token-icon overlap" />
                      </div>
                      <div className="pool-info">
                        <span className="pool-name">{pool.tokenA.symbol}/{pool.tokenB.symbol}</span>
                        <span className="pool-fee">{getFeeLabel(pool.fee)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="mono">{formatCurrency(pool.tvlUsd, { compact: true })}</td>
                  <td className="mono">{formatCurrency(pool.volume24h, { compact: true })}</td>
                  <td className="mono">{formatCurrency(pool.fees24h, { compact: true })}</td>
                  <td>
                    <span className="apr-badge">{pool.apr.toFixed(1)}%</span>
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button className="action-btn primary" onClick={() => openModal(pool, 'liquidity')}>
                        <Plus size={14} />
                        Add LP
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {selectedPool && createPortal(
        <div className="modal-overlay" onClick={() => setSelectedPool(null)}>
          <div className="pool-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-tabs">
              <button
                className={`modal-tab ${modalTab === 'liquidity' ? 'active' : ''}`}
                onClick={() => setModalTab('liquidity')}
              >
                <Plus size={16} />
                Add Liquidity
              </button>
              <button
                className={`modal-tab vault ${modalTab === 'vault' ? 'active' : ''}`}
                onClick={() => setModalTab('vault')}
              >
                <Vault size={16} />
                Create Vault
              </button>
            </div>
            <div className="modal-body">
              {modalTab === 'liquidity' ? (
                <AddLiquidityModal
                  pool={selectedPool}
                  isOpen={true}
                  onClose={() => setSelectedPool(null)}
                  embedded={true}
                />
              ) : (
                <CreateVaultModal
                  pool={selectedPool}
                  isOpen={true}
                  onClose={() => setSelectedPool(null)}
                  embedded={true}
                />
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      <style>{`
        .pool-discovery {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        /* Header */
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 24px;
        }

        .page-header h1 {
          font-size: 28px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 4px;
        }

        .page-header p {
          font-size: 14px;
          color: var(--text-muted);
        }

        .header-stats {
          display: flex;
          gap: 16px;
        }

        .header-stat {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 12px 20px;
          background: var(--bg-card);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
        }

        .header-stat .label {
          font-size: 12px;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .header-stat .value {
          font-size: 20px;
          font-weight: 700;
          color: var(--text-primary);
        }

        /* Search Section */
        .search-section {
          display: flex;
          gap: 12px;
        }

        .search-bar {
          flex: 1;
          position: relative;
        }

        .search-icon {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-dim);
        }

        .search-input {
          width: 100%;
          height: 48px;
          padding: 0 48px 0 48px;
          background: var(--bg-card);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          color: var(--text-primary);
          font-size: 15px;
          transition: all var(--transition-base);
        }

        .search-input:focus {
          outline: none;
          border-color: var(--accent-teal);
          box-shadow: 0 0 0 3px rgba(20, 244, 201, 0.1);
        }

        .search-input::placeholder {
          color: var(--text-dim);
        }

        .clear-btn {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
        }

        .clear-btn:hover {
          color: var(--text-primary);
        }

        .filter-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 48px;
          padding: 0 20px;
          background: var(--bg-card);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          color: var(--text-secondary);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .filter-btn:hover, .filter-btn.active {
          border-color: var(--border-hover);
          color: var(--text-primary);
        }

        .filter-btn .rotated {
          transform: rotate(180deg);
        }

        /* Filters Panel */
        .filters-panel {
          display: flex;
          gap: 16px;
          padding: 20px;
          background: var(--bg-card);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          flex-wrap: wrap;
          align-items: flex-end;
        }

        .filter-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .filter-group label {
          font-size: 12px;
          color: var(--text-muted);
          font-weight: 500;
        }

        .filter-group input {
          width: 140px;
        }

        .clear-filters-btn {
          margin-left: auto;
        }

        /* Table */
        .pools-table-container {
          background: var(--bg-card);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          overflow: hidden;
        }

        .pools-table {
          width: 100%;
          border-collapse: collapse;
        }

        .pools-table th {
          padding: 14px 16px;
          text-align: left;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border-default);
          position: sticky;
          top: 0;
          z-index: 1;
        }

        .pools-table th.sortable {
          cursor: pointer;
          user-select: none;
        }

        .pools-table th.sortable:hover {
          color: var(--text-primary);
        }

        .sort-icon {
          margin-left: 4px;
          opacity: 0.4;
          vertical-align: middle;
        }

        .sort-icon.active {
          opacity: 1;
          color: var(--accent-teal);
        }

        .pools-table td {
          padding: 16px;
          border-bottom: 1px solid var(--border-default);
          font-size: 14px;
          color: var(--text-primary);
        }

        .pools-table tbody tr {
          transition: background var(--transition-fast);
        }

        .pools-table tbody tr:hover {
          background: var(--bg-hover);
        }

        .pools-table tbody tr:last-child td {
          border-bottom: none;
        }

        .col-favorite {
          width: 48px;
        }

        .col-pool {
          min-width: 200px;
        }

        .col-actions {
          width: 140px;
        }

        .empty-cell {
          text-align: center;
          padding: 48px !important;
        }

        /* Favorite Button */
        .favorite-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          background: transparent;
          border: none;
          color: var(--text-dim);
          cursor: pointer;
          border-radius: var(--radius-sm);
          transition: all var(--transition-fast);
        }

        .favorite-btn:hover, .favorite-btn.active {
          color: #fbbf24;
        }

        /* Pool Cell */
        .pool-cell {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .token-pair {
          display: flex;
        }

        .token-icon {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid var(--bg-card);
        }

        .token-icon.overlap {
          margin-left: -10px;
        }

        .pool-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .pool-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .pool-fee {
          font-size: 12px;
          color: var(--text-muted);
        }

        /* APR Badge */
        .apr-badge {
          display: inline-block;
          padding: 5px 12px;
          background: var(--color-profit-bg);
          color: var(--color-profit);
          border-radius: var(--radius-full);
          font-size: 13px;
          font-weight: 700;
        }

        /* Action Buttons */
        .action-buttons {
          display: flex;
          gap: 8px;
        }

        .action-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
          border: none;
        }

        .action-btn.primary {
          background: var(--gradient-primary);
          color: #09090b;
        }

        .action-btn.primary:hover {
          transform: translateY(-1px);
          box-shadow: var(--shadow-glow-teal);
        }

        /* Modal */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .pool-modal {
          background: var(--bg-elevated);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-xl);
          width: 90%;
          max-width: 520px;
          max-height: 90vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .modal-tabs {
          display: flex;
          border-bottom: 1px solid var(--border-default);
        }

        .modal-tab {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 16px;
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-fast);
          position: relative;
        }

        .modal-tab:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }

        .modal-tab.active {
          color: var(--accent-teal);
          background: rgba(20, 244, 201, 0.08);
        }

        .modal-tab.active::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--gradient-primary);
        }

        .modal-tab.vault.active {
          color: var(--accent-purple);
          background: rgba(168, 85, 247, 0.08);
        }

        .modal-tab.vault.active::after {
          background: var(--gradient-accent);
        }

        .modal-body {
          flex: 1;
          overflow-y: auto;
        }

        @media (max-width: 768px) {
          .page-header {
            flex-direction: column;
          }
          
          .search-section {
            flex-direction: column;
          }
          
          .filters-panel {
            flex-direction: column;
          }
          
          .filter-group input {
            width: 100%;
          }
          
          .pools-table-container {
            overflow-x: auto;
          }
          
          .pools-table {
            min-width: 700px;
          }
        }
      `}</style>
    </div>
  );
}
