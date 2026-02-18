import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { Dashboard } from '@/components/Dashboard';
import { PoolDiscovery } from '@/components/PoolDiscovery';
import { TopPositions } from '@/components/TopPositions';
import { PositionAnalytics } from '@/components/PositionAnalytics';
import { MyVaults } from '@/components/MyVaults';
import { LPRegistry } from '@/components/LPRegistry';
import { RangeAnalytics } from '@/components/RangeAnalytics';
import { Backtesting } from '@/components/Backtesting';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { WalletProvider } from '@/contexts/WalletContext';
import { AutoCloseProvider } from '@/contexts/AutoCloseContext';
import './App.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: false,
    },
  },
});

type View = 'dashboard' | 'pools' | 'positions' | 'leaderboard' | 'vaults' | 'lp-registry' | 'range-analytics' | 'backtesting';

function App() {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'pools':
        return <PoolDiscovery />;
      case 'positions':
        return <PositionAnalytics />;
      case 'leaderboard':
        return <TopPositions />;
      case 'vaults':
        return <MyVaults />;
      case 'lp-registry':
        return <LPRegistry />;
      case 'range-analytics':
        return <RangeAnalytics />;
      case 'backtesting':
        return <Backtesting />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <AutoCloseProvider>
          <div className="app-container">
            <Sidebar
              isOpen={sidebarOpen}
              currentView={currentView}
              onViewChange={setCurrentView}
              onToggle={() => setSidebarOpen(!sidebarOpen)}
            />
            <div className={`main-content ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
              <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
              <main className="content-area">
                {renderView()}
              </main>
            </div>
            <Toaster position="bottom-right" />
          </div>
        </AutoCloseProvider>
      </WalletProvider>
    </QueryClientProvider>
  );
}

export default App;
