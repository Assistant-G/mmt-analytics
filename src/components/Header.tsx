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
          <Menu size={18} />
        </button>
        
        <form onSubmit={handleSearch} className="search-container">
          <Search className="search-icon" size={16} />
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
          <span>MMT Finance</span>
          <ExternalLink size={13} />
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
          padding: 0 28px;
          background: rgba(12, 13, 18, 0.7);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 14px;
          flex: 1;
          max-width: 480px;
        }

        .menu-button {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border: none;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 9px;
          color: #8b8fa3;
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
          max-width: 380px;
        }

        .search-icon {
          position: absolute;
          left: 13px;
          top: 50%;
          transform: translateY(-50%);
          color: #555a6e;
          pointer-events: none;
        }

        .search-input {
          width: 100%;
          height: 38px;
          padding-left: 40px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 10px;
          color: #E8E8EC;
          font-size: 13px;
          font-family: 'JetBrains Mono', monospace;
          transition: all 0.25s ease;
        }

        .search-input::placeholder {
          color: #555a6e;
          font-family: 'Inter', sans-serif;
        }

        .search-input:focus {
          outline: none;
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(0, 212, 170, 0.25);
          box-shadow: 0 0 0 3px rgba(0, 212, 170, 0.06);
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .external-link {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          color: #8b8fa3;
          text-decoration: none;
          font-size: 12.5px;
          font-weight: 500;
          border-radius: 9px;
          transition: all 0.2s;
        }

        .external-link:hover {
          color: #00D4AA;
          background: rgba(0, 212, 170, 0.06);
        }

        .wallet-button {
          height: 38px;
          padding: 0 18px;
          font-weight: 600;
          font-size: 13px;
          border-radius: 10px;
          background: linear-gradient(135deg, #00D4AA 0%, #00A3FF 100%);
          border: none;
          color: #0A0A0F;
          transition: all 0.3s ease;
          letter-spacing: -0.01em;
        }

        .wallet-button:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(0, 212, 170, 0.25);
        }

        .wallet-button.connected {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.07);
          color: #E8E8EC;
        }

        .wallet-button.connected:hover {
          background: rgba(255, 255, 255, 0.06);
          transform: none;
          box-shadow: none;
          border-color: rgba(255, 255, 255, 0.12);
        }

        .wallet-indicator {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #00D4AA;
          margin-right: 9px;
          box-shadow: 0 0 6px rgba(0, 212, 170, 0.5);
        }

        @media (max-width: 768px) {
          .header {
            padding: 0 16px;
          }

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
