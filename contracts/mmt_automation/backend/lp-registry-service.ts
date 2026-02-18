/**
 * LP Registry Backend Service
 *
 * Manages LP positions that are registered for automated operations:
 * - Auto Rebalance: Rebalance when position goes out of range (with configurable delay)
 * - Auto Compound: Compound trading fees back into the position
 * - Auto Claim Fees: Claim and send fees to owner
 * - Recurring: Execute recurring operations on schedule
 *
 * Position is wrapped in registry for privacy (hidden from portfolio trackers)
 * User keeps ownership via receipt, can withdraw anytime
 * Operator can only rebalance/compound, cannot steal funds
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { MmtSDK } from '@mmt-finance/clmm-sdk';
import BN from 'bn.js';

// ============ Styled Logger ============

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
};

const icons = {
  rocket: '🚀',
  check: '✅',
  cross: '❌',
  warning: '⚠️',
  clock: '⏱️',
  cycle: '🔄',
  registry: '📋',
  money: '💰',
  link: '🔗',
  info: 'ℹ️',
  star: '⭐',
  gear: '⚙️',
  stop: '🛑',
  search: '🔍',
  pause: '⏸️',
  play: '▶️',
  compound: '🔁',
  range: '📊',
};

class Logger {
  private formatTime(): string {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false });
    return `${colors.dim}[${time}]${colors.reset}`;
  }

  private shortId(id: string): string {
    return `${id.slice(0, 8)}...${id.slice(-6)}`;
  }

  box(title: string, content?: string[]): void {
    const width = 55;
    const line = '═'.repeat(width);

    console.log(`${colors.magenta}╔${line}╗${colors.reset}`);
    console.log(`${colors.magenta}║${colors.reset}${colors.bold}${colors.brightMagenta} ${title.padEnd(width - 1)}${colors.reset}${colors.magenta}║${colors.reset}`);

    if (content && content.length > 0) {
      console.log(`${colors.magenta}╠${line}╣${colors.reset}`);
      for (const line of content) {
        const paddedLine = ` ${line}`.padEnd(width);
        console.log(`${colors.magenta}║${colors.reset}${paddedLine}${colors.magenta}║${colors.reset}`);
      }
    }

    console.log(`${colors.magenta}╚${line}╝${colors.reset}`);
  }

  info(message: string, details?: Record<string, unknown>): void {
    console.log(`${this.formatTime()} ${colors.blue}${icons.info}${colors.reset} ${message}`);
    if (details) {
      for (const [key, value] of Object.entries(details)) {
        console.log(`   ${colors.dim}${key}:${colors.reset} ${colors.white}${value}${colors.reset}`);
      }
    }
  }

  success(message: string, txDigest?: string): void {
    console.log(`${this.formatTime()} ${colors.green}${icons.check}${colors.reset} ${colors.brightGreen}${message}${colors.reset}`);
    if (txDigest) {
      console.log(`   ${colors.dim}${icons.link} https://suivision.xyz/txblock/${txDigest}${colors.reset}`);
    }
  }

  error(message: string, error?: unknown): void {
    console.log(`${this.formatTime()} ${colors.red}${icons.cross}${colors.reset} ${colors.brightRed}${message}${colors.reset}`);
    if (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`   ${colors.dim}${errorMessage}${colors.reset}`);
    }
  }

  warn(message: string): void {
    console.log(`${this.formatTime()} ${colors.yellow}${icons.warning}${colors.reset} ${colors.brightYellow}${message}${colors.reset}`);
  }

  registry(positionId: string, action: string, details?: Record<string, unknown>): void {
    const shortId = this.shortId(positionId);
    console.log(`${this.formatTime()} ${colors.magenta}${icons.registry}${colors.reset} ${colors.brightMagenta}${shortId}${colors.reset} ${colors.dim}│${colors.reset} ${action}`);
    if (details) {
      for (const [key, value] of Object.entries(details)) {
        console.log(`   ${colors.dim}├─ ${key}:${colors.reset} ${colors.white}${value}${colors.reset}`);
      }
    }
  }

  range(positionId: string, currentTick: number, tickLower: number, tickUpper: number, isInRange: boolean): void {
    const shortId = this.shortId(positionId);
    const status = isInRange
      ? `${colors.green}IN RANGE${colors.reset}`
      : `${colors.red}OUT OF RANGE${colors.reset}`;
    console.log(`${this.formatTime()} ${colors.cyan}${icons.range}${colors.reset} ${shortId} ${colors.dim}│${colors.reset} ${status}`);
    console.log(`   ${colors.dim}├─ Current:${colors.reset} ${currentTick}`);
    console.log(`   ${colors.dim}├─ Lower:${colors.reset} ${tickLower}`);
    console.log(`   ${colors.dim}└─ Upper:${colors.reset} ${tickUpper}`);
  }

  outOfRangeDelay(positionId: string, secondsRemaining: number): void {
    const shortId = this.shortId(positionId);
    const timeStr = secondsRemaining >= 60
      ? `${Math.floor(secondsRemaining / 60)}m ${secondsRemaining % 60}s`
      : `${secondsRemaining}s`;
    console.log(`   ${colors.dim}${icons.clock} ${shortId}: Waiting ${timeStr} before rebalance (price may return)${colors.reset}`);
  }

  monitoring(count: number): void {
    if (count === 0) return;
    console.log(`${this.formatTime()} ${colors.brightBlack}${icons.search} Monitoring ${count} LP Registry position(s)${colors.reset}`);
  }

  ready(count: number, action: string): void {
    console.log(`\n${this.formatTime()} ${colors.brightGreen}${icons.star} Found ${count} position(s) ready for ${action}${colors.reset}`);
  }

  startup(config: { executor: string; network: string; pollInterval: number }): void {
    console.log('');
    this.box(`${icons.rocket} LP REGISTRY SERVICE`, [
      `${icons.gear} Network: ${config.network}`,
      `${icons.clock} Poll Interval: ${config.pollInterval / 1000}s`,
      `${icons.money} Executor: ${this.shortId(config.executor)}`,
      `     Features: Auto-Rebalance, Auto-Compound, Recurring`,
    ]);
    console.log('');
  }

  shutdown(): void {
    console.log(`\n${this.formatTime()} ${colors.yellow}${icons.stop}${colors.reset} ${colors.brightYellow}Shutting down gracefully...${colors.reset}\n`);
  }
}

const log = new Logger();

// ============ Configuration ============

// LP Registry contract IDs (new deployment)
const LP_REGISTRY_PACKAGE_ID = process.env.LP_REGISTRY_PACKAGE_ID || '0x302a07fee2847fd203aaaac779b7a5a9454a028b515f288fc27a5fe83cce11f9';
const LP_REGISTRY_ID = process.env.LP_REGISTRY_ID || '0x3bb1ff6d52796c8ea1f29ad20cf348eb5ddb0cae0b4afc98edfcb83aaea82afa';

// MMT Finance contract addresses
const MMT_PACKAGE_ID = '0xcf60a40f45d46fc1e828871a647c1e25a0915dec860d2662eb10fdb382c3c1d1';
const MMT_PUBLISHED_AT = '0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860';
const MMT_VERSION_ID = '0x2375a0b1ec12010aaea3b2545acfa2ad34cfbba03ce4b59f4c39e1e25eed1b2a';

const MMT_POSITION_TYPE = `${MMT_PUBLISHED_AT}::position::Position`;

const NETWORK = 'mainnet';
const POLLING_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL || '10000');
const CLOCK_OBJECT_ID = '0x6';

// ============ Types ============

interface RegisteredPosition {
  id: string;
  owner: string;
  poolId: string;
  tokenXType: string;
  tokenYType: string;
  rangeBps: number;

  // Feature toggles
  autoRebalance: boolean;
  autoCompound: boolean;
  autoClaimFees: boolean;
  recurring: boolean;

  // Rebalance delay settings
  rebalanceDelayMs: number; // Wait this long before rebalancing when out of range
  outOfRangeSince: number; // Timestamp when position first went out of range (0 if in range)

  // Recurring settings
  recurringIntervalMs: number;
  nextRecurringAt: number;

  // State
  isPaused: boolean;
  hasPosition: boolean;

  // Stats
  rebalanceCount: number;
  compoundCount: number;
  lastActionAt: number;
}

interface PoolData {
  objectId: string;
  tokenXType: string;
  tokenYType: string;
  currentTick: number;
  tickSpacing: number;
  rewarders: { coin_type: string }[];
}

interface PositionTicks {
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

// Track out-of-range timestamps in memory (persists across polls)
const outOfRangeTracker: Map<string, number> = new Map();

// ============ Tick Math Helpers ============

function signedShiftRight(n0: BN, shiftBy: number, bitWidth: number): BN {
  const twoN0 = n0.toTwos(bitWidth).shrn(shiftBy);
  twoN0.imaskn(bitWidth - shiftBy + 1);
  return twoN0.fromTwos(bitWidth - shiftBy);
}

function tickIndexToSqrtPricePositive(tick: number): BN {
  let ratio: BN;
  if ((tick & 1) !== 0) ratio = new BN('79232123823359799118286999567');
  else ratio = new BN('79228162514264337593543950336');
  if ((tick & 2) !== 0) ratio = signedShiftRight(ratio.mul(new BN('79236085330515764027303304731')), 96, 256);
  if ((tick & 4) !== 0) ratio = signedShiftRight(ratio.mul(new BN('79244008939048815603706035061')), 96, 256);
  if ((tick & 8) !== 0) ratio = signedShiftRight(ratio.mul(new BN('79259858533276714757314932305')), 96, 256);
  if ((tick & 16) !== 0) ratio = signedShiftRight(ratio.mul(new BN('79291567232598584799939703904')), 96, 256);
  if ((tick & 32) !== 0) ratio = signedShiftRight(ratio.mul(new BN('79355022692464371645785046466')), 96, 256);
  if ((tick & 64) !== 0) ratio = signedShiftRight(ratio.mul(new BN('79482085999252804386437311141')), 96, 256);
  if ((tick & 128) !== 0) ratio = signedShiftRight(ratio.mul(new BN('79736823300114093921829183326')), 96, 256);
  if ((tick & 256) !== 0) ratio = signedShiftRight(ratio.mul(new BN('80248749790819932309965073892')), 96, 256);
  if ((tick & 512) !== 0) ratio = signedShiftRight(ratio.mul(new BN('81282483887344747381513967011')), 96, 256);
  if ((tick & 1024) !== 0) ratio = signedShiftRight(ratio.mul(new BN('83390072131320151908154831281')), 96, 256);
  if ((tick & 2048) !== 0) ratio = signedShiftRight(ratio.mul(new BN('87770609709833776024991924138')), 96, 256);
  if ((tick & 4096) !== 0) ratio = signedShiftRight(ratio.mul(new BN('97234110755111693312479820773')), 96, 256);
  if ((tick & 8192) !== 0) ratio = signedShiftRight(ratio.mul(new BN('119332217159966728226237229890')), 96, 256);
  if ((tick & 16384) !== 0) ratio = signedShiftRight(ratio.mul(new BN('179736315981702064433883588727')), 96, 256);
  if ((tick & 32768) !== 0) ratio = signedShiftRight(ratio.mul(new BN('407748233172238350107850275304')), 96, 256);
  if ((tick & 65536) !== 0) ratio = signedShiftRight(ratio.mul(new BN('2098478828474011932436660412517')), 96, 256);
  if ((tick & 131072) !== 0) ratio = signedShiftRight(ratio.mul(new BN('55581415166113811149459800483533')), 96, 256);
  if ((tick & 262144) !== 0) ratio = signedShiftRight(ratio.mul(new BN('38992368544603139932233054999993551')), 96, 256);
  return signedShiftRight(ratio, 32, 256);
}

function tickIndexToSqrtPriceNegative(tickIndex: number): BN {
  const tick = Math.abs(tickIndex);
  let ratio: BN;
  if ((tick & 1) !== 0) ratio = new BN('18445821805675392311');
  else ratio = new BN('18446744073709551616');
  if ((tick & 2) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18444899583751176498')), 64, 256);
  if ((tick & 4) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18443055278223354162')), 64, 256);
  if ((tick & 8) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18439367220385604838')), 64, 256);
  if ((tick & 16) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18431993317065449817')), 64, 256);
  if ((tick & 32) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18417254355718160513')), 64, 256);
  if ((tick & 64) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18387811781193591352')), 64, 256);
  if ((tick & 128) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18329067761203520168')), 64, 256);
  if ((tick & 256) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18212142134806087854')), 64, 256);
  if ((tick & 512) !== 0) ratio = signedShiftRight(ratio.mul(new BN('17980523815641551639')), 64, 256);
  if ((tick & 1024) !== 0) ratio = signedShiftRight(ratio.mul(new BN('17526086738831147013')), 64, 256);
  if ((tick & 2048) !== 0) ratio = signedShiftRight(ratio.mul(new BN('16651378430235024244')), 64, 256);
  if ((tick & 4096) !== 0) ratio = signedShiftRight(ratio.mul(new BN('15030750278693429944')), 64, 256);
  if ((tick & 8192) !== 0) ratio = signedShiftRight(ratio.mul(new BN('12247334978882834399')), 64, 256);
  if ((tick & 16384) !== 0) ratio = signedShiftRight(ratio.mul(new BN('8131365268884726200')), 64, 256);
  if ((tick & 32768) !== 0) ratio = signedShiftRight(ratio.mul(new BN('3584323654723342297')), 64, 256);
  if ((tick & 65536) !== 0) ratio = signedShiftRight(ratio.mul(new BN('696457651847595233')), 64, 256);
  if ((tick & 131072) !== 0) ratio = signedShiftRight(ratio.mul(new BN('26294789957452057')), 64, 256);
  if ((tick & 262144) !== 0) ratio = signedShiftRight(ratio.mul(new BN('37481735321082')), 64, 256);
  return ratio;
}

function tickIndexToSqrtPriceX64(tickIndex: number): BN {
  if (tickIndex > 0) return tickIndexToSqrtPricePositive(tickIndex);
  return tickIndexToSqrtPriceNegative(tickIndex);
}

function toSignedTick(tick: number): number {
  const MAX_I32 = 2147483647;
  const OVERFLOW = 4294967296;
  if (tick > MAX_I32) return tick - OVERFLOW;
  return tick;
}

function alignTickToSpacing(tick: number, tickSpacing: number): number {
  if (!tickSpacing || tickSpacing <= 0) return tick;
  const sign = tick >= 0 ? 1 : -1;
  const absTick = Math.abs(tick);
  return Math.floor(absTick / tickSpacing) * tickSpacing * sign;
}

const MIN_TICK = -443636;
const MAX_TICK = 443636;

function calculateTickFromPercent(currentTick: number, percent: number, tickSpacing: number): number {
  const priceMultiplier = 1 + percent / 100;
  const tickOffset = Math.round(Math.log(priceMultiplier) / Math.log(1.0001));
  const rawTick = currentTick + tickOffset;
  const clampedTick = Math.max(MIN_TICK, Math.min(MAX_TICK, rawTick));
  return alignTickToSpacing(clampedTick, tickSpacing);
}

// ============ Service Class ============

class LPRegistryService {
  private client: SuiClient;
  private sdk: MmtSDK;
  private keypair: Ed25519Keypair;
  private executorAddress: string;
  private isRunning: boolean = false;

  constructor() {
    const rpcUrl = process.env.SUI_RPC_URL || getFullnodeUrl(NETWORK);
    this.client = new SuiClient({ url: rpcUrl });
    this.sdk = MmtSDK.NEW({ network: 'mainnet' });

    const privateKey = process.env.EXECUTOR_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('EXECUTOR_PRIVATE_KEY environment variable required');
    }

    if (privateKey.startsWith('suiprivkey')) {
      const { secretKey } = decodeSuiPrivateKey(privateKey);
      this.keypair = Ed25519Keypair.fromSecretKey(secretKey);
    } else {
      const secretKey = Uint8Array.from(Buffer.from(privateKey, 'hex'));
      this.keypair = Ed25519Keypair.fromSecretKey(secretKey);
    }

    this.executorAddress = this.keypair.getPublicKey().toSuiAddress();
  }

  private async getSuiClockTime(): Promise<number> {
    try {
      const clockObj = await this.client.getObject({
        id: CLOCK_OBJECT_ID,
        options: { showContent: true },
      });

      if (clockObj.data?.content?.dataType === 'moveObject') {
        const fields = (clockObj.data.content as any).fields;
        return Number(fields.timestamp_ms);
      }
    } catch (e) {
      log.warn('Failed to get Sui clock, using local time');
    }
    return Date.now();
  }

  async start(): Promise<void> {
    log.startup({
      executor: this.executorAddress,
      network: NETWORK,
      pollInterval: POLLING_INTERVAL_MS,
    });

    this.isRunning = true;

    while (this.isRunning) {
      try {
        await this.checkAndExecutePositions();
      } catch (error) {
        log.error('Error in polling cycle', error);
      }

      await this.sleep(POLLING_INTERVAL_MS);
    }
  }

  stop(): void {
    log.shutdown();
    this.isRunning = false;
  }

  private async checkAndExecutePositions(): Promise<void> {
    const currentTime = await this.getSuiClockTime();
    const positions = await this.findRegisteredPositions();

    log.monitoring(positions.length);

    // Process each position based on enabled features
    for (const position of positions) {
      if (position.isPaused) {
        continue; // Skip paused positions
      }

      if (!position.hasPosition) {
        continue; // No MMT position stored
      }

      try {
        const poolData = await this.getPoolData(position.poolId);
        const ticks = await this.getPositionTicks(position.id);

        if (!ticks) continue;

        const currentTick = toSignedTick(poolData.currentTick);
        const isInRange = currentTick >= ticks.tickLower && currentTick <= ticks.tickUpper;

        // Log current range status
        log.range(position.id, currentTick, ticks.tickLower, ticks.tickUpper, isInRange);

        // Check Auto-Rebalance
        if (position.autoRebalance && !isInRange) {
          const shouldRebalance = await this.checkRebalanceDelay(position, currentTime);
          if (shouldRebalance) {
            log.ready(1, 'rebalance');
            await this.executeRebalance(position, poolData, ticks.liquidity);
            outOfRangeTracker.delete(position.id); // Reset tracker after rebalance
          }
        } else if (isInRange) {
          // Position is back in range, clear the out-of-range tracker
          if (outOfRangeTracker.has(position.id)) {
            log.info(`Position ${position.id.slice(0, 10)}... returned to range, canceling rebalance`);
            outOfRangeTracker.delete(position.id);
          }
        }

        // Check Auto-Compound (only if in range to avoid wasting gas)
        if (position.autoCompound && position.recurring && isInRange) {
          if (currentTime >= position.nextRecurringAt) {
            log.ready(1, 'compound');
            await this.executeCompound(position, poolData, ticks.liquidity);
          }
        }

        // Check Auto-Claim Fees (if enabled separately from compound)
        if (position.autoClaimFees && !position.autoCompound && isInRange) {
          if (currentTime >= position.nextRecurringAt) {
            log.ready(1, 'claim fees');
            await this.executeClaimFees(position, poolData);
          }
        }

      } catch (error) {
        log.error(`Failed to process position ${position.id.slice(0, 10)}...`, error);
      }
    }
  }

  /**
   * Check if rebalance delay has passed
   * Returns true if position should be rebalanced now
   */
  private async checkRebalanceDelay(position: RegisteredPosition, currentTime: number): Promise<boolean> {
    const delayMs = position.rebalanceDelayMs || 0;

    if (delayMs === 0) {
      // No delay configured, rebalance immediately
      return true;
    }

    // Check when position first went out of range
    let outOfRangeSince = outOfRangeTracker.get(position.id);

    if (!outOfRangeSince) {
      // First time detecting out of range, start the timer
      outOfRangeSince = currentTime;
      outOfRangeTracker.set(position.id, outOfRangeSince);
      log.info(`Position ${position.id.slice(0, 10)}... went out of range, starting ${delayMs / 1000}s delay`);
    }

    const elapsedMs = currentTime - outOfRangeSince;
    const remainingMs = delayMs - elapsedMs;

    if (remainingMs > 0) {
      // Still waiting, show countdown
      log.outOfRangeDelay(position.id, Math.ceil(remainingMs / 1000));
      return false;
    }

    // Delay has passed
    log.info(`Rebalance delay passed for ${position.id.slice(0, 10)}...`);
    return true;
  }

  /**
   * Find all registered positions in LP Registry
   */
  private async findRegisteredPositions(): Promise<RegisteredPosition[]> {
    const positions: RegisteredPosition[] = [];

    try {
      // Query PositionRegistered events
      const eventType = `${LP_REGISTRY_PACKAGE_ID}::lp_registry::PositionRegistered`;

      const events = await this.client.queryEvents({
        query: { MoveEventType: eventType },
        order: 'descending',
        limit: 100,
      });

      for (const event of events.data) {
        const eventData = event.parsedJson as {
          position_id: string;
          owner: string;
          pool_id: string;
        };

        try {
          const positionObj = await this.client.getObject({
            id: eventData.position_id,
            options: { showContent: true, showType: true },
          });

          if (!positionObj.data?.content || positionObj.data.content.dataType !== 'moveObject') {
            continue;
          }

          const fields = positionObj.data.content.fields as Record<string, unknown>;
          const objectType = positionObj.data.content.type;

          // Extract token types from RegisteredPosition<X, Y>
          const typeMatch = objectType.match(/RegisteredPosition<([^,]+),\s*([^>]+)>/);
          if (!typeMatch) continue;

          const [, tokenXType, tokenYType] = typeMatch;

          // Check if this backend is an authorized operator
          const operators = fields.operators as string[] || [];
          if (!operators.includes(this.executorAddress)) {
            continue;
          }

          const position: RegisteredPosition = {
            id: eventData.position_id,
            owner: fields.owner as string,
            poolId: fields.pool_id as string,
            tokenXType: tokenXType.trim(),
            tokenYType: tokenYType.trim(),
            rangeBps: Number(fields.range_bps || 500),

            // Feature toggles
            autoRebalance: fields.auto_rebalance as boolean || false,
            autoCompound: fields.auto_compound as boolean || false,
            autoClaimFees: fields.auto_claim_fees as boolean || false,
            recurring: fields.recurring as boolean || false,

            // Rebalance delay
            rebalanceDelayMs: Number(fields.rebalance_delay_ms || 0),
            outOfRangeSince: Number(fields.out_of_range_since || 0),

            // Recurring settings
            recurringIntervalMs: Number(fields.recurring_interval_ms || 3600000), // Default 1 hour
            nextRecurringAt: Number(fields.next_recurring_at || 0),

            // State
            isPaused: fields.is_paused as boolean || false,
            hasPosition: fields.has_position as boolean || false,

            // Stats
            rebalanceCount: Number(fields.rebalance_count || 0),
            compoundCount: Number(fields.compound_count || 0),
            lastActionAt: Number(fields.last_action_at || 0),
          };

          if (!position.isPaused) {
            positions.push(position);
          }

        } catch (error) {
          continue;
        }
      }

    } catch (error) {
      log.error('Failed to query LP Registry events', error);
    }

    return positions;
  }

  private async getPoolData(poolId: string): Promise<PoolData> {
    const poolObj = await this.client.getObject({
      id: poolId,
      options: { showContent: true, showType: true },
    });

    if (!poolObj.data?.content || poolObj.data.content.dataType !== 'moveObject') {
      throw new Error('Pool not found');
    }

    const objectType = poolObj.data.content.type;
    const fields = poolObj.data.content.fields as Record<string, unknown>;

    const typeMatch = objectType.match(/Pool<([^,]+),\s*([^>]+)>/);
    if (!typeMatch) throw new Error('Could not parse pool type');

    const [, tokenXType, tokenYType] = typeMatch;

    const rewardersRaw = (fields.rewarders as any)?.fields?.contents || [];
    const rewarders = rewardersRaw.map((r: any) => ({
      coin_type: r.fields?.value?.fields?.coin_type || r.fields?.coin_type,
    })).filter((r: any) => r.coin_type);

    return {
      objectId: poolId,
      tokenXType: tokenXType.trim(),
      tokenYType: tokenYType.trim(),
      currentTick: Number(fields.current_tick_index || 0),
      tickSpacing: Number(fields.tick_spacing || 1),
      rewarders,
    };
  }

  private async getPositionTicks(registeredPositionId: string): Promise<PositionTicks | null> {
    try {
      const dynamicFields = await this.client.getDynamicFields({
        parentId: registeredPositionId,
      });

      const positionField = dynamicFields.data.find(
        (field) => field.objectType?.includes('::position::Position')
      );

      if (!positionField) return null;

      const positionObj = await this.client.getObject({
        id: positionField.objectId,
        options: { showContent: true },
      });

      if (!positionObj.data?.content || positionObj.data.content.dataType !== 'moveObject') {
        return null;
      }

      const fields = positionObj.data.content.fields as Record<string, unknown>;
      const positionFields = (fields.value as Record<string, unknown>) || fields;

      return {
        tickLower: toSignedTick(Number(positionFields.tick_lower_index)),
        tickUpper: toSignedTick(Number(positionFields.tick_upper_index)),
        liquidity: BigInt(positionFields.liquidity as string || '0'),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Execute rebalance: close position, open new one centered on current price
   */
  private async executeRebalance(
    position: RegisteredPosition,
    poolData: PoolData,
    liquidity: bigint
  ): Promise<void> {
    log.registry(position.id, 'Executing rebalance', {
      'Owner': `${position.owner.slice(0, 10)}...`,
      'Pool': `${position.poolId.slice(0, 10)}...`,
    });

    const tx = new Transaction();
    const sdkPool = await this.sdk.Pool.getPool(position.poolId);

    const actualTickSpacing = parseInt(String(sdkPool.tickSpacing || 1));
    const currentTickUnsigned = parseInt(sdkPool.currentTickIndex || '0');
    const currentTick = toSignedTick(currentTickUnsigned);

    const poolParams = {
      objectId: sdkPool.poolId,
      tokenXType: sdkPool.tokenXType,
      tokenYType: sdkPool.tokenYType,
      tickSpacing: actualTickSpacing,
      rewarders: sdkPool.rewarders || [],
    };

    // 1. Retrieve position from registry
    const oldPosition = tx.moveCall({
      target: `${LP_REGISTRY_PACKAGE_ID}::lp_registry::retrieve_position`,
      typeArguments: [position.tokenXType, position.tokenYType, MMT_POSITION_TYPE],
      arguments: [
        tx.object(LP_REGISTRY_ID),
        tx.object(position.id),
      ],
    });

    // 2. Remove liquidity
    const { removeLpCoinA, removeLpCoinB } = this.sdk.Pool.removeLiquidity(
      tx, poolParams, oldPosition, liquidity,
      BigInt(0), BigInt(0), undefined, true,
    );

    // 3. Collect fees
    const { feeCoinA, feeCoinB } = this.sdk.Pool.collectFee(
      tx, poolParams, oldPosition, undefined, true,
    );

    // 4. Collect rewards and send to owner
    for (const rewarder of sdkPool.rewarders || []) {
      if (!rewarder.coin_type) continue;
      const rewardCoin = this.sdk.Pool.collectReward(
        tx, poolParams, oldPosition, rewarder.coin_type, undefined, true,
      );
      tx.transferObjects([rewardCoin], position.owner);
    }

    // 5. Merge fees into principal (auto-compound)
    tx.mergeCoins(removeLpCoinA, [feeCoinA]);
    tx.mergeCoins(removeLpCoinB, [feeCoinB]);

    // 6. Calculate new tick range
    const rangePercent = position.rangeBps / 100;
    const tickLower = calculateTickFromPercent(currentTick, -rangePercent, actualTickSpacing);
    const tickUpper = calculateTickFromPercent(currentTick, rangePercent, actualTickSpacing);

    log.info('New tick range', { currentTick, tickLower, tickUpper });

    // 7. Open new position
    const lowerSqrtPrice = tickIndexToSqrtPriceX64(tickLower);
    const upperSqrtPrice = tickIndexToSqrtPriceX64(tickUpper);

    const newPosition = this.sdk.Position.openPosition(
      tx, poolParams, lowerSqrtPrice.toString(), upperSqrtPrice.toString()
    );

    // 8. Add liquidity
    const [leftoverX, leftoverY] = tx.moveCall({
      target: `${this.sdk.PackageId}::liquidity::add_liquidity`,
      typeArguments: [position.tokenXType, position.tokenYType],
      arguments: [
        tx.object(position.poolId),
        newPosition,
        removeLpCoinA,
        removeLpCoinB,
        tx.pure.u64(0),
        tx.pure.u64(0),
        tx.object(CLOCK_OBJECT_ID),
        tx.object(this.sdk.contractConst.versionId),
      ],
    });

    // 9. Store new position
    tx.moveCall({
      target: `${LP_REGISTRY_PACKAGE_ID}::lp_registry::store_position`,
      typeArguments: [position.tokenXType, position.tokenYType, MMT_POSITION_TYPE],
      arguments: [
        tx.object(LP_REGISTRY_ID),
        tx.object(position.id),
        newPosition,
      ],
    });

    // 10. Record action
    tx.moveCall({
      target: `${LP_REGISTRY_PACKAGE_ID}::lp_registry::record_rebalance`,
      typeArguments: [position.tokenXType, position.tokenYType],
      arguments: [
        tx.object(LP_REGISTRY_ID),
        tx.object(position.id),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });

    // 11. Send leftover and old position to owner
    tx.transferObjects([leftoverX, leftoverY, oldPosition], position.owner);

    // Execute
    tx.setGasBudget(100_000_000);
    tx.setSender(this.executorAddress);

    const builtTx = await tx.build({ client: this.client });
    const signature = (await this.keypair.signTransaction(builtTx)).signature;

    const result = await this.client.executeTransactionBlock({
      transactionBlock: builtTx,
      signature,
      options: { showEffects: true },
    });

    if (result.effects?.status?.status !== 'success') {
      throw new Error(`Rebalance failed: ${result.effects?.status?.error}`);
    }

    log.success('Rebalance completed', result.digest);
  }

  /**
   * Execute compound: collect fees and add to position
   */
  private async executeCompound(
    position: RegisteredPosition,
    poolData: PoolData,
    liquidity: bigint
  ): Promise<void> {
    log.registry(position.id, 'Executing compound', {
      'Owner': `${position.owner.slice(0, 10)}...`,
    });

    const tx = new Transaction();
    const sdkPool = await this.sdk.Pool.getPool(position.poolId);

    const poolParams = {
      objectId: sdkPool.poolId,
      tokenXType: sdkPool.tokenXType,
      tokenYType: sdkPool.tokenYType,
    };

    // 1. Retrieve position
    const mmtPosition = tx.moveCall({
      target: `${LP_REGISTRY_PACKAGE_ID}::lp_registry::retrieve_position`,
      typeArguments: [position.tokenXType, position.tokenYType, MMT_POSITION_TYPE],
      arguments: [
        tx.object(LP_REGISTRY_ID),
        tx.object(position.id),
      ],
    });

    // 2. Collect fees
    const { feeCoinA, feeCoinB } = this.sdk.Pool.collectFee(
      tx, poolParams, mmtPosition, undefined, true,
    );

    // 3. Add fees as liquidity (compound)
    const [leftoverX, leftoverY] = tx.moveCall({
      target: `${this.sdk.PackageId}::liquidity::add_liquidity`,
      typeArguments: [position.tokenXType, position.tokenYType],
      arguments: [
        tx.object(position.poolId),
        mmtPosition,
        feeCoinA,
        feeCoinB,
        tx.pure.u64(0),
        tx.pure.u64(0),
        tx.object(CLOCK_OBJECT_ID),
        tx.object(this.sdk.contractConst.versionId),
      ],
    });

    // 4. Store position back
    tx.moveCall({
      target: `${LP_REGISTRY_PACKAGE_ID}::lp_registry::store_position`,
      typeArguments: [position.tokenXType, position.tokenYType, MMT_POSITION_TYPE],
      arguments: [
        tx.object(LP_REGISTRY_ID),
        tx.object(position.id),
        mmtPosition,
      ],
    });

    // 5. Record compound action
    tx.moveCall({
      target: `${LP_REGISTRY_PACKAGE_ID}::lp_registry::record_compound`,
      typeArguments: [position.tokenXType, position.tokenYType],
      arguments: [
        tx.object(LP_REGISTRY_ID),
        tx.object(position.id),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });

    // 6. Send any leftover to owner
    tx.transferObjects([leftoverX, leftoverY], position.owner);

    // Execute
    tx.setGasBudget(50_000_000);
    tx.setSender(this.executorAddress);

    const builtTx = await tx.build({ client: this.client });
    const signature = (await this.keypair.signTransaction(builtTx)).signature;

    const result = await this.client.executeTransactionBlock({
      transactionBlock: builtTx,
      signature,
      options: { showEffects: true },
    });

    if (result.effects?.status?.status !== 'success') {
      throw new Error(`Compound failed: ${result.effects?.status?.error}`);
    }

    log.success('Compound completed', result.digest);
  }

  /**
   * Execute claim fees: collect fees and send to owner (no compound)
   */
  private async executeClaimFees(
    position: RegisteredPosition,
    poolData: PoolData
  ): Promise<void> {
    log.registry(position.id, 'Claiming fees', {
      'Owner': `${position.owner.slice(0, 10)}...`,
    });

    const tx = new Transaction();
    const sdkPool = await this.sdk.Pool.getPool(position.poolId);

    const poolParams = {
      objectId: sdkPool.poolId,
      tokenXType: sdkPool.tokenXType,
      tokenYType: sdkPool.tokenYType,
    };

    // 1. Retrieve position
    const mmtPosition = tx.moveCall({
      target: `${LP_REGISTRY_PACKAGE_ID}::lp_registry::retrieve_position`,
      typeArguments: [position.tokenXType, position.tokenYType, MMT_POSITION_TYPE],
      arguments: [
        tx.object(LP_REGISTRY_ID),
        tx.object(position.id),
      ],
    });

    // 2. Collect fees
    const { feeCoinA, feeCoinB } = this.sdk.Pool.collectFee(
      tx, poolParams, mmtPosition, undefined, true,
    );

    // 3. Collect rewards
    for (const rewarder of sdkPool.rewarders || []) {
      if (!rewarder.coin_type) continue;
      const rewardCoin = this.sdk.Pool.collectReward(
        tx, poolParams, mmtPosition, rewarder.coin_type, undefined, true,
      );
      tx.transferObjects([rewardCoin], position.owner);
    }

    // 4. Store position back
    tx.moveCall({
      target: `${LP_REGISTRY_PACKAGE_ID}::lp_registry::store_position`,
      typeArguments: [position.tokenXType, position.tokenYType, MMT_POSITION_TYPE],
      arguments: [
        tx.object(LP_REGISTRY_ID),
        tx.object(position.id),
        mmtPosition,
      ],
    });

    // 5. Send fees to owner
    tx.transferObjects([feeCoinA, feeCoinB], position.owner);

    // Execute
    tx.setGasBudget(50_000_000);
    tx.setSender(this.executorAddress);

    const builtTx = await tx.build({ client: this.client });
    const signature = (await this.keypair.signTransaction(builtTx)).signature;

    const result = await this.client.executeTransactionBlock({
      transactionBlock: builtTx,
      signature,
      options: { showEffects: true },
    });

    if (result.effects?.status?.status !== 'success') {
      throw new Error(`Claim fees failed: ${result.effects?.status?.error}`);
    }

    log.success('Fees claimed', result.digest);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ Main ============

async function main() {
  const service = new LPRegistryService();

  process.on('SIGINT', () => {
    service.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    service.stop();
    process.exit(0);
  });

  await service.start();
}

main().catch((error) => log.error('Fatal error', error));
