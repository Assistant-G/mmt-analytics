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
            <Zap size={22} />
          </div>
          <div className={`logo-text ${isOpen ? 'visible' : ''}`}>
            <span className="logo-title">MMT</span>
            <span className="logo-subtitle">Analytics</span>
          </div>
        </div>
        <button className="toggle-button" onClick={onToggle} aria-label="Toggle sidebar">
          {isOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
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
              {isActive && <div className="active-indicator" />}
              <div className="nav-icon">
                <Icon size={19} strokeWidth={isActive ? 2.2 : 1.8} />
              </div>
              <span className={`nav-label ${isOpen ? 'visible' : ''}`}>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className={`network-badge ${isOpen ? 'expanded' : ''}`}>
          <div className="network-dot" />
          {isOpen && <span>Sui Mainnet</span>}
        </div>
      </div>

      <style>{`
        .sidebar {
          position: fixed;
          left: 0;
          top: 0;
          height: 100vh;
          background: rgba(12, 13, 18, 0.92);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border-right: 1px solid rgba(255, 255, 255, 0.04);
          display: flex;
          flex-direction: column;
          z-index: 200;
          transition: width 0.35s var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1));
          overflow: hidden;
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
          padding: 18px 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          min-height: 64px;
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 12px;
          overflow: hidden;
        }

        .logo-icon {
          width: 38px;
          height: 38px;
          min-width: 38px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #00D4AA 0%, #00A3FF 100%);
          border-radius: 11px;
          color: #0A0A0F;
          box-shadow: 0 2px 12px rgba(0, 212, 170, 0.2);
        }

        .logo-text {
          display: flex;
          flex-direction: column;
          opacity: 0;
          transform: translateX(-8px);
          transition: all 0.25s var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1));
          white-space: nowrap;
        }

        .logo-text.visible {
          opacity: 1;
          transform: translateX(0);
        }

        .logo-title {
          font-size: 17px;
          font-weight: 700;
          color: #E8E8EC;
          line-height: 1.2;
          letter-spacing: -0.02em;
        }

        .logo-subtitle {
          font-size: 10px;
          color: #555a6e;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 500;
        }

        .toggle-button {
          width: 26px;
          height: 26px;
          min-width: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 7px;
          color: #8b8fa3;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .toggle-button:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #E8E8EC;
          border-color: rgba(255, 255, 255, 0.12);
        }

        .sidebar-nav {
          flex: 1;
          padding: 12px 10px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          overflow-y: auto;
          overflow-x: hidden;
        }

        .nav-item {
          position: relative;
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 11px 14px;
          background: transparent;
          border: none;
          border-radius: 10px;
          color: #6b7084;
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: left;
          overflow: hidden;
        }

        .sidebar.collapsed .nav-item {
          padding: 11px;
          justify-content: center;
        }

        .nav-item:hover {
          background: rgba(255, 255, 255, 0.04);
          color: #c8cad3;
        }

        .nav-item.active {
          background: rgba(0, 212, 170, 0.08);
          color: #00D4AA;
        }

        .nav-item.active:hover {
          background: rgba(0, 212, 170, 0.12);
        }

        .nav-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          width: 20px;
          height: 20px;
        }

        .nav-label {
          font-size: 13.5px;
          font-weight: 500;
          white-space: nowrap;
          opacity: 0;
          transform: translateX(-6px);
          transition: all 0.25s var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1));
        }

        .nav-label.visible {
          opacity: 1;
          transform: translateX(0);
        }

        .active-indicator {
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 20px;
          background: linear-gradient(180deg, #00D4AA 0%, #00A3FF 100%);
          border-radius: 0 3px 3px 0;
        }

        .sidebar-footer {
          padding: 14px;
          border-top: 1px solid rgba(255, 255, 255, 0.04);
        }

        .network-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 9px;
          background: rgba(0, 212, 170, 0.06);
          border: 1px solid rgba(0, 212, 170, 0.1);
          border-radius: 9px;
          font-size: 11.5px;
          font-weight: 500;
          color: #00D4AA;
          transition: all 0.3s ease;
          overflow: hidden;
          white-space: nowrap;
        }

        .network-badge.expanded {
          padding: 9px 14px;
          justify-content: flex-start;
        }

        .network-dot {
          width: 7px;
          height: 7px;
          min-width: 7px;
          border-radius: 50%;
          background: #00D4AA;
          box-shadow: 0 0 8px rgba(0, 212, 170, 0.5);
          animation: pulse-glow 2.5s ease-in-out infinite;
        }

        @media (max-width: 1024px) {
          .sidebar {
            transform: translateX(-100%);
          }
          
          .sidebar.open {
            transform: translateX(0);
            box-shadow: 16px 0 48px rgba(0, 0, 0, 0.5);
          }
        }
      `}</style>
    </aside>
  );
}
