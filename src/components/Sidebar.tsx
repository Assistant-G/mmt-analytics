import {
  LayoutDashboard,
  Droplets,
  BarChart3,
  Trophy,
  ChevronLeft,
  ChevronRight,
  Zap,
  Vault,
  Target,
  FlaskConical,
  Layers,
} from 'lucide-react';

type View = 'dashboard' | 'pools' | 'positions' | 'leaderboard' | 'vaults' | 'lp-registry' | 'range-analytics' | 'backtesting';

interface SidebarProps {
  isOpen: boolean;
  currentView: View;
  onViewChange: (view: View) => void;
  onToggle: () => void;
}

const navItems = [
  { id: 'dashboard' as View, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'pools' as View, label: 'Pool Discovery', icon: Droplets },
  { id: 'positions' as View, label: 'My Positions', icon: BarChart3 },
  { id: 'vaults' as View, label: 'My Vaults', icon: Vault },
  { id: 'lp-registry' as View, label: 'LP Registry', icon: Layers },
  { id: 'leaderboard' as View, label: 'Leaderboard', icon: Trophy },
  { id: 'range-analytics' as View, label: 'Range Analytics', icon: Target },
  { id: 'backtesting' as View, label: 'Backtesting', icon: FlaskConical },
];

export function Sidebar({ isOpen, currentView, onViewChange, onToggle }: SidebarProps) {
  return (
    <aside className={`sidebar ${isOpen ? 'open' : 'collapsed'}`}>
      <div className="sidebar-header">
        <div className="logo">
          <div className="logo-icon">
            <Zap size={24} />
          </div>
          {isOpen && (
            <div className="logo-text">
              <span className="logo-title">MMT</span>
              <span className="logo-subtitle">Analytics</span>
            </div>
          )}
        </div>
        <button className="toggle-button" onClick={onToggle}>
          {isOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          
          return (
            <button
              key={item.id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => onViewChange(item.id)}
              title={!isOpen ? item.label : undefined}
            >
              <div className="nav-icon">
                <Icon size={20} />
              </div>
              {isOpen && <span className="nav-label">{item.label}</span>}
              {isActive && <div className="active-indicator" />}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        {isOpen && (
          <div className="network-badge">
            <div className="network-dot" />
            <span>Sui Mainnet</span>
          </div>
        )}
      </div>

      <style>{`
        .sidebar {
          position: fixed;
          left: 0;
          top: 0;
          height: 100vh;
          background: rgba(10, 10, 15, 0.95);
          backdrop-filter: blur(20px);
          border-right: 1px solid rgba(255, 255, 255, 0.04);
          display: flex;
          flex-direction: column;
          z-index: 200;
          transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .sidebar.open {
          width: var(--sidebar-width);
        }

        .sidebar.collapsed {
          width: var(--sidebar-collapsed);
        }

        .sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .logo-icon {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #00D4AA 0%, #00A3FF 100%);
          border-radius: 12px;
          color: #0A0A0F;
        }

        .logo-text {
          display: flex;
          flex-direction: column;
        }

        .logo-title {
          font-size: 18px;
          font-weight: 700;
          color: #E8E8EC;
          line-height: 1.2;
        }

        .logo-subtitle {
          font-size: 11px;
          color: #606070;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .toggle-button {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 8px;
          color: #A0A0B0;
          cursor: pointer;
          transition: all 0.2s;
        }

        .toggle-button:hover {
          background: rgba(255, 255, 255, 0.06);
          color: #E8E8EC;
        }

        .sidebar-nav {
          flex: 1;
          padding: 16px 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .nav-item {
          position: relative;
          display: flex;
          align-items: center;
          gap: 14px;
          width: 100%;
          padding: 14px 16px;
          background: transparent;
          border: none;
          border-radius: 12px;
          color: #808090;
          cursor: pointer;
          transition: all 0.2s;
          text-align: left;
        }

        .sidebar.collapsed .nav-item {
          padding: 14px;
          justify-content: center;
        }

        .nav-item:hover {
          background: rgba(255, 255, 255, 0.03);
          color: #E8E8EC;
        }

        .nav-item.active {
          background: rgba(0, 212, 170, 0.1);
          color: #00D4AA;
        }

        .nav-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .nav-label {
          font-size: 14px;
          font-weight: 500;
          white-space: nowrap;
        }

        .active-indicator {
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 24px;
          background: linear-gradient(180deg, #00D4AA 0%, #00A3FF 100%);
          border-radius: 0 3px 3px 0;
        }

        .sidebar-footer {
          padding: 16px;
          border-top: 1px solid rgba(255, 255, 255, 0.04);
        }

        .network-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: rgba(0, 212, 170, 0.08);
          border: 1px solid rgba(0, 212, 170, 0.15);
          border-radius: 10px;
          font-size: 12px;
          font-weight: 500;
          color: #00D4AA;
        }

        .network-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #00D4AA;
          animation: pulse-glow 2s infinite;
        }

        @media (max-width: 1024px) {
          .sidebar {
            transform: translateX(-100%);
          }
          
          .sidebar.open {
            transform: translateX(0);
          }
        }
      `}</style>
    </aside>
  );
}
