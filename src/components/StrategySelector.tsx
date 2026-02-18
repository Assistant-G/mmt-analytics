/**
 * Strategy Selector Component
 *
 * Compact dropdown selector for LP strategies with details panel.
 */

import { useState, useRef, useEffect } from 'react';
import { STRATEGY_PRESETS, type StrategyPreset } from '@/types/strategies';
import { Check, ChevronDown, TrendingUp, Shield, Zap, Coins, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StrategySelectorProps {
  selectedId: string;
  onSelect: (preset: StrategyPreset) => void;
  disabled?: boolean;
}

const strategyIcons = {
  'smart-rebalance': Shield,
  'aggressive-yield': Zap,
  'conservative': Shield,
  'stablecoin-farmer': Coins,
  'trend-follower': TrendingUp,
} as const;

export function StrategySelector({ selectedId, onSelect, disabled }: StrategySelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedPreset = STRATEGY_PRESETS.find(p => p.id === selectedId) || STRATEGY_PRESETS[0];
  const SelectedIcon = strategyIcons[selectedPreset.id as keyof typeof strategyIcons] || Activity;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (preset: StrategyPreset) => {
    onSelect(preset);
    setIsOpen(false);
  };

  return (
    <div className="strategy-selector" ref={dropdownRef}>
      <label className="selector-label">
        <Activity size={14} />
        Select Strategy
      </label>

      {/* Dropdown Trigger */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          'dropdown-trigger',
          isOpen && 'open',
          disabled && 'disabled'
        )}
      >
        <div className="trigger-content">
          <div className={cn('trigger-icon', `risk-${selectedPreset.riskLevel}`)}>
            <SelectedIcon size={18} />
          </div>
          <span className="trigger-name">{selectedPreset.name}</span>
          <RiskBadge risk={selectedPreset.riskLevel} />
        </div>
        <ChevronDown size={18} className={cn('chevron', isOpen && 'rotated')} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="dropdown-menu">
          {STRATEGY_PRESETS.map((preset) => {
            const Icon = strategyIcons[preset.id as keyof typeof strategyIcons] || Activity;
            const isSelected = selectedId === preset.id;

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelect(preset)}
                className={cn('dropdown-item', isSelected && 'selected')}
              >
                <div className={cn('item-icon', `risk-${preset.riskLevel}`)}>
                  <Icon size={16} />
                </div>
                <div className="item-content">
                  <span className="item-name">{preset.name}</span>
                  <span className="item-apy">{preset.expectedAprMultiplier}</span>
                </div>
                <RiskBadge risk={preset.riskLevel} small />
                {isSelected && <Check size={16} className="check-icon" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Selected Strategy Details */}
      <div className="strategy-details">
        <p className="strategy-description">{selectedPreset.description}</p>

        <div className="strategy-metrics">
          <div className="metric">
            <span className="metric-label">Expected APY</span>
            <span className="metric-value apy">{selectedPreset.expectedAprMultiplier}</span>
          </div>
          <div className="metric">
            <span className="metric-label">Gas Cost</span>
            <span className={cn('metric-value', `gas-${selectedPreset.gasCostLevel}`)}>
              {selectedPreset.gasCostLevel.charAt(0).toUpperCase() + selectedPreset.gasCostLevel.slice(1)}
            </span>
          </div>
          <div className="metric">
            <span className="metric-label">Risk</span>
            <span className={cn('metric-value', `risk-text-${selectedPreset.riskLevel}`)}>
              {selectedPreset.riskLevel.toUpperCase()}
            </span>
          </div>
        </div>

        <div className="strategy-tags">
          <span className="tags-label">Best for:</span>
          {selectedPreset.bestFor.map((tag, idx) => (
            <span key={idx} className="tag">{tag}</span>
          ))}
        </div>
      </div>

      <style>{`
        .strategy-selector {
          position: relative;
        }

        .selector-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: #A0A0B0;
          margin-bottom: 8px;
        }

        .dropdown-trigger {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .dropdown-trigger:hover:not(.disabled) {
          border-color: rgba(147, 51, 234, 0.5);
          background: rgba(255, 255, 255, 0.05);
        }

        .dropdown-trigger.open {
          border-color: rgba(147, 51, 234, 0.7);
          border-bottom-left-radius: 0;
          border-bottom-right-radius: 0;
        }

        .dropdown-trigger.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .trigger-content {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .trigger-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .trigger-icon.risk-low { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
        .trigger-icon.risk-medium { background: rgba(234, 179, 8, 0.2); color: #eab308; }
        .trigger-icon.risk-high { background: rgba(239, 68, 68, 0.2); color: #ef4444; }

        .trigger-name {
          font-size: 14px;
          font-weight: 600;
          color: #E8E8EC;
        }

        .chevron {
          color: #808090;
          transition: transform 0.2s;
        }

        .chevron.rotated {
          transform: rotate(180deg);
        }

        .dropdown-menu {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: #1a1a24;
          border: 1px solid rgba(147, 51, 234, 0.5);
          border-top: none;
          border-radius: 0 0 10px 10px;
          overflow: hidden;
          z-index: 100;
          max-height: 280px;
          overflow-y: auto;
        }

        .dropdown-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          background: transparent;
          border: none;
          cursor: pointer;
          transition: all 0.15s;
          text-align: left;
        }

        .dropdown-item:hover {
          background: rgba(147, 51, 234, 0.1);
        }

        .dropdown-item.selected {
          background: rgba(147, 51, 234, 0.15);
        }

        .item-icon {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .item-icon.risk-low { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
        .item-icon.risk-medium { background: rgba(234, 179, 8, 0.2); color: #eab308; }
        .item-icon.risk-high { background: rgba(239, 68, 68, 0.2); color: #ef4444; }

        .item-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }

        .item-name {
          font-size: 13px;
          font-weight: 500;
          color: #E8E8EC;
        }

        .item-apy {
          font-size: 11px;
          color: #22c55e;
        }

        .check-icon {
          color: #A855F7;
          flex-shrink: 0;
        }

        .strategy-details {
          margin-top: 12px;
          padding: 14px;
          background: rgba(147, 51, 234, 0.08);
          border: 1px solid rgba(147, 51, 234, 0.15);
          border-radius: 10px;
        }

        .strategy-description {
          font-size: 13px;
          color: #B0B0C0;
          line-height: 1.5;
          margin-bottom: 12px;
        }

        .strategy-metrics {
          display: flex;
          gap: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          margin-bottom: 10px;
        }

        .metric {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .metric-label {
          font-size: 11px;
          color: #606070;
        }

        .metric-value {
          font-size: 13px;
          font-weight: 600;
          color: #E8E8EC;
        }

        .metric-value.apy { color: #22c55e; }
        .metric-value.gas-low { color: #22c55e; }
        .metric-value.gas-medium { color: #eab308; }
        .metric-value.gas-high { color: #ef4444; }
        .metric-value.risk-text-low { color: #22c55e; }
        .metric-value.risk-text-medium { color: #eab308; }
        .metric-value.risk-text-high { color: #ef4444; }

        .strategy-tags {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
        }

        .tags-label {
          font-size: 11px;
          color: #606070;
        }

        .tag {
          font-size: 11px;
          padding: 3px 8px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
          color: #A0A0B0;
        }
      `}</style>
    </div>
  );
}

function RiskBadge({ risk, small = false }: { risk: string; small?: boolean }) {
  const colors = {
    low: 'bg-green-500/20 text-green-500 border-green-500/30',
    medium: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30',
    high: 'bg-red-500/20 text-red-500 border-red-500/30',
    custom: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded border font-medium',
        small ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
        colors[risk as keyof typeof colors] || colors.custom
      )}
    >
      {risk.toUpperCase()}
    </span>
  );
}
