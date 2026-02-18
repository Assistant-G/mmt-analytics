import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

// RPC endpoints for Sui mainnet
export const RPC_ENDPOINTS = {
  // Primary: Official Sui fullnode
  primary: getFullnodeUrl('mainnet'),
  // Backup: ANKR RPC
  backup: 'https://rpc.ankr.com/sui/0ec3e0c9bf86ce2302ab9d90d7c0c791c846a5928003e4b481e24d21c31b722f',
} as const;

// Track which RPC is currently active
let currentRpcIndex = 0;
const rpcEndpoints = [RPC_ENDPOINTS.primary, RPC_ENDPOINTS.backup];

// Get current RPC URL
export function getCurrentRpcUrl(): string {
  return rpcEndpoints[currentRpcIndex];
}

// Switch to next RPC endpoint
export function switchToBackupRpc(): string {
  currentRpcIndex = (currentRpcIndex + 1) % rpcEndpoints.length;
  const newUrl = rpcEndpoints[currentRpcIndex];
  console.log(`[RPC] Switching to ${currentRpcIndex === 0 ? 'primary' : 'backup'} RPC: ${newUrl.substring(0, 50)}...`);
  return newUrl;
}

// Reset to primary RPC
export function resetToPrimaryRpc(): void {
  currentRpcIndex = 0;
}

// Singleton SuiClient instance with current RPC
let suiClientInstance: SuiClient | null = null;
let currentClientRpc: string | null = null;

// Get or create SuiClient with current RPC
export function getSuiClient(): SuiClient {
  const currentUrl = getCurrentRpcUrl();

  // Create new client if none exists or if RPC has changed
  if (!suiClientInstance || currentClientRpc !== currentUrl) {
    suiClientInstance = new SuiClient({ url: currentUrl });
    currentClientRpc = currentUrl;
  }

  return suiClientInstance;
}

// Create a new SuiClient (useful when you need a fresh instance)
export function createSuiClient(url?: string): SuiClient {
  return new SuiClient({ url: url || getCurrentRpcUrl() });
}

// Execute an RPC call with automatic fallback to backup RPC on failure
export async function withRpcFallback<T>(
  operation: (client: SuiClient) => Promise<T>,
  maxRetries: number = 2
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const client = getSuiClient();
      return await operation(client);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this is a network/RPC error that warrants switching endpoints
      const errorMessage = lastError.message.toLowerCase();
      const isRpcError =
        errorMessage.includes('fetch') ||
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('econnrefused') ||
        errorMessage.includes('rate limit') ||
        errorMessage.includes('429') ||
        errorMessage.includes('503') ||
        errorMessage.includes('502');

      if (isRpcError && attempt < maxRetries - 1) {
        console.warn(`[RPC] Request failed, switching to backup RPC. Error: ${lastError.message}`);
        switchToBackupRpc();
        // Clear the cached client so a new one is created with the new RPC
        suiClientInstance = null;
        currentClientRpc = null;
      } else {
        throw lastError;
      }
    }
  }

  throw lastError || new Error('RPC operation failed after retries');
}

// Network config for dapp-kit with backup RPC support
export function getNetworkConfig() {
  return {
    mainnet: { url: getCurrentRpcUrl() },
    testnet: { url: getFullnodeUrl('testnet') },
  };
}
