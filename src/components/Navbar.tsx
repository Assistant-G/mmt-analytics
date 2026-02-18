import { useState, useRef, useEffect } from 'react';
import { 
  Zap, 
  LayoutDashboard, 
  Droplets, 
  BarChart3, 
  Trophy, 
  Vault, 
  Layers, 
  Target, 
  FlaskConical,
  ExternalLink,
  ChevronDown,
  Search,
  Wallet
} from 'lucide-react';
import { ConnectModal } from '@mysten/dapp-kit';
import { useWallet } from '@/contexts/WalletContext';
import { formatAddress } from '@/utils';
import type { View } from '@/App';

interface NavbarProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

interface NavItem {
  id: View;
  label: string;
  icon: typeof LayoutDashboard;
  group?: string;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'pools', label: 'Pools', icon: Droplets },
  { id: 'positions', label: 'Positions', icon: BarChart3, group: 'portfolio' },
  { id: 'vaults', label: 'Vaults', icon: Vault, group: 'portfolio' },
  { id: 'lp-registry', label: 'LP Registry', icon: Layers, group: 'portfolio' },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { id: 'range-analytics', label: 'Range Analytics', icon: Target, group: 'tools' },
  { id: 'backtesting', label: 'Backtesting', icon: FlaskConical, group: 'tools' },
];

export function Navbar({ currentView, onViewChange }: NavbarProps) {
  const { address, isConnected, isConnecting, disconnect, setAddress } = useWallet();
  const [searchValue, setSearchValue] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const portfolioRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (portfolioRef.current && !portfolioRef.current.contains(e.target as Node)) {
        setPortfolioOpen(false);
      }
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setToolsOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.startsWith('0x') && searchValue.length >= 42) {
      setAddress(searchValue);
      setSearchValue('');
      setShowSearch(false);
      onViewChange('positions');
    }
  };

  const mainNavItems = navItems.filter(item => !item.group);
  const portfolioItems = navItems.filter(item => item.group === 'portfolio');
  const toolsItems = navItems.filter(item => item.group === 'tools');
  
  const isPortfolioActive = portfolioItems.some(item => item.id === currentView);
  const isToolsActive = toolsItems.some(item => item.id === currentView);

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        {/* Logo */}
        <div className="navbar-logo" onClick={() => onViewChange('dashboard')}>
          <div className="logo-icon">
            <Zap size={20} />
          </div>
          <span className="logo-text">MMT Analytics</span>
        </div>

        {/* Main Navigation */}
        <div className="navbar-nav">
          {mainNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                className={`nav-link ${isActive ? 'active' : ''}`}
                onClick={() => onViewChange(item.id)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}

          {/* Portfolio Dropdown */}
          <div className="nav-dropdown" ref={portfolioRef}>
            <button
              className={`nav-link has-dropdown ${isPortfolioActive ? 'active' : ''}`}
              onClick={() => setPortfolioOpen(!portfolioOpen)}
            >
              <Wallet size={16} />
              <span>Portfolio</span>
              <ChevronDown size={14} className={`dropdown-arrow ${portfolioOpen ? 'open' : ''}`} />
            </button>
            {portfolioOpen && (
              <div className="dropdown-menu animate-slide-down">
                {portfolioItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentView === item.id;
                  return (
                    <button
                      key={item.id}
                      className={`dropdown-item ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        onViewChange(item.id);
                        setPortfolioOpen(false);
                      }}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tools Dropdown */}
          <div className="nav-dropdown" ref={toolsRef}>
            <button
              className={`nav-link has-dropdown ${isToolsActive ? 'active' : ''}`}
              onClick={() => setToolsOpen(!toolsOpen)}
            >
              <Target size={16} />
              <span>Tools</span>
              <ChevronDown size={14} className={`dropdown-arrow ${toolsOpen ? 'open' : ''}`} />
            </button>
            {toolsOpen && (
              <div className="dropdown-menu animate-slide-down">
                {toolsItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentView === item.id;
                  return (
                    <button
                      key={item.id}
                      className={`dropdown-item ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        onViewChange(item.id);
                        setToolsOpen(false);
                      }}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Section */}
        <div className="navbar-actions">
          {/* Search */}
          <div className={`search-container ${showSearch ? 'expanded' : ''}`}>
            {showSearch ? (
              <form onSubmit={handleSearch} className="search-form">
                <Search size={16} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search wallet (0x...)"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  autoFocus
                  onBlur={() => !searchValue && setShowSearch(false)}
                  className="search-input"
                />
              </form>
            ) : (
              <button className="icon-btn" onClick={() => setShowSearch(true)}>
                <Search size={18} />
              </button>
            )}
          </div>

          {/* External Link */}
          <a 
            href="https://app.mmt.finance" 
            target="_blank" 
            rel="noopener noreferrer"
            className="external-link hide-mobile"
          >
            <span>Trade</span>
            <ExternalLink size={14} />
          </a>

          {/* Network Indicator */}
          <div className="network-badge hide-mobile">
            <div className="network-dot" />
            <span>Sui</span>
          </div>

          {/* Wallet */}
          {isConnected ? (
            <button className="wallet-btn connected" onClick={disconnect}>
              <div className="wallet-dot" />
              <span className="mono">{formatAddress(address!, 4)}</span>
            </button>
          ) : (
            <ConnectModal
              trigger={
                <button className="wallet-btn" disabled={isConnecting}>
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </button>
              }
            />
          )}
        </div>
      </div>

      <style>{`
        .navbar {
          position: sticky;
          top: 0;
          z-index: 100;
          background: rgba(9, 9, 11, 0.8);
          backdrop-filter: blur(16px);
          border-bottom: 1px solid var(--border-default);
        }

        .navbar-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: var(--nav-height);
          max-width: var(--max-content-width);
          margin: 0 auto;
          padding: 0 var(--content-padding);
          gap: 32px;
        }

        /* Logo */
        .navbar-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          flex-shrink: 0;
        }

        .logo-icon {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--gradient-primary);
          border-radius: 10px;
          color: #09090b;
        }

        .logo-text {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.03em;
        }

        /* Navigation */
        .navbar-nav {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 1;
          justify-content: center;
        }

        .nav-link {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          color: var(--text-muted);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-fast);
          white-space: nowrap;
        }

        .nav-link:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }

        .nav-link.active {
          color: var(--accent-teal);
          background: rgba(20, 244, 201, 0.1);
        }

        .nav-link.has-dropdown {
          padding-right: 10px;
        }

        .dropdown-arrow {
          transition: transform var(--transition-fast);
        }

        .dropdown-arrow.open {
          transform: rotate(180deg);
        }

        /* Dropdown */
        .nav-dropdown {
          position: relative;
        }

        .dropdown-menu {
          position: absolute;
          top: calc(100% + 8px);
          left: 50%;
          transform: translateX(-50%);
          min-width: 180px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          padding: 6px;
          box-shadow: var(--shadow-lg);
        }

        .dropdown-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 14px;
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-fast);
          text-align: left;
        }

        .dropdown-item:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .dropdown-item.active {
          color: var(--accent-teal);
          background: rgba(20, 244, 201, 0.1);
        }

        .dropdown-item svg {
          opacity: 0.7;
        }

        /* Actions */
        .navbar-actions {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }

        /* Search */
        .search-container {
          display: flex;
          align-items: center;
        }

        .search-container.expanded {
          width: 240px;
        }

        .search-form {
          position: relative;
          width: 100%;
        }

        .search-icon {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-dim);
        }

        .search-input {
          width: 100%;
          height: 38px;
          padding: 0 12px 0 40px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: 13px;
          font-family: 'JetBrains Mono', monospace;
        }

        .search-input:focus {
          outline: none;
          border-color: var(--accent-teal);
        }

        .search-input::placeholder {
          font-family: 'Inter', sans-serif;
          color: var(--text-dim);
        }

        .icon-btn {
          width: 38px;
          height: 38px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-elevated);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          color: var(--text-muted);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .icon-btn:hover {
          color: var(--text-primary);
          border-color: var(--border-hover);
        }

        /* External Link */
        .external-link {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          color: var(--text-muted);
          text-decoration: none;
          font-size: 13px;
          font-weight: 500;
          border-radius: var(--radius-md);
          transition: all var(--transition-fast);
        }

        .external-link:hover {
          color: var(--accent-teal);
          background: rgba(20, 244, 201, 0.1);
        }

        /* Network Badge */
        .network-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: rgba(20, 244, 201, 0.08);
          border: 1px solid rgba(20, 244, 201, 0.2);
          border-radius: var(--radius-full);
          font-size: 12px;
          font-weight: 600;
          color: var(--accent-teal);
        }

        .network-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent-teal);
          box-shadow: 0 0 8px var(--accent-teal);
        }

        /* Wallet Button */
        .wallet-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 40px;
          padding: 0 18px;
          background: var(--gradient-primary);
          border: none;
          border-radius: var(--radius-md);
          color: #09090b;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .wallet-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: var(--shadow-glow-teal);
        }

        .wallet-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .wallet-btn.connected {
          background: var(--bg-elevated);
          border: 1px solid var(--border-default);
          color: var(--text-primary);
        }

        .wallet-btn.connected:hover {
          background: var(--bg-hover);
          border-color: var(--border-hover);
          transform: none;
          box-shadow: none;
        }

        .wallet-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-teal);
          box-shadow: 0 0 8px var(--accent-teal);
        }

        /* Mobile */
        @media (max-width: 1024px) {
          .navbar-nav {
            gap: 2px;
          }
          
          .nav-link span {
            display: none;
          }
          
          .nav-link {
            padding: 10px;
          }
          
          .nav-link svg {
            width: 20px;
            height: 20px;
          }
          
          .logo-text {
            display: none;
          }
        }

        @media (max-width: 768px) {
          .navbar-inner {
            gap: 16px;
          }
          
          .network-badge span {
            display: none;
          }
          
          .wallet-btn span {
            display: none;
          }
          
          .wallet-btn {
            width: 40px;
            padding: 0;
            justify-content: center;
          }
        }
      `}</style>
    </nav>
  );
}
