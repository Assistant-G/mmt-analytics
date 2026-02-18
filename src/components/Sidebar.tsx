// Sidebar.tsx - Deprecated: Now using Navbar component with horizontal navigation
// Kept for backwards compatibility

type View = 'dashboard' | 'pools' | 'positions' | 'leaderboard' | 'vaults' | 'lp-registry' | 'range-analytics' | 'backtesting';

interface SidebarProps {
  isOpen?: boolean;
  currentView?: View;
  onViewChange?: (view: View) => void;
  onToggle?: () => void;
}

export function Sidebar({ isOpen, currentView, onViewChange, onToggle }: SidebarProps) {
  return null;
}
