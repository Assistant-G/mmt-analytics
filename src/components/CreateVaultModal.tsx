/**
 * Create Vault Modal
 *
 * UI for creating a cycling vault that automatically manages LP positions.
 * Users deposit tokens and configure cycle parameters.
 */

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { Transaction } from '@mysten/sui/transactions';
import {
  X,
  Vault,
  Timer,
  Repeat,
  AlertCircle,
  Loader2,
  Info,
  Infinity,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import { useWallet } from '@/contexts/WalletContext';
import { VAULT_CONFIG, isVaultDeployed, buildUpdateRebalanceSettingsTransaction } from '@/services/vaultService';
import { fetchPoolsData } from '@/services/mmtService';
import { getTokenLogo, getFeeLabel } from '@/utils';
import type { Pool } from '@/types';
import { StrategySelector } from './StrategySelector';
import { STRATEGY_PRESETS, type StrategyPreset } from '@/types/strategies';

interface CreateVaultModalProps {
  pool: Pool;
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean; // When true, don't render modal overlay (used inside combined modal)
}

// Time unit options
const TIME_UNITS = [
  { label: 's', multiplier: 1 },
  { label: 'm', multiplier: 60 },
  { label: 'h', multiplier: 3600 },
];

export function CreateVaultModal({ pool, isOpen, onClose, embedded = false }: CreateVaultModalProps) {
  const { address } = useWallet();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  // Form state
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyPreset>(STRATEGY_PRESETS[0]); // Default to Smart Rebalancing
  const [rangePercent, setRangePercent] = useState([5]); // 5% default
  const [rangeMode, setRangeMode] = useState<'percent' | 'manual'>('percent');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [timerSeconds, setTimerSeconds] = useState(60); // 1 minute default
  const [timerValue, setTimerValue] = useState('1');
  const [timerUnit, setTimerUnit] = useState<'s' | 'm' | 'h'>('m');
  const [maxCycles, setMaxCycles] = useState(0); // 0 = infinite
  const [cyclesValue, setCyclesValue] = useState('');
  const [isInfinite, setIsInfinite] = useState(true);
  // Duration mode: 'cycles' = number of cycles, 'duration' = total time
  const [durationMode, setDurationMode] = useState<'cycles' | 'duration'>('cycles');
  const [totalDurationValue, setTotalDurationValue] = useState('');
  const [totalDurationUnit, setTotalDurationUnit] = useState<'s' | 'm' | 'h'>('h');
  const [userBalances, setUserBalances] = useState<{ a: string; b: string }>({ a: '0', b: '0' });
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);

  // ZAP state
  const [useZap, setUseZap] = useState(true); // ZAP enabled by default
  const [zapSlippageBps, setZapSlippageBps] = useState(1); // 0.01% default (1 bps)
  const [customZapSlippage, setCustomZapSlippage] = useState('');
  const [showCustomZapSlippage, setShowCustomZapSlippage] = useState(false);
  const [zapWaitForSlippage, setZapWaitForSlippage] = useState(true); // Wait if slippage too high

  // Fetch all pools to find same-pair pools with different fee tiers for ZAP
  const { data: allPools } = useQuery({
    queryKey: ['pools'],
    queryFn: fetchPoolsData,
    staleTime: 60000,
  });

  // Find pools with the same token pair but different fee tiers (for ZAP swap pool)
  const samePairPools = useMemo(() => {
    if (!allPools) return [];

    const tokenAAddr = pool.tokenA.address;
    const tokenBAddr = pool.tokenB.address;

    return allPools
      .filter(p => {
        const matchForward = p.tokenA.address === tokenAAddr && p.tokenB.address === tokenBAddr;
        const matchReverse = p.tokenA.address === tokenBAddr && p.tokenB.address === tokenAAddr;
        return (matchForward || matchReverse) && p.id !== pool.id;
      })
      .sort((a, b) => a.fee - b.fee);
  }, [allPools, pool]);

  // All available pools for this pair (including current pool)
  const allPairPools = useMemo(() => {
    const pools = [pool, ...samePairPools];
    return pools.sort((a, b) => a.fee - b.fee);
  }, [pool, samePairPools]);

  // Find the lowest-fee pool among non-current pools for tagging
  const lowestFeePoolId = useMemo(() => {
    const nonCurrentPools = allPairPools.filter(p => p.id !== pool.id);
    if (nonCurrentPools.length === 0) return null;
    const minFee = Math.min(...nonCurrentPools.map(p => p.fee));
    return nonCurrentPools.find(p => p.fee === minFee)?.id || null;
  }, [allPairPools, pool]);

  // ZAP slippage preset options (in basis points)
  const ZAP_SLIPPAGE_PRESETS = [
    { label: '0.01%', bps: 1 },
    { label: '0.05%', bps: 5 },
    { label: '0.1%', bps: 10 },
    { label: '0.5%', bps: 50 },
  ];

  // Apply custom slippage
  const applyCustomZapSlippage = () => {
    const val = parseFloat(customZapSlippage);
    if (isNaN(val) || val <= 0) {
      toast.error('Enter a valid slippage value');
      return;
    }
    // Convert percent to bps: 0.01% = 1 bps
    const bps = Math.max(1, Math.round(val * 100));
    setZapSlippageBps(bps);
    setShowCustomZapSlippage(false);
  };

  // Calculate current price from pool sqrtPrice
  const getCurrentPrice = () => {
    if (!pool.sqrtPrice) return 0;
    const sqrtPriceX64 = BigInt(pool.sqrtPrice);
    const Q64 = BigInt(1) << BigInt(64);
    // price = (sqrtPrice / 2^64)^2, adjusted for decimals
    const priceRaw = Number(sqrtPriceX64) / Number(Q64);
    const price = priceRaw * priceRaw;
    // Adjust for decimal difference
    const decimalAdjust = Math.pow(10, pool.tokenA.decimals - pool.tokenB.decimals);
    return price * decimalAdjust;
  };

  const currentPrice = getCurrentPrice();

  // Round price to nearest valid tick
  const roundPriceToTick = (price: number): number => {
    if (price <= 0) return 0;
    const tickSpacing = pool.tickSpacing || 1;
    // Convert price to tick: tick = log(price) / log(1.0001)
    const tickRaw = Math.log(price) / Math.log(1.0001);
    // Round to nearest tick spacing
    const alignedTick = Math.round(tickRaw / tickSpacing) * tickSpacing;
    // Convert back to price: price = 1.0001^tick
    return Math.pow(1.0001, alignedTick);
  };

  // Calculate range_bps from manual prices (symmetric around current price)
  const getRangeBpsFromPrices = () => {
    if (!minPrice || !maxPrice || !currentPrice) return rangePercent[0] * 100;
    const min = parseFloat(minPrice);
    const max = parseFloat(maxPrice);
    if (min <= 0 || max <= 0 || min >= max) return rangePercent[0] * 100;

    // Use the larger deviation from current price as the symmetric range
    const lowerDev = Math.abs((currentPrice - min) / currentPrice);
    const upperDev = Math.abs((max - currentPrice) / currentPrice);
    const maxDev = Math.max(lowerDev, upperDev);

    // Convert to basis points (1% = 100 bps), minimum 10 bps (0.1%)
    const bps = Math.max(10, Math.round(maxDev * 10000));
    return bps;
  };

  // Get effective range_bps based on mode
  const getEffectiveRangeBps = () => {
    if (rangeMode === 'manual') {
      return getRangeBpsFromPrices();
    }
    return rangePercent[0] * 100;
  };

  // Round and set min price
  const handleMinPriceChange = (value: string) => {
    setMinPrice(value);
  };

  const handleMinPriceBlur = () => {
    if (minPrice && currentPrice > 0) {
      const rounded = roundPriceToTick(parseFloat(minPrice));
      if (rounded > 0) {
        setMinPrice(rounded.toPrecision(6));
      }
    }
  };

  // Round and set max price
  const handleMaxPriceChange = (value: string) => {
    setMaxPrice(value);
  };

  const handleMaxPriceBlur = () => {
    if (maxPrice && currentPrice > 0) {
      const rounded = roundPriceToTick(parseFloat(maxPrice));
      if (rounded > 0) {
        setMaxPrice(rounded.toPrecision(6));
      }
    }
  };

  // Initialize manual prices when switching to manual mode
  const handleRangeModeChange = (mode: 'percent' | 'manual') => {
    setRangeMode(mode);
    if (mode === 'manual' && currentPrice > 0) {
      const percent = rangePercent[0] / 100;
      const minP = roundPriceToTick(currentPrice * (1 - percent));
      const maxP = roundPriceToTick(currentPrice * (1 + percent));
      setMinPrice(minP.toPrecision(6));
      setMaxPrice(maxP.toPrecision(6));
    }
  };

  // Calculate cycles from total duration
  const calculateCyclesFromDuration = () => {
    if (!totalDurationValue || !timerSeconds) return 0;
    const unitMultiplier = totalDurationUnit === 'h' ? 3600 : totalDurationUnit === 'm' ? 60 : 1;
    const totalSeconds = Number(totalDurationValue) * unitMultiplier;
    return Math.floor(totalSeconds / timerSeconds);
  };

  // Get effective max cycles based on mode
  const getEffectiveMaxCycles = () => {
    if (isInfinite) return 0;
    if (durationMode === 'duration') {
      return calculateCyclesFromDuration();
    }
    return maxCycles;
  };

  // Handle timer value change
  const handleTimerValueChange = (value: string) => {
    setTimerValue(value);
    const num = parseInt(value);
    if (!isNaN(num) && num > 0) {
      const unit = TIME_UNITS.find(u => u.label === timerUnit);
      setTimerSeconds(num * (unit?.multiplier || 60));
    }
  };

  // Handle time unit change
  const handleTimerUnitChange = (unit: 's' | 'm' | 'h') => {
    setTimerUnit(unit);
    const num = parseInt(timerValue);
    if (!isNaN(num) && num > 0) {
      const unitObj = TIME_UNITS.find(u => u.label === unit);
      setTimerSeconds(num * (unitObj?.multiplier || 60));
    }
  };

  // Handle cycles input
  const handleCyclesChange = (value: string) => {
    setCyclesValue(value);
    const num = parseInt(value);
    if (!isNaN(num) && num > 0) {
      setMaxCycles(num);
      setIsInfinite(false);
    } else if (value === '') {
      setMaxCycles(0);
      setIsInfinite(true);
    }
  };

  // Handle total duration input
  const handleTotalDurationChange = (value: string) => {
    setTotalDurationValue(value);
    if (value) {
      setIsInfinite(false);
    }
  };

  // Handle infinity toggle
  const handleInfiniteToggle = () => {
    setIsInfinite(!isInfinite);
    if (!isInfinite) {
      // Turning on infinite
      setMaxCycles(0);
      setCyclesValue('');
      setTotalDurationValue('');
    }
  };

  // Update range when strategy changes
  useEffect(() => {
    const strategy = selectedStrategy.strategy;
    if ('rangeBps' in strategy) {
      setRangePercent([strategy.rangeBps / 100]);
    }
  }, [selectedStrategy]);

  // Fetch user balances
  useEffect(() => {
    if (!address || !isOpen) return;

    const fetchBalances = async () => {
      setIsLoadingBalances(true);
      try {
        const [balanceA, balanceB] = await Promise.all([
          suiClient.getBalance({ owner: address, coinType: pool.tokenA.address }),
          suiClient.getBalance({ owner: address, coinType: pool.tokenB.address }),
        ]);

        setUserBalances({
          a: (Number(balanceA.totalBalance) / Math.pow(10, pool.tokenA.decimals)).toFixed(6),
          b: (Number(balanceB.totalBalance) / Math.pow(10, pool.tokenB.decimals)).toFixed(6),
        });
      } catch (error) {
        console.error('Failed to fetch balances:', error);
      } finally {
        setIsLoadingBalances(false);
      }
    };

    fetchBalances();
  }, [address, isOpen, pool, suiClient]);

  const handleCreateVault = async () => {
    if (!address) {
      toast.error('Please connect your wallet');
      return;
    }

    if (!isVaultDeployed()) {
      toast.error('Vault contract not yet deployed');
      return;
    }

    const amountANum = parseFloat(amountA);
    const amountBNum = parseFloat(amountB);

    if (isNaN(amountANum) || amountANum <= 0 || isNaN(amountBNum) || amountBNum <= 0) {
      toast.error('Please enter valid amounts for both tokens');
      return;
    }

    try {
      const tx = new Transaction();

      // Get coins for both tokens
      const amountASmallest = BigInt(Math.floor(amountANum * Math.pow(10, pool.tokenA.decimals)));
      const amountBSmallest = BigInt(Math.floor(amountBNum * Math.pow(10, pool.tokenB.decimals)));

      const SUI_TYPE = '0x2::sui::SUI';

      // Helper to get coin for a token type
      const getCoinForToken = async (tokenType: string, amount: bigint) => {
        const isSui = tokenType === SUI_TYPE || tokenType.includes('::sui::SUI');

        if (isSui) {
          // For SUI, split from gas
          const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
          return coin;
        } else {
          // For other tokens, fetch user's coins and merge/split
          const coins = await suiClient.getCoins({
            owner: address,
            coinType: tokenType,
          });

          if (coins.data.length === 0) {
            throw new Error(`No ${tokenType} coins found in wallet`);
          }

          // Calculate total available
          const totalAvailable = coins.data.reduce(
            (sum, c) => sum + BigInt(c.balance),
            BigInt(0)
          );

          if (totalAvailable < amount) {
            throw new Error(`Insufficient balance for ${tokenType}`);
          }

          // Use first coin, merge others if needed
          const primaryCoin = tx.object(coins.data[0].coinObjectId);

          if (coins.data.length > 1) {
            // Merge all coins into primary
            const otherCoins = coins.data.slice(1).map(c => tx.object(c.coinObjectId));
            tx.mergeCoins(primaryCoin, otherCoins);
          }

          // Split exact amount
          const [exactCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(amount)]);
          return exactCoin;
        }
      };

      // Get coins for both tokens
      const coinA = await getCoinForToken(pool.tokenA.address, amountASmallest);
      const coinB = await getCoinForToken(pool.tokenB.address, amountBSmallest);

      // Create vault with auto-rebalance settings
      tx.moveCall({
        target: `${VAULT_CONFIG.packageId}::cycling_vault::create_and_share_vault`,
        typeArguments: [pool.tokenA.address, pool.tokenB.address],
        arguments: [
          tx.object(VAULT_CONFIG.configId),
          coinA,
          coinB,
          tx.pure.id(pool.address),
          tx.pure.u64(getEffectiveRangeBps()), // Range in basis points
          tx.pure.u64(timerSeconds * 1000), // Convert to ms
          tx.pure.u64(getEffectiveMaxCycles()),
          tx.pure.bool(true),  // auto_rebalance: enabled
          tx.pure.bool(useZap),  // use_zap: swap excess tokens for max capital efficiency
          tx.pure.bool(false), // auto_compound: disabled (fees kept separate)
          tx.pure.u64(0),      // rebalance_delay_ms: no delay
          tx.object(VAULT_CONFIG.clockId),
        ],
      });

      const result = await signAndExecute({ transaction: tx });

      // Apply ZAP slippage settings if ZAP is enabled with custom slippage
      if (useZap && zapSlippageBps > 0) {
        try {
          const txDetails = await suiClient.waitForTransaction({
            digest: result.digest,
            options: { showObjectChanges: true },
          });

          const createdVault = txDetails.objectChanges?.find(
            (change) => change.type === 'created' && change.objectType?.includes('cycling_vault::Vault')
          );

          if (createdVault && 'objectId' in createdVault) {
            toast.info('Applying ZAP slippage settings...');
            const updateTx = buildUpdateRebalanceSettingsTransaction(
              createdVault.objectId,
              pool.tokenA.address,
              pool.tokenB.address,
              true,    // auto_rebalance
              useZap,  // use_zap
              false,   // auto_compound
              0,       // rebalance_delay_ms
              zapSlippageBps
            );
            await signAndExecute({ transaction: updateTx });
          }
        } catch (updateError) {
          console.warn('Failed to apply ZAP slippage settings:', updateError);
          toast.warning('Vault created but ZAP slippage settings could not be applied. Update them in vault settings.');
        }
      }

      toast.success(
        <div>
          <p>Vault created successfully!</p>
          <p className="text-xs text-gray-400 mt-1">
            Your tokens will cycle through LP positions automatically.
          </p>
          <a
            href={`https://suivision.xyz/txblock/${result.digest}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline text-sm"
          >
            View transaction
          </a>
        </div>
      );

      onClose();
    } catch (error) {
      console.error('Failed to create vault:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create vault');
    }
  };

  if (!isOpen) return null;

  const innerContent = (
    <>
      {/* Header - only show when not embedded */}
      {!embedded && (
        <div className="modal-header">
          <div className="header-left">
            <Vault size={24} className="text-purple-400" />
            <div>
              <h2>Create Cycling Vault</h2>
              <p className="text-sm text-gray-400">
                {pool.tokenA.symbol}/{pool.tokenB.symbol}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="close-btn">
            <X size={20} />
          </button>
        </div>
      )}

        {/* Info Banner */}
        <div className="info-banner">
          <Info size={16} />
          <div>
            <p className="font-medium">How Cycling Vault Works</p>
            <p className="text-xs text-gray-400 mt-1">
              Deposit tokens → Vault opens LP position → Timer expires →
              Backend closes & reopens → Repeat automatically. Works offline!
            </p>
          </div>
        </div>

        {/* Token Amounts */}
        <div className="form-section">
          <label>Deposit Amounts</label>
          <div className="token-inputs">
            <div className="token-input-row">
              <div className="token-info">
                <img src={getTokenLogo(pool.tokenA.symbol)} alt={pool.tokenA.symbol} />
                <span>{pool.tokenA.symbol}</span>
              </div>
              <div className="input-wrapper">
                <Input
                  type="number"
                  placeholder="0.00"
                  value={amountA}
                  onChange={(e) => setAmountA(e.target.value)}
                  className="amount-input"
                />
                <button
                  className="max-btn"
                  onClick={() => setAmountA(userBalances.a)}
                >
                  MAX
                </button>
              </div>
              <span className="balance-text">
                Balance: {isLoadingBalances ? '...' : userBalances.a}
              </span>
            </div>

            <div className="token-input-row">
              <div className="token-info">
                <img src={getTokenLogo(pool.tokenB.symbol)} alt={pool.tokenB.symbol} />
                <span>{pool.tokenB.symbol}</span>
              </div>
              <div className="input-wrapper">
                <Input
                  type="number"
                  placeholder="0.00"
                  value={amountB}
                  onChange={(e) => setAmountB(e.target.value)}
                  className="amount-input"
                />
                <button
                  className="max-btn"
                  onClick={() => setAmountB(userBalances.b)}
                >
                  MAX
                </button>
              </div>
              <span className="balance-text">
                Balance: {isLoadingBalances ? '...' : userBalances.b}
              </span>
            </div>
          </div>
        </div>

        {/* Strategy Selection */}
        <div className="form-section">
          <StrategySelector
            selectedId={selectedStrategy.id}
            onSelect={setSelectedStrategy}
            disabled={isPending}
          />
        </div>

        {/* ZAP Configuration */}
        <div className="form-section">
          <label>
            <Zap size={14} />
            ZAP (Capital Efficiency)
          </label>

          {/* ZAP Toggle */}
          <div className="zap-toggle-row">
            <div className="zap-toggle-info">
              <span className="zap-toggle-label">Enable ZAP</span>
              <span className="zap-toggle-desc">Swap excess tokens to use ALL liquidity</span>
            </div>
            <button
              onClick={() => setUseZap(!useZap)}
              className={`zap-toggle-switch ${useZap ? 'active' : ''}`}
            >
              <span className="zap-toggle-knob" />
            </button>
          </div>

          {/* ZAP Settings (always shown when ZAP is enabled) */}
          {useZap && (
            <div className="zap-pool-section">
              {/* Current Pool Fee Info */}
              <div className="zap-pool-detected">
                <div className="zap-pool-badge">
                  <Zap size={12} />
                  <span>Pool Fee: {getFeeLabel(pool.fee)}</span>
                </div>

                {/* Available fee tier pools */}
                {allPairPools.length > 1 && (
                  <div className="zap-fee-tiers">
                    <span className="zap-fee-tiers-label">Available pools for this pair:</span>
                    <div className="zap-fee-tiers-list">
                      {allPairPools.map((p) => (
                        <div key={p.id} className="zap-fee-tier-item">
                          <span className={`zap-fee-tier-badge ${p.id === pool.id ? 'current' : ''}`}>
                            {getFeeLabel(p.fee)}
                          </span>
                          {p.id === pool.id && (
                            <span className="zap-tier-tag current-tag">Current</span>
                          )}
                          {p.id === lowestFeePoolId && (
                            <span className="zap-tier-tag best-tag">Lowest</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Max ZAP Slippage */}
              <div className="zap-slippage-section">
                <div className="zap-slippage-header">
                  <span className="zap-slippage-title">Max ZAP Slippage</span>
                  <span className="zap-slippage-value">{(zapSlippageBps / 100).toFixed(2)}%</span>
                </div>

                <div className="zap-slippage-presets">
                  {ZAP_SLIPPAGE_PRESETS.map((preset) => (
                    <button
                      key={preset.bps}
                      onClick={() => {
                        setZapSlippageBps(preset.bps);
                        setShowCustomZapSlippage(false);
                      }}
                      className={`zap-slippage-btn ${zapSlippageBps === preset.bps && !showCustomZapSlippage ? 'active' : ''}`}
                    >
                      {preset.label}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setShowCustomZapSlippage(!showCustomZapSlippage);
                      setCustomZapSlippage((zapSlippageBps / 100).toString());
                    }}
                    className={`zap-slippage-btn ${showCustomZapSlippage ? 'active' : ''}`}
                  >
                    Custom
                  </button>
                </div>

                {/* Custom slippage input */}
                {showCustomZapSlippage && (
                  <div className="zap-custom-slippage-row">
                    <Input
                      type="number"
                      value={customZapSlippage}
                      onChange={(e) => setCustomZapSlippage(e.target.value)}
                      placeholder="e.g. 0.01"
                      step="0.01"
                      min="0.01"
                      className="zap-custom-input"
                    />
                    <span className="zap-custom-unit">%</span>
                    <button
                      onClick={applyCustomZapSlippage}
                      className="zap-custom-apply"
                    >
                      Apply
                    </button>
                  </div>
                )}
              </div>

              {/* Wait for good slippage toggle */}
              <div className="zap-wait-row">
                <div className="zap-wait-info">
                  <span className="zap-wait-label">Wait for good slippage</span>
                  <span className="zap-wait-desc">
                    {zapWaitForSlippage
                      ? 'Vault will wait and retry until slippage is within limit'
                      : 'Vault will skip ZAP if slippage exceeds limit'}
                  </span>
                </div>
                <button
                  onClick={() => setZapWaitForSlippage(!zapWaitForSlippage)}
                  className={`zap-toggle-switch ${zapWaitForSlippage ? 'active' : ''}`}
                >
                  <span className="zap-toggle-knob" />
                </button>
              </div>

              {/* Behavior explanation */}
              <div className={`zap-behavior-info ${zapWaitForSlippage ? 'wait-mode' : 'skip-mode'}`}>
                <AlertCircle size={12} />
                <span>
                  {zapWaitForSlippage
                    ? `If slippage > ${(zapSlippageBps / 100).toFixed(2)}%, vault will hold tokens and retry on next cycle until market conditions improve.`
                    : `If slippage > ${(zapSlippageBps / 100).toFixed(2)}%, vault will open position with only one side (no swap). Some capital may sit idle.`}
                </span>
              </div>

              <p className="hint-text">
                ZAP swaps excess tokens so both sides are fully utilized. Lower slippage = better entry but may wait longer.
              </p>
            </div>
          )}
        </div>

        {/* Price Range */}
        <div className="form-section">
          <label>
            <TrendingUp size={14} />
            Price Range
          </label>

          {/* Mode Toggle */}
          <div className="mode-toggle">
            <button
              onClick={() => handleRangeModeChange('percent')}
              className={`mode-btn ${rangeMode === 'percent' ? 'active' : ''}`}
            >
              By Percent
            </button>
            <button
              onClick={() => handleRangeModeChange('manual')}
              className={`mode-btn ${rangeMode === 'manual' ? 'active' : ''}`}
            >
              Manual Price
            </button>
          </div>

          {/* Percent Mode */}
          {rangeMode === 'percent' && (
            <>
              <Slider
                value={rangePercent}
                onValueChange={setRangePercent}
                min={0.1}
                max={50}
                step={0.1}
                className="range-slider"
              />
              <div className="slider-labels">
                <span>0.1% (Tight)</span>
                <span>±{rangePercent[0]}%</span>
                <span>50% (Wide)</span>
              </div>
            </>
          )}

          {/* Manual Price Mode */}
          {rangeMode === 'manual' && (
            <div className="price-inputs">
              <div className="price-input-row">
                <span className="price-label">Min Price</span>
                <Input
                  type="number"
                  value={minPrice}
                  onChange={(e) => handleMinPriceChange(e.target.value)}
                  onBlur={handleMinPriceBlur}
                  placeholder="0.00"
                  step="any"
                  className="price-input"
                />
                <span className="price-unit">{pool.tokenB.symbol}/{pool.tokenA.symbol}</span>
              </div>
              <div className="current-price-indicator">
                Current: {currentPrice.toPrecision(6)} {pool.tokenB.symbol}/{pool.tokenA.symbol}
              </div>
              <div className="price-input-row">
                <span className="price-label">Max Price</span>
                <Input
                  type="number"
                  value={maxPrice}
                  onChange={(e) => handleMaxPriceChange(e.target.value)}
                  onBlur={handleMaxPriceBlur}
                  placeholder="0.00"
                  step="any"
                  className="price-input"
                />
                <span className="price-unit">{pool.tokenB.symbol}/{pool.tokenA.symbol}</span>
              </div>
              <p className="price-hint">Prices will be rounded to valid tick values on blur</p>
            </div>
          )}

          <p className="hint-text">
            {rangeMode === 'percent'
              ? `Position range: ${currentPrice > 0 ? (currentPrice * (1 - rangePercent[0]/100)).toPrecision(4) : '?'} - ${currentPrice > 0 ? (currentPrice * (1 + rangePercent[0]/100)).toPrecision(4) : '?'}`
              : `Range: ${minPrice || '?'} - ${maxPrice || '?'} (${(getEffectiveRangeBps() / 100).toFixed(1)}% from current)`}
          </p>
        </div>

        {/* Timer Duration */}
        <div className="form-section">
          <label>
            <Timer size={14} />
            Cycle Duration
          </label>
          <div className="timer-input-row">
            <Input
              type="number"
              placeholder="e.g. 30"
              value={timerValue}
              onChange={(e) => handleTimerValueChange(e.target.value)}
              className="timer-input"
              min="1"
            />
            <div className="unit-buttons">
              {TIME_UNITS.map((unit) => (
                <button
                  key={unit.label}
                  onClick={() => handleTimerUnitChange(unit.label as 's' | 'm' | 'h')}
                  className={`unit-btn ${timerUnit === unit.label ? 'active' : ''}`}
                >
                  {unit.label}
                </button>
              ))}
            </div>
          </div>
          <p className="hint-text">
            Position will be closed and reopened every {formatDuration(timerSeconds)}
          </p>
        </div>

        {/* Duration Mode Selection */}
        <div className="form-section">
          <label>
            <Repeat size={14} />
            Run Duration
          </label>

          {/* Mode Toggle */}
          <div className="mode-toggle">
            <button
              onClick={() => setDurationMode('cycles')}
              className={`mode-btn ${durationMode === 'cycles' ? 'active' : ''}`}
            >
              By Cycles
            </button>
            <button
              onClick={() => setDurationMode('duration')}
              className={`mode-btn ${durationMode === 'duration' ? 'active' : ''}`}
            >
              By Time
            </button>
            <button
              onClick={handleInfiniteToggle}
              className={`mode-btn infinity ${isInfinite ? 'active' : ''}`}
            >
              <Infinity size={14} />
            </button>
          </div>

          {/* Cycles Input (shown when mode is 'cycles' and not infinite) */}
          {durationMode === 'cycles' && !isInfinite && (
            <div className="duration-input-row">
              <Input
                type="number"
                placeholder="e.g. 10"
                value={cyclesValue}
                onChange={(e) => handleCyclesChange(e.target.value)}
                className="duration-input"
                min="1"
              />
              <span className="input-suffix">cycles</span>
            </div>
          )}

          {/* Time Duration Input (shown when mode is 'duration' and not infinite) */}
          {durationMode === 'duration' && !isInfinite && (
            <div className="duration-input-row">
              <Input
                type="number"
                placeholder="e.g. 2"
                value={totalDurationValue}
                onChange={(e) => handleTotalDurationChange(e.target.value)}
                className="duration-input"
                min="1"
              />
              <div className="unit-buttons">
                {TIME_UNITS.map((unit) => (
                  <button
                    key={unit.label}
                    onClick={() => setTotalDurationUnit(unit.label as 's' | 'm' | 'h')}
                    className={`unit-btn ${totalDurationUnit === unit.label ? 'active' : ''}`}
                  >
                    {unit.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="hint-text">
            {isInfinite
              ? 'Vault will cycle indefinitely until you pause or withdraw'
              : durationMode === 'cycles'
                ? `Vault will complete ${maxCycles || 0} cycles then stop`
                : `Vault will run for ~${totalDurationValue || 0}${totalDurationUnit} (${calculateCyclesFromDuration()} cycles)`}
          </p>
        </div>

        {/* Summary */}
        <div className="summary-section">
          <h3>Summary</h3>
          <div className="summary-row">
            <span>Deposit</span>
            <span>
              {amountA || '0'} {pool.tokenA.symbol} + {amountB || '0'} {pool.tokenB.symbol}
            </span>
          </div>
          <div className="summary-row">
            <span>ZAP</span>
            <span className={useZap ? 'zap-enabled-text' : ''}>
              {useZap
                ? `Enabled (max ${(zapSlippageBps / 100).toFixed(2)}% slippage${zapWaitForSlippage ? ', wait mode' : ''})`
                : 'Disabled'}
            </span>
          </div>
          <div className="summary-row">
            <span>Price Range</span>
            <span>
              {rangeMode === 'manual'
                ? `${minPrice} - ${maxPrice}`
                : `±${rangePercent[0]}%`} ({(getEffectiveRangeBps() / 100).toFixed(1)}%)
            </span>
          </div>
          <div className="summary-row">
            <span>Cycle Duration</span>
            <span>{formatDuration(timerSeconds)}</span>
          </div>
          <div className="summary-row">
            <span>Total Cycles</span>
            <span>{getEffectiveMaxCycles() === 0 ? 'Infinite' : getEffectiveMaxCycles()}</span>
          </div>
        </div>

        {/* Warning */}
        {!isVaultDeployed() && (
          <div className="warning-banner">
            <AlertCircle size={16} />
            <span>Vault contract not yet deployed. Please deploy first.</span>
          </div>
        )}

        {/* Action Button */}
        <Button
          onClick={handleCreateVault}
          disabled={isPending || !isVaultDeployed() || !amountA || !amountB}
          className="create-btn"
        >
          {isPending ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Creating Vault...
            </>
          ) : (
            <>
              <Vault size={18} />
              Create Cycling Vault
            </>
          )}
        </Button>

        <style>{`
          .vault-modal {
            max-width: 480px;
            max-height: 90vh;
            overflow-y: auto;
          }

          .vault-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 99999;
            padding: 20px;
          }

          .modal-content {
            background: #12121a;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 24px;
            width: 100%;
          }

          .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
          }

          .header-left {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .header-left h2 {
            font-size: 18px;
            font-weight: 600;
            color: #E8E8EC;
          }

          .close-btn {
            background: none;
            border: none;
            color: #808090;
            cursor: pointer;
            padding: 4px;
          }

          .close-btn:hover {
            color: #E8E8EC;
          }

          .info-banner {
            display: flex;
            gap: 12px;
            padding: 12px;
            background: rgba(147, 51, 234, 0.1);
            border: 1px solid rgba(147, 51, 234, 0.2);
            border-radius: 8px;
            margin-bottom: 20px;
            color: #A855F7;
          }

          .form-section {
            margin-bottom: 20px;
          }

          .form-section label {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            color: #A0A0B0;
            margin-bottom: 8px;
          }

          .token-inputs {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .token-input-row {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 12px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 8px;
          }

          .token-info {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .token-info img {
            width: 24px;
            height: 24px;
            border-radius: 50%;
          }

          .token-info span {
            font-weight: 500;
            color: #E8E8EC;
          }

          .input-wrapper {
            display: flex;
            gap: 8px;
          }

          .amount-input {
            flex: 1;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
          }

          .max-btn {
            padding: 8px 12px;
            background: rgba(147, 51, 234, 0.2);
            border: 1px solid rgba(147, 51, 234, 0.3);
            border-radius: 6px;
            color: #A855F7;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
          }

          .max-btn:hover {
            background: rgba(147, 51, 234, 0.3);
          }

          .balance-text {
            font-size: 12px;
            color: #606070;
          }

          .range-slider {
            margin: 12px 0;
          }

          .slider-labels {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: #606070;
          }

          .price-inputs {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .price-input-row {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .price-label {
            width: 70px;
            font-size: 12px;
            color: #808090;
          }

          .price-input {
            flex: 1;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
          }

          .price-unit {
            font-size: 12px;
            color: #606070;
            white-space: nowrap;
          }

          .current-price-indicator {
            text-align: center;
            padding: 8px;
            background: rgba(147, 51, 234, 0.1);
            border-radius: 6px;
            font-size: 12px;
            color: #A855F7;
          }

          .price-hint {
            font-size: 11px;
            color: #606070;
            text-align: center;
            margin-top: 4px;
          }

          .preset-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
          }

          .preset-btn {
            padding: 8px 14px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            color: #A0A0B0;
            font-size: 13px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: all 0.2s;
          }

          .preset-btn:hover {
            border-color: rgba(147, 51, 234, 0.5);
            color: #E8E8EC;
          }

          .preset-btn.active {
            background: rgba(147, 51, 234, 0.2);
            border-color: rgba(147, 51, 234, 0.5);
            color: #A855F7;
          }

          .timer-input-row {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .timer-input {
            flex: 1;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
          }

          .unit-buttons {
            display: flex;
            gap: 4px;
          }

          .unit-btn {
            padding: 8px 14px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            color: #808090;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
          }

          .unit-btn:hover {
            background: rgba(255, 255, 255, 0.08);
          }

          .unit-btn.active {
            background: rgba(147, 51, 234, 0.2);
            border-color: rgba(147, 51, 234, 0.5);
            color: #A855F7;
          }

          .mode-toggle {
            display: flex;
            gap: 6px;
            margin-bottom: 12px;
          }

          .mode-btn {
            flex: 1;
            padding: 10px 14px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            color: #808090;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
          }

          .mode-btn:hover {
            background: rgba(255, 255, 255, 0.06);
            color: #E8E8EC;
          }

          .mode-btn.active {
            background: rgba(147, 51, 234, 0.2);
            border-color: rgba(147, 51, 234, 0.5);
            color: #A855F7;
          }

          .mode-btn.infinity {
            flex: 0;
            padding: 10px 14px;
          }

          .duration-input-row {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .duration-input {
            flex: 1;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
          }

          .input-suffix {
            color: #808090;
            font-size: 13px;
          }

          .cycles-row {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .cycles-input {
            flex: 1;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
          }

          .cycles-input:disabled {
            opacity: 0.4;
          }

          .infinity-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 10px 16px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            color: #A0A0B0;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s;
          }

          .infinity-btn:hover {
            border-color: rgba(147, 51, 234, 0.5);
            color: #E8E8EC;
          }

          .infinity-btn.active {
            background: rgba(147, 51, 234, 0.2);
            border-color: rgba(147, 51, 234, 0.5);
            color: #A855F7;
          }

          .hint-text {
            margin-top: 8px;
            font-size: 12px;
            color: #606070;
          }

          .summary-section {
            padding: 16px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 8px;
            margin-bottom: 20px;
          }

          .summary-section h3 {
            font-size: 14px;
            font-weight: 600;
            color: #E8E8EC;
            margin-bottom: 12px;
          }

          .summary-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          }

          .summary-row:last-child {
            border-bottom: none;
          }

          .summary-row span:first-child {
            color: #808090;
            font-size: 13px;
          }

          .summary-row span:last-child {
            color: #E8E8EC;
            font-size: 13px;
            font-weight: 500;
          }

          .warning-banner {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px;
            background: rgba(255, 165, 0, 0.1);
            border: 1px solid rgba(255, 165, 0, 0.2);
            border-radius: 8px;
            color: #FFA500;
            font-size: 13px;
            margin-bottom: 20px;
          }

          .create-btn {
            width: 100%;
            height: 48px;
            background: linear-gradient(135deg, #9333EA, #7C3AED);
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
          }

          .create-btn:hover:not(:disabled) {
            opacity: 0.9;
          }

          .create-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .vault-modal-embedded {
            padding: 20px;
            overflow-y: auto;
            max-height: calc(90vh - 60px);
          }

          .vault-modal-embedded .form-section {
            margin-bottom: 16px;
          }

          /* ZAP Styles */
          .zap-toggle-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 8px;
            margin-bottom: 12px;
          }

          .zap-toggle-info {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }

          .zap-toggle-label {
            font-size: 13px;
            font-weight: 500;
            color: #E8E8EC;
          }

          .zap-toggle-desc {
            font-size: 11px;
            color: #606070;
          }

          .zap-toggle-switch {
            position: relative;
            width: 44px;
            height: 24px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.3s;
            flex-shrink: 0;
          }

          .zap-toggle-switch.active {
            background: rgba(250, 204, 21, 0.3);
            border-color: rgba(250, 204, 21, 0.5);
          }

          .zap-toggle-knob {
            position: absolute;
            top: 2px;
            left: 2px;
            width: 18px;
            height: 18px;
            background: #808090;
            border-radius: 50%;
            transition: all 0.3s;
          }

          .zap-toggle-switch.active .zap-toggle-knob {
            left: 22px;
            background: #FACC15;
          }

          .zap-pool-section {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .zap-pool-detected {
            padding: 10px 12px;
            background: rgba(250, 204, 21, 0.06);
            border: 1px solid rgba(250, 204, 21, 0.15);
            border-radius: 8px;
          }

          .zap-pool-badge {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            color: #FACC15;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 6px;
          }

          .zap-fee-tiers {
            margin-top: 8px;
          }

          .zap-fee-tiers-label {
            font-size: 11px;
            color: #808090;
            display: block;
            margin-bottom: 6px;
          }

          .zap-fee-tiers-list {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
          }

          .zap-fee-tier-item {
            display: flex;
            align-items: center;
            gap: 4px;
          }

          .zap-fee-tier-badge {
            padding: 3px 8px;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            color: #A0A0B0;
          }

          .zap-fee-tier-badge.current {
            background: rgba(250, 204, 21, 0.1);
            border-color: rgba(250, 204, 21, 0.3);
            color: #FACC15;
          }

          .zap-tier-tag {
            font-size: 9px;
            padding: 1px 4px;
            border-radius: 3px;
            font-weight: 600;
          }

          .zap-tier-tag.current-tag {
            background: rgba(147, 51, 234, 0.15);
            color: #A855F7;
          }

          .zap-tier-tag.best-tag {
            background: rgba(34, 197, 94, 0.15);
            color: #22C55E;
          }

          /* ZAP Slippage */
          .zap-slippage-section {
            padding: 12px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 8px;
          }

          .zap-slippage-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
          }

          .zap-slippage-title {
            font-size: 12px;
            color: #A0A0B0;
            font-weight: 500;
          }

          .zap-slippage-value {
            font-size: 13px;
            font-weight: 700;
            color: #FACC15;
            font-family: monospace;
          }

          .zap-slippage-presets {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
          }

          .zap-slippage-btn {
            padding: 6px 12px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            color: #808090;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
          }

          .zap-slippage-btn:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #E8E8EC;
          }

          .zap-slippage-btn.active {
            background: rgba(250, 204, 21, 0.15);
            border-color: rgba(250, 204, 21, 0.4);
            color: #FACC15;
          }

          .zap-custom-slippage-row {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 8px;
          }

          .zap-custom-input {
            width: 80px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
            font-size: 12px;
          }

          .zap-custom-unit {
            font-size: 12px;
            color: #808090;
          }

          .zap-custom-apply {
            padding: 6px 12px;
            background: rgba(250, 204, 21, 0.15);
            border: 1px solid rgba(250, 204, 21, 0.3);
            border-radius: 6px;
            color: #FACC15;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
          }

          .zap-custom-apply:hover {
            background: rgba(250, 204, 21, 0.25);
          }

          /* ZAP Wait for slippage */
          .zap-wait-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 8px;
          }

          .zap-wait-info {
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex: 1;
            margin-right: 12px;
          }

          .zap-wait-label {
            font-size: 12px;
            font-weight: 500;
            color: #E8E8EC;
          }

          .zap-wait-desc {
            font-size: 11px;
            color: #606070;
          }

          .zap-behavior-info {
            display: flex;
            align-items: flex-start;
            gap: 6px;
            padding: 8px 10px;
            border-radius: 6px;
            font-size: 11px;
            line-height: 1.4;
          }

          .zap-behavior-info.wait-mode {
            background: rgba(250, 204, 21, 0.06);
            border: 1px solid rgba(250, 204, 21, 0.12);
            color: rgba(250, 204, 21, 0.8);
          }

          .zap-behavior-info.skip-mode {
            background: rgba(255, 165, 0, 0.06);
            border: 1px solid rgba(255, 165, 0, 0.12);
            color: rgba(255, 165, 0, 0.8);
          }

          .zap-enabled-text {
            color: #FACC15 !important;
          }
        `}</style>
    </>
  );

  // When embedded, render content directly without portal and overlay
  if (embedded) {
    return <div className="vault-modal-embedded">{innerContent}</div>;
  }

  const modalContent = (
    <div className="vault-modal-overlay" onClick={onClose}>
      <div className="modal-content vault-modal" onClick={(e) => e.stopPropagation()}>
        {innerContent}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
  return `${Math.floor(seconds / 86400)} days`;
}
