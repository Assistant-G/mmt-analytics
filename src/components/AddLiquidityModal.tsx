import { useState, useMemo, useCallback } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { toast } from 'sonner';
import { Loader2, AlertCircle, Info, Timer, Settings, Key, Eye, EyeOff, Check, FileSignature, Cloud } from 'lucide-react';
import BN from 'bn.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { getSDK } from '@/services/mmtService';
import { buildCreateEscrowTransaction, isEscrowAvailable } from '@/services/escrowService';
import { useWallet } from '@/contexts/WalletContext';
import { useAutoClose } from '@/contexts/AutoCloseContext';
import { formatCurrency, getTokenLogo } from '@/utils';
import type { Pool, TimerDuration, TimerUnit } from '@/types';
import { TIMER_PRESETS, TIMER_UNITS } from '@/types';

interface AddLiquidityModalProps {
  pool: Pool;
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean; // When true, don't render modal overlay (used inside combined modal)
}

// Constants for tick math (matching SDK)
const MIN_TICK = -443636;
const MAX_TICK = 443636;

// Convert unsigned 32-bit tick to signed tick
// The blockchain stores ticks as u32, but they can be negative
function toSignedTick(tick: number): number {
  // If tick is greater than 2^31, it's a negative number stored as unsigned
  const MAX_I32 = 2147483647; // 2^31 - 1
  const OVERFLOW = 4294967296; // 2^32

  if (tick > MAX_I32) {
    return tick - OVERFLOW;
  }
  return tick;
}

// Align tick to tick spacing (round toward zero for consistency)
function alignTickToSpacing(tick: number, tickSpacing: number): number {
  // Round toward zero to ensure consistent alignment
  const sign = tick >= 0 ? 1 : -1;
  const absTick = Math.abs(tick);
  const aligned = Math.floor(absTick / tickSpacing) * tickSpacing * sign;
  return aligned;
}

// Calculate tick from price percentage (proper CLMM math)
// In CLMM, ~100 ticks ≈ 1% price change
function calculateTickFromPercent(
  currentTick: number,
  percent: number,
  tickSpacing: number
): number {
  // Calculate tick offset: ~100 ticks per 1% price change
  // More precisely: ticks = log(1 + percent/100) / log(1.0001)
  const priceMultiplier = 1 + percent / 100;
  const tickOffset = Math.round(Math.log(priceMultiplier) / Math.log(1.0001));

  const rawTick = currentTick + tickOffset;

  // Clamp to valid range
  const clampedTick = Math.max(MIN_TICK, Math.min(MAX_TICK, rawTick));

  // Align to tick spacing
  const alignedTick = alignTickToSpacing(clampedTick, tickSpacing);

  return alignedTick;
}

// Use SDK's proper tick to sqrt price calculation
// This replicates the SDK's tickIndexToSqrtPriceX64 logic
function tickIndexToSqrtPriceX64(tickIndex: number): BN {
  if (tickIndex > 0) {
    return tickIndexToSqrtPricePositive(tickIndex);
  }
  return tickIndexToSqrtPriceNegative(tickIndex);
}

function signedShiftRight(n0: BN, shiftBy: number, bitWidth: number): BN {
  const twoN0 = n0.toTwos(bitWidth).shrn(shiftBy);
  twoN0.imaskn(bitWidth - shiftBy + 1);
  return twoN0.fromTwos(bitWidth - shiftBy);
}

function tickIndexToSqrtPricePositive(tick: number): BN {
  let ratio: BN;
  if ((tick & 1) !== 0) {
    ratio = new BN('79232123823359799118286999567');
  } else {
    ratio = new BN('79228162514264337593543950336');
  }
  if ((tick & 2) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('79236085330515764027303304731')), 96, 256);
  }
  if ((tick & 4) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('79244008939048815603706035061')), 96, 256);
  }
  if ((tick & 8) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('79259858533276714757314932305')), 96, 256);
  }
  if ((tick & 16) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('79291567232598584799939703904')), 96, 256);
  }
  if ((tick & 32) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('79355022692464371645785046466')), 96, 256);
  }
  if ((tick & 64) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('79482085999252804386437311141')), 96, 256);
  }
  if ((tick & 128) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('79736823300114093921829183326')), 96, 256);
  }
  if ((tick & 256) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('80248749790819932309965073892')), 96, 256);
  }
  if ((tick & 512) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('81282483887344747381513967011')), 96, 256);
  }
  if ((tick & 1024) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('83390072131320151908154831281')), 96, 256);
  }
  if ((tick & 2048) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('87770609709833776024991924138')), 96, 256);
  }
  if ((tick & 4096) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('97234110755111693312479820773')), 96, 256);
  }
  if ((tick & 8192) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('119332217159966728226237229890')), 96, 256);
  }
  if ((tick & 16384) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('179736315981702064433883588727')), 96, 256);
  }
  if ((tick & 32768) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('407748233172238350107850275304')), 96, 256);
  }
  if ((tick & 65536) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('2098478828474011932436660412517')), 96, 256);
  }
  if ((tick & 131072) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('55581415166113811149459800483533')), 96, 256);
  }
  if ((tick & 262144) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('38992368544603139932233054999993551')), 96, 256);
  }
  return signedShiftRight(ratio, 32, 256);
}

function tickIndexToSqrtPriceNegative(tickIndex: number): BN {
  const tick = Math.abs(tickIndex);
  let ratio: BN;
  if ((tick & 1) !== 0) {
    ratio = new BN('18445821805675392311');
  } else {
    ratio = new BN('18446744073709551616');
  }
  if ((tick & 2) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('18444899583751176498')), 64, 256);
  }
  if ((tick & 4) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('18443055278223354162')), 64, 256);
  }
  if ((tick & 8) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('18439367220385604838')), 64, 256);
  }
  if ((tick & 16) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('18431993317065449817')), 64, 256);
  }
  if ((tick & 32) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('18417254355718160513')), 64, 256);
  }
  if ((tick & 64) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('18387811781193591352')), 64, 256);
  }
  if ((tick & 128) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('18329067761203520168')), 64, 256);
  }
  if ((tick & 256) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('18212142134806087854')), 64, 256);
  }
  if ((tick & 512) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('17980523815641551639')), 64, 256);
  }
  if ((tick & 1024) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('17526086738831147013')), 64, 256);
  }
  if ((tick & 2048) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('16651378430235024244')), 64, 256);
  }
  if ((tick & 4096) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('15030750278693429944')), 64, 256);
  }
  if ((tick & 8192) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('12247334978882834399')), 64, 256);
  }
  if ((tick & 16384) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('8131365268884726200')), 64, 256);
  }
  if ((tick & 32768) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('3584323654723342297')), 64, 256);
  }
  if ((tick & 65536) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('696457651847595233')), 64, 256);
  }
  if ((tick & 131072) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('26294789957452057')), 64, 256);
  }
  if ((tick & 262144) !== 0) {
    ratio = signedShiftRight(ratio.mul(new BN('37481735321082')), 64, 256);
  }
  return ratio;
}

export function AddLiquidityModal({ pool, isOpen, onClose, embedded = false }: AddLiquidityModalProps) {
  const { address, isConnected, connect } = useWallet();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecuteTransaction, isPending } = useSignAndExecuteTransaction();
  const { addPosition, settings, updateSettings, isPrivateKeyValid, requestPreSign } = useAutoClose();

  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [rangePercent, setRangePercent] = useState([10]); // Default 10% range
  const [rangeMode, setRangeMode] = useState<'percent' | 'manual'>('percent');
  const [minPriceInput, setMinPriceInput] = useState('');
  const [maxPriceInput, setMaxPriceInput] = useState('');
  const [slippage, setSlippage] = useState(0.5); // 0.5% default slippage
  const [timerDuration, setTimerDuration] = useState<TimerDuration>(null); // No timer by default
  const [showCustomTimer, setShowCustomTimer] = useState(false);
  const [customTimerValue, setCustomTimerValue] = useState('');
  const [customTimerUnit, setCustomTimerUnit] = useState<TimerUnit>('min');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [privateKeyInput, setPrivateKeyInput] = useState(settings.privateKey || '');

  // Format duration for display
  const formatTimerDisplay = (seconds: number): string => {
    if (seconds >= 86400) {
      const days = seconds / 86400;
      return days === 1 ? '1 day' : `${days} days`;
    } else if (seconds >= 3600) {
      const hours = seconds / 3600;
      return hours === 1 ? '1 hour' : `${hours} hours`;
    } else if (seconds >= 60) {
      const mins = seconds / 60;
      return mins === 1 ? '1 min' : `${mins} min`;
    }
    return seconds === 1 ? '1 sec' : `${seconds} sec`;
  };

  // Handle preset selection
  const handlePresetSelect = (seconds: number | null) => {
    if (seconds === -1) {
      // Custom mode
      setShowCustomTimer(true);
      setCustomTimerValue('');
      setTimerDuration(null);
    } else {
      setShowCustomTimer(false);
      setTimerDuration(seconds);
    }
  };

  // Apply custom timer
  const applyCustomTimer = () => {
    const value = parseFloat(customTimerValue);
    if (isNaN(value) || value <= 0) {
      toast.error('Please enter a valid timer value');
      return;
    }
    const unit = TIMER_UNITS.find(u => u.value === customTimerUnit);
    if (unit) {
      const totalSeconds = Math.round(value * unit.multiplier);
      setTimerDuration(totalSeconds);
    }
  };

  // Get current price
  const currentPrice = useMemo(() => {
    return pool.priceTokenB > 0 ? pool.priceTokenB : 1;
  }, [pool.priceTokenB]);

  // Round price to nearest valid tick
  const roundPriceToTick = (price: number): number => {
    if (price <= 0) return 0;
    const tickSpacing = pool.tickSpacing || 1;
    const tickRaw = Math.log(price) / Math.log(1.0001);
    const alignedTick = Math.round(tickRaw / tickSpacing) * tickSpacing;
    return Math.pow(1.0001, alignedTick);
  };

  // Handle switching to manual mode
  const handleRangeModeChange = (mode: 'percent' | 'manual') => {
    setRangeMode(mode);
    if (mode === 'manual' && currentPrice > 0) {
      const percent = rangePercent[0] / 100;
      const minP = roundPriceToTick(currentPrice * (1 - percent));
      const maxP = roundPriceToTick(currentPrice * (1 + percent));
      setMinPriceInput(minP.toPrecision(6));
      setMaxPriceInput(maxP.toPrecision(6));
    }
  };

  // Handle price input blur - round to valid tick
  const handleMinPriceBlur = () => {
    if (minPriceInput && currentPrice > 0) {
      const rounded = roundPriceToTick(parseFloat(minPriceInput));
      if (rounded > 0) {
        setMinPriceInput(rounded.toPrecision(6));
      }
    }
  };

  const handleMaxPriceBlur = () => {
    if (maxPriceInput && currentPrice > 0) {
      const rounded = roundPriceToTick(parseFloat(maxPriceInput));
      if (rounded > 0) {
        setMaxPriceInput(rounded.toPrecision(6));
      }
    }
  };

  // Calculate tick from price
  const calculateTickFromPrice = (price: number, tickSpacing: number): number => {
    // tick = log(price) / log(1.0001)
    const tickRaw = Math.log(price) / Math.log(1.0001);
    const alignedTick = alignTickToSpacing(Math.round(tickRaw), tickSpacing);
    return Math.max(MIN_TICK, Math.min(MAX_TICK, alignedTick));
  };

  // Calculate price range based on mode
  const priceRange = useMemo(() => {
    const signedCurrentTick = toSignedTick(pool.currentTick);

    if (rangeMode === 'manual' && minPriceInput && maxPriceInput) {
      const minPrice = parseFloat(minPriceInput);
      const maxPrice = parseFloat(maxPriceInput);

      if (minPrice > 0 && maxPrice > 0 && minPrice < maxPrice) {
        const lowerTick = calculateTickFromPrice(minPrice, pool.tickSpacing);
        const upperTick = calculateTickFromPrice(maxPrice, pool.tickSpacing);

        return {
          lowerPrice: minPrice,
          upperPrice: maxPrice,
          lowerTick,
          upperTick,
          signedCurrentTick,
        };
      }
    }

    // Default: percentage mode
    const percent = rangePercent[0] / 100;
    const lowerPrice = currentPrice * (1 - percent);
    const upperPrice = currentPrice * (1 + percent);

    const lowerTick = calculateTickFromPercent(
      signedCurrentTick,
      -rangePercent[0],
      pool.tickSpacing
    );
    const upperTick = calculateTickFromPercent(
      signedCurrentTick,
      rangePercent[0],
      pool.tickSpacing
    );

    return {
      lowerPrice,
      upperPrice,
      lowerTick,
      upperTick,
      signedCurrentTick,
    };
  }, [pool.currentTick, pool.tickSpacing, rangePercent, rangeMode, minPriceInput, maxPriceInput, currentPrice]);

  // Calculate estimated amounts based on ratio
  const updateAmountB = useCallback((valueA: string) => {
    if (!valueA || parseFloat(valueA) <= 0) {
      setAmountB('');
      return;
    }
    // Simplified ratio calculation based on price
    const ratio = pool.priceTokenB > 0 ? pool.priceTokenB : 1;
    const calculatedB = parseFloat(valueA) * ratio;
    setAmountB(calculatedB.toFixed(6));
  }, [pool.priceTokenB]);

  const updateAmountA = useCallback((valueB: string) => {
    if (!valueB || parseFloat(valueB) <= 0) {
      setAmountA('');
      return;
    }
    const ratio = pool.priceTokenB > 0 ? pool.priceTokenB : 1;
    const calculatedA = parseFloat(valueB) / ratio;
    setAmountA(calculatedA.toFixed(6));
  }, [pool.priceTokenB]);

  const handleAddLiquidity = async () => {
    if (!address || !isConnected) {
      toast.error('Please connect your wallet first');
      return;
    }

    const amountANum = parseFloat(amountA);
    const amountBNum = parseFloat(amountB);

    if (!amountANum || !amountBNum || amountANum <= 0 || amountBNum <= 0) {
      toast.error('Please enter valid amounts');
      return;
    }

    setIsSubmitting(true);

    try {
      const sdk = getSDK();
      const txb = new Transaction();

      // Convert amounts to base units
      const amountABase = BigInt(Math.floor(amountANum * Math.pow(10, pool.tokenA.decimals)));
      const amountBBase = BigInt(Math.floor(amountBNum * Math.pow(10, pool.tokenB.decimals)));

      // Validate tick range
      console.log('Tick range debug:', {
        rawCurrentTick: pool.currentTick,
        signedCurrentTick: priceRange.signedCurrentTick,
        tickSpacing: pool.tickSpacing,
        lowerTick: priceRange.lowerTick,
        upperTick: priceRange.upperTick,
        rangePercent: rangePercent[0],
      });

      // Ensure lower tick < upper tick
      if (priceRange.lowerTick >= priceRange.upperTick) {
        throw new Error(`Invalid tick range: lower (${priceRange.lowerTick}) must be less than upper (${priceRange.upperTick})`);
      }

      // Ensure ticks are aligned to tick spacing
      if (priceRange.lowerTick % pool.tickSpacing !== 0) {
        throw new Error(`Lower tick ${priceRange.lowerTick} is not aligned to tick spacing ${pool.tickSpacing}`);
      }
      if (priceRange.upperTick % pool.tickSpacing !== 0) {
        throw new Error(`Upper tick ${priceRange.upperTick} is not aligned to tick spacing ${pool.tickSpacing}`);
      }

      // Calculate sqrt prices for tick range using SDK-compatible math
      const lowerSqrtPrice = tickIndexToSqrtPriceX64(priceRange.lowerTick);
      const upperSqrtPrice = tickIndexToSqrtPriceX64(priceRange.upperTick);

      console.log('Sqrt prices:', {
        lowerSqrtPrice: lowerSqrtPrice.toString(),
        upperSqrtPrice: upperSqrtPrice.toString(),
      });

      // Pool params for SDK
      const poolParams = {
        objectId: pool.address,
        tokenXType: pool.tokenA.address,
        tokenYType: pool.tokenB.address,
        tickSpacing: pool.tickSpacing,
      };

      // Step 1: Open a new position
      // IMPORTANT: Do NOT pass address here - it causes immediate transfer and returns undefined
      const position = sdk.Position.openPosition(
        txb,
        poolParams,
        lowerSqrtPrice.toString(),
        upperSqrtPrice.toString()
      );

      // Validate position was created
      if (!position) {
        throw new Error('Failed to create position object');
      }

      // Step 2: Get coins for liquidity
      // For SUI (native token), we use splitCoins
      // For other tokens, we need to fetch and use existing coins

      let coinX: ReturnType<typeof txb.splitCoins>[0];
      let coinY: ReturnType<typeof txb.splitCoins>[0];

      // Check if token is SUI
      const isSuiA = pool.tokenA.address.includes('::sui::SUI');
      const isSuiB = pool.tokenB.address.includes('::sui::SUI');

      if (isSuiA) {
        // Split SUI from gas
        [coinX] = txb.splitCoins(txb.gas, [amountABase]);
      } else {
        // Fetch user's coins of this type
        const coinsA = await suiClient.getCoins({
          owner: address,
          coinType: pool.tokenA.address,
        });

        if (!coinsA.data.length) {
          throw new Error(`No ${pool.tokenA.symbol} tokens found in wallet`);
        }

        // Merge coins if needed and split the required amount
        const coinIds = coinsA.data.map(c => c.coinObjectId);
        if (coinIds.length > 1) {
          const [primaryCoinId, ...otherCoinIds] = coinIds;
          const primaryCoinRef = txb.object(primaryCoinId);
          const otherCoinRefs = otherCoinIds.map(id => txb.object(id));
          txb.mergeCoins(primaryCoinRef, otherCoinRefs);
          [coinX] = txb.splitCoins(primaryCoinRef, [amountABase]);
        } else {
          [coinX] = txb.splitCoins(txb.object(coinIds[0]), [amountABase]);
        }
      }

      if (isSuiB) {
        // Split SUI from gas
        [coinY] = txb.splitCoins(txb.gas, [amountBBase]);
      } else {
        // Fetch user's coins of this type
        const coinsB = await suiClient.getCoins({
          owner: address,
          coinType: pool.tokenB.address,
        });

        if (!coinsB.data.length) {
          throw new Error(`No ${pool.tokenB.symbol} tokens found in wallet`);
        }

        // Merge coins if needed and split the required amount
        const coinIds = coinsB.data.map(c => c.coinObjectId);
        if (coinIds.length > 1) {
          const [primaryCoinId, ...otherCoinIds] = coinIds;
          const primaryCoinRef = txb.object(primaryCoinId);
          const otherCoinRefs = otherCoinIds.map(id => txb.object(id));
          txb.mergeCoins(primaryCoinRef, otherCoinRefs);
          [coinY] = txb.splitCoins(primaryCoinRef, [amountBBase]);
        } else {
          [coinY] = txb.splitCoins(txb.object(coinIds[0]), [amountBBase]);
        }
      }

      // Step 3: Add liquidity to the position
      // Use BigInt(0) for min amounts as per SDK example - slippage protection handled by wallet
      sdk.Pool.addLiquidity(
        txb,
        poolParams,
        position,
        coinX,
        coinY,
        BigInt(0),
        BigInt(0),
        address
      );

      // Step 4: Transfer the position to the user's wallet
      txb.transferObjects([position], txb.pure.address(address));

      // Execute the transaction with options to get effects
      const result = await signAndExecuteTransaction({
        transaction: txb,
      });

      console.log('Transaction result:', result);

      // If timer is set, try to find the position ID
      if (timerDuration) {
        let positionId: string | null = null;

        // Try to get position ID from transaction effects
        if (result.effects && typeof result.effects === 'object' && 'created' in result.effects) {
          const effects = result.effects as { created?: Array<{ owner: unknown; reference: { objectId: string } | string }> };
          const createdObjects = effects.created;
          if (createdObjects) {
            const positionObject = createdObjects.find((obj: { owner: unknown }) => {
              return obj.owner && typeof obj.owner === 'object' && 'AddressOwner' in obj.owner;
            });

            if (positionObject) {
              const positionRef = positionObject.reference;
              positionId = typeof positionRef === 'object' && 'objectId' in positionRef
                ? positionRef.objectId
                : String(positionRef);
            }
          }
        }

        // If we couldn't get position ID from effects, try to query it
        if (!positionId) {
          try {
            // Wait a moment for the transaction to be indexed
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Query transaction to get created objects
            const txDetails = await suiClient.getTransactionBlock({
              digest: result.digest,
              options: { showEffects: true, showObjectChanges: true }
            });

            console.log('Transaction details:', txDetails);

            // Find position from object changes
            if (txDetails.objectChanges) {
              const createdPosition = txDetails.objectChanges.find(
                (change) => change.type === 'created' &&
                  'objectType' in change &&
                  change.objectType?.includes('Position')
              );
              if (createdPosition && 'objectId' in createdPosition) {
                positionId = createdPosition.objectId;
              }
            }
          } catch (err) {
            console.error('Failed to query transaction:', err);
          }
        }

        if (positionId) {
          console.log('Registering position for auto-close:', positionId);
          const liquidityEstimate = String(amountABase + amountBBase);

          let preSignedTx = undefined;
          let escrowId = undefined;
          let isInEscrow = false;

          // Handle escrow method
          if (settings.method === 'escrow') {
            if (!isEscrowAvailable()) {
              toast.error('Escrow contracts not available. Please select another method.');
            } else {
              try {
                const expiresAt = Date.now() + (timerDuration! * 1000);
                const escrowTx = buildCreateEscrowTransaction({
                  positionId,
                  poolId: pool.address,
                  expiresAt,
                  autoReopen: settings.repeatCount !== 0,
                  reopenRangePercent: rangePercent[0] * 100, // Convert to basis points
                  remainingRepeats: typeof settings.repeatCount === 'number' ? settings.repeatCount : 1000000,
                });

                toast.info('Please approve the escrow deposit transaction...');
                const escrowResult = await signAndExecuteTransaction({
                  transaction: escrowTx,
                });

                // Query the transaction to get created objects
                const escrowTxDetails = await suiClient.getTransactionBlock({
                  digest: escrowResult.digest,
                  options: { showEffects: true, showObjectChanges: true }
                });

                if (escrowTxDetails.effects?.status?.status === 'success') {
                  // Find the created escrow object from objectChanges
                  const escrowObj = escrowTxDetails.objectChanges?.find(
                    (change) =>
                      change.type === 'created' &&
                      'objectType' in change &&
                      (change as { objectType?: string }).objectType?.includes('SimpleEscrow')
                  );

                  if (escrowObj && 'objectId' in escrowObj) {
                    escrowId = escrowObj.objectId;
                    isInEscrow = true;
                    toast.success('Position deposited to escrow! It will close automatically.');
                  }
                } else {
                  toast.error('Escrow deposit failed. Please try again.');
                }
              } catch (err) {
                console.error('Escrow deposit error:', err);
                toast.error('Escrow deposit failed. Please try again.');
              }
            }
          }

          // If preSigned method is selected, request pre-signature
          if (settings.method === 'preSigned') {
            preSignedTx = await requestPreSign(positionId, pool.address, address);
            if (!preSignedTx) {
              toast.warning('Pre-sign cancelled. Please use escrow method for automatic closing.');
            }
          }

          // Store position params for repeat functionality
          const positionParams = {
            poolId: pool.address,
            amountA,
            amountB,
            rangePercent: rangePercent[0],
            slippage,
            decimalsA: pool.tokenA.decimals,
            decimalsB: pool.tokenB.decimals,
            tickSpacing: pool.tickSpacing,
          };

          addPosition({
            positionId,
            poolId: pool.address,
            liquidity: liquidityEstimate,
            walletAddress: address,
            timerDuration,
            preSignedTx: preSignedTx || undefined,
            positionParams,
            remainingRepeats: settings.repeatCount,
            escrowId,
            isInEscrow,
          });
        } else {
          console.warn('Could not find position ID for auto-close timer');
          toast.warning('Timer set but position tracking may not work. Please check your positions manually.');
        }
      }

      toast.success(
        <div>
          <p>Liquidity added successfully!</p>
          {timerDuration && (
            <p className="text-xs text-yellow-400 mt-1">
              Position will auto-close in {timerDuration >= 60 ? `${timerDuration / 60} min` : `${timerDuration} sec`}
            </p>
          )}
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
      setAmountA('');
      setAmountB('');
      setTimerDuration(null);
    } catch (error) {
      console.error('Add liquidity error:', error);
      const message = error instanceof Error ? error.message : 'Failed to add liquidity';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const estimatedValue = useMemo(() => {
    const aValue = parseFloat(amountA || '0') * (pool.priceTokenA || 0);
    const bValue = parseFloat(amountB || '0') * (pool.priceTokenB || 0);
    return aValue + bValue;
  }, [amountA, amountB, pool.priceTokenA, pool.priceTokenB]);

  const modalContent = (
    <>
      {!embedded && (
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-xl">
            <div className="flex">
              <img
                src={getTokenLogo(pool.tokenA.symbol)}
                alt={pool.tokenA.symbol}
                className="w-8 h-8 rounded-full border-2 border-[#1a1a2e]"
              />
              <img
                src={getTokenLogo(pool.tokenB.symbol)}
                alt={pool.tokenB.symbol}
                className="w-8 h-8 rounded-full border-2 border-[#1a1a2e] -ml-3"
              />
            </div>
            Add Liquidity to {pool.tokenA.symbol}/{pool.tokenB.symbol}
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Provide liquidity to earn {pool.apr.toFixed(1)}% APR
          </DialogDescription>
        </DialogHeader>
      )}

        <div className="space-y-6 mt-4">
          {/* Token A Input */}
          <div className="space-y-2">
            <Label className="text-gray-400">{pool.tokenA.symbol} Amount</Label>
            <div className="relative">
              <Input
                type="number"
                placeholder="0.0"
                value={amountA}
                onChange={(e) => {
                  setAmountA(e.target.value);
                  updateAmountB(e.target.value);
                }}
                className="bg-[#12121a] border-[#1a1a2e] text-white pr-20 h-12 text-lg"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <img
                  src={getTokenLogo(pool.tokenA.symbol)}
                  alt={pool.tokenA.symbol}
                  className="w-5 h-5 rounded-full"
                />
                <span className="text-gray-400 text-sm">{pool.tokenA.symbol}</span>
              </div>
            </div>
          </div>

          {/* Token B Input */}
          <div className="space-y-2">
            <Label className="text-gray-400">{pool.tokenB.symbol} Amount</Label>
            <div className="relative">
              <Input
                type="number"
                placeholder="0.0"
                value={amountB}
                onChange={(e) => {
                  setAmountB(e.target.value);
                  updateAmountA(e.target.value);
                }}
                className="bg-[#12121a] border-[#1a1a2e] text-white pr-20 h-12 text-lg"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <img
                  src={getTokenLogo(pool.tokenB.symbol)}
                  alt={pool.tokenB.symbol}
                  className="w-5 h-5 rounded-full"
                />
                <span className="text-gray-400 text-sm">{pool.tokenB.symbol}</span>
              </div>
            </div>
          </div>

          {/* Price Range */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label className="text-gray-400">Price Range</Label>
              <span className="text-sm text-cyan-400">
                {rangeMode === 'percent' ? `+/- ${rangePercent[0]}%` : 'Manual'}
              </span>
            </div>

            {/* Mode Toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => handleRangeModeChange('percent')}
                className={`flex-1 px-3 py-2 text-sm rounded transition-all ${
                  rangeMode === 'percent'
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                    : 'bg-[#1a1a2e] text-gray-400 hover:text-white'
                }`}
              >
                By Percent
              </button>
              <button
                onClick={() => handleRangeModeChange('manual')}
                className={`flex-1 px-3 py-2 text-sm rounded transition-all ${
                  rangeMode === 'manual'
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                    : 'bg-[#1a1a2e] text-gray-400 hover:text-white'
                }`}
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
                  max={100}
                  step={0.1}
                  className="w-full"
                />
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Narrow (Higher APR)</span>
                  <span>Wide (Lower Risk)</span>
                </div>
              </>
            )}

            {/* Manual Price Mode */}
            {rangeMode === 'manual' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Min Price ({pool.tokenB.symbol}/{pool.tokenA.symbol})</label>
                  <Input
                    type="number"
                    value={minPriceInput}
                    onChange={(e) => setMinPriceInput(e.target.value)}
                    onBlur={handleMinPriceBlur}
                    placeholder="0.00"
                    step="any"
                    className="bg-[#12121a] border-[#1a1a2e] text-white"
                  />
                </div>
                <div className="text-center py-1">
                  <span className="text-xs text-cyan-400">
                    Current: {currentPrice.toPrecision(6)} {pool.tokenB.symbol}/{pool.tokenA.symbol}
                  </span>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Max Price ({pool.tokenB.symbol}/{pool.tokenA.symbol})</label>
                  <Input
                    type="number"
                    value={maxPriceInput}
                    onChange={(e) => setMaxPriceInput(e.target.value)}
                    onBlur={handleMaxPriceBlur}
                    placeholder="0.00"
                    step="any"
                    className="bg-[#12121a] border-[#1a1a2e] text-white"
                  />
                </div>
                <p className="text-xs text-gray-500 text-center">Prices rounded to valid tick values</p>
              </div>
            )}

            {/* Price Summary */}
            <div className="grid grid-cols-2 gap-4 p-3 bg-[#12121a] rounded-lg">
              <div>
                <span className="text-xs text-gray-500">Min Price</span>
                <p className="text-white font-mono">{priceRange.lowerPrice.toPrecision(6)}</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">Max Price</span>
                <p className="text-white font-mono">{priceRange.upperPrice.toPrecision(6)}</p>
              </div>
            </div>
          </div>

          {/* Slippage */}
          <div className="flex items-center justify-between p-3 bg-[#12121a] rounded-lg">
            <div className="flex items-center gap-2">
              <Info size={14} className="text-gray-500" />
              <span className="text-sm text-gray-400">Slippage Tolerance</span>
            </div>
            <div className="flex gap-2">
              {[0.1, 0.5, 1.0].map((val) => (
                <button
                  key={val}
                  onClick={() => setSlippage(val)}
                  className={`px-3 py-1 text-sm rounded ${
                    slippage === val
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                      : 'bg-[#1a1a2e] text-gray-400 hover:text-white'
                  }`}
                >
                  {val}%
                </button>
              ))}
            </div>
          </div>

          {/* Auto-Close Timer */}
          <div className="space-y-3 p-3 bg-[#12121a] rounded-lg">
            <div className="flex items-center gap-2">
              <Timer size={14} className="text-orange-500" />
              <span className="text-sm text-gray-400">Auto-Close Timer</span>
              {timerDuration && timerDuration > 0 && (
                <span className="ml-auto text-xs text-orange-400">
                  Will close after {formatTimerDisplay(timerDuration)}
                </span>
              )}
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-1.5 rounded transition-all ${
                  showSettings
                    ? 'bg-orange-500/20 text-orange-400'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-[#1a1a2e]'
                }`}
                title="Auto-close settings"
              >
                <Settings size={14} />
              </button>
            </div>

            {/* Settings Panel */}
            {showSettings && (
              <div className="p-3 bg-[#1a1a2e] rounded-lg border border-[#252535] space-y-3">
                <p className="text-xs text-gray-400 mb-2">Choose how to close position when timer expires:</p>

                {/* Option 1: Pre-Sign */}
                <button
                  onClick={() => updateSettings({ method: 'preSigned' })}
                  className={`w-full p-3 rounded-lg border transition-all flex items-start gap-3 ${
                    settings.method === 'preSigned'
                      ? 'bg-purple-500/10 border-purple-500/50 text-white'
                      : 'bg-[#12121a] border-[#252535] text-gray-400 hover:border-gray-500'
                  }`}
                >
                  <FileSignature size={18} className={settings.method === 'preSigned' ? 'text-purple-400' : ''} />
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">Pre-Sign Transaction</span>
                      {settings.method === 'preSigned' && <Check size={14} className="text-purple-400" />}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Sign close transaction now, executes automatically when timer expires.
                    </p>
                  </div>
                </button>

                {/* Option 2: Private Key */}
                <button
                  onClick={() => updateSettings({ method: 'privateKey' })}
                  className={`w-full p-3 rounded-lg border transition-all flex items-start gap-3 ${
                    settings.method === 'privateKey'
                      ? 'bg-orange-500/10 border-orange-500/50 text-white'
                      : 'bg-[#12121a] border-[#252535] text-gray-400 hover:border-gray-500'
                  }`}
                >
                  <Key size={18} className={settings.method === 'privateKey' ? 'text-orange-400' : ''} />
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">Private Key (Automatic)</span>
                      {settings.method === 'privateKey' && isPrivateKeyValid && (
                        <Check size={14} className="text-green-400" />
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Closes automatically without any popups. Requires private key.
                    </p>
                  </div>
                </button>

                {/* Option 3: Escrow (Works Offline) */}
                <button
                  onClick={() => updateSettings({ method: 'escrow', repeatCount: 0 })}
                  className={`w-full p-3 rounded-lg border transition-all flex items-start gap-3 ${
                    settings.method === 'escrow'
                      ? 'bg-green-500/10 border-green-500/50 text-white'
                      : 'bg-[#12121a] border-[#252535] text-gray-400 hover:border-gray-500'
                  } ${!isEscrowAvailable() ? 'opacity-60' : ''}`}
                >
                  <Cloud size={18} className={settings.method === 'escrow' ? 'text-green-400' : ''} />
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">Escrow (Works Offline)</span>
                      {settings.method === 'escrow' && <Check size={14} className="text-green-400" />}
                      {isEscrowAvailable() ? (
                        <span className="text-[10px] px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">NEW</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">COMING SOON</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {isEscrowAvailable()
                        ? 'Deposits position on-chain. Closes automatically even if you close your browser.'
                        : 'Escrow contracts are being deployed. Please try again later.'}
                    </p>
                  </div>
                </button>

                {/* Escrow Info (shown when escrow method selected) */}
                {settings.method === 'escrow' && (
                  <div className="space-y-2 pt-2 border-t border-[#252535]">
                    <div className="p-2 bg-green-500/10 rounded text-xs text-green-300">
                      <p className="font-medium mb-1">How Escrow Works:</p>
                      <ul className="list-disc list-inside space-y-0.5 text-green-400/80">
                        <li>Your position is deposited to a secure smart contract</li>
                        <li>When timer expires, our backend automatically closes it</li>
                        <li>Tokens are sent directly to your wallet</li>
                        <li>You can cancel anytime before timer expires</li>
                      </ul>
                    </div>
                  </div>
                )}

                {/* Private Key Input (shown when privateKey method selected) */}
                {settings.method === 'privateKey' && (
                  <div className="space-y-2 pt-2 border-t border-[#252535]">
                    <label className="text-xs text-gray-400">Enter Private Key:</label>
                    <div className="relative">
                      <input
                        type={showPrivateKey ? 'text' : 'password'}
                        value={privateKeyInput}
                        onChange={(e) => setPrivateKeyInput(e.target.value)}
                        onBlur={() => updateSettings({ privateKey: privateKeyInput || null })}
                        placeholder="suiprivkey... or hex format"
                        className="w-full bg-[#12121a] border border-[#252535] rounded px-3 py-2 text-sm text-white pr-20 font-mono"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <button
                          onClick={() => setShowPrivateKey(!showPrivateKey)}
                          className="p-1 text-gray-500 hover:text-gray-300"
                        >
                          {showPrivateKey ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button
                          onClick={() => {
                            updateSettings({ privateKey: privateKeyInput || null });
                            toast.success(isPrivateKeyValid ? 'Private key saved!' : 'Invalid private key format');
                          }}
                          className="px-2 py-0.5 text-xs bg-orange-500/20 text-orange-400 rounded hover:bg-orange-500/30"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                    {privateKeyInput && (
                      <div className={`text-xs ${isPrivateKeyValid ? 'text-green-400' : 'text-yellow-400'}`}>
                        {isPrivateKeyValid ? 'Valid private key' : 'Enter a valid private key to enable automatic closing'}
                      </div>
                    )}
                    <div className="text-xs text-red-400/70 flex items-start gap-1 mt-2">
                      <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                      <span>Warning: Private keys are stored in browser. Use only on trusted devices.</span>
                    </div>
                  </div>
                )}

                {/* Repeat Count Selector */}
                <div className="pt-3 border-t border-[#252535]">
                  <label className="text-xs text-gray-400 block mb-2">Repeat open-close cycle:</label>
                  {settings.method === 'escrow' ? (
                    <div className="text-xs text-yellow-400/70 flex items-start gap-1">
                      <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                      <span>Repeat cycles not available with Escrow. Escrow closes position once - use Private Key for repeat cycles.</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { label: 'Once', value: 0 },
                          { label: '2x', value: 1 },
                          { label: '3x', value: 2 },
                          { label: '5x', value: 4 },
                          { label: '10x', value: 9 },
                          { label: 'Infinite', value: 'infinite' as const },
                        ].map((option) => (
                          <button
                            key={option.label}
                            onClick={() => updateSettings({ repeatCount: option.value })}
                            className={`px-3 py-1.5 text-xs rounded transition-all ${
                              settings.repeatCount === option.value
                                ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                                : 'bg-[#12121a] border border-[#252535] text-gray-400 hover:text-white hover:border-gray-500'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      {settings.repeatCount !== 0 && (
                        <p className="text-xs text-green-400/70 mt-2">
                          {settings.repeatCount === 'infinite'
                            ? 'Position will reopen indefinitely after each close.'
                            : `Position will reopen ${settings.repeatCount} more time${settings.repeatCount === 1 ? '' : 's'} after initial close.`}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {TIMER_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handlePresetSelect(preset.seconds)}
                  className={`px-3 py-1.5 text-xs rounded transition-all ${
                    (preset.seconds === -1 && showCustomTimer) ||
                    (preset.seconds !== -1 && !showCustomTimer && timerDuration === preset.seconds)
                      ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                      : 'bg-[#1a1a2e] text-gray-400 hover:text-white hover:bg-[#252535]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Custom Timer Input */}
            {showCustomTimer && (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="number"
                  value={customTimerValue}
                  onChange={(e) => setCustomTimerValue(e.target.value)}
                  placeholder="Enter value"
                  min="1"
                  className="w-24 bg-[#1a1a2e] border border-[#252535] rounded px-3 py-1.5 text-sm text-white focus:border-orange-500/50 focus:outline-none"
                />
                <select
                  value={customTimerUnit}
                  onChange={(e) => setCustomTimerUnit(e.target.value as TimerUnit)}
                  className="bg-[#1a1a2e] border border-[#252535] rounded px-3 py-1.5 text-sm text-white focus:border-orange-500/50 focus:outline-none"
                >
                  {TIMER_UNITS.map((unit) => (
                    <option key={unit.value} value={unit.value}>
                      {unit.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={applyCustomTimer}
                  className="px-3 py-1.5 text-xs bg-orange-500/20 text-orange-400 rounded hover:bg-orange-500/30 border border-orange-500/50"
                >
                  Apply
                </button>
              </div>
            )}

            {/* Timer info */}
            {timerDuration && timerDuration > 0 && (
              <div className={`mt-2 p-2 ${settings.method === 'escrow' ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-orange-500/10 border-orange-500/30 text-orange-300'} border rounded text-xs`}>
                {settings.method === 'escrow' ? (
                  <p>Position will be deposited to escrow. It will close automatically even if you close your browser.</p>
                ) : settings.method === 'preSigned' ? (
                  <p>You'll sign the close transaction after creating the position. It will execute automatically when timer expires.</p>
                ) : settings.method === 'privateKey' && isPrivateKeyValid ? (
                  <p>Position will close automatically when timer expires. No approval needed.</p>
                ) : (
                  <p>When timer expires, you'll be prompted to approve the close in your wallet.</p>
                )}
              </div>
            )}
          </div>

          {/* Summary */}
          {estimatedValue > 0 && (
            <div className="p-4 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-lg border border-cyan-500/20">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Estimated Value</span>
                <span className="text-xl font-semibold text-white">
                  {formatCurrency(estimatedValue)}
                </span>
              </div>
              <div className="flex justify-between items-center mt-2">
                <span className="text-gray-400">Est. APR</span>
                <span className="text-green-400 font-semibold">{pool.apr.toFixed(1)}%</span>
              </div>
            </div>
          )}

          {/* Warning */}
          <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <AlertCircle size={16} className="text-yellow-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-yellow-200/80">
              Adding liquidity involves risk including impermanent loss.
              Make sure you understand the risks before proceeding.
            </p>
          </div>

          {/* Action Button */}
          {!isConnected ? (
            <Button
              onClick={connect}
              className="w-full h-12 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-black font-semibold"
            >
              Connect Wallet
            </Button>
          ) : (
            <Button
              onClick={handleAddLiquidity}
              disabled={isSubmitting || isPending || !amountA || !amountB}
              className="w-full h-12 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-black font-semibold disabled:opacity-50"
            >
              {isSubmitting || isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="animate-spin" size={18} />
                  Adding Liquidity...
                </span>
              ) : (
                'Add Liquidity'
              )}
            </Button>
          )}
        </div>
    </>
  );

  // When embedded, render content directly without Dialog wrapper
  if (embedded) {
    return <div className="p-6 space-y-6">{modalContent}</div>;
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto bg-[#0A0A0F] border-[#1a1a2e] text-white">
        {modalContent}
      </DialogContent>
    </Dialog>
  );
}
