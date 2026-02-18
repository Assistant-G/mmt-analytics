/**
 * Unified Vault Automation Service
 *
 * A single backend service that manages ALL vault operations:
 *
 * 1. TIMER-BASED CYCLING:
 *    - Monitors vault timers (next_execution_at)
 *    - When timer expires: close position → deposit_proceeds → compound_fees → open new position
 *    - Tracks cycles_completed, respects max_cycles
 *    - Uses deposit_reward for xSUI/reward tracking
 *
 * 2. AUTO-REBALANCE (OUT OF RANGE):
 *    - Monitors position tick range vs current pool tick
 *    - When out of range: mark_out_of_range → wait delay → rebalance
 *    - Uses record_rebalance to update rebalance state
 *
 * 3. ZAP MODE:
 *    - Pre-swaps tokens to match target position ratio
 *    - Works for BOTH timer cycles AND auto-rebalance for max capital efficiency
 *
 * 4. INITIAL POSITION OPENING:
 *    - For new vaults with balance but no position
 *    - Compounds fees before opening (if auto_compound enabled)
 *
 * All leftover coins are deposited back to vault (NOT to user wallet).
 */

import 'dotenv/config';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { MmtSDK, Types } from '@mmt-finance/clmm-sdk';

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
  zap: '⚡',
  target: '🎯',
};

class Logger {
  private formatTime(): string {
    const now = new Date();
    return `${colors.dim}[${now.toLocaleTimeString('en-US', { hour12: false })}]${colors.reset}`;
  }

  private shortId(id: string): string {
    return `${id.slice(0, 8)}...${id.slice(-6)}`;
  }

  box(title: string, content?: string[]): void {
    const width = 55;
    const line = '═'.repeat(width);
    console.log(`${colors.cyan}╔${line}╗${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}${colors.bold}${colors.brightCyan} ${title.padEnd(width - 1)}${colors.reset}${colors.cyan}║${colors.reset}`);
    if (content && content.length > 0) {
      console.log(`${colors.cyan}╠${line}╣${colors.reset}`);
      for (const l of content) {
        console.log(`${colors.cyan}║${colors.reset} ${l.padEnd(width - 1)}${colors.cyan}║${colors.reset}`);
      }
    }
    console.log(`${colors.cyan}╚${line}╝${colors.reset}`);
  }

  info(message: string): void {
    console.log(`${this.formatTime()} ${colors.blue}${icons.info}${colors.reset} ${message}`);
  }

  success(message: string, txDigest?: string): void {
    console.log(`${this.formatTime()} ${colors.green}${icons.check}${colors.reset} ${colors.brightGreen}${message}${colors.reset}`);
    if (txDigest) {
      console.log(`   ${colors.dim}${icons.link} https://suivision.xyz/txblock/${txDigest}${colors.reset}`);
    }
  }

  error(message: string, err?: unknown): void {
    console.log(`${this.formatTime()} ${colors.red}${icons.cross}${colors.reset} ${colors.brightRed}${message}${colors.reset}`);
    if (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`   ${colors.dim}${msg}${colors.reset}`);
    }
  }

  warn(message: string): void {
    console.log(`${this.formatTime()} ${colors.yellow}${icons.warning}${colors.reset} ${colors.brightYellow}${message}${colors.reset}`);
  }

  vault(vaultId: string, action: string, details?: Record<string, unknown>): void {
    console.log(`${this.formatTime()} ${colors.magenta}${icons.vault}${colors.reset} ${colors.brightMagenta}${this.shortId(vaultId)}${colors.reset} ${colors.dim}│${colors.reset} ${action}`);
    if (details) {
      for (const [key, value] of Object.entries(details)) {
        console.log(`   ${colors.dim}├─ ${key}:${colors.reset} ${colors.white}${value}${colors.reset}`);
      }
    }
  }

  cycle(vaultId: string, current: number, max: number): void {
    const maxStr = max === 0 ? '∞' : String(max);
    const progress = max === 0 ? '' : ` (${Math.round((current / max) * 100)}%)`;
    console.log(`${this.formatTime()} ${colors.cyan}${icons.cycle}${colors.reset} ${colors.brightCyan}Cycle ${current}/${maxStr}${progress}${colors.reset} ${colors.dim}│${colors.reset} ${this.shortId(vaultId)}`);
  }

  rebalance(vaultId: string, reason: string): void {
    console.log(`${this.formatTime()} ${colors.yellow}${icons.target}${colors.reset} ${colors.brightYellow}Rebalance${colors.reset} ${colors.dim}│${colors.reset} ${this.shortId(vaultId)} ${colors.dim}(${reason})${colors.reset}`);
  }

  timer(vaultId: string, secondsLeft: number): void {
    const timeStr = secondsLeft >= 60 ? `${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s` : `${secondsLeft}s`;
    console.log(`   ${colors.dim}${icons.clock} ${this.shortId(vaultId)}: ${timeStr} remaining${colors.reset}`);
  }

  monitoring(activeCount: number, totalCount: number): void {
    if (activeCount === 0) return;
    console.log(`${this.formatTime()} ${colors.brightBlack}${icons.search} Monitoring ${activeCount} active / ${totalCount} total vaults${colors.reset}`);
  }

  separator(): void {
    console.log(`${colors.dim}${'─'.repeat(60)}${colors.reset}`);
  }

  startup(config: { executor: string; network: string; pollInterval: number; packageId: string }): void {
    console.log('');
    this.box(`${icons.rocket} UNIFIED VAULT AUTOMATION SERVICE`, [
      `${icons.gear} Network: ${config.network}`,
      `${icons.clock} Poll Interval: ${config.pollInterval / 1000}s`,
      `${icons.money} Executor: ${this.shortId(config.executor)}`,
      `${icons.vault} Package: ${this.shortId(config.packageId)}`,
    ]);
    console.log('');
  }
}

const log = new Logger();
type PoolInfo = Types.ExtendedPoolWithApr;
import BN from 'bn.js';

// Configuration - uses Railway env vars
const CONFIG = {
  packageId: process.env.VAULT_PACKAGE_ID || '0x4554604e6a3fcc8a412884a45c47d1265588644a99a32029b8070e5ff8067e94',
  vaultConfigId: process.env.VAULT_CONFIG_ID || '0x08910c589001a95f7dba36c56cc21752bdc970e5dcce95aaff821c89f9d7d00f',
  clockId: '0x6',
  pollInterval: parseInt(process.env.POLL_INTERVAL || '30000'),
  network: 'mainnet' as const,
  rpcUrl: process.env.SUI_RPC_URL || getFullnodeUrl('mainnet'),
};

const suiClient = new SuiClient({ url: CONFIG.rpcUrl });
const sdk = MmtSDK.NEW({ network: CONFIG.network });

// MMT package ID will be resolved dynamically from version object
let mmtPackageId: string = '';

// SDK initialized - verbose logging removed

// Get MMT package ID from version object type
async function getMmtPackageId(): Promise<string> {
  if (mmtPackageId) return mmtPackageId;

  try {
    const versionObj = await suiClient.getObject({
      id: sdk.contractConst.versionId,
      options: { showType: true },
    });

    if (versionObj.data?.type) {
      // Extract package ID from type like "0x...::version::Version"
      const match = versionObj.data.type.match(/^(0x[a-fA-F0-9]+)::/);
      if (match) {
        mmtPackageId = match[1];
        return mmtPackageId;
      }
    }
  } catch (e) {
    // Silently fall back
  }

  // Fallback to known package ID
  mmtPackageId = '0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860';
  return mmtPackageId;
}

let operatorKeypair: Ed25519Keypair | null = null;
let allPools: PoolInfo[] = [];

interface VaultInfo {
  id: string;
  owner: string;
  poolId: string;
  tokenXType: string;
  tokenYType: string;
  // Settings
  rangeBps: u64;
  timerDurationMs: number;
  maxCycles: number;
  cyclesCompleted: number;
  // Rebalance settings
  autoRebalance: boolean;
  useZap: boolean;
  autoCompound: boolean;
  rebalanceDelayMs: number;
  outOfRangeSince: number;
  rebalancePending: boolean;
  rebalanceCount: number;
  feeRecipient: string;
  maxZapSlippageBps: number; // Max slippage for ZAP (bps), 0 = no limit
  // State
  isActive: boolean;
  hasPosition: boolean;
  // Balances (when not in position)
  balanceX: string;
  balanceY: string;
  // Position data (if has_position)
  positionId?: string;
  positionType?: string;
  tickLower?: number;
  tickUpper?: number;
  liquidity?: string;
  // Pool data
  currentTick: number;
  currentSqrtPrice: string;
  tickSpacing: number;
  isInRange: boolean;
}

type u64 = number;

const processingVaults = new Set<string>();

function loadOperatorKeypair(): Ed25519Keypair {
  const privateKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('OPERATOR_PRIVATE_KEY environment variable required');
  }

  if (privateKey.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }

  if (privateKey.startsWith('0x')) {
    return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey.slice(2), 'hex'));
  }

  return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));
}

// Convert tick to sqrt price X64
function tickIndexToSqrtPriceX64(tickIndex: number): BN {
  const sqrtRatio = Math.sqrt(Math.pow(1.0001, tickIndex));
  const sqrtPriceX64 = sqrtRatio * Math.pow(2, 64);
  return new BN(Math.floor(sqrtPriceX64).toString());
}

/**
 * Calculate the exact token ratio needed for a CLMM position.
 */
function calculateTargetXRatio(
  currentSqrtPriceX64: string,
  lowerTick: number,
  upperTick: number
): number {
  const sqrtP = Number(BigInt(currentSqrtPriceX64)) / (2 ** 64);
  const sqrtPa = Math.sqrt(Math.pow(1.0001, lowerTick));
  const sqrtPb = Math.sqrt(Math.pow(1.0001, upperTick));

  if (sqrtP <= sqrtPa) return 1.0;
  if (sqrtP >= sqrtPb) return 0.0;

  const amountXPerL = (sqrtPb - sqrtP) / (sqrtP * sqrtPb);
  const amountYPerL = sqrtP - sqrtPa;

  const price = sqrtP * sqrtP;
  const xValueInY = amountXPerL * price;
  const yValue = amountYPerL;

  const totalValue = xValueInY + yValue;
  if (totalValue === 0) return 0.5;

  return xValueInY / totalValue;
}

async function fetchAllVaults(): Promise<VaultInfo[]> {
  if (allPools.length === 0) {
    allPools = await sdk.Pool.getAllPools();
  }

  const eventType = `${CONFIG.packageId}::cycling_vault::VaultCreated`;
  const events = await suiClient.queryEvents({
    query: { MoveEventType: eventType },
    limit: 1000,
  });

  const vaults: VaultInfo[] = [];

  for (const event of events.data) {
    const parsedJson = event.parsedJson as Record<string, unknown>;
    const vaultId = parsedJson.vault_id as string;

    try {
      const vaultObj = await suiClient.getObject({
        id: vaultId,
        options: { showContent: true, showType: true },
      });

      if (!vaultObj.data || vaultObj.data?.content?.dataType !== 'moveObject') {
        continue; // Silently skip deleted vaults
      }

      const vaultType = vaultObj.data.type || '';
      const fields = (vaultObj.data.content as any).fields;

      // Verify vault belongs to current package (skip vaults from old deployments)
      if (!vaultType.includes(CONFIG.packageId)) {
        log.warn(`Skipping vault ${vaultId.slice(0, 10)}... from different package`);
        continue;
      }

      const typeMatch = vaultType.match(/Vault<([^,]+),\s*([^>]+)>/);
      if (!typeMatch) continue;

      const tokenXType = typeMatch[1].trim();
      const tokenYType = typeMatch[2].trim();

      // Find pool
      const normalizeType = (t: string) => t.replace(/^0x0+/, '0x');
      const normX = normalizeType(tokenXType);
      const normY = normalizeType(tokenYType);

      const pool = allPools.find(p => {
        const pNormX = normalizeType(p.tokenXType);
        const pNormY = normalizeType(p.tokenYType);
        return (pNormX === normX && pNormY === normY) ||
               (pNormX === normY && pNormY === normX);
      });

      if (!pool) continue;

      // Convert currentTick from unsigned to signed
      let currentTick = parseInt(pool.currentTickIndex);
      const MAX_I32 = 2147483647;
      const OVERFLOW = 4294967296;
      if (currentTick > MAX_I32) currentTick = currentTick - OVERFLOW;

      // Get position data if vault has position
      let positionData: {
        positionId?: string;
        positionType?: string;
        tickLower?: number;
        tickUpper?: number;
        liquidity?: string;
      } = {};

      if (fields.has_position) {
        positionData = await fetchPositionFromVault(vaultId);
      }

      const tickLower = positionData.tickLower ?? 0;
      const tickUpper = positionData.tickUpper ?? 0;
      const isInRange = fields.has_position
        ? (currentTick >= tickLower && currentTick <= tickUpper)
        : true;

      // Extract balance values
      const balanceX = typeof fields.balance_x === 'string'
        ? fields.balance_x
        : (fields.balance_x?.fields?.value || fields.balance_x?.value || '0');
      const balanceY = typeof fields.balance_y === 'string'
        ? fields.balance_y
        : (fields.balance_y?.fields?.value || fields.balance_y?.value || '0');

      vaults.push({
        id: vaultId,
        owner: fields.owner,
        poolId: pool.poolId,
        tokenXType,
        tokenYType,
        rangeBps: Number(fields.range_bps || 500),
        timerDurationMs: Number(fields.timer_duration_ms || 0),
        maxCycles: Number(fields.max_cycles || 0),
        cyclesCompleted: Number(fields.cycles_completed || 0),
        autoRebalance: fields.auto_rebalance ?? false,
        useZap: fields.use_zap ?? true,
        autoCompound: fields.auto_compound ?? false,
        rebalanceDelayMs: Number(fields.rebalance_delay_ms || 0),
        outOfRangeSince: Number(fields.out_of_range_since || 0),
        rebalancePending: fields.rebalance_pending ?? false,
        rebalanceCount: Number(fields.rebalance_count || 0),
        feeRecipient: fields.fee_recipient || '0x0',
        maxZapSlippageBps: Number(fields.max_zap_slippage_bps || 0),
        isActive: fields.is_active ?? false,
        hasPosition: fields.has_position ?? false,
        balanceX,
        balanceY,
        ...positionData,
        currentTick,
        currentSqrtPrice: pool.currentSqrtPrice,
        tickSpacing: pool.tickSpacing,
        isInRange,
      });
    } catch (e) {
      // Silently skip errors (likely deleted vaults)
    }
  }

  return vaults;
}

async function fetchPositionFromVault(vaultId: string): Promise<{
  positionId?: string;
  positionType?: string;
  tickLower?: number;
  tickUpper?: number;
  liquidity?: string;
}> {
  try {
    const positionFieldBytes = Array.from('position').map(c => c.charCodeAt(0));
    const positionObject = await suiClient.getDynamicFieldObject({
      parentId: vaultId,
      name: { type: 'vector<u8>', value: positionFieldBytes },
    });

    if (!positionObject?.data?.content || positionObject.data.content.dataType !== 'moveObject') {
      return {};
    }

    const positionType = positionObject.data.type || '';
    const positionId = positionObject.data.objectId;
    const fields = (positionObject.data.content as any).fields;

    const tickLowerField = fields.tick_lower_index;
    const tickUpperField = fields.tick_upper_index;

    let lowerTick = tickLowerField?.fields?.bits ? Number(tickLowerField.fields.bits) : 0;
    let upperTick = tickUpperField?.fields?.bits ? Number(tickUpperField.fields.bits) : 0;

    const MAX_I32 = 2147483647;
    const OVERFLOW = 4294967296;
    if (lowerTick > MAX_I32) lowerTick = lowerTick - OVERFLOW;
    if (upperTick > MAX_I32) upperTick = upperTick - OVERFLOW;

    return {
      positionId,
      positionType,
      tickLower: lowerTick,
      tickUpper: upperTick,
      liquidity: String(fields.liquidity || '0'),
    };
  } catch (e) {
    // Silently return empty - position may not exist
    return {};
  }
}

async function markOutOfRange(vault: VaultInfo): Promise<boolean> {
  if (!operatorKeypair) return false;

  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${CONFIG.packageId}::cycling_vault::mark_out_of_range`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(CONFIG.vaultConfigId),
        tx.object(vault.id),
        tx.object(CONFIG.clockId),
      ],
    });

    const result = await suiClient.signAndExecuteTransaction({
      signer: operatorKeypair,
      transaction: tx,
    });
    log.vault(vault.id, `Marked out of range`, { delay: `${vault.rebalanceDelayMs / 1000}s` });
    return true;
  } catch (e: any) {
    log.error(`Failed to mark out of range`, e);
    return false;
  }
}

async function clearOutOfRange(vault: VaultInfo): Promise<boolean> {
  if (!operatorKeypair) return false;

  try {
    const tx = new Transaction();

    tx.moveCall({
      target: `${CONFIG.packageId}::cycling_vault::clear_out_of_range`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(CONFIG.vaultConfigId),
        tx.object(vault.id),
        tx.object(CONFIG.clockId),
      ],
    });

    const result = await suiClient.signAndExecuteTransaction({
      signer: operatorKeypair,
      transaction: tx,
    });
    log.vault(vault.id, 'Cleared out of range (back in range)');
    return true;
  } catch (e: any) {
    log.error(`Failed to clear out of range`, e);
    return false;
  }
}

async function executeVaultRebalance(vault: VaultInfo, isTimerTriggered: boolean = false): Promise<boolean> {
  if (!operatorKeypair) return false;
  if (processingVaults.has(vault.id)) return false;
  if (!vault.hasPosition || !vault.positionType || !vault.liquidity) {
    return false;
  }

  const isLastCycle = isTimerTriggered && vault.maxCycles > 0 && (vault.cyclesCompleted + 1) >= vault.maxCycles;
  processingVaults.add(vault.id);

  // Log the operation start
  log.separator();
  if (isTimerTriggered) {
    log.cycle(vault.id, vault.cyclesCompleted + 1, vault.maxCycles);
    if (isLastCycle) log.info('Final cycle - will not reopen position');
  } else {
    log.rebalance(vault.id, 'out of range');
  }

  try {
    const tx = new Transaction();
    tx.addSerializationPlugin(sdk.mvrNamedPackagesPlugin);
    const targetPackage = sdk.contractConst.mvrName;

    const fullPositionType = vault.positionType || '';
    const basePositionType = fullPositionType.replace(/<.*>$/, '');

    const pool = allPools.find(p => p.poolId === vault.poolId);

    // Log pool and rewarders info
    if (pool?.rewarders && pool.rewarders.length > 0) {
      log.info(`Pool has ${pool.rewarders.length} rewarder(s)`);
    } else {
      log.warn(`No rewarders found for pool ${vault.poolId.slice(0, 10)}...`);
    }

    // Retrieve position from vault
    const [retrievedPosition] = tx.moveCall({
      target: `${CONFIG.packageId}::cycling_vault::retrieve_position`,
      typeArguments: [vault.tokenXType, vault.tokenYType, basePositionType],
      arguments: [
        tx.object(CONFIG.vaultConfigId),
        tx.object(vault.id),
      ],
    });

    // Collect fees
    const [feeX, feeY] = tx.moveCall({
      target: `${targetPackage}::collect::fee`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(vault.poolId),
        retrievedPosition,
        tx.object(CONFIG.clockId),
        tx.object(sdk.contractConst.versionId),
      ],
    });

    // Collect rewards
    if (pool?.rewarders && pool.rewarders.length > 0) {
      for (const rewarder of pool.rewarders) {
        const [rewardCoin] = tx.moveCall({
          target: `${targetPackage}::collect::reward`,
          typeArguments: [vault.tokenXType, vault.tokenYType, rewarder.coin_type],
          arguments: [
            tx.object(vault.poolId),
            retrievedPosition,
            tx.object(CONFIG.clockId),
            tx.object(sdk.contractConst.versionId),
          ],
        });

        if (isTimerTriggered) {
          // For timer cycles: deposit reward into vault for tracking (sends to owner)
          tx.moveCall({
            target: `${CONFIG.packageId}::cycling_vault::deposit_reward`,
            typeArguments: [vault.tokenXType, vault.tokenYType, rewarder.coin_type],
            arguments: [
              tx.object(CONFIG.vaultConfigId),
              tx.object(vault.id),
              rewardCoin,
            ],
          });
        } else {
          // For auto-rebalance: track reward and send to owner
          // Get reward value for tracking
          const [rewardValue] = tx.moveCall({
            target: '0x2::coin::value',
            typeArguments: [rewarder.coin_type],
            arguments: [rewardCoin],
          });

          // Track the reward in vault stats
          tx.moveCall({
            target: `${CONFIG.packageId}::cycling_vault::track_reward`,
            typeArguments: [vault.tokenXType, vault.tokenYType, rewarder.coin_type],
            arguments: [
              tx.object(CONFIG.vaultConfigId),
              tx.object(vault.id),
              rewardValue,
            ],
          });

          // Send to owner or fee recipient
          const isZeroAddr = !vault.feeRecipient ||
            vault.feeRecipient === '0x0' ||
            vault.feeRecipient.replace(/0/g, '') === 'x';
          const rewardRecipient = isZeroAddr ? vault.owner : vault.feeRecipient;
          log.info(`Sending reward to ${rewardRecipient.slice(0, 10)}...`);
          tx.transferObjects([rewardCoin], rewardRecipient);
        }
      }
    }

    // Remove all liquidity
    const [coinX, coinY] = tx.moveCall({
      target: `${targetPackage}::liquidity::remove_liquidity`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(vault.poolId),
        retrievedPosition,
        tx.pure.u128(vault.liquidity),
        tx.pure.u64(0),
        tx.pure.u64(0),
        tx.object(CONFIG.clockId),
        tx.object(sdk.contractConst.versionId),
      ],
    });

    // For AUTO-REBALANCE: close the position (destroy NFT)
    // For TIMER CYCLES: keep position to transfer to owner as "receipt"
    if (!isTimerTriggered) {
      tx.moveCall({
        target: `${targetPackage}::liquidity::close_position`,
        arguments: [
          retrievedPosition,
          tx.object(sdk.contractConst.versionId),
        ],
      });
    }

    // Handle fees based on trigger type
    if (isTimerTriggered) {
      // Timer-triggered: deposit_proceeds updates cycle count and resets timer
      tx.moveCall({
        target: `${CONFIG.packageId}::cycling_vault::deposit_proceeds`,
        typeArguments: [vault.tokenXType, vault.tokenYType],
        arguments: [
          tx.object(CONFIG.vaultConfigId),
          tx.object(vault.id),
          coinX,    // liquidity coins
          coinY,    // liquidity coins
          feeX,     // fee coins
          feeY,     // fee coins
          tx.object(CONFIG.clockId),
        ],
      });

      // For LAST CYCLE: transfer position to owner and exit (no reopen)
      if (isLastCycle) {
        tx.transferObjects([retrievedPosition], vault.owner);

        const result = await suiClient.signAndExecuteTransaction({
          signer: operatorKeypair,
          transaction: tx,
          options: { showEffects: true, showEvents: true },
        });

        if (result.effects?.status?.status === 'success') {
          log.success(`Final cycle complete - ${vault.maxCycles} cycles finished`, result.digest);
        } else {
          log.error(`Final cycle failed`, result.effects?.status?.error);
        }
        return result.effects?.status?.status === 'success';
      }

      // Transfer old position to owner (as cycle receipt)
      tx.transferObjects([retrievedPosition], vault.owner);

      // Compound fees before opening new position (if auto_compound enabled)
      if (vault.autoCompound) {
        tx.moveCall({
          target: `${CONFIG.packageId}::cycling_vault::compound_fees`,
          typeArguments: [vault.tokenXType, vault.tokenYType],
          arguments: [
            tx.object(CONFIG.vaultConfigId),
            tx.object(vault.id),
          ],
        });
      }
    } else {
      // AUTO-REBALANCE: Track fees before merging
      const [feeXValue] = tx.moveCall({
        target: '0x2::coin::value',
        typeArguments: [vault.tokenXType],
        arguments: [feeX],
      });
      const [feeYValue] = tx.moveCall({
        target: '0x2::coin::value',
        typeArguments: [vault.tokenYType],
        arguments: [feeY],
      });

      // Track fees in vault stats
      tx.moveCall({
        target: `${CONFIG.packageId}::cycling_vault::track_fees`,
        typeArguments: [vault.tokenXType, vault.tokenYType],
        arguments: [
          tx.object(CONFIG.vaultConfigId),
          tx.object(vault.id),
          feeXValue,
          feeYValue,
        ],
      });

      // Merge fees with liquidity coins
      tx.mergeCoins(coinX, [feeX]);
      tx.mergeCoins(coinY, [feeY]);

      // Also take leftover balance from vault and merge it
      const [leftoverX, leftoverY] = tx.moveCall({
        target: `${CONFIG.packageId}::cycling_vault::take_for_position`,
        typeArguments: [vault.tokenXType, vault.tokenYType],
        arguments: [
          tx.object(CONFIG.vaultConfigId),
          tx.object(vault.id),
        ],
      });
      tx.mergeCoins(coinX, [leftoverX]);
      tx.mergeCoins(coinY, [leftoverY]);
    }

    // Calculate new tick range
    const currentTick = vault.currentTick;
    const rangePercent = vault.rangeBps / 10000;
    const ticksForRange = Math.round(rangePercent * 10000);
    const tickSpacing = vault.tickSpacing;

    let newLowerTick = Math.floor((currentTick - ticksForRange) / tickSpacing) * tickSpacing;
    let newUpperTick = Math.ceil((currentTick + ticksForRange) / tickSpacing) * tickSpacing;

    // Take tokens for new position
    let positionCoinX: any;
    let positionCoinY: any;

    if (isTimerTriggered) {
      const [takenX, takenY] = tx.moveCall({
        target: `${CONFIG.packageId}::cycling_vault::take_for_position`,
        typeArguments: [vault.tokenXType, vault.tokenYType],
        arguments: [
          tx.object(CONFIG.vaultConfigId),
          tx.object(vault.id),
        ],
      });
      positionCoinX = takenX;
      positionCoinY = takenY;
    } else {
      // For auto-rebalance: use the coins we already have (liquidity + fees merged)
      positionCoinX = coinX;
      positionCoinY = coinY;
    }

    // Open new position
    const lowerSqrtPrice = tickIndexToSqrtPriceX64(newLowerTick);
    const upperSqrtPrice = tickIndexToSqrtPriceX64(newUpperTick);

    const [lowerTick1] = tx.moveCall({
      target: `${targetPackage}::tick_math::get_tick_at_sqrt_price`,
      arguments: [tx.pure.u128(lowerSqrtPrice.toString())],
    });
    const [upperTick1] = tx.moveCall({
      target: `${targetPackage}::tick_math::get_tick_at_sqrt_price`,
      arguments: [tx.pure.u128(upperSqrtPrice.toString())],
    });

    const [tickSpacingI32] = tx.moveCall({
      target: `${targetPackage}::i32::from_u32`,
      arguments: [tx.pure.u32(tickSpacing)],
    });

    const [lowerTickMod] = tx.moveCall({
      target: `${targetPackage}::i32::mod`,
      arguments: [lowerTick1, tickSpacingI32],
    });
    const [upperTickMod] = tx.moveCall({
      target: `${targetPackage}::i32::mod`,
      arguments: [upperTick1, tickSpacingI32],
    });
    const [lowerTick] = tx.moveCall({
      target: `${targetPackage}::i32::sub`,
      arguments: [lowerTick1, lowerTickMod],
    });
    const [upperTick] = tx.moveCall({
      target: `${targetPackage}::i32::sub`,
      arguments: [upperTick1, upperTickMod],
    });

    const [newPosition] = tx.moveCall({
      target: `${targetPackage}::liquidity::open_position`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(vault.poolId),
        lowerTick,
        upperTick,
        tx.object(sdk.contractConst.versionId),
      ],
    });

    // Track swap amounts for recording in event (actual data, not estimates)
    let actualSwapAmountIn: any = null;
    let actualSwapAmountOut: any = null;
    let actualSwapXtoY = false;

    // ZAP Mode: Swap tokens to balance ratio (for BOTH timer cycles and auto-rebalance)
    // This ensures capital efficiency by using ALL available liquidity
    let zapSkippedDueToSlippage = false;
    if (vault.useZap) {
      const targetXRatio = calculateTargetXRatio(vault.currentSqrtPrice, newLowerTick, newUpperTick);
      const wasAboveRange = vault.currentTick > (vault.tickUpper ?? 0);
      const wasBelowRange = vault.currentTick < (vault.tickLower ?? 0);

      let swapXtoY: boolean;
      let swapPercent: number;

      if (wasAboveRange) {
        swapXtoY = false;
        swapPercent = targetXRatio;
      } else if (wasBelowRange) {
        swapXtoY = true;
        swapPercent = 1 - targetXRatio;
      } else {
        swapXtoY = targetXRatio < 0.5;
        swapPercent = Math.abs(0.5 - targetXRatio) * 2;
      }

      swapPercent = Math.min(swapPercent * 1.003, 0.95);
      const imbalance = wasAboveRange || wasBelowRange ? swapPercent : Math.abs(0.5 - targetXRatio);

      // Estimate slippage based on swap percentage (rough approximation)
      // Small swaps: ~10bps, Medium: ~30bps, Large: ~50bps+
      const estimatedSlippageBps = imbalance < 0.05 ? 10 : imbalance < 0.2 ? 30 : 50 + Math.floor(imbalance * 100);

      // Check if slippage exceeds user's max threshold (skip ZAP if too expensive)
      if (vault.maxZapSlippageBps > 0 && estimatedSlippageBps > vault.maxZapSlippageBps) {
        log(`${icons.warning} ZAP skipped - estimated slippage ${estimatedSlippageBps}bps > max ${vault.maxZapSlippageBps}bps`, 'yellow');
        zapSkippedDueToSlippage = true;
      }

      if (!zapSkippedDueToSlippage && imbalance >= 0.02) {
        actualSwapXtoY = swapXtoY;
        const MIN_SQRT_PRICE = BigInt('4295048017');
        const MAX_SQRT_PRICE = BigInt('79226673515401279992447579050');
        const sqrtPriceLimit = swapXtoY ? MIN_SQRT_PRICE : MAX_SQRT_PRICE;

        const [fullCoinValue] = tx.moveCall({
          target: '0x2::coin::value',
          typeArguments: [swapXtoY ? vault.tokenXType : vault.tokenYType],
          arguments: [swapXtoY ? positionCoinX : positionCoinY],
        });

        const swapAmountBps = Math.floor(swapPercent * 10000);

        const [scaledValue] = tx.moveCall({
          target: `${targetPackage}::full_math_u64::mul_div_floor`,
          arguments: [
            fullCoinValue,
            tx.pure.u64(swapAmountBps),
            tx.pure.u64(10000),
          ],
        });

        const [coinToSwap] = tx.moveCall({
          target: '0x2::coin::split',
          typeArguments: [swapXtoY ? vault.tokenXType : vault.tokenYType],
          arguments: [swapXtoY ? positionCoinX : positionCoinY, scaledValue],
        });

        const [swapAmount] = tx.moveCall({
          target: '0x2::coin::value',
          typeArguments: [swapXtoY ? vault.tokenXType : vault.tokenYType],
          arguments: [coinToSwap],
        });

        // Track actual swap amount in
        actualSwapAmountIn = swapAmount;

        const [receiveBalanceA, receiveBalanceB, flashReceipt] = tx.moveCall({
          target: `${targetPackage}::trade::flash_swap`,
          typeArguments: [vault.tokenXType, vault.tokenYType],
          arguments: [
            tx.object(vault.poolId),
            tx.pure.bool(swapXtoY),
            tx.pure.bool(true),
            swapAmount,
            tx.pure.u128(sqrtPriceLimit.toString()),
            tx.object(CONFIG.clockId),
            tx.object(sdk.contractConst.versionId),
          ],
        });

        tx.moveCall({
          target: '0x2::balance::destroy_zero',
          typeArguments: [swapXtoY ? vault.tokenXType : vault.tokenYType],
          arguments: [swapXtoY ? receiveBalanceA : receiveBalanceB],
        });

        const [debtA, debtB] = tx.moveCall({
          target: `${targetPackage}::trade::swap_receipt_debts`,
          arguments: [flashReceipt],
        });

        const [paymentCoin] = tx.moveCall({
          target: '0x2::coin::split',
          typeArguments: [swapXtoY ? vault.tokenXType : vault.tokenYType],
          arguments: [coinToSwap, swapXtoY ? debtA : debtB],
        });

        tx.mergeCoins(swapXtoY ? positionCoinX : positionCoinY, [coinToSwap]);

        const [zeroCoin] = tx.moveCall({
          target: '0x2::coin::zero',
          typeArguments: [swapXtoY ? vault.tokenYType : vault.tokenXType],
        });

        const [paymentBalanceA] = tx.moveCall({
          target: '0x2::coin::into_balance',
          typeArguments: [vault.tokenXType],
          arguments: [swapXtoY ? paymentCoin : zeroCoin],
        });
        const [paymentBalanceB] = tx.moveCall({
          target: '0x2::coin::into_balance',
          typeArguments: [vault.tokenYType],
          arguments: [swapXtoY ? zeroCoin : paymentCoin],
        });

        tx.moveCall({
          target: `${targetPackage}::trade::repay_flash_swap`,
          typeArguments: [vault.tokenXType, vault.tokenYType],
          arguments: [
            tx.object(vault.poolId),
            flashReceipt,
            paymentBalanceA,
            paymentBalanceB,
            tx.object(sdk.contractConst.versionId),
          ],
        });

        // Get actual amount out from receive balance
        const [amountOut] = tx.moveCall({
          target: '0x2::balance::value',
          typeArguments: [swapXtoY ? vault.tokenYType : vault.tokenXType],
          arguments: [swapXtoY ? receiveBalanceB : receiveBalanceA],
        });
        actualSwapAmountOut = amountOut;

        const [swappedCoin] = tx.moveCall({
          target: '0x2::coin::from_balance',
          typeArguments: [swapXtoY ? vault.tokenYType : vault.tokenXType],
          arguments: [swapXtoY ? receiveBalanceB : receiveBalanceA],
        });

        if (swapXtoY) {
          tx.mergeCoins(positionCoinY, [swappedCoin]);
        } else {
          tx.mergeCoins(positionCoinX, [swappedCoin]);
        }

      }
    }

    // Add liquidity to new position
    const [remainingX, remainingY] = tx.moveCall({
      target: `${targetPackage}::liquidity::add_liquidity`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(vault.poolId),
        newPosition,
        positionCoinX,
        positionCoinY,
        tx.pure.u64(0),
        tx.pure.u64(0),
        tx.object(CONFIG.clockId),
        tx.object(sdk.contractConst.versionId),
      ],
    });

    // Deposit leftover back to vault
    tx.moveCall({
      target: `${CONFIG.packageId}::cycling_vault::deposit_leftover`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(CONFIG.vaultConfigId),
        tx.object(vault.id),
        remainingX,
        remainingY,
      ],
    });

    // Store new position back to vault
    tx.moveCall({
      target: `${CONFIG.packageId}::cycling_vault::store_position`,
      typeArguments: [vault.tokenXType, vault.tokenYType, basePositionType],
      arguments: [
        tx.object(CONFIG.vaultConfigId),
        tx.object(vault.id),
        newPosition,
        tx.object(CONFIG.clockId),
      ],
    });

    // Record rebalance (only for auto-rebalance, not timer-triggered)
    if (!isTimerTriggered) {
      // Pass actual swap amounts (or 0 if no swap occurred)
      const amountIn = actualSwapAmountIn ?? tx.pure.u64(0);
      const amountOut = actualSwapAmountOut ?? tx.pure.u64(0);

      tx.moveCall({
        target: `${CONFIG.packageId}::cycling_vault::record_rebalance`,
        typeArguments: [vault.tokenXType, vault.tokenYType],
        arguments: [
          tx.object(CONFIG.vaultConfigId),
          tx.object(vault.id),
          amountIn,
          amountOut,
          tx.pure.bool(actualSwapXtoY),
          tx.object(CONFIG.clockId),
        ],
      });
    }

    // Execute
    const result = await suiClient.signAndExecuteTransaction({
      signer: operatorKeypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true },
    });

    if (result.effects?.status?.status === 'success') {
      const opType = isTimerTriggered ? 'Cycle' : 'Rebalance';
      log.success(`${opType} complete - new range: ${newLowerTick} to ${newUpperTick}`, result.digest);
    } else {
      log.error(`Operation failed`, result.effects?.status?.error);
    }

    return result.effects?.status?.status === 'success';
  } catch (e: any) {
    log.error(`Vault operation failed`, e);
    return false;
  } finally {
    processingVaults.delete(vault.id);
  }
}

async function openInitialPosition(vault: VaultInfo): Promise<boolean> {
  if (!operatorKeypair) return false;
  if (processingVaults.has(vault.id)) return false;

  processingVaults.add(vault.id);
  log.separator();
  log.vault(vault.id, 'Opening initial position', {
    range: `±${vault.rangeBps / 100}%`,
    zap: vault.useZap ? 'ON' : 'OFF',
  });

  try {
    const tx = new Transaction();
    tx.addSerializationPlugin(sdk.mvrNamedPackagesPlugin);
    const targetPackage = sdk.contractConst.mvrName;

    // Compound accumulated fees before opening position (if auto_compound enabled)
    if (vault.autoCompound) {
      tx.moveCall({
        target: `${CONFIG.packageId}::cycling_vault::compound_fees`,
        typeArguments: [vault.tokenXType, vault.tokenYType],
        arguments: [
          tx.object(CONFIG.vaultConfigId),
          tx.object(vault.id),
        ],
      });
    }

    // Take tokens from vault
    const [coinX, coinY] = tx.moveCall({
      target: `${CONFIG.packageId}::cycling_vault::take_for_position`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(CONFIG.vaultConfigId),
        tx.object(vault.id),
      ],
    });

    // Calculate tick range
    const currentTick = vault.currentTick;
    const rangePercent = vault.rangeBps / 10000;
    const ticksForRange = Math.round(rangePercent * 10000);
    const tickSpacing = vault.tickSpacing;

    let newLowerTick = Math.floor((currentTick - ticksForRange) / tickSpacing) * tickSpacing;
    let newUpperTick = Math.ceil((currentTick + ticksForRange) / tickSpacing) * tickSpacing;

    // Open position
    const lowerSqrtPrice = tickIndexToSqrtPriceX64(newLowerTick);
    const upperSqrtPrice = tickIndexToSqrtPriceX64(newUpperTick);

    const [lowerTick1] = tx.moveCall({
      target: `${targetPackage}::tick_math::get_tick_at_sqrt_price`,
      arguments: [tx.pure.u128(lowerSqrtPrice.toString())],
    });
    const [upperTick1] = tx.moveCall({
      target: `${targetPackage}::tick_math::get_tick_at_sqrt_price`,
      arguments: [tx.pure.u128(upperSqrtPrice.toString())],
    });

    const [tickSpacingI32] = tx.moveCall({
      target: `${targetPackage}::i32::from_u32`,
      arguments: [tx.pure.u32(tickSpacing)],
    });

    const [lowerTickMod] = tx.moveCall({
      target: `${targetPackage}::i32::mod`,
      arguments: [lowerTick1, tickSpacingI32],
    });
    const [upperTickMod] = tx.moveCall({
      target: `${targetPackage}::i32::mod`,
      arguments: [upperTick1, tickSpacingI32],
    });
    const [lowerTick] = tx.moveCall({
      target: `${targetPackage}::i32::sub`,
      arguments: [lowerTick1, lowerTickMod],
    });
    const [upperTick] = tx.moveCall({
      target: `${targetPackage}::i32::sub`,
      arguments: [upperTick1, upperTickMod],
    });

    const [newPosition] = tx.moveCall({
      target: `${targetPackage}::liquidity::open_position`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(vault.poolId),
        lowerTick,
        upperTick,
        tx.object(sdk.contractConst.versionId),
      ],
    });

    // Add liquidity
    const [remainingX, remainingY] = tx.moveCall({
      target: `${targetPackage}::liquidity::add_liquidity`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(vault.poolId),
        newPosition,
        coinX,
        coinY,
        tx.pure.u64(0),
        tx.pure.u64(0),
        tx.object(CONFIG.clockId),
        tx.object(sdk.contractConst.versionId),
      ],
    });

    // Deposit leftover back to vault
    tx.moveCall({
      target: `${CONFIG.packageId}::cycling_vault::deposit_leftover`,
      typeArguments: [vault.tokenXType, vault.tokenYType],
      arguments: [
        tx.object(CONFIG.vaultConfigId),
        tx.object(vault.id),
        remainingX,
        remainingY,
      ],
    });

    // Store position in vault
    const mmtPkgId = await getMmtPackageId();
    const mmtPositionType = `${mmtPkgId}::position::Position`;

    tx.moveCall({
      target: `${CONFIG.packageId}::cycling_vault::store_position`,
      typeArguments: [vault.tokenXType, vault.tokenYType, mmtPositionType],
      arguments: [
        tx.object(CONFIG.vaultConfigId),
        tx.object(vault.id),
        newPosition,
        tx.object(CONFIG.clockId),
      ],
    });

    // Execute
    const result = await suiClient.signAndExecuteTransaction({
      signer: operatorKeypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true },
    });

    if (result.effects?.status?.status === 'success') {
      log.success(`Initial position opened - range: ${newLowerTick} to ${newUpperTick}`, result.digest);
    } else {
      log.error(`Failed to open position`, result.effects?.status?.error);
    }

    return result.effects?.status?.status === 'success';
  } catch (e: any) {
    log.error(`Open initial position failed`, e);
    return false;
  } finally {
    processingVaults.delete(vault.id);
  }
}

async function processVault(vault: VaultInfo): Promise<void> {
  // Check if vault needs initial position opening
  if (vault.isActive && !vault.hasPosition) {
    const hasBalance = BigInt(vault.balanceX) > 0n || BigInt(vault.balanceY) > 0n;
    if (hasBalance) {
      await openInitialPosition(vault);
    }
    return;
  }

  if (!vault.isActive || !vault.hasPosition) {
    return;
  }

  const now = Date.now();

  // ===== TIMER-BASED CYCLING =====
  if (vault.timerDurationMs > 0 && vault.maxCycles !== 0) {
    const vaultObj = await suiClient.getObject({
      id: vault.id,
      options: { showContent: true },
    });

    if (vaultObj.data?.content?.dataType === 'moveObject') {
      const fields = (vaultObj.data.content as any).fields;
      const nextExecutionAt = Number(fields.next_execution_at || 0);
      const cyclesRemaining = vault.maxCycles === 0 || vault.cyclesCompleted < vault.maxCycles;

      if (now >= nextExecutionAt && cyclesRemaining) {
        await executeVaultRebalance(vault, true);
        return;
      } else if (cyclesRemaining) {
        const timeLeft = Math.max(0, nextExecutionAt - now);
        log.timer(vault.id, Math.ceil(timeLeft / 1000));
      }
    }
  }

  // ===== AUTO-REBALANCE (OUT OF RANGE) =====
  if (!vault.autoRebalance) {
    return;
  }

  if (vault.rebalancePending) {
    const rebalanceAt = vault.outOfRangeSince + vault.rebalanceDelayMs;
    if (now >= rebalanceAt) {
      await executeVaultRebalance(vault);
      return;
    }
  }

  // Check if position went out of range
  if (!vault.isInRange) {
    await markOutOfRange(vault);
  }
}

async function monitoringLoop(): Promise<void> {
  try {
    allPools = await sdk.Pool.getAllPools();
    const vaults = await fetchAllVaults();

    if (vaults.length === 0) {
      return;
    }

    const activeVaults = vaults.filter(v => v.isActive);
    log.monitoring(activeVaults.length, vaults.length);

    for (const vault of vaults) {
      await processVault(vault);
    }
  } catch (e: any) {
    log.error('Monitoring error', e);
  }
}

async function verifyExecutorAuthorization(operatorAddress: string): Promise<boolean> {
  try {
    const configObj = await suiClient.getObject({
      id: CONFIG.vaultConfigId,
      options: { showContent: true },
    });

    if (!configObj.data?.content || configObj.data.content.dataType !== 'moveObject') {
      log.error('VaultConfig not found or invalid', { configId: CONFIG.vaultConfigId });
      return false;
    }

    const fields = (configObj.data.content as any).fields;
    const executor = fields.executor as string;
    const admin = fields.admin as string;

    if (operatorAddress !== executor && operatorAddress !== admin) {
      log.error('Operator not authorized as executor or admin');
      log.info(`Operator address: ${operatorAddress}`);
      log.info(`Config executor:  ${executor}`);
      log.info(`Config admin:     ${admin}`);
      log.warn('Admin must call set_executor to authorize this operator');
      return false;
    }

    return true;
  } catch (e: any) {
    log.error('Failed to verify executor authorization', e);
    return false;
  }
}

async function main(): Promise<void> {
  try {
    operatorKeypair = loadOperatorKeypair();
  } catch (e: any) {
    log.error('Failed to load operator', e);
    process.exit(1);
  }

  // Resolve MMT package ID at startup
  await getMmtPackageId();

  const operatorAddress = operatorKeypair.getPublicKey().toSuiAddress();

  // Verify operator is authorized before starting
  const isAuthorized = await verifyExecutorAuthorization(operatorAddress);
  if (!isAuthorized) {
    log.error('Operator is not authorized. Please have the admin call set_executor.');
    process.exit(1);
  }

  // Show styled startup
  log.startup({
    executor: operatorAddress,
    network: CONFIG.network,
    pollInterval: CONFIG.pollInterval,
    packageId: CONFIG.packageId,
  });

  await monitoringLoop();
  setInterval(monitoringLoop, CONFIG.pollInterval);
}

main().catch(console.error);
