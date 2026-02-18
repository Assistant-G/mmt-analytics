/**
 * Price Service
 *
 * Combines:
 * - DeFiLlama API for current prices (simple, fast, no CORS issues)
 * - CoinGecko API for historical prices and volatility calculations
 * - Position cycle tracking (localStorage)
 * - Price alerts (localStorage)
 */

// ============================================
// CoinGecko API (Historical Prices)
// ============================================

const COINGECKO_API_KEY = 'CG-GnjayGS49D9Fo7vJpGAzBRKs';
const CORS_PROXY = 'https://corsproxy.io/?';

async function fetchWithCorsProxy(url: string): Promise<Response> {
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'x-cg-demo-api-key': COINGECKO_API_KEY,
      },
    });
    if (response.ok) return response;
  } catch {
    // CORS error, try proxy
  }

  const proxyUrl = CORS_PROXY + encodeURIComponent(url);
  return fetch(proxyUrl, {
    headers: { 'Accept': 'application/json' },
  });
}

// Token symbol to CoinGecko ID mapping
const COINGECKO_IDS: Record<string, string> = {
  SUI: 'sui',
  USDC: 'usd-coin',
  USDT: 'tether',
  WETH: 'weth',
  ETH: 'ethereum',
  WBTC: 'wrapped-bitcoin',
  BTC: 'bitcoin',
  DEEP: 'deepbook',
  SOL: 'solana',
  CETUS: 'cetus-protocol',
  TURBOS: 'turbos-finance',
  NAVX: 'navi-protocol',
  BUCK: 'bucket-protocol-buck',
  SCA: 'scallop-2',
  AFSUI: 'aftermath-staked-sui',
  HASUI: 'haedal-staked-sui',
  VSUI: 'volo-staked-sui',
  WAL: 'walrus-2',
  MMT: 'mammoth-mmt',
  'YBTC.B': 'bitcoin',
  YBTC: 'bitcoin',
  XBTC: 'bitcoin',
  'xBTC': 'bitcoin',
  WBTC_SUI: 'wrapped-bitcoin',
  SUIUSDT: 'tether',
  'suiUSDT': 'tether',
  SUIUSDC: 'usd-coin',
  USDC_SUI: 'usd-coin',
  USDT_SUI: 'tether',
  XSUI: 'sui',
  'xSUI': 'sui',
  WSUI: 'sui',
  XAUM: 'tether-gold',
  XAUM_SUI: 'tether-gold',
  AUSD: 'usd-coin',
  FUSD: 'usd-coin',
};

// ============================================
// DeFiLlama API (Current Prices)
// ============================================

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface SimplePriceCache {
  price: number;
  timestamp: number;
}

const simplePriceCache: Map<string, SimplePriceCache> = new Map();

const DEFILLAMA_IDS: Record<string, string> = {
  SUI: 'coingecko:sui',
  USDC: 'coingecko:usd-coin',
  USDT: 'coingecko:tether',
  ETH: 'coingecko:ethereum',
  BTC: 'coingecko:bitcoin',
};

// Fallback prices - only used if DeFiLlama API completely fails
// These should rarely be needed since we initialize cache at app startup
const FALLBACK_PRICES: Record<string, number> = {
  SUI: 2.50,  // Conservative fallback - real price fetched from DeFiLlama
  USDC: 1.0,
  USDT: 1.0,
  ETH: 3200,
  BTC: 95000,
};

const XSUI_RATE = 1.00968;

async function fetchPriceFromDeFiLlama(symbol: string): Promise<number | null> {
  const defillamaId = DEFILLAMA_IDS[symbol.toUpperCase()];
  if (!defillamaId) {
    console.warn(`[Price] No DeFiLlama ID for ${symbol}`);
    return null;
  }

  try {
    const url = `https://coins.llama.fi/prices/current/${defillamaId}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.warn(`[Price] DeFiLlama API error for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const price = data.coins?.[defillamaId]?.price;

    if (typeof price === 'number' && price > 0) {
      console.log(`[Price] Fetched ${symbol} price from DeFiLlama: $${price.toFixed(4)}`);
      return price;
    }
    console.warn(`[Price] Invalid price data for ${symbol}:`, data);
    return null;
  } catch (error) {
    console.warn(`[Price] Failed to fetch ${symbol} from DeFiLlama:`, error);
    return null;
  }
}

/**
 * Fetch historical price at a specific timestamp from DeFiLlama
 * @param symbol Token symbol (e.g., 'SUI')
 * @param timestamp Unix timestamp in milliseconds
 * @returns Price at that timestamp, or null if not available
 */
export async function fetchHistoricalPrice(symbol: string, timestamp: number): Promise<number | null> {
  const defillamaId = DEFILLAMA_IDS[symbol.toUpperCase()];
  if (!defillamaId) {
    return null;
  }

  try {
    // Convert to seconds for DeFiLlama API
    const timestampSec = Math.floor(timestamp / 1000);

    const response = await fetch(
      `https://coins.llama.fi/prices/historical/${timestampSec}/${defillamaId}`,
      { method: 'GET', headers: { 'Accept': 'application/json' } }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const price = data.coins?.[defillamaId]?.price;

    if (typeof price === 'number' && price > 0) {
      return price;
    }
    return null;
  } catch (error) {
    console.warn(`Failed to fetch historical price for ${symbol} at ${timestamp}:`, error);
    return null;
  }
}

async function getCachedPrice(symbol: string): Promise<number> {
  const upperSymbol = symbol.toUpperCase();
  const cached = simplePriceCache.get(upperSymbol);
  const now = Date.now();

  if (cached && (now - cached.timestamp) < CACHE_DURATION) {
    return cached.price;
  }

  const freshPrice = await fetchPriceFromDeFiLlama(upperSymbol);

  if (freshPrice !== null) {
    simplePriceCache.set(upperSymbol, { price: freshPrice, timestamp: now });
    return freshPrice;
  }

  if (cached) {
    return cached.price;
  }

  return FALLBACK_PRICES[upperSymbol] || 1.0;
}

export async function fetchSuiPrice(): Promise<number> {
  return getCachedPrice('SUI');
}

export async function fetchXSuiPrice(): Promise<number> {
  const suiPrice = await fetchSuiPrice();
  return suiPrice * XSUI_RATE;
}

export async function fetchTokenPrice(symbol: string): Promise<number> {
  const upperSymbol = symbol.toUpperCase();

  if (upperSymbol === 'USDC' || upperSymbol === 'USDT') {
    return 1.0;
  }

  if (upperSymbol === 'XSUI') {
    return fetchXSuiPrice();
  }

  return getCachedPrice(symbol);
}

export async function fetchTokenPrices(symbols: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      prices[symbol.toUpperCase()] = await fetchTokenPrice(symbol);
    })
  );
  return prices;
}

export function getSuiPriceSync(): number {
  const cached = simplePriceCache.get('SUI');
  if (cached) {
    return cached.price;
  }
  // Trigger async fetch for next time
  fetchSuiPrice().catch(() => {});
  console.log(`[Price] SUI cache miss, using fallback: $${FALLBACK_PRICES.SUI}`);
  return FALLBACK_PRICES.SUI;
}

export function getXSuiPriceSync(): number {
  const suiPrice = getSuiPriceSync();
  const xSuiPrice = suiPrice * XSUI_RATE;
  return xSuiPrice;
}

export function getTokenPriceSync(symbol: string): number {
  const upperSymbol = symbol.toUpperCase();

  if (upperSymbol === 'USDC' || upperSymbol === 'USDT') return 1.0;
  if (upperSymbol === 'XSUI') return getXSuiPriceSync();

  const cached = simplePriceCache.get(upperSymbol);
  if (cached) return cached.price;

  fetchTokenPrice(symbol).catch(() => {});
  return FALLBACK_PRICES[upperSymbol] || 1.0;
}

export async function initializePriceCache(): Promise<void> {
  console.log('[Price] Initializing price cache...');
  try {
    await Promise.all([fetchSuiPrice(), fetchTokenPrice('USDC')]);
    console.log('[Price] Price cache initialized');
  } catch (error) {
    console.warn('[Price] Failed to initialize cache:', error);
  }
}

export function clearPriceCache(): void {
  simplePriceCache.clear();
  console.log('[Price] Price cache cleared');
}

// ============================================
// CoinGecko Historical Prices & Volatility
// ============================================

interface HistoryPriceCache {
  data: PriceHistoryPoint[];
  timestamp: number;
  ttl: number;
}

const historyPriceCache: Map<string, HistoryPriceCache> = new Map();
const HISTORY_CACHE_TTL = 5 * 60 * 1000;

export interface PriceHistoryPoint {
  timestamp: number;
  price: number;
  volume?: number;
}

export interface VolatilityData {
  daily: number;
  weekly: number;
  monthly: number;
  annualized: number;
}

export interface PriceAlert {
  tokenSymbol: string;
  currentPrice: number;
  targetPrice: number;
  direction: 'above' | 'below';
  triggered: boolean;
}

function getCoinGeckoId(symbol: string): string | null {
  if (COINGECKO_IDS[symbol]) return COINGECKO_IDS[symbol];

  const upper = symbol.toUpperCase();
  if (COINGECKO_IDS[upper]) return COINGECKO_IDS[upper];

  const withoutW = upper.replace(/^W/, '');
  if (COINGECKO_IDS[withoutW]) return COINGECKO_IDS[withoutW];

  const cleaned = upper.replace(/_SUI$/, '').replace(/^SUI/, '').replace(/\.B$/, '');
  if (COINGECKO_IDS[cleaned]) return COINGECKO_IDS[cleaned];

  if (upper.includes('BTC') || upper.includes('BITCOIN')) return 'bitcoin';
  if (upper.includes('ETH') || upper.includes('ETHER')) return 'ethereum';
  if (upper.includes('USDC')) return 'usd-coin';
  if (upper.includes('USDT')) return 'tether';
  if (upper.includes('SUI') && !upper.includes('USD')) return 'sui';

  return null;
}

export async function fetchPriceHistory(
  tokenSymbol: string,
  days: number = 30,
  vsCurrency: string = 'usd'
): Promise<PriceHistoryPoint[]> {
  const coinId = getCoinGeckoId(tokenSymbol);

  if (!coinId) {
    console.warn(`No CoinGecko ID found for ${tokenSymbol}, using fallback`);
    return generateFallbackPriceHistory(days);
  }

  const cacheKey = `${coinId}-${days}-${vsCurrency}`;
  const cached = historyPriceCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    return cached.data;
  }

  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=${vsCurrency}&days=${days}&interval=${days > 7 ? 'daily' : 'hourly'}&x_cg_demo_api_key=${COINGECKO_API_KEY}`;
    const response = await fetchWithCorsProxy(url);

    if (!response.ok) {
      if (response.status === 429) {
        console.warn('CoinGecko rate limit hit, using cached or fallback data');
        return cached?.data || generateFallbackPriceHistory(days);
      }
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();

    const priceHistory: PriceHistoryPoint[] = data.prices.map((point: [number, number], index: number) => ({
      timestamp: point[0],
      price: point[1],
      volume: data.total_volumes?.[index]?.[1] || 0,
    }));

    historyPriceCache.set(cacheKey, {
      data: priceHistory,
      timestamp: Date.now(),
      ttl: HISTORY_CACHE_TTL,
    });

    return priceHistory;
  } catch (error) {
    console.error(`Error fetching price history for ${tokenSymbol}:`, error);
    return cached?.data || generateFallbackPriceHistory(days);
  }
}

export async function fetchCurrentPrice(tokenSymbol: string): Promise<number | null> {
  const coinId = getCoinGeckoId(tokenSymbol);
  if (!coinId) return null;

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&x_cg_demo_api_key=${COINGECKO_API_KEY}`;
    const response = await fetchWithCorsProxy(url);
    if (!response.ok) return null;

    const data = await response.json();
    return data[coinId]?.usd || null;
  } catch (error) {
    console.error(`Error fetching current price for ${tokenSymbol}:`, error);
    return null;
  }
}

export function calculateVolatility(priceHistory: PriceHistoryPoint[]): VolatilityData {
  if (priceHistory.length < 2) {
    return { daily: 0, weekly: 0, monthly: 0, annualized: 0 };
  }

  const returns: number[] = [];
  for (let i = 1; i < priceHistory.length; i++) {
    const logReturn = Math.log(priceHistory[i].price / priceHistory[i - 1].price);
    returns.push(logReturn);
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  const timeDiff = priceHistory[1].timestamp - priceHistory[0].timestamp;
  const isHourly = timeDiff < 24 * 60 * 60 * 1000;

  const periodsPerYear = isHourly ? 365 * 24 : 365;
  const periodsPerDay = isHourly ? 24 : 1;
  const periodsPerWeek = isHourly ? 24 * 7 : 7;
  const periodsPerMonth = isHourly ? 24 * 30 : 30;

  return {
    daily: stdDev * Math.sqrt(periodsPerDay) * 100,
    weekly: stdDev * Math.sqrt(periodsPerWeek) * 100,
    monthly: stdDev * Math.sqrt(periodsPerMonth) * 100,
    annualized: stdDev * Math.sqrt(periodsPerYear) * 100,
  };
}

export function calculateOptimalRangeWidth(
  volatility: VolatilityData,
  feeApr: number,
  riskTolerance: 'conservative' | 'moderate' | 'aggressive' = 'moderate'
): { narrow: number; optimal: number; wide: number } {
  const baseVolatility = volatility.weekly;

  const riskMultipliers = {
    conservative: 1.5,
    moderate: 1.0,
    aggressive: 0.7,
  };

  const feeAdjustment = Math.max(0.6, 1 - (feeApr / 150));
  const multiplier = riskMultipliers[riskTolerance] * feeAdjustment;

  return {
    narrow: Math.max(1, Math.min(10, baseVolatility * 0.5 * multiplier)),
    optimal: Math.max(3, Math.min(25, baseVolatility * multiplier)),
    wide: Math.max(5, Math.min(50, baseVolatility * 1.8 * multiplier)),
  };
}

export function calculateImpermanentLoss(priceChangePercent: number): number {
  const priceRatio = 1 + priceChangePercent / 100;
  if (priceRatio <= 0) return 100;

  const sqrtRatio = Math.sqrt(priceRatio);
  const holdValue = (1 + priceRatio) / 2;
  const lpValue = sqrtRatio;

  const il = (lpValue / holdValue - 1) * 100;
  return Math.abs(il);
}

export function calculateBreakEvenTime(
  totalApr: number,
  estimatedILPercent: number,
  _positionValueUsd?: number
): { days: number; confident: boolean } {
  if (totalApr <= 0) {
    return { days: Infinity, confident: false };
  }

  const dailyEarningRate = totalApr / 365 / 100;
  const ilLossPercent = estimatedILPercent / 100;
  const days = ilLossPercent / dailyEarningRate;

  return {
    days: Math.max(0, days),
    confident: totalApr > 20 && estimatedILPercent < 10,
  };
}

function generateFallbackPriceHistory(days: number): PriceHistoryPoint[] {
  const points: PriceHistoryPoint[] = [];
  const now = Date.now();
  const interval = days > 7 ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const numPoints = days > 7 ? days : days * 24;

  let price = 1;

  for (let i = numPoints; i >= 0; i--) {
    price = price * (1 + (Math.random() - 0.5) * 0.04);
    points.push({
      timestamp: now - i * interval,
      price,
      volume: Math.random() * 1000000,
    });
  }

  return points;
}

// ============================================
// Position Cycle Tracking (localStorage)
// ============================================

export interface PositionCycle {
  id: string;
  positionId: string;
  poolId: string;
  poolName: string;
  openTimestamp: number;
  closeTimestamp: number | null;
  openValueUsd: number;
  closeValueUsd: number | null;
  feesEarnedUsd: number;
  rewardsEarnedUsd: number;
  estimatedIL: number;
  netPnl: number | null;
  status: 'open' | 'closed';
  // Range info
  priceLower?: number;
  priceUpper?: number;
  currentValueUsd?: number;
  // Price tracking for actual IL calculation
  entryPrice?: number;
  currentPrice?: number;
}

const CYCLES_STORAGE_KEY = 'mmt-position-cycles';

export function getPositionCycles(): PositionCycle[] {
  try {
    const stored = localStorage.getItem(CYCLES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function savePositionCycles(cycles: PositionCycle[]): void {
  try {
    localStorage.setItem(CYCLES_STORAGE_KEY, JSON.stringify(cycles));
  } catch (error) {
    console.error('Error saving position cycles:', error);
  }
}

export function trackPositionOpen(
  positionId: string,
  poolId: string,
  poolName: string,
  valueUsd: number,
  priceLower?: number,
  priceUpper?: number,
  openTimestamp?: number,
  entryPrice?: number
): PositionCycle {
  const cycles = getPositionCycles();

  const newCycle: PositionCycle = {
    id: `${positionId}-${Date.now()}`,
    positionId,
    poolId,
    poolName,
    openTimestamp: openTimestamp || Date.now(),
    closeTimestamp: null,
    openValueUsd: valueUsd,
    closeValueUsd: null,
    feesEarnedUsd: 0,
    rewardsEarnedUsd: 0,
    estimatedIL: 0,
    netPnl: null,
    status: 'open',
    priceLower,
    priceUpper,
    currentValueUsd: valueUsd,
    entryPrice,
    currentPrice: entryPrice,
  };

  cycles.unshift(newCycle);
  savePositionCycles(cycles);

  return newCycle;
}

export function trackPositionClose(
  positionId: string,
  closeValueUsd: number,
  feesEarnedUsd: number,
  rewardsEarnedUsd: number,
  estimatedIL: number
): PositionCycle | null {
  const cycles = getPositionCycles();

  const openCycle = cycles.find(c => c.positionId === positionId && c.status === 'open');
  if (!openCycle) return null;

  openCycle.closeTimestamp = Date.now();
  openCycle.closeValueUsd = closeValueUsd;
  openCycle.feesEarnedUsd = feesEarnedUsd;
  openCycle.rewardsEarnedUsd = rewardsEarnedUsd;
  openCycle.estimatedIL = estimatedIL;
  openCycle.netPnl = closeValueUsd - openCycle.openValueUsd + feesEarnedUsd + rewardsEarnedUsd;
  openCycle.status = 'closed';

  savePositionCycles(cycles);

  return openCycle;
}

/**
 * Calculate actual IL from entry price vs current price
 * Formula: IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
 * Returns IL as a percentage (e.g., 0.14 for 0.14% IL)
 */
export function calculateActualIL(entryPrice: number, currentPrice: number): number {
  if (!entryPrice || entryPrice <= 0 || !currentPrice || currentPrice <= 0) {
    return 0;
  }
  const priceRatio = currentPrice / entryPrice;
  const sqrtRatio = Math.sqrt(priceRatio);
  const ilFactor = 2 * sqrtRatio / (1 + priceRatio) - 1;
  // Convert to percentage and return absolute value
  return Math.abs(ilFactor * 100);
}

export function updatePositionCycleEarnings(
  positionId: string,
  feesEarnedUsd: number,
  rewardsEarnedUsd: number,
  estimatedIL: number,
  currentValueUsd?: number,
  priceLower?: number,
  priceUpper?: number,
  actualOpenTimestamp?: number,
  currentPrice?: number
): void {
  const cycles = getPositionCycles();

  const openCycle = cycles.find(c => c.positionId === positionId && c.status === 'open');
  if (openCycle) {
    openCycle.feesEarnedUsd = feesEarnedUsd;
    openCycle.rewardsEarnedUsd = rewardsEarnedUsd;

    // Update current price and calculate actual IL if we have entry price
    if (currentPrice !== undefined && currentPrice > 0) {
      openCycle.currentPrice = currentPrice;
      // Set entry price if not already set (first time seeing this position)
      if (!openCycle.entryPrice || openCycle.entryPrice <= 0) {
        openCycle.entryPrice = currentPrice;
      }
      // Calculate actual IL from price movement
      openCycle.estimatedIL = calculateActualIL(openCycle.entryPrice, currentPrice);
    } else {
      // Fall back to volatility-based estimate
      openCycle.estimatedIL = estimatedIL;
    }

    if (currentValueUsd !== undefined) {
      openCycle.currentValueUsd = currentValueUsd;
    }
    // Update range info if not set or if provided
    if (priceLower !== undefined && (!openCycle.priceLower || openCycle.priceLower === 0)) {
      openCycle.priceLower = priceLower;
    }
    if (priceUpper !== undefined && (!openCycle.priceUpper || openCycle.priceUpper === 0)) {
      openCycle.priceUpper = priceUpper;
    }
    // Fix openTimestamp only if stored timestamp is significantly NEWER than actual
    // This means it was probably set to browser open time instead of actual position creation
    // Never update if stored is older (that would be the correct historical time)
    if (actualOpenTimestamp && actualOpenTimestamp > 0) {
      const storedIsNewer = openCycle.openTimestamp > actualOpenTimestamp;
      const significantDiff = Math.abs(openCycle.openTimestamp - actualOpenTimestamp) > 60000; // 1 min
      if (storedIsNewer && significantDiff) {
        openCycle.openTimestamp = actualOpenTimestamp;
      }
    }
    savePositionCycles(cycles);
  }
}

export function getPositionCycleHistory(positionId: string): PositionCycle[] {
  return getPositionCycles().filter(c => c.positionId === positionId);
}

/**
 * Update the entry price for a position cycle (used when historical price is fetched)
 * This recalculates the IL based on the correct entry price
 */
export function updatePositionEntryPrice(
  positionId: string,
  entryPrice: number
): void {
  const cycles = getPositionCycles();
  const openCycle = cycles.find(c => c.positionId === positionId && c.status === 'open');

  if (openCycle && entryPrice > 0) {
    const currentPrice = openCycle.currentPrice || entryPrice;

    // Update entry price
    openCycle.entryPrice = entryPrice;

    // Recalculate IL with correct entry price
    if (currentPrice > 0) {
      openCycle.estimatedIL = calculateActualIL(entryPrice, currentPrice);
    }

    savePositionCycles(cycles);
    console.log(`Updated entry price for ${positionId}: $${entryPrice.toFixed(4)}, IL: ${openCycle.estimatedIL.toFixed(4)}%`);
  }
}

export function getCycleStatistics(): {
  totalCycles: number;
  openCycles: number;
  closedCycles: number;
  totalFeesEarned: number;
  totalRewardsEarned: number;
  totalIL: number;
  totalNetPnl: number;
  avgCycleDuration: number;
} {
  const cycles = getPositionCycles();
  const closedCycles = cycles.filter(c => c.status === 'closed');
  const openCycles = cycles.filter(c => c.status === 'open');

  const totalDuration = closedCycles.reduce((sum, c) => {
    return sum + ((c.closeTimestamp || 0) - c.openTimestamp);
  }, 0);

  // Calculate Net P&L for closed cycles
  const closedNetPnl = closedCycles.reduce((sum, c) => sum + (c.netPnl || 0), 0);

  // Calculate estimated Net P&L for open cycles (same formula as RangeAnalytics.tsx)
  const openNetPnl = openCycles.reduce((sum, cycle) => {
    const currentValue = cycle.currentValueUsd || cycle.openValueUsd;
    const valueDiff = currentValue - cycle.openValueUsd;
    const totalEarnings = cycle.feesEarnedUsd + cycle.rewardsEarnedUsd;
    const ilLoss = cycle.openValueUsd * (cycle.estimatedIL / 100);
    return sum + valueDiff + totalEarnings - ilLoss;
  }, 0);

  return {
    totalCycles: cycles.length,
    openCycles: openCycles.length,
    closedCycles: closedCycles.length,
    totalFeesEarned: cycles.reduce((sum, c) => sum + c.feesEarnedUsd, 0),
    totalRewardsEarned: cycles.reduce((sum, c) => sum + c.rewardsEarnedUsd, 0),
    totalIL: cycles.reduce((sum, c) => sum + c.estimatedIL, 0),
    totalNetPnl: closedNetPnl + openNetPnl, // Include both closed and open cycles
    avgCycleDuration: closedCycles.length > 0
      ? totalDuration / closedCycles.length / (1000 * 60 * 60 * 24)
      : 0,
  };
}

export function clearPositionCycles(): void {
  localStorage.removeItem(CYCLES_STORAGE_KEY);
}

// ============================================
// Price Alerts (localStorage)
// ============================================

const ALERTS_STORAGE_KEY = 'mmt-price-alerts';

export interface StoredPriceAlert {
  id: string;
  positionId: string;
  poolName: string;
  lowerBound: number;
  upperBound: number;
  currentPrice: number;
  alertThresholdPercent: number;
  createdAt: number;
  lastTriggered: number | null;
  enabled: boolean;
}

export function getPriceAlerts(): StoredPriceAlert[] {
  try {
    const stored = localStorage.getItem(ALERTS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function savePriceAlerts(alerts: StoredPriceAlert[]): void {
  try {
    localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(alerts));
  } catch (error) {
    console.error('Error saving price alerts:', error);
  }
}

export function createPriceAlert(
  positionId: string,
  poolName: string,
  lowerBound: number,
  upperBound: number,
  currentPrice: number,
  alertThresholdPercent: number = 5
): StoredPriceAlert {
  const alerts = getPriceAlerts();

  const alert: StoredPriceAlert = {
    id: `alert-${positionId}-${Date.now()}`,
    positionId,
    poolName,
    lowerBound,
    upperBound,
    currentPrice,
    alertThresholdPercent,
    createdAt: Date.now(),
    lastTriggered: null,
    enabled: true,
  };

  const filtered = alerts.filter(a => a.positionId !== positionId);
  filtered.push(alert);
  savePriceAlerts(filtered);

  return alert;
}

export function checkPriceAlerts(
  positions: Array<{ id: string; priceLower: number; priceUpper: number; pool: { priceTokenB: number } }>
): StoredPriceAlert[] {
  const alerts = getPriceAlerts();
  const triggered: StoredPriceAlert[] = [];

  for (const pos of positions) {
    const alert = alerts.find(a => a.positionId === pos.id && a.enabled);
    if (!alert) continue;

    const currentPrice = pos.pool.priceTokenB;
    const lowerDistance = ((currentPrice - pos.priceLower) / currentPrice) * 100;
    const upperDistance = ((pos.priceUpper - currentPrice) / currentPrice) * 100;
    const minDistance = Math.min(lowerDistance, upperDistance);

    alert.currentPrice = currentPrice;

    if (minDistance <= alert.alertThresholdPercent || currentPrice < pos.priceLower || currentPrice > pos.priceUpper) {
      alert.lastTriggered = Date.now();
      triggered.push(alert);
    }
  }

  savePriceAlerts(alerts);
  return triggered;
}

export function togglePriceAlert(alertId: string): void {
  const alerts = getPriceAlerts();
  const alert = alerts.find(a => a.id === alertId);
  if (alert) {
    alert.enabled = !alert.enabled;
    savePriceAlerts(alerts);
  }
}

export function deletePriceAlert(alertId: string): void {
  const alerts = getPriceAlerts().filter(a => a.id !== alertId);
  savePriceAlerts(alerts);
}
