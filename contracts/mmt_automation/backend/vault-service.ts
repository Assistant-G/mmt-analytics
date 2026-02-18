/**
 * Cycling Vault Backend Service
 *
 * Monitors vaults and executes LP position cycles:
 * 1. Detect expired vault timers
 * 2. Close position (remove liquidity, collect fees/rewards)
 * 3. Deposit proceeds back to vault
 * 4. Open new position using vault tokens
 * 5. Store new position in vault
 * 6. Repeat until max cycles or user pauses
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

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Bright foreground
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Background colors
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
  vault: '🔐',
  money: '💰',
  link: '🔗',
  info: 'ℹ️',
  star: '⭐',
  gear: '⚙️',
  stop: '🛑',
  search: '🔍',
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
    const width = 50;
    const line = '═'.repeat(width);
    const empty = ' '.repeat(width);

    console.log(`${colors.cyan}╔${line}╗${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}${colors.bold}${colors.brightCyan} ${title.padEnd(width - 1)}${colors.reset}${colors.cyan}║${colors.reset}`);

    if (content && content.length > 0) {
      console.log(`${colors.cyan}╠${line}╣${colors.reset}`);
      for (const line of content) {
        const paddedLine = ` ${line}`.padEnd(width);
        console.log(`${colors.cyan}║${colors.reset}${paddedLine}${colors.cyan}║${colors.reset}`);
      }
    }

    console.log(`${colors.cyan}╚${line}╝${colors.reset}`);
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

  vault(vaultId: string, action: string, details?: Record<string, unknown>): void {
    const shortVaultId = this.shortId(vaultId);
    console.log(`${this.formatTime()} ${colors.magenta}${icons.vault}${colors.reset} ${colors.brightMagenta}${shortVaultId}${colors.reset} ${colors.dim}│${colors.reset} ${action}`);
    if (details) {
      for (const [key, value] of Object.entries(details)) {
        console.log(`   ${colors.dim}├─ ${key}:${colors.reset} ${colors.white}${value}${colors.reset}`);
      }
    }
  }

  cycle(vaultId: string, current: number, max: number | string): void {
    const shortVaultId = this.shortId(vaultId);
    const maxStr = max === 0 ? '∞' : String(max);
    const progress = max === 0 || max === '∞' ? '' : ` (${Math.round((current / Number(max)) * 100)}%)`;
    console.log(`${this.formatTime()} ${colors.cyan}${icons.cycle}${colors.reset} ${colors.brightCyan}Cycle ${current}/${maxStr}${progress}${colors.reset} ${colors.dim}│${colors.reset} ${this.shortId(vaultId)}`);
  }

  timer(vaultId: string, secondsLeft: number): void {
    const shortVaultId = this.shortId(vaultId);
    const timeStr = secondsLeft >= 60
      ? `${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s`
      : `${secondsLeft}s`;
    console.log(`   ${colors.dim}${icons.clock} ${shortVaultId}: ${timeStr} until next cycle${colors.reset}`);
  }

  monitoring(count: number): void {
    if (count === 0) return;
    console.log(`${this.formatTime()} ${colors.brightBlack}${icons.search} Monitoring ${count} active vault(s)${colors.reset}`);
  }

  ready(count: number): void {
    console.log(`\n${this.formatTime()} ${colors.brightGreen}${icons.star} Found ${count} vault(s) ready for cycle${colors.reset}`);
  }

  separator(): void {
    console.log(`${colors.dim}${'─'.repeat(60)}${colors.reset}`);
  }

  startup(config: { executor: string; network: string; pollInterval: number }): void {
    console.log('');
    this.box(`${icons.rocket} MMT CYCLING VAULT SERVICE`, [
      `${icons.gear} Network: ${config.network}`,
      `${icons.clock} Poll Interval: ${config.pollInterval / 1000}s`,
      `${icons.money} Executor: ${this.shortId(config.executor)}`,
    ]);
    console.log('');
  }

  shutdown(): void {
    console.log(`\n${this.formatTime()} ${colors.yellow}${icons.stop}${colors.reset} ${colors.brightYellow}Shutting down gracefully...${colors.reset}\n`);
  }
}

const log = new Logger();

// ============ Configuration ============

// Vault contract - deployed with fee compounding, leftover retention, and xSUI rewards tracking
const VAULT_PACKAGE_ID = process.env.VAULT_PACKAGE_ID || '0x302a07fee2847fd203aaaac779b7a5a9454a028b515f288fc27a5fe83cce11f9';
const VAULT_CONFIG_ID = process.env.VAULT_CONFIG_ID || '0xf5df31a91a1a9bb38d713844051d2d97cd20577d71a162a03f181e436d0a74b7';

// MMT Finance contract addresses
const MMT_PACKAGE_ID = '0xcf60a40f45d46fc1e828871a647c1e25a0915dec860d2662eb10fdb382c3c1d1';
const MMT_PUBLISHED_AT = '0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860';
const MMT_VERSION_ID = '0x2375a0b1ec12010aaea3b2545acfa2ad34cfbba03ce4b59f4c39e1e25eed1b2a';
const MMT_GLOBAL_CONFIG = '0x03db251ba509a422d6b5d4a86aa0f228cded1be51b2badf1138e8e43b7b165cf';

const MMT_POSITION_TYPE = `${MMT_PUBLISHED_AT}::position::Position`;

const NETWORK = 'mainnet';
const POLLING_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL || '10000'); // Default: 10 seconds
const CLOCK_OBJECT_ID = '0x6';

// ============ Types ============

interface VaultData {
  id: string;
  owner: string;
  poolId: string;
  balanceX: string;
  balanceY: string;
  feesX: string;
  feesY: string;
  rangeBps: number;
  timerDurationMs: number;
  nextExecutionAt: number;
  maxCycles: number;
  cyclesCompleted: number;
  isActive: boolean;
  hasPosition: boolean;
  tokenXType: string;
  tokenYType: string;
}

interface PoolData {
  objectId: string;
  tokenXType: string;
  tokenYType: string;
  currentTick: number;
  tickSpacing: number;
  rewarders: { coin_type: string }[];
}

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

class VaultService {
  private client: SuiClient;
  private sdk: MmtSDK;
  private keypair: Ed25519Keypair;
  private executorAddress: string;
  private isRunning: boolean = false;

  constructor() {
    // Initialize Sui client (use custom RPC URL if provided)
    const rpcUrl = process.env.SUI_RPC_URL || getFullnodeUrl(NETWORK);
    this.client = new SuiClient({ url: rpcUrl });

    // Initialize MMT SDK
    this.sdk = MmtSDK.NEW({ network: 'mainnet' });

    // Load executor keypair from environment
    const privateKey = process.env.EXECUTOR_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('EXECUTOR_PRIVATE_KEY environment variable required');
    }

    // Parse the private key
    if (privateKey.startsWith('suiprivkey')) {
      const { secretKey } = decodeSuiPrivateKey(privateKey);
      this.keypair = Ed25519Keypair.fromSecretKey(secretKey);
    } else {
      // Assume hex format
      const secretKey = Uint8Array.from(Buffer.from(privateKey, 'hex'));
      this.keypair = Ed25519Keypair.fromSecretKey(secretKey);
    }

    this.executorAddress = this.keypair.getPublicKey().toSuiAddress();
  }

  /**
   * Get current time from Sui blockchain clock (more accurate than local time)
   */
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
        await this.checkAndExecuteVaults();
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

  private async checkAndExecuteVaults(): Promise<void> {
    // Find vaults that are ready for execution
    const readyVaults = await this.findReadyVaults();

    if (readyVaults.length > 0) {
      log.ready(readyVaults.length);
    }

    for (const vault of readyVaults) {
      try {
        log.vault(vault.id, 'Processing cycle...');
        await this.executeCycle(vault);
      } catch (error) {
        log.error(`Failed to process vault ${vault.id.slice(0, 10)}...`, error);
      }
    }
  }

  /**
   * Find all vaults that are ready for cycle execution
   */
  private async findReadyVaults(): Promise<VaultData[]> {
    const readyVaults: VaultData[] = [];

    try {
      // Query VaultCreated events to find all vaults
      const eventType = `${VAULT_PACKAGE_ID}::cycling_vault::VaultCreated`;

      const events = await this.client.queryEvents({
        query: {
          MoveEventType: eventType,
        },
        order: 'descending',
        limit: 100,
      });

      const currentTime = await this.getSuiClockTime();
      let checkedCount = 0;

      for (const event of events.data) {
        const eventData = event.parsedJson as {
          vault_id: string;
          owner: string;
          pool_id: string;
        };

        try {
          // Get vault object
          const vaultObj = await this.client.getObject({
            id: eventData.vault_id,
            options: { showContent: true, showType: true },
          });

          if (!vaultObj.data?.content || vaultObj.data.content.dataType !== 'moveObject') {
            // Vault was closed/deleted - skip silently
            continue;
          }

          const fields = vaultObj.data.content.fields as Record<string, unknown>;
          const objectType = vaultObj.data.content.type;

          // Extract token types from Vault<X, Y> type
          const typeMatch = objectType.match(/Vault<([^,]+),\s*([^>]+)>/);
          if (!typeMatch) continue;

          const [, tokenXType, tokenYType] = typeMatch;

          // Helper to extract balance value (handles both direct value and nested fields.value)
          const getBalanceValue = (field: unknown): string => {
            if (typeof field === 'string') return field;
            if (typeof field === 'number') return String(field);
            if (field && typeof field === 'object') {
              const obj = field as any;
              return String(obj.fields?.value || obj.value || '0');
            }
            return '0';
          };

          const vault: VaultData = {
            id: eventData.vault_id,
            owner: fields.owner as string,
            poolId: fields.pool_id as string,
            balanceX: getBalanceValue(fields.balance_x),
            balanceY: getBalanceValue(fields.balance_y),
            feesX: getBalanceValue(fields.fees_x),
            feesY: getBalanceValue(fields.fees_y),
            rangeBps: Number(fields.range_bps || 0),
            timerDurationMs: Number(fields.timer_duration_ms || 0),
            nextExecutionAt: Number(fields.next_execution_at || 0),
            maxCycles: Number(fields.max_cycles || 0),
            cyclesCompleted: Number(fields.cycles_completed || 0),
            isActive: fields.is_active as boolean,
            hasPosition: fields.has_position as boolean,
            tokenXType: tokenXType.trim(),
            tokenYType: tokenYType.trim(),
          };

          // Check if vault has tokens or position (skip empty vaults)
          const hasTokens = BigInt(vault.balanceX) > 0 || BigInt(vault.balanceY) > 0;
          const isEmpty = !vault.hasPosition && !hasTokens;

          if (isEmpty) {
            // Skip empty vaults silently
            continue;
          }

          // Only count non-empty, active vaults
          if (vault.isActive) {
            checkedCount++;
          }

          // Check if ready for execution
          // Case 1: New vault without position but has tokens - open first position
          const isNewVaultNeedingFirstPosition = vault.isActive && !vault.hasPosition && hasTokens;

          let shouldExecute = false;
          let executionReason = '';

          if (isNewVaultNeedingFirstPosition) {
            shouldExecute = true;
            executionReason = '🆕 New vault - opening first position';
          } else if (vault.isActive && vault.hasPosition) {
            // For existing positions, check smart rebalancing conditions
            const poolData = await this.getPoolData(vault.poolId);

            // PRIMARY CHECK: Out of range?
            const outOfRange = await this.isPositionOutOfRange(vault, poolData);
            if (outOfRange) {
              shouldExecute = true;
              executionReason = '🎯 Out of range - rebalancing';
            }

            // BACKUP CHECK: Timer expired?
            const isTimerExpired = currentTime >= vault.nextExecutionAt;
            if (!shouldExecute && isTimerExpired) {
              shouldExecute = true;
              executionReason = '⏰ Timer expired - rebalancing';
            }

            // SAFETY CHECK: Divergence loss too high?
            if (!shouldExecute) {
              const divergenceLoss = await this.calculateDivergenceLoss(vault, poolData);
              const MAX_DIVERGENCE_LOSS = 3.0; // 3% maximum IL
              if (divergenceLoss > MAX_DIVERGENCE_LOSS) {
                shouldExecute = true;
                executionReason = `🛡️ Divergence loss ${divergenceLoss.toFixed(2)}% > ${MAX_DIVERGENCE_LOSS}% - protecting capital`;
              }
            }

            // Debug: log timing info for vaults not ready
            if (!shouldExecute && !isTimerExpired) {
              const timeLeft = Math.max(0, vault.nextExecutionAt - currentTime);
              log.timer(vault.id, Math.ceil(timeLeft / 1000));
            }
          }

          if (shouldExecute) {
            // Check max cycles (0 = infinite)
            if (vault.maxCycles === 0 || vault.cyclesCompleted < vault.maxCycles) {
              readyVaults.push(vault);
              log.cycle(vault.id, vault.cyclesCompleted + 1, vault.maxCycles);
              if (executionReason) {
                log.info(executionReason);
              }
            }
          }
        } catch (error) {
          // Skip vaults that can't be read (deleted, etc)
          continue;
        }
      }

      log.monitoring(checkedCount);
    } catch (error) {
      log.error('Failed to query vault events', error);
    }

    return readyVaults;
  }

  /**
   * Get pool data from MMT
   */
  private async getPoolData(poolId: string): Promise<PoolData> {
    const poolObj = await this.client.getObject({
      id: poolId,
      options: { showContent: true, showType: true },
    });

    if (!poolObj.data?.content || poolObj.data.content.dataType !== 'moveObject') {
      throw new Error('Pool not found or invalid');
    }

    const objectType = poolObj.data.content.type;
    const fields = poolObj.data.content.fields as Record<string, unknown>;

    // Extract token types from Pool<X, Y> type
    const typeMatch = objectType.match(/Pool<([^,]+),\s*([^>]+)>/);
    if (!typeMatch) {
      throw new Error('Could not parse pool type');
    }

    const [, tokenXType, tokenYType] = typeMatch;

    // Parse rewarders
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

  /**
   * Get tick range from stored position in vault
   */
  private async getPositionTicks(vaultId: string): Promise<{ tickLower: number; tickUpper: number } | null> {
    try {
      const dynamicFields = await this.client.getDynamicFields({
        parentId: vaultId,
      });

      const positionField = dynamicFields.data.find(
        (field) => field.objectType?.includes('::position::Position')
      );

      if (!positionField) {
        return null;
      }

      const positionObj = await this.client.getObject({
        id: positionField.objectId,
        options: { showContent: true },
      });

      if (!positionObj.data?.content || positionObj.data.content.dataType !== 'moveObject') {
        return null;
      }

      const fields = positionObj.data.content.fields as Record<string, unknown>;
      const positionFields = (fields.value as Record<string, unknown>) || fields;

      const tickLowerRaw = positionFields.tick_lower_index as string | number;
      const tickUpperRaw = positionFields.tick_upper_index as string | number;

      if (!tickLowerRaw || !tickUpperRaw) {
        return null;
      }

      return {
        tickLower: toSignedTick(Number(tickLowerRaw)),
        tickUpper: toSignedTick(Number(tickUpperRaw)),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if position is out of range
   */
  private async isPositionOutOfRange(vault: VaultData, poolData: PoolData): Promise<boolean> {
    if (!vault.hasPosition) {
      return false;
    }

    try {
      const ticks = await this.getPositionTicks(vault.id);
      if (!ticks) {
        return false;
      }

      const currentTick = toSignedTick(poolData.currentTick);
      const isOutOfRange = currentTick < ticks.tickLower || currentTick > ticks.tickUpper;

      if (isOutOfRange) {
        const ticksFromCenter = Math.abs(currentTick - (ticks.tickLower + ticks.tickUpper) / 2);
        const priceMove = (ticksFromCenter / 100).toFixed(2);
        log.info(`🎯 Position OUT OF RANGE`, {
          'Vault': vault.id.slice(0, 10) + '...',
          'Current Tick': currentTick,
          'Range': `${ticks.tickLower} to ${ticks.tickUpper}`,
          'Price Move': `~${priceMove}%`,
        });
      }

      return isOutOfRange;
    } catch (error) {
      log.warn(`Failed to check out-of-range for vault ${vault.id.slice(0, 10)}...`);
      return false;
    }
  }

  /**
   * Calculate divergence loss (impermanent loss) percentage
   * Returns percentage of IL relative to position value
   */
  private async calculateDivergenceLoss(vault: VaultData, poolData: PoolData): Promise<number> {
    if (!vault.hasPosition) {
      return 0;
    }

    try {
      const ticks = await this.getPositionTicks(vault.id);
      if (!ticks) {
        return 0;
      }

      const currentTick = toSignedTick(poolData.currentTick);

      // Estimate initial tick as center of range
      const initialTick = (ticks.tickLower + ticks.tickUpper) / 2;

      // Calculate price ratio change
      // Price moves by ~1% per 100 ticks (approximately)
      const tickChange = currentTick - initialTick;
      const priceChangePercent = tickChange / 100;

      // IL formula approximation: IL ≈ (price_change^2) / 8 for small changes
      // For larger changes, use full formula: 2*sqrt(k)/(1+k) - 1
      const priceRatio = Math.pow(1.0001, tickChange);
      const sqrtRatio = Math.sqrt(priceRatio);
      const il = Math.abs((2 * sqrtRatio) / (1 + priceRatio) - 1);

      return il * 100; // Return as percentage
    } catch (error) {
      return 0;
    }
  }

  /**
   * Execute a full cycle for a vault:
   * 1. If has position: close it and deposit proceeds
   * 2. Take tokens from vault
   * 3. Open new position
   * 4. Store position in vault
   *
   * Note: Close+Open are combined into a single transaction to avoid
   * object version race conditions.
   */
  private async executeCycle(vault: VaultData): Promise<void> {
    log.vault(vault.id, 'Executing cycle', {
      'Owner': `${vault.owner.slice(0, 10)}...`,
      'Pool': `${vault.poolId.slice(0, 10)}...`,
      'Has Position': vault.hasPosition,
      'Cycle': `${vault.cyclesCompleted + 1}/${vault.maxCycles || '∞'}`,
    });

    const isLastCycle = vault.maxCycles > 0 && (vault.cyclesCompleted + 1) >= vault.maxCycles;

    if (vault.hasPosition) {
      if (isLastCycle) {
        // Last cycle: just close position, don't reopen
        await this.closePositionOnly(vault);
        log.success(`Vault completed all ${vault.maxCycles} cycles. Coins in vault for withdrawal.`);
        return;
      } else {
        // Not last cycle: close and immediately reopen in single transaction
        await this.closeAndReopenPosition(vault);
        return;
      }
    }

    // New vault without position: just open
    await this.openNewPosition(vault);
  }

  /**
   * Close existing position and deposit proceeds (last cycle only, no reopen)
   */
  private async closePositionOnly(vault: VaultData): Promise<void> {
    log.info('Closing position (final cycle)...');

    const positionLiquidity = await this.getStoredPositionLiquidity(vault.id);
    log.info('Position liquidity', { value: positionLiquidity.toString() });

    const tx = new Transaction();
    const sdkPool = await this.sdk.Pool.getPool(vault.poolId);

    const poolParams = {
      objectId: sdkPool.poolId,
      tokenXType: sdkPool.tokenXType,
      tokenYType: sdkPool.tokenYType,
    };

    // 1. Retrieve position from vault
    const position = tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::cycling_vault::retrieve_position`,
      typeArguments: [vault.tokenXType, vault.tokenYType, MMT_POSITION_TYPE],
      arguments: [
        tx.object(VAULT_CONFIG_ID),
        tx.object(vault.id),
      ],
    });

    // 2. Remove liquidity
    const { removeLpCoinA, removeLpCoinB } = this.sdk.Pool.removeLiquidity(
      tx, poolParams, position, positionLiquidity,
      BigInt(0), BigInt(0), undefined, true,
    );

    // 3. Collect fees
    const { feeCoinA, feeCoinB } = this.sdk.Pool.collectFee(
      tx, poolParams, position, undefined, true,
    );

    // 4. Collect rewards and deposit into vault for tracking
    for (const rewarder of sdkPool.rewarders || []) {
      if (!rewarder.coin_type) continue;
      const rewardCoin = this.sdk.Pool.collectReward(
        tx, poolParams, position, rewarder.coin_type, undefined, true,
      );

      // Deposit reward into vault (tracks amount + sends to owner)
      tx.moveCall({
        target: `${VAULT_PACKAGE_ID}::cycling_vault::deposit_reward`,
        typeArguments: [vault.tokenXType, vault.tokenYType, rewarder.coin_type],
        arguments: [
          tx.object(VAULT_CONFIG_ID),
          tx.object(vault.id),
          rewardCoin,
        ],
      });
    }

    // 5. Deposit proceeds back into vault
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::cycling_vault::deposit_proceeds`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(VAULT_CONFIG_ID), tx.object(vault.id),
        removeLpCoinA, removeLpCoinB, feeCoinA, feeCoinB,
        tx.object(CLOCK_OBJECT_ID),
      ],
    });

    // 6. Transfer empty position NFT to owner
    tx.transferObjects([position], vault.owner);

    // Execute
    tx.setGasBudget(100_000_000);
    tx.setSender(this.executorAddress);

    const builtTx = await tx.build({ client: this.client });
    const signature = (await this.keypair.signTransaction(builtTx)).signature;

    const result = await this.client.executeTransactionBlock({
      transactionBlock: builtTx,
      signature,
      options: { showEffects: true, showEvents: true },
    });

    if (result.effects?.status?.status !== 'success') {
      throw new Error(`Close position failed: ${result.effects?.status?.error}`);
    }

    // Track actual gas cost
    const gasUsed = result.effects?.gasUsed;
    if (gasUsed) {
      const totalGas = BigInt(gasUsed.computationCost) + BigInt(gasUsed.storageCost) - BigInt(gasUsed.storageRebate);
      const gasInSui = Number(totalGas) / 1e9;
      log.info(`Gas used: ${gasInSui.toFixed(6)} SUI (computation: ${gasUsed.computationCost}, storage: ${gasUsed.storageCost}, rebate: ${gasUsed.storageRebate})`);
    }

    log.success('Position closed successfully', result.digest);
  }

  /**
   * Close existing position and immediately reopen new one (single transaction)
   * This avoids object version race conditions between close and open.
   */
  private async closeAndReopenPosition(vault: VaultData): Promise<void> {
    log.info('Closing and reopening position (atomic tx)...');

    const positionLiquidity = await this.getStoredPositionLiquidity(vault.id);
    log.info('Position liquidity', { value: positionLiquidity.toString() });

    const tx = new Transaction();
    const sdkPool = await this.sdk.Pool.getPool(vault.poolId);

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

    // ===== CLOSE PHASE =====

    // 1. Retrieve position from vault
    const oldPosition = tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::cycling_vault::retrieve_position`,
      typeArguments: [vault.tokenXType, vault.tokenYType, MMT_POSITION_TYPE],
      arguments: [
        tx.object(VAULT_CONFIG_ID),
        tx.object(vault.id),
      ],
    });

    // 2. Remove liquidity
    const { removeLpCoinA, removeLpCoinB } = this.sdk.Pool.removeLiquidity(
      tx, poolParams, oldPosition, positionLiquidity,
      BigInt(0), BigInt(0), undefined, true,
    );

    // 3. Collect fees
    const { feeCoinA, feeCoinB } = this.sdk.Pool.collectFee(
      tx, poolParams, oldPosition, undefined, true,
    );

    // 4. Collect rewards and deposit into vault for tracking
    for (const rewarder of sdkPool.rewarders || []) {
      if (!rewarder.coin_type) continue;
      const rewardCoin = this.sdk.Pool.collectReward(
        tx, poolParams, oldPosition, rewarder.coin_type, undefined, true,
      );

      // Deposit reward into vault (tracks amount + sends to owner)
      tx.moveCall({
        target: `${VAULT_PACKAGE_ID}::cycling_vault::deposit_reward`,
        typeArguments: [vault.tokenXType, vault.tokenYType, rewarder.coin_type],
        arguments: [
          tx.object(VAULT_CONFIG_ID),
          tx.object(vault.id),
          rewardCoin,
        ],
      });
    }

    // 5. Deposit proceeds back into vault (resets timer)
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::cycling_vault::deposit_proceeds`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(VAULT_CONFIG_ID), tx.object(vault.id),
        removeLpCoinA, removeLpCoinB, feeCoinA, feeCoinB,
        tx.object(CLOCK_OBJECT_ID),
      ],
    });

    // 6. Transfer empty old position NFT to owner
    tx.transferObjects([oldPosition], vault.owner);

    // ===== OPEN PHASE =====

    // 7. Compound accumulated fees before opening new position
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::cycling_vault::compound_fees`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(VAULT_CONFIG_ID),
        tx.object(vault.id),
      ],
    });
    log.info('Compounding fees for next cycle');

    // 8. Take tokens from vault for new position (now includes compounded fees)
    const [coinX, coinY] = tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::cycling_vault::take_for_position`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(VAULT_CONFIG_ID),
        tx.object(vault.id),
      ],
    });

    // 8. Calculate tick range
    const rangePercent = vault.rangeBps / 100;
    const tickLower = calculateTickFromPercent(currentTick, -rangePercent, actualTickSpacing);
    const tickUpper = calculateTickFromPercent(currentTick, rangePercent, actualTickSpacing);

    log.info('Tick calculation', { currentTick, rangePercent: `${rangePercent}%`, tickSpacing: actualTickSpacing, tickLower, tickUpper });

    // 9. Calculate sqrt prices
    const lowerSqrtPrice = tickIndexToSqrtPriceX64(tickLower);
    const upperSqrtPrice = tickIndexToSqrtPriceX64(tickUpper);

    // 10. Open new position
    const newPosition = this.sdk.Position.openPosition(
      tx, poolParams, lowerSqrtPrice.toString(), upperSqrtPrice.toString()
    );

    // 11. Add liquidity - call MMT contract directly to capture leftover
    const [leftoverX, leftoverY] = tx.moveCall({
      target: `${this.sdk.PackageId}::liquidity::add_liquidity`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(vault.poolId),
        newPosition,
        coinX,
        coinY,
        tx.pure.u64(0), // min_amount_x
        tx.pure.u64(0), // min_amount_y
        tx.object('0x6'), // clock
        tx.object(this.sdk.contractConst.versionId),
      ],
    });
    log.info('Added liquidity to position');

    // 12. Deposit leftover back into vault for compounding
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::cycling_vault::deposit_leftover`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(VAULT_CONFIG_ID),
        tx.object(vault.id),
        leftoverX,
        leftoverY,
      ],
    });
    log.info('Deposited leftover back to vault');

    // 13. Store new position in vault
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::cycling_vault::store_position`,
      typeArguments: [vault.tokenXType, vault.tokenYType, MMT_POSITION_TYPE],
      arguments: [
        tx.object(VAULT_CONFIG_ID),
        tx.object(vault.id),
        newPosition,
      ],
    });

    // Execute
    tx.setGasBudget(100_000_000);
    tx.setSender(this.executorAddress);

    const builtTx = await tx.build({ client: this.client });
    const signature = (await this.keypair.signTransaction(builtTx)).signature;

    const result = await this.client.executeTransactionBlock({
      transactionBlock: builtTx,
      signature,
      options: { showEffects: true, showObjectChanges: true, showEvents: true },
    });

    if (result.effects?.status?.status !== 'success') {
      throw new Error(`Close+Reopen failed: ${result.effects?.status?.error}`);
    }

    // Track actual gas cost
    const gasUsed = result.effects?.gasUsed;
    if (gasUsed) {
      const totalGas = BigInt(gasUsed.computationCost) + BigInt(gasUsed.storageCost) - BigInt(gasUsed.storageRebate);
      const gasInSui = Number(totalGas) / 1e9;
      log.info(`Gas used: ${gasInSui.toFixed(6)} SUI (computation: ${gasUsed.computationCost}, storage: ${gasUsed.storageCost}, rebate: ${gasUsed.storageRebate})`);
    }

    log.success('Position cycled successfully', result.digest);
  }

  /**
   * Open a new position using vault tokens (for new vaults without existing position)
   */
  private async openNewPosition(vault: VaultData): Promise<void> {
    log.info('Opening new position...');

    const tx = new Transaction();
    const sdkPool = await this.sdk.Pool.getPool(vault.poolId);
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

    // 1. Compound accumulated fees before opening position (reinvest all fees)
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::cycling_vault::compound_fees`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(VAULT_CONFIG_ID),
        tx.object(vault.id),
      ],
    });
    log.info('Compounding fees into principal balance');

    // 2. Take tokens from vault (now includes compounded fees)
    const [coinX, coinY] = tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::cycling_vault::take_for_position`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(VAULT_CONFIG_ID),
        tx.object(vault.id),
      ],
    });

    // 2. Calculate tick range based on range_bps
    // range_bps = 500 means 5% range on each side
    const rangePercent = vault.rangeBps / 100; // Convert basis points to percent
    const tickLower = calculateTickFromPercent(currentTick, -rangePercent, actualTickSpacing);
    const tickUpper = calculateTickFromPercent(currentTick, rangePercent, actualTickSpacing);

    log.info('Tick calculation', {
      currentTick,
      rangePercent: `${rangePercent}%`,
      tickSpacing: actualTickSpacing,
      tickLower,
      tickUpper,
    });

    // 3. Calculate sqrt prices from ticks
    const lowerSqrtPrice = tickIndexToSqrtPriceX64(tickLower);
    const upperSqrtPrice = tickIndexToSqrtPriceX64(tickUpper);

    // 4. Open position using SDK
    const position = this.sdk.Position.openPosition(
      tx,
      poolParams,
      lowerSqrtPrice.toString(),
      upperSqrtPrice.toString()
    );

    // 5. Add liquidity - call MMT contract directly to capture leftover
    const [leftoverX, leftoverY] = tx.moveCall({
      target: `${this.sdk.PackageId}::liquidity::add_liquidity`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(vault.poolId),
        position,
        coinX,
        coinY,
        tx.pure.u64(0), // min_amount_x
        tx.pure.u64(0), // min_amount_y
        tx.object('0x6'), // clock
        tx.object(this.sdk.contractConst.versionId),
      ],
    });
    log.info('Added liquidity to position');

    // 6. Deposit leftover back into vault for compounding
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::cycling_vault::deposit_leftover`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(VAULT_CONFIG_ID),
        tx.object(vault.id),
        leftoverX,
        leftoverY,
      ],
    });
    log.info('Deposited leftover back to vault');

    // 7. Store position in vault
    tx.moveCall({
      target: `${VAULT_PACKAGE_ID}::cycling_vault::store_position`,
      typeArguments: [vault.tokenXType, vault.tokenYType, MMT_POSITION_TYPE],
      arguments: [
        tx.object(VAULT_CONFIG_ID),
        tx.object(vault.id),
        position,
      ],
    });

    // Execute
    tx.setGasBudget(100_000_000);
    tx.setSender(this.executorAddress);

    const builtTx = await tx.build({ client: this.client });
    const signature = (await this.keypair.signTransaction(builtTx)).signature;

    const result = await this.client.executeTransactionBlock({
      transactionBlock: builtTx,
      signature,
      options: { showEffects: true, showObjectChanges: true, showEvents: true },
    });

    if (result.effects?.status?.status !== 'success') {
      throw new Error(`Open position failed: ${result.effects?.status?.error}`);
    }

    // Track actual gas cost
    const gasUsed = result.effects?.gasUsed;
    if (gasUsed) {
      const totalGas = BigInt(gasUsed.computationCost) + BigInt(gasUsed.storageCost) - BigInt(gasUsed.storageRebate);
      const gasInSui = Number(totalGas) / 1e9;
      log.info(`Gas used: ${gasInSui.toFixed(6)} SUI (computation: ${gasUsed.computationCost}, storage: ${gasUsed.storageCost}, rebate: ${gasUsed.storageRebate})`);
    }

    log.success('Position opened successfully', result.digest);
  }

  /**
   * Get the liquidity of the position stored in a vault
   */
  private async getStoredPositionLiquidity(vaultId: string): Promise<bigint> {
    try {
      // Query dynamic object fields
      const dynamicFields = await this.client.getDynamicFields({
        parentId: vaultId,
      });

      // Find the position field by objectType (contains ::position::Position)
      const positionField = dynamicFields.data.find(
        (field) => field.objectType?.includes('::position::Position')
      );

      if (!positionField) {
        log.warn('No position found in vault');
        throw new Error('No position found in vault');
      }

      // Get the position object
      const positionObj = await this.client.getObject({
        id: positionField.objectId,
        options: { showContent: true },
      });

      if (!positionObj.data?.content || positionObj.data.content.dataType !== 'moveObject') {
        throw new Error('Position object not found');
      }

      const fields = positionObj.data.content.fields as Record<string, unknown>;

      // The position might be wrapped in a value field (dynamic field wrapping)
      const positionFields = (fields.value as Record<string, unknown>) || fields;
      const liquidity = positionFields.liquidity as string;

      if (!liquidity) {
        throw new Error('Liquidity not found in position');
      }

      return BigInt(liquidity);
    } catch (error) {
      log.error('Failed to get position liquidity', error);
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ Main ============

async function main() {
  const service = new VaultService();

  // Handle shutdown
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
