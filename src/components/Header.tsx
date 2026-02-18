import { useState } from 'react';
import { Search, Menu, ExternalLink } from 'lucide-react';
import { ConnectModal } from '@mysten/dapp-kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWallet } from '@/contexts/WalletContext';
import { formatAddress } from '@/utils';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { address, isConnected, isConnecting, disconnect, setAddress } = useWallet();
  const [searchValue, setSearchValue] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.startsWith('0x') && searchValue.length >= 42) {
      setAddress(searchValue);
      setSearchValue('');
    }
  };

  return (
    <header className="header">
      <div className="header-left">
        <button className="menu-button" onClick={onMenuClick}>
          <Menu size={20} />
        </button>
        
        <form onSubmit={handleSearch} className="search-container">
          <Search className="search-icon" size={18} />
          <Input
            type="text"
            placeholder="Search wallet address (0x...)"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="search-input"
          />
        </form>
      </div>

      <div className="header-right">
        <a 
          href="https://app.mmt.finance" 
          target="_blank" 
          rel="noopener noreferrer"
          className="external-link"
        >
          <span>Open MMT Finance</span>
          <ExternalLink size={14} />
        </a>
        
        {isConnected ? (
          <Button
            variant="outline"
            className="wallet-button connected"
            onClick={disconnect}
          >
            <div className="wallet-indicator" />
            <span className="mono">{formatAddress(address!, 6)}</span>
          </Button>
        ) : (
          <ConnectModal
            trigger={
              <Button
                className="wallet-button"
                disabled={isConnecting}
              >
                {isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </Button>
            }
          />
        )}
      </div>

      <style>{`
        .header {
          height: var(--header-height);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
          background: rgba(10, 10, 15, 0.8);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 16px;
          flex: 1;
          max-width: 500px;
        }

        .menu-button {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border: none;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 10px;
          color: #A0A0B0;
          cursor: pointer;
          transition: all 0.2s;
        }

        .menu-button:hover {
          background: rgba(255, 255, 255, 0.06);
          color: #E8E8EC;
        }

        .search-container {
          position: relative;
          flex: 1;
          max-width: 400px;
        }

        .search-icon {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: #606070;
          pointer-events: none;
        }

        .search-input {
          width: 100%;
          height: 44px;
          padding-left: 44px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 12px;
          color: #E8E8EC;
          font-size: 14px;
          font-family: 'JetBrains Mono', monospace;
          transition: all 0.2s;
        }

        .search-input::placeholder {
          color: #606070;
          font-family: 'Sora', sans-serif;
        }

        .search-input:focus {
          outline: none;
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(0, 212, 170, 0.3);
          box-shadow: 0 0 0 3px rgba(0, 212, 170, 0.1);
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .external-link {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 16px;
          color: #A0A0B0;
          text-decoration: none;
          font-size: 13px;
          font-weight: 500;
          border-radius: 10px;
          transition: all 0.2s;
        }

        .external-link:hover {
          color: #00D4AA;
          background: rgba(0, 212, 170, 0.08);
        }

        .wallet-button {
          height: 44px;
          padding: 0 20px;
          font-weight: 600;
          border-radius: 12px;
          background: linear-gradient(135deg, #00D4AA 0%, #00A3FF 100%);
          border: none;
          color: #0A0A0F;
          transition: all 0.3s;
        }

        .wallet-button:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(0, 212, 170, 0.25);
        }

        .wallet-button.connected {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #E8E8EC;
        }

        .wallet-button.connected:hover {
          background: rgba(255, 255, 255, 0.06);
          transform: none;
          box-shadow: none;
        }

        .wallet-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #00D4AA;
          margin-right: 10px;
          animation: pulse-glow 2s infinite;
        }

        @media (max-width: 768px) {
          .external-link span {
            display: none;
          }
          
          .search-container {
            max-width: 200px;
          }
        }
      `}</style>
    </header>
  );
}
