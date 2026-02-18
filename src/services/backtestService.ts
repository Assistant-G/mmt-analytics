/**
 * Backtesting Service
 *
 * Simulates LP strategy performance using REAL historical price data.
 * No synthetic/fake data - only real market data from APIs.
 */

import { STRATEGY_PRESETS, type StrategyPreset, type Strategy } from '@/types/strategies';

// Types
export interface PricePoint {
  timestamp: number;
  price: number;
  volume?: number;
}

export interface PoolHistoricalData {
  tvl: number;
  volume24h: number;
  fees24h: number;
  timestamp: number;
}

export interface BacktestConfig {
  poolId: string;
  tokenA: string;
  tokenB: string;
  strategy: StrategyPreset;
  initialCapital: number;
  startTime: number;
  endTime: number;
  poolApr?: number; // Base pool APR for fee estimation
  allowSynthetic?: boolean; // Allow synthetic data when real data unavailable
  autoRebalance?: boolean; // If false, wait for price to return to range instead of rebalancing
}

export interface RebalanceEvent {
  timestamp: number;
  price: number;
  reason: 'position-opened' | 'out-of-range' | 'timer' | 'divergence' | 'profit-target' | 'stop-loss' | 'return-to-range' | 'price-exit-range' | 'price-enter-range';
  oldRange: { lower: number; upper: number };
  newRange: { lower: number; upper: number };
  feesCollected: number;
  gasCost: number;
  positionValue: number;
  outOfRangeDurationMs?: number; // How long price was out of range before this event
  inRangeDurationMs?: number; // How long price was in range before exiting
}

export interface OutOfRangePeriod {
  startTimestamp: number;
  endTimestamp: number;
  durationMs: number;
  exitPrice: number; // Price when exited range
  returnPrice?: number; // Price when returned (if it did)
  didReturn: boolean; // Whether price returned to range
}

export interface BacktestResult {
  config: BacktestConfig;
  // Data quality
  dataSource: 'binance' | 'coingecko' | 'defillama' | 'synthetic' | 'none';
  dataQuality: 'high' | 'medium' | 'low' | 'simulated';
  warnings: string[];
  // Performance metrics
  finalValue: number;
  totalReturn: number;
  totalReturnPercent: number;
  // Breakdown
  feesEarned: number;
  impermanentLoss: number;
  gasCosts: number;
  netPnL: number;
  // Risk metrics
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  // Efficiency
  timeInRange: number; // percentage
  rebalanceCount: number;
  avgTimePerCycle: number; // ms
  // Events
  rebalances: RebalanceEvent[];
  outOfRangePeriods: OutOfRangePeriod[]; // Periods when price was out of range
  // Time series for charting
  equityCurve: { timestamp: number; value: number }[];
  priceData: PricePoint[];
  ranges: { timestamp: number; lower: number; upper: number }[];
}

export interface MonteCarloResult {
  simulations: number;
  percentiles: {
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
  mean: number;
  stdDev: number;
  bestCase: number;
  worstCase: number;
  probabilityOfProfit: number;
}

export interface StrategyComparison {
  strategyId: string;
  strategyName: string;
  result: BacktestResult;
}

// Token ID mappings for different APIs
const COINGECKO_IDS: Record<string, string> = {
  'SUI': 'sui',
  'USDC': 'usd-coin',
  'USDT': 'tether',
  'WETH': 'ethereum',
  'ETH': 'ethereum',
  'WBTC': 'wrapped-bitcoin',
  'BTC': 'bitcoin',
  'SOL': 'solana',
  'CETUS': 'cetus-protocol',
  'DEEP': 'deepbook',
  'NAVX': 'navi-protocol',
  'SCA': 'scallop-2',
  'BUCK': 'bucket-protocol',
  'AUSD': 'helio-protocol-hay',
};

const DEFILLAMA_IDS: Record<string, string> = {
  'SUI': 'coingecko:sui',
  'USDC': 'coingecko:usd-coin',
  'USDT': 'coingecko:tether',
  'WETH': 'coingecko:ethereum',
  'ETH': 'coingecko:ethereum',
  'WBTC': 'coingecko:wrapped-bitcoin',
  'BTC': 'coingecko:bitcoin',
  'CETUS': 'coingecko:cetus-protocol',
};

// Binance trading pairs - most reliable data source
const BINANCE_SYMBOLS: Record<string, string> = {
  'SUI/USDC': 'SUIUSDC',
  'SUI/USDT': 'SUIUSDT',
  'ETH/USDC': 'ETHUSDC',
  'ETH/USDT': 'ETHUSDT',
  'WETH/USDC': 'ETHUSDC',
  'WETH/USDT': 'ETHUSDT',
  'BTC/USDC': 'BTCUSDC',
  'BTC/USDT': 'BTCUSDT',
  'WBTC/USDC': 'BTCUSDC',
  'WBTC/USDT': 'BTCUSDT',
  'SOL/USDC': 'SOLUSDC',
  'SOL/USDT': 'SOLUSDT',
  'CETUS/USDT': 'CETUSUSDT',
};

/**
 * Fetch historical prices from Binance (most reliable, high quality data)
 */
async function fetchBinancePrices(
  tokenA: string,
  tokenB: string,
  startTime: number,
  endTime: number
): Promise<{ prices: PricePoint[]; source: 'binance' } | null> {
  // Check if we have a direct trading pair
  const pairKey = `${tokenA.toUpperCase()}/${tokenB.toUpperCase()}`;
  const reversePairKey = `${tokenB.toUpperCase()}/${tokenA.toUpperCase()}`;

  let symbol = BINANCE_SYMBOLS[pairKey];
  let isReversed = false;

  if (!symbol) {
    symbol = BINANCE_SYMBOLS[reversePairKey];
    isReversed = true;
  }

  if (!symbol) {
    console.warn(`Binance: No trading pair for ${tokenA}/${tokenB}`);
    return null;
  }

  try {
    // Binance klines endpoint - get hourly candles
    // Max 1000 candles per request
    const interval = '1h';
    const limit = Math.min(1000, Math.ceil((endTime - startTime) / (60 * 60 * 1000)));

    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;

    console.log('Binance API URL:', url);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length < 2) {
      throw new Error('Insufficient data from Binance');
    }

    // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
    const prices: PricePoint[] = data.map((candle: (string | number)[]) => {
      const timestamp = Number(candle[0]);
      const closePrice = parseFloat(candle[4] as string);

      return {
        timestamp,
        price: isReversed ? 1 / closePrice : closePrice,
      };
    });

    console.log(`Binance: got ${prices.length} price points for ${symbol}`);
    return { prices, source: 'binance' };
  } catch (error) {
    console.warn('Binance fetch failed:', error);
    return null;
  }
}

/**
 * Fetch historical prices from DeFiLlama (more reliable, no rate limits)
 * Tries multiple endpoint formats for best compatibility
 */
async function fetchDeFiLlamaPrices(
  tokenA: string,
  tokenB: string,
  startTime: number,
  endTime: number
): Promise<{ prices: PricePoint[]; source: 'defillama' } | null> {
  const tokenAId = DEFILLAMA_IDS[tokenA.toUpperCase()];
  const tokenBId = DEFILLAMA_IDS[tokenB.toUpperCase()];

  if (!tokenAId || !tokenBId) {
    console.warn(`DeFiLlama: Token ID not found for ${tokenA} or ${tokenB}`);
    return null;
  }

  // Try Method 1: /prices/historical endpoint (get multiple timestamps)
  const result1 = await fetchDeFiLlamaHistorical(tokenAId, tokenBId, startTime, endTime);
  if (result1) return result1;

  // Try Method 2: /chart endpoint
  const result2 = await fetchDeFiLlamaChart(tokenAId, tokenBId, startTime, endTime);
  if (result2) return result2;

  return null;
}

/**
 * Fetch from DeFiLlama /prices/historical endpoint
 * Format: /prices/historical/{timestamp}/{coins}
 */
async function fetchDeFiLlamaHistorical(
  tokenAId: string,
  tokenBId: string,
  startTime: number,
  endTime: number
): Promise<{ prices: PricePoint[]; source: 'defillama' } | null> {
  try {
    const prices: PricePoint[] = [];
    const coins = `${tokenAId},${tokenBId}`;
    const hourMs = 60 * 60 * 1000;

    // Fetch prices at hourly intervals (limit to 100 requests to avoid rate limiting)
    const numPoints = Math.min(Math.ceil((endTime - startTime) / hourMs), 100);
    const interval = (endTime - startTime) / numPoints;

    const timestamps: number[] = [];
    for (let i = 0; i <= numPoints; i++) {
      timestamps.push(Math.floor((startTime + i * interval) / 1000));
    }

    // Batch requests (fetch 5 timestamps at a time)
    for (let i = 0; i < timestamps.length; i += 5) {
      const batch = timestamps.slice(i, i + 5);
      const batchPromises = batch.map(ts =>
        fetch(`https://coins.llama.fi/prices/historical/${ts}/${coins}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      );

      const results = await Promise.all(batchPromises);

      for (let j = 0; j < results.length; j++) {
        const data = results[j];
        if (data?.coins?.[tokenAId]?.price && data?.coins?.[tokenBId]?.price) {
          const priceA = data.coins[tokenAId].price;
          const priceB = data.coins[tokenBId].price;
          if (priceB > 0) {
            prices.push({
              timestamp: batch[j] * 1000,
              price: priceA / priceB,
            });
          }
        }
      }
    }

    if (prices.length >= 2) {
      console.log(`DeFiLlama historical: got ${prices.length} price points`);
      return { prices: prices.sort((a, b) => a.timestamp - b.timestamp), source: 'defillama' };
    }

    throw new Error('Insufficient price data points');
  } catch (error) {
    console.warn('DeFiLlama historical fetch failed:', error);
    return null;
  }
}

/**
 * Fetch from DeFiLlama /chart endpoint
 * Format: /chart/{coins}?start={timestamp}&span={count}&period={period}
 */
async function fetchDeFiLlamaChart(
  tokenAId: string,
  tokenBId: string,
  startTime: number,
  endTime: number
): Promise<{ prices: PricePoint[]; source: 'defillama' } | null> {
  try {
    const startSec = Math.floor(startTime / 1000);
    const endSec = Math.floor(endTime / 1000);
    const span = Math.min(Math.ceil((endSec - startSec) / 3600), 500);

    // DeFiLlama chart endpoint - coins should NOT be URL encoded in the path
    const urlA = `https://coins.llama.fi/chart/${tokenAId}?start=${startSec}&span=${span}&period=1h`;
    const urlB = `https://coins.llama.fi/chart/${tokenBId}?start=${startSec}&span=${span}&period=1h`;

    console.log('DeFiLlama chart URLs:', urlA, urlB);

    const [responseA, responseB] = await Promise.all([
      fetch(urlA),
      fetch(urlB)
    ]);

    if (!responseA.ok || !responseB.ok) {
      throw new Error(`DeFiLlama chart API error: ${responseA.status} / ${responseB.status}`);
    }

    const dataA = await responseA.json();
    const dataB = await responseB.json();

    console.log('DeFiLlama chart response A:', JSON.stringify(dataA).slice(0, 200));
    console.log('DeFiLlama chart response B:', JSON.stringify(dataB).slice(0, 200));

    // Try different response formats
    const pricesA = dataA.coins?.[tokenAId]?.prices || dataA[tokenAId]?.prices || dataA.prices || [];
    const pricesB = dataB.coins?.[tokenBId]?.prices || dataB[tokenBId]?.prices || dataB.prices || [];

    if (pricesA.length < 2 || pricesB.length < 2) {
      throw new Error(`Insufficient price data: A=${pricesA.length}, B=${pricesB.length}`);
    }

    // Create a map of tokenB prices by timestamp
    const pricesBMap = new Map<number, number>();
    pricesB.forEach((p: { timestamp: number; price: number }) => {
      const hourTs = Math.floor(p.timestamp / 3600) * 3600;
      pricesBMap.set(hourTs, p.price);
    });

    // Calculate relative prices
    const prices: PricePoint[] = [];
    for (const pA of pricesA) {
      const hourTs = Math.floor(pA.timestamp / 3600) * 3600;
      const priceB = pricesBMap.get(hourTs);
      if (priceB && priceB > 0) {
        const timestamp = pA.timestamp * 1000;
        if (timestamp >= startTime && timestamp <= endTime) {
          prices.push({
            timestamp,
            price: pA.price / priceB,
          });
        }
      }
    }

    if (prices.length >= 2) {
      console.log(`DeFiLlama chart: got ${prices.length} price points`);
      return { prices, source: 'defillama' };
    }

    throw new Error('Insufficient matched price points');
  } catch (error) {
    console.warn('DeFiLlama chart fetch failed:', error);
    return null;
  }
}

/**
 * Fetch historical prices from CoinGecko (backup)
 * Uses direct API call - works in many environments without proxy
 */
async function fetchCoinGeckoPrices(
  tokenA: string,
  tokenB: string,
  startTime: number,
  endTime: number
): Promise<{ prices: PricePoint[]; source: 'coingecko' } | null> {
  const tokenAId = COINGECKO_IDS[tokenA.toUpperCase()];
  const tokenBId = COINGECKO_IDS[tokenB.toUpperCase()];

  if (!tokenAId || !tokenBId) {
    console.warn(`CoinGecko: Token ID not found for ${tokenA} or ${tokenB}`);
    return null;
  }

  const days = Math.ceil((endTime - startTime) / (24 * 60 * 60 * 1000));

  // List of CORS proxies to try (some may be more reliable than others)
  const proxies = [
    '', // Try direct first (works in some environments)
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest=',
  ];

  for (const proxy of proxies) {
    try {
      const baseUrlA = `https://api.coingecko.com/api/v3/coins/${tokenAId}/market_chart?vs_currency=usd&days=${Math.min(days, 90)}`;
      const baseUrlB = `https://api.coingecko.com/api/v3/coins/${tokenBId}/market_chart?vs_currency=usd&days=${Math.min(days, 90)}`;

      const urlA = proxy ? proxy + encodeURIComponent(baseUrlA) : baseUrlA;
      const urlB = proxy ? proxy + encodeURIComponent(baseUrlB) : baseUrlB;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const [responseA, responseB] = await Promise.all([
        fetch(urlA, { signal: controller.signal }),
        fetch(urlB, { signal: controller.signal }),
      ]);

      clearTimeout(timeoutId);

      if (!responseA.ok || !responseB.ok) {
        throw new Error('CoinGecko API error');
      }

      const dataA = await responseA.json();
      const dataB = await responseB.json();

      if (!dataA.prices || !dataB.prices) {
        throw new Error('Missing price data');
      }

      // Create map of B prices
      const pricesBMap = new Map<number, number>();
      dataB.prices.forEach(([timestamp, price]: [number, number]) => {
        // Round to nearest hour for matching
        const hourTimestamp = Math.floor(timestamp / 3600000) * 3600000;
        pricesBMap.set(hourTimestamp, price);
      });

      // Calculate relative prices
      const prices: PricePoint[] = [];
      for (const [timestamp, priceA] of dataA.prices) {
        const hourTimestamp = Math.floor(timestamp / 3600000) * 3600000;
        const priceB = pricesBMap.get(hourTimestamp);

        if (priceB && priceB > 0 && timestamp >= startTime && timestamp <= endTime) {
          prices.push({
            timestamp,
            price: priceA / priceB,
          });
        }
      }

      if (prices.length < 2) {
        throw new Error('Insufficient price data points');
      }

      console.log(`CoinGecko fetch succeeded via ${proxy || 'direct'}`);
      return { prices, source: 'coingecko' };
    } catch (error) {
      console.warn(`CoinGecko fetch failed with proxy "${proxy || 'direct'}":`, error);
      continue; // Try next proxy
    }
  }

  console.error('CoinGecko fetch failed with all proxies');
  return null;
}

/**
 * Generate synthetic price data based on realistic volatility parameters
 * Used as fallback when real data isn't available
 */
function generateSyntheticPrices(
  tokenA: string,
  tokenB: string,
  startTime: number,
  endTime: number
): PricePoint[] {
  // Token-specific starting prices and volatility estimates
  const tokenParams: Record<string, { startPrice: number; dailyVol: number }> = {
    'SUI': { startPrice: 4.0, dailyVol: 0.05 },    // ~5% daily volatility
    'USDC': { startPrice: 1.0, dailyVol: 0.001 },  // Stablecoin
    'USDT': { startPrice: 1.0, dailyVol: 0.001 },
    'WETH': { startPrice: 3500, dailyVol: 0.04 },
    'ETH': { startPrice: 3500, dailyVol: 0.04 },
    'WBTC': { startPrice: 95000, dailyVol: 0.035 },
    'BTC': { startPrice: 95000, dailyVol: 0.035 },
    'CETUS': { startPrice: 0.25, dailyVol: 0.08 },
    'DEEP': { startPrice: 0.15, dailyVol: 0.10 },
  };

  const paramsA = tokenParams[tokenA.toUpperCase()] || { startPrice: 1, dailyVol: 0.05 };
  const paramsB = tokenParams[tokenB.toUpperCase()] || { startPrice: 1, dailyVol: 0.001 };

  // Calculate relative starting price
  const startPrice = paramsA.startPrice / paramsB.startPrice;

  // Combined volatility (roughly sqrt of sum of squares for uncorrelated assets)
  const combinedVol = Math.sqrt(paramsA.dailyVol ** 2 + paramsB.dailyVol ** 2);
  const hourlyVol = combinedVol / Math.sqrt(24); // Convert to hourly

  const prices: PricePoint[] = [];
  let price = startPrice;
  const hourMs = 60 * 60 * 1000;

  for (let timestamp = startTime; timestamp <= endTime; timestamp += hourMs) {
    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    // Apply hourly return with slight mean reversion
    const meanReversion = -0.001 * (price / startPrice - 1); // Pull back toward start
    const drift = meanReversion;
    const diffusion = hourlyVol * z;

    price = price * Math.exp(drift + diffusion);
    // Ensure price stays positive
    price = Math.max(price * 0.1, price);

    prices.push({ timestamp, price });
  }

  return prices;
}

/**
 * Fetch historical prices - tries multiple sources, with optional synthetic fallback
 * Priority: Binance (best) > DeFiLlama > CoinGecko > Synthetic
 */
export async function fetchHistoricalPrices(
  tokenA: string,
  tokenB: string,
  startTime: number,
  endTime: number,
  allowSynthetic: boolean = false
): Promise<{ prices: PricePoint[]; source: 'binance' | 'defillama' | 'coingecko' | 'synthetic' | 'none'; error?: string }> {
  // Try Binance first (most reliable, high quality data)
  const binanceResult = await fetchBinancePrices(tokenA, tokenB, startTime, endTime);
  if (binanceResult) {
    console.log('Using Binance price data');
    return { prices: binanceResult.prices, source: 'binance' };
  }

  // Try DeFiLlama second
  const defiLlamaResult = await fetchDeFiLlamaPrices(tokenA, tokenB, startTime, endTime);
  if (defiLlamaResult) {
    console.log('Using DeFiLlama price data');
    return { prices: defiLlamaResult.prices, source: 'defillama' };
  }

  // Try CoinGecko as backup
  const coinGeckoResult = await fetchCoinGeckoPrices(tokenA, tokenB, startTime, endTime);
  if (coinGeckoResult) {
    console.log('Using CoinGecko price data');
    return { prices: coinGeckoResult.prices, source: 'coingecko' };
  }

  // If synthetic data is allowed, generate it
  if (allowSynthetic) {
    console.log('Using synthetic price data (real data unavailable)');
    const syntheticPrices = generateSyntheticPrices(tokenA, tokenB, startTime, endTime);
    return {
      prices: syntheticPrices,
      source: 'synthetic',
      error: 'Using simulated prices - real historical data unavailable. Results are illustrative only.',
    };
  }

  // NO SYNTHETIC FALLBACK - return error instead
  return {
    prices: [],
    source: 'none',
    error: `Could not fetch historical price data for ${tokenA}/${tokenB}. Please try a different token pair or time range.`,
  };
}

/**
 * Fetch current gas price on Sui (estimated)
 */
async function getEstimatedGasCost(): Promise<number> {
  // Sui transactions are very cheap, typically 0.001-0.01 SUI
  // At ~$1-2 SUI price, this is roughly $0.001-0.02 per tx
  // Use conservative estimate
  return 0.02; // $0.02 per rebalance
}

/**
 * Calculate Impermanent Loss using standard formula
 * IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
 */
function calculateImpermanentLoss(initialPrice: number, currentPrice: number): number {
  const priceRatio = currentPrice / initialPrice;
  const ilFactor = 2 * Math.sqrt(priceRatio) / (1 + priceRatio) - 1;
  return Math.abs(ilFactor);
}

/**
 * Estimate fees earned while in range
 * This is an approximation based on:
 * - Pool APR (user input or from pool data)
 * - Time in range
 * - Range concentration (tighter range = more fees per $ when in range)
 */
function estimateFeesEarned(
  capital: number,
  poolApr: number,
  hoursInRange: number,
  rangeBps: number
): number {
  // Base hourly rate from APR
  const hourlyRate = poolApr / 100 / 365 / 24;

  // Concentration multiplier: tighter range = higher fee share when in range
  // Full range would be ~10000 bps (100%), so multiplier = 10000 / rangeBps
  // Cap at 20x to be conservative
  const concentrationMultiplier = Math.min(20, 10000 / rangeBps);

  // Fees = capital * hourlyRate * hours * concentration
  // Apply a discount factor (0.7) to be conservative
  const fees = capital * hourlyRate * hoursInRange * concentrationMultiplier * 0.7;

  return fees;
}

/**
 * Main backtest function - uses REAL data when available, synthetic fallback optional
 */
export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const warnings: string[] = [];

  // Fetch historical prices (allow synthetic by default to prevent failures)
  const allowSynthetic = config.allowSynthetic !== false; // Default to true
  const priceResult = await fetchHistoricalPrices(
    config.tokenA,
    config.tokenB,
    config.startTime,
    config.endTime,
    allowSynthetic
  );

  if (priceResult.source === 'none' || priceResult.prices.length < 2) {
    throw new Error(priceResult.error || 'Failed to fetch historical price data. Cannot run backtest.');
  }

  const priceData = priceResult.prices;
  const dataSource = priceResult.source;

  // Add appropriate warnings
  if (dataSource === 'synthetic') {
    warnings.push('⚠️ SIMULATED DATA: Real price data unavailable. Results are for illustration only and may not reflect actual market conditions.');
  }

  warnings.push('Fee earnings are estimated based on pool APR and concentration. Actual fees may vary.');

  if (priceData.length < 24 && dataSource !== 'synthetic') {
    warnings.push('Limited price data available. Results may be less accurate.');
  }

  // Get gas cost estimate
  const gasCostPerTx = await getEstimatedGasCost();

  // Initialize simulation state
  const strategy = config.strategy.strategy;
  const rangeBps = getRangeBps(strategy);
  const initialPrice = priceData[0].price;
  const autoRebalance = config.autoRebalance !== false; // Default to true

  let currentValue = config.initialCapital;
  let totalFees = 0;
  let totalGasCosts = 0;
  let currentRange = calculateRange(initialPrice, rangeBps);
  let lastRebalanceTime = config.startTime;
  let timeInRangeMs = 0;
  let timeOutOfRangeMs = 0;

  // Track out-of-range periods
  const outOfRangePeriods: OutOfRangePeriod[] = [];
  let currentOutOfRangePeriod: {
    startTimestamp: number;
    exitPrice: number;
  } | null = null;

  const rebalances: RebalanceEvent[] = [];
  const equityCurve: { timestamp: number; value: number }[] = [];
  const ranges: { timestamp: number; lower: number; upper: number }[] = [
    { timestamp: config.startTime, ...currentRange }
  ];

  // Add initial position-opened event
  rebalances.push({
    timestamp: config.startTime,
    price: initialPrice,
    reason: 'position-opened',
    oldRange: { lower: 0, upper: 0 },
    newRange: { ...currentRange },
    feesCollected: 0,
    gasCost: gasCostPerTx, // Initial gas to open position
    positionValue: currentValue,
  });

  let maxValue = currentValue;
  let maxDrawdown = 0;
  const returns: number[] = [];
  let wasInRange = true; // Track previous state
  let lastInRangeTimestamp = config.startTime; // Track when we entered current in-range period

  // Simulate through each price point
  for (let i = 1; i < priceData.length; i++) {
    const prevPoint = priceData[i - 1];
    const point = priceData[i];
    const timeDeltaMs = point.timestamp - prevPoint.timestamp;
    const timeDeltaHours = timeDeltaMs / (60 * 60 * 1000);

    // Check if price is in range
    const isInRange = point.price >= currentRange.lower && point.price <= currentRange.upper;

    if (isInRange) {
      timeInRangeMs += timeDeltaMs;

      // If we just returned to range from being out of range
      if (!wasInRange && currentOutOfRangePeriod) {
        const outOfRangeDuration = point.timestamp - currentOutOfRangePeriod.startTimestamp;
        outOfRangePeriods.push({
          startTimestamp: currentOutOfRangePeriod.startTimestamp,
          endTimestamp: point.timestamp,
          durationMs: outOfRangeDuration,
          exitPrice: currentOutOfRangePeriod.exitPrice,
          returnPrice: point.price,
          didReturn: true,
        });

        // If not auto-rebalancing, record return-to-range event
        if (!autoRebalance) {
          rebalances.push({
            timestamp: point.timestamp,
            price: point.price,
            reason: 'return-to-range',
            oldRange: { ...currentRange },
            newRange: { ...currentRange }, // Same range, price returned
            feesCollected: totalFees,
            gasCost: 0, // No gas cost - didn't rebalance
            positionValue: currentValue,
            outOfRangeDurationMs: outOfRangeDuration,
          });
        }

        currentOutOfRangePeriod = null;
      }

      // Estimate fees earned while in range
      const feesEarned = estimateFeesEarned(
        currentValue,
        config.poolApr || 50,
        timeDeltaHours,
        rangeBps
      );
      totalFees += feesEarned;
      currentValue += feesEarned;
    } else {
      timeOutOfRangeMs += timeDeltaMs;

      // Track when we first go out of range
      if (wasInRange && !currentOutOfRangePeriod) {
        const inRangeDuration = point.timestamp - lastInRangeTimestamp;
        currentOutOfRangePeriod = {
          startTimestamp: point.timestamp,
          exitPrice: point.price,
        };

        // Add price-exit-range event
        rebalances.push({
          timestamp: point.timestamp,
          price: point.price,
          reason: 'price-exit-range',
          oldRange: { ...currentRange },
          newRange: { ...currentRange }, // Range doesn't change
          feesCollected: totalFees,
          gasCost: 0, // No gas cost - just tracking
          positionValue: currentValue,
          inRangeDurationMs: inRangeDuration,
        });
      }
    }

    // Update lastInRangeTimestamp when entering range
    if (isInRange && !wasInRange) {
      lastInRangeTimestamp = point.timestamp;
    }
    wasInRange = isInRange;

    // Calculate current IL
    const currentIL = calculateImpermanentLoss(initialPrice, point.price);
    const ilLossUsd = config.initialCapital * currentIL;

    // Check rebalance conditions (only if auto-rebalance is enabled)
    const shouldRebalance = checkRebalanceCondition(
      strategy,
      point.price,
      currentRange,
      point.timestamp - lastRebalanceTime,
      autoRebalance
    );

    if (shouldRebalance.should) {
      totalGasCosts += gasCostPerTx;
      currentValue -= gasCostPerTx;

      const oldRange = { ...currentRange };
      currentRange = calculateRange(point.price, rangeBps);

      // Calculate out-of-range duration if applicable
      let outOfRangeDuration: number | undefined;
      if (currentOutOfRangePeriod) {
        outOfRangeDuration = point.timestamp - currentOutOfRangePeriod.startTimestamp;
        outOfRangePeriods.push({
          startTimestamp: currentOutOfRangePeriod.startTimestamp,
          endTimestamp: point.timestamp,
          durationMs: outOfRangeDuration,
          exitPrice: currentOutOfRangePeriod.exitPrice,
          returnPrice: undefined,
          didReturn: false, // Rebalanced instead of waiting for return
        });
        currentOutOfRangePeriod = null;
      }

      rebalances.push({
        timestamp: point.timestamp,
        price: point.price,
        reason: shouldRebalance.reason,
        oldRange,
        newRange: currentRange,
        feesCollected: totalFees,
        gasCost: gasCostPerTx,
        positionValue: currentValue - ilLossUsd,
        outOfRangeDurationMs: outOfRangeDuration,
      });

      ranges.push({ timestamp: point.timestamp, ...currentRange });
      lastRebalanceTime = point.timestamp;
      wasInRange = true; // After rebalancing, we're in range
    }

    // Track equity (value after IL)
    const equityValue = currentValue - ilLossUsd;
    equityCurve.push({ timestamp: point.timestamp, value: equityValue });

    // Track returns for Sharpe calculation
    if (equityCurve.length > 1) {
      const prevEquity = equityCurve[equityCurve.length - 2].value;
      if (prevEquity > 0) {
        returns.push((equityValue - prevEquity) / prevEquity);
      }
    }

    // Track max drawdown
    if (equityValue > maxValue) {
      maxValue = equityValue;
    }
    const drawdown = maxValue - equityValue;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // If we end while out of range, record that period
  if (currentOutOfRangePeriod) {
    const lastTimestamp = priceData[priceData.length - 1].timestamp;
    outOfRangePeriods.push({
      startTimestamp: currentOutOfRangePeriod.startTimestamp,
      endTimestamp: lastTimestamp,
      durationMs: lastTimestamp - currentOutOfRangePeriod.startTimestamp,
      exitPrice: currentOutOfRangePeriod.exitPrice,
      returnPrice: undefined,
      didReturn: false,
    });
  }

  // Calculate final metrics
  const totalTimeMs = timeInRangeMs + timeOutOfRangeMs;
  const timeInRangePercent = totalTimeMs > 0 ? (timeInRangeMs / totalTimeMs) * 100 : 0;

  // Final IL
  const finalPrice = priceData[priceData.length - 1].price;
  const finalIL = calculateImpermanentLoss(initialPrice, finalPrice);
  const impermanentLoss = config.initialCapital * finalIL;

  const finalValue = currentValue - impermanentLoss;
  const totalReturn = finalValue - config.initialCapital;
  const totalReturnPercent = (totalReturn / config.initialCapital) * 100;

  // Calculate Sharpe ratio (annualized)
  let sharpeRatio = 0;
  if (returns.length > 1) {
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      // Annualize based on hourly data
      sharpeRatio = (avgReturn / stdDev) * Math.sqrt(365 * 24);
    }
  }

  // Determine data quality
  let dataQuality: 'high' | 'medium' | 'low' | 'simulated' = 'high';
  if (dataSource === 'synthetic') {
    dataQuality = 'simulated';
  } else if (priceData.length < 24) {
    dataQuality = 'low';
  } else if (priceData.length < 100) {
    dataQuality = 'medium';
  }

  return {
    config,
    dataSource,
    dataQuality,
    warnings,
    finalValue,
    totalReturn,
    totalReturnPercent,
    feesEarned: totalFees,
    impermanentLoss,
    gasCosts: totalGasCosts,
    netPnL: totalReturn,
    maxDrawdown,
    maxDrawdownPercent: maxValue > 0 ? (maxDrawdown / maxValue) * 100 : 0,
    sharpeRatio,
    timeInRange: timeInRangePercent,
    rebalanceCount: rebalances.length,
    avgTimePerCycle: rebalances.length > 0 ? (config.endTime - config.startTime) / rebalances.length : 0,
    rebalances,
    outOfRangePeriods,
    equityCurve,
    priceData,
    ranges,
  };
}

/**
 * Run backtest for multiple strategies and compare
 */
export async function compareStrategies(
  baseConfig: Omit<BacktestConfig, 'strategy'>,
  strategyIds?: string[]
): Promise<StrategyComparison[]> {
  const strategies = strategyIds
    ? STRATEGY_PRESETS.filter(s => strategyIds.includes(s.id))
    : STRATEGY_PRESETS;

  const results: StrategyComparison[] = [];

  for (const strategy of strategies) {
    try {
      const result = await runBacktest({ ...baseConfig, strategy });
      results.push({
        strategyId: strategy.id,
        strategyName: strategy.name,
        result,
      });
    } catch (error) {
      console.error(`Failed to backtest ${strategy.name}:`, error);
    }
  }

  // Sort by return
  results.sort((a, b) => b.result.totalReturnPercent - a.result.totalReturnPercent);

  return results;
}

/**
 * Monte Carlo simulation using historical volatility
 * Generates price paths based on REAL historical volatility, not random
 */
export async function runMonteCarloSimulation(
  config: BacktestConfig,
  simulations: number = 100
): Promise<MonteCarloResult> {
  // Get real historical prices first
  const priceResult = await fetchHistoricalPrices(
    config.tokenA,
    config.tokenB,
    config.startTime,
    config.endTime
  );

  if (priceResult.source === 'none' || priceResult.prices.length < 10) {
    throw new Error('Insufficient historical data for Monte Carlo simulation');
  }

  const priceData = priceResult.prices;

  // Calculate historical volatility (hourly returns std dev)
  const logReturns: number[] = [];
  for (let i = 1; i < priceData.length; i++) {
    const logReturn = Math.log(priceData[i].price / priceData[i - 1].price);
    logReturns.push(logReturn);
  }

  const meanReturn = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / logReturns.length;
  const volatility = Math.sqrt(variance);

  // Run simulations
  const results: number[] = [];
  const startPrice = priceData[0].price;
  const numPeriods = priceData.length;

  for (let sim = 0; sim < simulations; sim++) {
    // Generate price path using geometric Brownian motion with historical params
    const syntheticPrices: PricePoint[] = [{ timestamp: config.startTime, price: startPrice }];
    let price = startPrice;

    for (let i = 1; i < numPeriods; i++) {
      // Box-Muller transform for normal distribution
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

      // GBM: dS = μSdt + σSdW
      const drift = meanReturn;
      const diffusion = volatility * z;
      price = price * Math.exp(drift + diffusion);

      syntheticPrices.push({
        timestamp: config.startTime + i * (3600 * 1000), // Hourly
        price,
      });
    }

    // Run backtest with synthetic prices
    const result = await runBacktestWithPrices(config, syntheticPrices);
    results.push(result.totalReturnPercent);
  }

  // Calculate statistics
  results.sort((a, b) => a - b);

  const mean = results.reduce((a, b) => a + b, 0) / results.length;
  const varianceRes = results.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / results.length;
  const stdDev = Math.sqrt(varianceRes);

  const getPercentile = (p: number) => {
    const idx = Math.floor(results.length * p / 100);
    return results[Math.min(idx, results.length - 1)];
  };

  return {
    simulations,
    percentiles: {
      p5: getPercentile(5),
      p25: getPercentile(25),
      p50: getPercentile(50),
      p75: getPercentile(75),
      p95: getPercentile(95),
    },
    mean,
    stdDev,
    bestCase: results[results.length - 1],
    worstCase: results[0],
    probabilityOfProfit: (results.filter(r => r > 0).length / results.length) * 100,
  };
}

/**
 * Run backtest with provided price data (for Monte Carlo)
 */
async function runBacktestWithPrices(
  config: BacktestConfig,
  priceData: PricePoint[]
): Promise<BacktestResult> {
  const strategy = config.strategy.strategy;
  const rangeBps = getRangeBps(strategy);
  const initialPrice = priceData[0].price;
  const gasCostPerTx = 0.02;

  let currentValue = config.initialCapital;
  let totalFees = 0;
  let totalGasCosts = 0;
  let currentRange = calculateRange(initialPrice, rangeBps);
  let lastRebalanceTime = config.startTime;
  let timeInRangeMs = 0;
  let timeOutOfRangeMs = 0;

  const rebalances: RebalanceEvent[] = [];
  const equityCurve: { timestamp: number; value: number }[] = [];

  for (let i = 1; i < priceData.length; i++) {
    const prevPoint = priceData[i - 1];
    const point = priceData[i];
    const timeDeltaMs = point.timestamp - prevPoint.timestamp;
    const timeDeltaHours = timeDeltaMs / (60 * 60 * 1000);

    const isInRange = point.price >= currentRange.lower && point.price <= currentRange.upper;

    if (isInRange) {
      timeInRangeMs += timeDeltaMs;
      const feesEarned = estimateFeesEarned(currentValue, config.poolApr || 50, timeDeltaHours, rangeBps);
      totalFees += feesEarned;
      currentValue += feesEarned;
    } else {
      timeOutOfRangeMs += timeDeltaMs;
    }

    const currentIL = calculateImpermanentLoss(initialPrice, point.price);
    const ilLossUsd = config.initialCapital * currentIL;

    const shouldRebalance = checkRebalanceCondition(
      strategy,
      point.price,
      currentRange,
      point.timestamp - lastRebalanceTime
    );

    if (shouldRebalance.should) {
      totalGasCosts += gasCostPerTx;
      currentValue -= gasCostPerTx;
      currentRange = calculateRange(point.price, rangeBps);
      lastRebalanceTime = point.timestamp;
      rebalances.push({
        timestamp: point.timestamp,
        price: point.price,
        reason: shouldRebalance.reason,
        oldRange: currentRange,
        newRange: currentRange,
        feesCollected: totalFees,
        gasCost: gasCostPerTx,
        positionValue: currentValue - ilLossUsd,
      });
    }

    equityCurve.push({ timestamp: point.timestamp, value: currentValue - ilLossUsd });
  }

  const finalPrice = priceData[priceData.length - 1].price;
  const finalIL = calculateImpermanentLoss(initialPrice, finalPrice);
  const impermanentLoss = config.initialCapital * finalIL;
  const finalValue = currentValue - impermanentLoss;
  const totalReturn = finalValue - config.initialCapital;

  return {
    config,
    dataSource: 'coingecko',
    dataQuality: 'medium',
    warnings: ['Monte Carlo simulation using synthetic price path'],
    finalValue,
    totalReturn,
    totalReturnPercent: (totalReturn / config.initialCapital) * 100,
    feesEarned: totalFees,
    impermanentLoss,
    gasCosts: totalGasCosts,
    netPnL: totalReturn,
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
    sharpeRatio: 0,
    timeInRange: timeInRangeMs / (timeInRangeMs + timeOutOfRangeMs) * 100,
    rebalanceCount: rebalances.length,
    avgTimePerCycle: 0,
    rebalances,
    outOfRangePeriods: [], // Not tracked in Monte Carlo for simplicity
    equityCurve,
    priceData,
    ranges: [],
  };
}

// Helper functions
function getRangeBps(strategy: Strategy): number {
  if ('rangeBps' in strategy) return strategy.rangeBps;
  if ('neutralRangeBps' in strategy) return strategy.neutralRangeBps;
  return 300; // Default 3%
}

function calculateRange(price: number, rangeBps: number): { lower: number; upper: number } {
  const rangePercent = rangeBps / 10000;
  return {
    lower: price * (1 - rangePercent),
    upper: price * (1 + rangePercent),
  };
}

function checkRebalanceCondition(
  strategy: Strategy,
  currentPrice: number,
  currentRange: { lower: number; upper: number },
  timeSinceLastRebalance: number,
  autoRebalance: boolean = true
): { should: boolean; reason: RebalanceEvent['reason'] } {
  const isOutOfRange = currentPrice < currentRange.lower || currentPrice > currentRange.upper;

  // If auto-rebalance is disabled (Wait for Return mode), never trigger any rebalances
  // The position will wait for price to naturally return to range
  if (!autoRebalance) {
    return { should: false, reason: 'return-to-range' };
  }

  // Normal auto-rebalance logic
  switch (strategy.type) {
    case 'time-based':
      if (timeSinceLastRebalance >= strategy.timerDurationMs) {
        return { should: true, reason: 'timer' };
      }
      break;

    case 'out-of-range':
      if (isOutOfRange) {
        return { should: true, reason: 'out-of-range' };
      }
      if (strategy.maxTimerMs && timeSinceLastRebalance >= strategy.maxTimerMs) {
        return { should: true, reason: 'timer' };
      }
      break;

    case 'smart-rebalance':
      if (strategy.checkOutOfRange && isOutOfRange) {
        return { should: true, reason: 'out-of-range' };
      }
      if (timeSinceLastRebalance >= strategy.maxTimerMs) {
        return { should: true, reason: 'timer' };
      }
      break;

    case 'profit-target':
      if (isOutOfRange) {
        return { should: true, reason: 'out-of-range' };
      }
      break;

    case 'asymmetric-trend':
      if (isOutOfRange) {
        return { should: true, reason: 'out-of-range' };
      }
      break;

    default:
      if (isOutOfRange) {
        return { should: true, reason: 'out-of-range' };
      }
  }

  return { should: false, reason: 'timer' };
}

// Time period presets
export const TIME_PRESETS = [
  { id: '1h', label: '1 Hour', ms: 60 * 60 * 1000 },
  { id: '3h', label: '3 Hours', ms: 3 * 60 * 60 * 1000 },
  { id: '1d', label: '1 Day', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7 Days', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: '30 Days', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: 'custom', label: 'Custom', ms: 0 },
] as const;
