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
import { Navbar } from '@/components/Navbar';
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

export type View = 'dashboard' | 'pools' | 'positions' | 'leaderboard' | 'vaults' | 'lp-registry' | 'range-analytics' | 'backtesting';

function App() {
  const [currentView, setCurrentView] = useState<View>('dashboard');

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
          <div className="app-layout">
            <Navbar currentView={currentView} onViewChange={setCurrentView} />
            <main className="main-content">
              <div className="content-container animate-fade-in-up">
                {renderView()}
              </div>
            </main>
            <Toaster 
              position="bottom-right" 
              toastOptions={{
                style: {
                  background: '#111113',
                  border: '1px solid #1c1c1f',
                  color: '#fafafa',
                },
              }}
            />
          </div>
        </AutoCloseProvider>
      </WalletProvider>
    </QueryClientProvider>
  );
}

export default App;
