/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import {
  createNetworkConfig,
  SuiClientProvider,
  WalletProvider as DappKitWalletProvider,
  useCurrentAccount,
  useConnectWallet,
  useDisconnectWallet,
  useWallets,
} from '@mysten/dapp-kit';
import { toast } from 'sonner';
import type { WalletState } from '@/types';
import { getNetworkConfig } from '@/config/rpc';
import '@mysten/dapp-kit/dist/index.css';

// Network configuration for Sui mainnet with backup RPC support
const { networkConfig } = createNetworkConfig(getNetworkConfig());

interface WalletContextType extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  setAddress: (address: string) => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

// Inner component that uses dapp-kit hooks
function WalletContextInner({ children }: { children: ReactNode }) {
  const [manualAddress, setManualAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const currentAccount = useCurrentAccount();
  const wallets = useWallets();
  const { mutateAsync: connectWallet } = useConnectWallet();
  const { mutate: disconnectWallet } = useDisconnectWallet();

  // Derive state from dapp-kit or manual address
  const address = manualAddress || currentAccount?.address || null;
  const isConnected = Boolean(address);
  const walletName = currentAccount?.label || 'Connected Wallet';

  const connect = useCallback(async () => {
    if (isConnecting) return;

    setIsConnecting(true);

    try {
      // Get available wallets
      const availableWallets = wallets;

      console.log('[Wallet] Available wallets:', availableWallets.map(w => w.name));

      if (availableWallets.length === 0) {
        throw new Error('No Sui wallet found. Please install Suiet, Sui Wallet, or another Sui-compatible wallet.');
      }

      // Prefer Suiet, then Sui Wallet, then any available wallet
      const preferredOrder = ['Suiet', 'Sui Wallet', 'Slush', 'Nightly'];
      let selectedWallet = availableWallets[0];

      for (const preferred of preferredOrder) {
        const found = availableWallets.find(w =>
          w.name.toLowerCase().includes(preferred.toLowerCase())
        );
        if (found) {
          selectedWallet = found;
          break;
        }
      }

      console.log('[Wallet] Connecting to:', selectedWallet.name);

      await connectWallet({ wallet: selectedWallet });

      toast.success(`${selectedWallet.name} connected successfully!`);
    } catch (error) {
      console.error('[Wallet] Connection error:', error);
      const message = error instanceof Error ? error.message : 'Failed to connect wallet';
      toast.error(message);
    } finally {
      setIsConnecting(false);
    }
  }, [wallets, connectWallet, isConnecting]);

  const disconnect = useCallback(() => {
    setManualAddress(null);
    disconnectWallet();
    toast.info('Wallet disconnected');
  }, [disconnectWallet]);

  const setAddress = useCallback((newAddress: string) => {
    if (newAddress && newAddress.startsWith('0x') && newAddress.length >= 42) {
      setManualAddress(newAddress);
      toast.success('Searching for positions...');
    }
  }, []);

  // Clear manual address when real wallet connects
  useEffect(() => {
    if (currentAccount?.address && manualAddress) {
      setManualAddress(null);
    }
  }, [currentAccount?.address, manualAddress]);

  const contextValue: WalletContextType = {
    address,
    isConnected,
    isConnecting,
    balance: undefined,
    walletName: isConnected ? walletName : undefined,
    connect,
    disconnect,
    setAddress,
  };

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  );
}

// Main provider that wraps with dapp-kit providers
export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <SuiClientProvider networks={networkConfig} defaultNetwork="mainnet">
      <DappKitWalletProvider autoConnect={true}>
        <WalletContextInner>{children}</WalletContextInner>
      </DappKitWalletProvider>
    </SuiClientProvider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
