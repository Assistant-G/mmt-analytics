/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useSignTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { toast } from 'sonner';
import { buildAutoCloseTransaction, buildOpenPositionTransaction, getSuiClient } from '@/services/mmtService';
import type { ActivePosition, AutoCloseSettings, PreSignedTransaction } from '@/types';

const SETTINGS_STORAGE_KEY = 'mmtanal_autoclose_settings';

interface AutoCloseContextType {
  activePositions: ActivePosition[];
  addPosition: (position: Omit<ActivePosition, 'expiresAt'>) => void;
  removePosition: (positionId: string) => void;
  getTimeRemaining: (positionId: string) => number | null;
  getRemainingRepeats: (positionId: string) => number | 'infinite' | undefined;
  stopInfiniteMode: (positionId: string) => void;
  isClosing: (positionId: string) => boolean;
  // Pre-sign
  requestPreSign: (positionId: string, poolId: string, walletAddress: string) => Promise<PreSignedTransaction | null>;
  // Settings
  settings: AutoCloseSettings;
  updateSettings: (settings: Partial<AutoCloseSettings>) => void;
  isPrivateKeyValid: boolean;
}

const AutoCloseContext = createContext<AutoCloseContextType | undefined>(undefined);

// Load settings from localStorage
function loadSettings(): AutoCloseSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Ensure repeatCount has a default value
      return { repeatCount: 0, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return { method: 'escrow', privateKey: null, repeatCount: 0 };
}

// Validate and parse private key
function parsePrivateKey(key: string | null): Ed25519Keypair | null {
  if (!key) return null;

  try {
    const trimmedKey = key.trim();

    // Handle suiprivkey format (Bech32 encoded)
    if (trimmedKey.startsWith('suiprivkey')) {
      const { secretKey } = decodeSuiPrivateKey(trimmedKey);
      return Ed25519Keypair.fromSecretKey(secretKey);
    }

    // Handle hex format
    if (/^[0-9a-fA-F]{64}$/.test(trimmedKey)) {
      const secretKey = Uint8Array.from(Buffer.from(trimmedKey, 'hex'));
      return Ed25519Keypair.fromSecretKey(secretKey);
    }

    // Handle base64 format
    try {
      const decoded = Uint8Array.from(atob(trimmedKey), c => c.charCodeAt(0));
      if (decoded.length === 32) {
        return Ed25519Keypair.fromSecretKey(decoded);
      }
    } catch {}

    return null;
  } catch (e) {
    console.error('Failed to parse private key:', e);
    return null;
  }
}

export function AutoCloseProvider({ children }: { children: ReactNode }) {
  const [activePositions, setActivePositions] = useState<ActivePosition[]>([]);
  const [closingPositions, setClosingPositions] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<AutoCloseSettings>(loadSettings);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const settingsRef = useRef<AutoCloseSettings>(settings); // Ref to always have latest settings
  const triggerCloseRef = useRef<((position: ActivePosition) => void) | null>(null);
  const { mutateAsync: signTransaction } = useSignTransaction();
  const suiClient = useSuiClient();

  // Keep settingsRef in sync with settings state
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Validate private key
  const isPrivateKeyValid = settings.method === 'privateKey' && parsePrivateKey(settings.privateKey) !== null;

  // Save settings to localStorage
  const updateSettings = useCallback((newSettings: Partial<AutoCloseSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Auto-reopen position with same parameters using private key
  const reopenWithPrivateKey = useCallback(async (
    position: ActivePosition,
    keypair: Ed25519Keypair
  ): Promise<string | null> => {
    if (!position.positionParams) {
      console.log('No position params stored, cannot reopen');
      return null;
    }

    try {
      toast.info('Auto-reopening position...', { duration: 3000 });

      const { transaction: txb } = await buildOpenPositionTransaction(
        position.positionParams.poolId,
        position.walletAddress,
        position.positionParams.amountA,
        position.positionParams.amountB,
        position.positionParams.rangePercent,
        position.positionParams.decimalsA,
        position.positionParams.decimalsB,
        position.positionParams.tickSpacing
      );

      // Set sender and sign
      const senderAddress = keypair.getPublicKey().toSuiAddress();
      txb.setSender(senderAddress);

      const serviceClient = getSuiClient();
      const builtTx = await txb.build({ client: serviceClient });
      const signature = (await keypair.signTransaction(builtTx)).signature;

      const result = await serviceClient.executeTransactionBlock({
        transactionBlock: builtTx,
        signature,
        options: { showEffects: true, showObjectChanges: true },
      });

      // Extract new position ID from result
      let newPositionId: string | null = null;
      if (result.objectChanges) {
        const createdPosition = result.objectChanges.find(
          (change) => change.type === 'created' &&
            'objectType' in change &&
            change.objectType?.includes('Position')
        );
        if (createdPosition && 'objectId' in createdPosition) {
          newPositionId = createdPosition.objectId;
        }
      }

      if (newPositionId) {
        toast.success(
          <div>
            <p>Position reopened successfully!</p>
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
        return newPositionId;
      }

      return null;
    } catch (error) {
      console.error('Reopen error:', error);
      const message = error instanceof Error ? error.message : 'Failed to reopen position';
      toast.error(`Auto-reopen failed: ${message}`);
      return null;
    }
  }, []);

  // Execute close with private key (automatic, no wallet popup)
  const executeWithPrivateKey = useCallback(async (position: ActivePosition) => {
    // Read fresh from localStorage to ensure we have latest settings
    const currentSettings = loadSettings();
    const keypair = parsePrivateKey(currentSettings.privateKey);
    if (!keypair) {
      toast.error('Invalid private key. Please check your settings.');
      // Remove position from tracking since we can't auto-close
      setActivePositions(prev => prev.filter(p => p.positionId !== position.positionId));
      return;
    }

    setClosingPositions(prev => new Set(prev).add(position.positionId));

    try {
      toast.info('Auto-closing position...', { duration: 3000 });

      const txb = await buildAutoCloseTransaction(
        position.positionId,
        position.poolId,
        position.walletAddress
      );

      // Set the sender address from the keypair before signing
      const senderAddress = keypair.getPublicKey().toSuiAddress();
      txb.setSender(senderAddress);

      // Build the transaction with the client to resolve all references
      const builtTx = await txb.build({ client: suiClient });

      // Sign the built transaction
      const signature = (await keypair.signTransaction(builtTx)).signature;

      // Execute the signed transaction
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: builtTx,
        signature,
        options: { showEffects: true },
      });

      toast.success(
        <div>
          <p>Position auto-closed successfully!</p>
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

      // Remove from active positions
      setActivePositions(prev => prev.filter(p => p.positionId !== position.positionId));

      // Check if we should auto-reopen
      const remainingRepeats = position.remainingRepeats;
      const shouldRepeat = remainingRepeats === 'infinite' || (typeof remainingRepeats === 'number' && remainingRepeats > 0);

      if (shouldRepeat && position.positionParams) {
        // Wait a moment for the close transaction to be indexed
        await new Promise(resolve => setTimeout(resolve, 2000));

        const newPositionId = await reopenWithPrivateKey(position, keypair);

        if (newPositionId) {
          // Calculate new remaining repeats
          const newRemainingRepeats = remainingRepeats === 'infinite'
            ? 'infinite'
            : (remainingRepeats as number) - 1;

          // Register new position for auto-close
          const expiresAt = Date.now() + ((position.timerDuration || 60) * 1000);
          const newPosition: ActivePosition = {
            positionId: newPositionId,
            poolId: position.poolId,
            liquidity: position.liquidity,
            walletAddress: position.walletAddress,
            expiresAt,
            timerDuration: position.timerDuration,
            positionParams: position.positionParams,
            remainingRepeats: newRemainingRepeats,
          };

          setActivePositions(prev => [...prev, newPosition]);

          // Set up timer for new position
          const timer = setTimeout(() => {
            console.log('Timer expired for reopened position:', newPositionId);
            triggerCloseRef.current?.(newPosition);
            timersRef.current.delete(newPositionId);
          }, (position.timerDuration || 60) * 1000);

          timersRef.current.set(newPositionId, timer);

          const repeatMsg = newRemainingRepeats === 'infinite'
            ? 'Will repeat infinitely'
            : `${newRemainingRepeats} repeat(s) remaining`;

          toast.info(`Position will auto-close again in ${formatDuration(position.timerDuration || 60)}. ${repeatMsg}`);
        }
      }
    } catch (error) {
      console.error('Auto-close error:', error);
      const message = error instanceof Error ? error.message : 'Failed to auto-close position';
      toast.error(`Auto-close failed: ${message}. You can close the position manually from your positions.`);

      // DON'T show modal - user chose private key mode, respect that choice
      // Just remove from tracking
      setActivePositions(prev => prev.filter(p => p.positionId !== position.positionId));
    } finally {
      setClosingPositions(prev => {
        const newSet = new Set(prev);
        newSet.delete(position.positionId);
        return newSet;
      });
    }
  }, [suiClient, reopenWithPrivateKey]);

  // Request user to pre-sign a close transaction (for preSigned method)
  const requestPreSign = useCallback(async (
    positionId: string,
    poolId: string,
    walletAddress: string
  ): Promise<PreSignedTransaction | null> => {
    try {
      toast.info('Please sign the close transaction in your wallet...', { duration: 10000 });

      // Build the close transaction
      const txb = await buildAutoCloseTransaction(positionId, poolId, walletAddress);

      // Sign without executing
      const { bytes, signature } = await signTransaction({ transaction: txb });

      toast.success('Transaction pre-signed! It will execute when timer expires.');

      return {
        positionId,
        transactionBytes: bytes,
        signature,
      };
    } catch (error) {
      console.error('Pre-sign error:', error);
      const message = error instanceof Error ? error.message : 'Failed to pre-sign transaction';
      toast.error(`Pre-sign failed: ${message}`);
      return null;
    }
  }, [signTransaction]);

  // Execute a pre-signed transaction
  const executePreSigned = useCallback(async (position: ActivePosition) => {
    if (!position.preSignedTx) {
      toast.error('No pre-signed transaction found');
      setActivePositions(prev => prev.filter(p => p.positionId !== position.positionId));
      return;
    }

    setClosingPositions(prev => new Set(prev).add(position.positionId));

    try {
      toast.info('Executing pre-signed transaction...', { duration: 3000 });

      const result = await suiClient.executeTransactionBlock({
        transactionBlock: position.preSignedTx.transactionBytes,
        signature: position.preSignedTx.signature,
        options: { showEffects: true },
      });

      toast.success(
        <div>
          <p>Position auto-closed successfully!</p>
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

      setActivePositions(prev => prev.filter(p => p.positionId !== position.positionId));
    } catch (error) {
      console.error('Execute pre-signed error:', error);
      const message = error instanceof Error ? error.message : 'Failed to execute';

      // Pre-signed transactions can become stale if object versions change
      toast.error(
        <div>
          <p>Pre-signed transaction failed: {message}</p>
          <p className="text-xs text-gray-400 mt-1">
            The transaction may have become stale. Please close the position manually.
          </p>
        </div>
      );

      setActivePositions(prev => prev.filter(p => p.positionId !== position.positionId));
    } finally {
      setClosingPositions(prev => {
        const newSet = new Set(prev);
        newSet.delete(position.positionId);
        return newSet;
      });
    }
  }, [suiClient]);

  // Called when timer expires - either auto-closes or shows popup based on settings
  const triggerClose = useCallback((position: ActivePosition) => {
    // ALWAYS read fresh settings from localStorage to avoid any stale state issues
    const currentSettings = loadSettings();

    // Play notification sound
    try {
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2Onp6jlYN1bXqGkZygnpWLgXl2fIWPl5ual46Df3p6gImTm52akIaAfHl7g42Wm5qWjYR+enl8hI6WmpmVjIN9eXl8hI+WmpmVi4J8d3h7hI+XmpmVi4F7d3d6go2Vm5qWjIF7d3Z5gYyVm5uXjYJ7dnV4gIuUm5uYjoN7dXR3f4qTm5uYj4R7dXR2foiSmpuZkIV7dHN1fYeRmZqZkYZ8dHN0e4aQmJqZkod8c3JzeoSPl5mYkoh9c3FyeYONlpiYk4l+c3ByeIKMlZeXk4p/c29xd4GLlJaWk4uAc29wdoCKk5WWlIyBc25vdX+JkpWVlI2Cc25udH6Ij5OUk42Dcm1tc32Hjo+SkY2Ecm1scnyGjY6QkI2Fc21scXuFjI2Pj42GdGxrcHqEi4yNjoyGdWxqb3mDiouMjYyHdmtpbneDiYqLjIuHd2tpbXaCiImKi4qIeGppbHWBh4iJioqIeWppbHSAhoiIiYmJemppbHN/hoeHiIiJe2tpbHN+hYaGh4eIfGtpbHJ9hIWFhoaIfGxpbHJ9hIWFhYaHfW1pbHF8g4SEhYWGfm1pbHF8g4OEhISFf25pbHF7goODhISFf29pbXF7gYKCg4OEgG9pbXB6gYGCgoKDgXBpbXB6gIGBgYKCgnBpbW95gICAgYGBg3FpbW95f3+AgICBg3JpbW94f39/f4CAg3NpbW94fn5+fn9/g3RpbW54fn5+fn5+g3VpbW53fX1+fn5+hHZpbm53fX19fX1+hHdpbm52fHx9fX19hHhpbm52fHx8fHx9hHlpbm91e3t8fHx8hHppbm91e3t7e3t7hHtpbm91e3t7e3t7hHxpbm91ent6ent7hH1qb3B0ent6enp6hH5qb3B0enp6enp6hH9qb3B0eXl5eXl5hIBrb3B0eXl5eXl5hIFrb3Bzd3h4eHh4hIJrb3BzeHh4eHh4hINsb3BzeHh3d3d4hIRsb3FzeHd3d3d3hIVtcHFyd3d3d3d3hIZtcHFyd3Z2dnZ2hIdtcHFydnZ2dnZ2hIhucHFydnV1dXV1hIlucHFydXV1dXV1hIpucXFxdXR0dHR0hItvcXFxdHR0dHR0hIxvcXJxdHNzc3NzhI1vcXJxc3NzcnJzhI5wcXJxc3JycnJyhI9wcnJxc3JycnJyhJBwcnNxc3FxcXFxhJFxcnNxc3FxcXFxhJJxcnNxcnBwcHBwhJNxc3Rwcm9vb29whJRyc3Rwcm9vb29vhJVyc3VwcW5ubm5vhJZzc3VwcG5ubm5uhJdzdHZwcW1tbW1uhJh0dHZxcG1sbGxthJl0dHdxcGxsbGxshJp1dHdxcGtrbGxshJt1dXhycGtqa2trhJx2dXhycGpqamtrhJ12dXhycWpqampqhJ53dnlzcWlpaWlphJ94dnlzcWhoaGhohKB4dnlzcWdnZ2dnhKF4d3pzcWdmZmZnhKJ5d3pzcGZmZmZmhKN5eHp0cGVlZWVmhKR6eHt0cGVlZWVlhKV6eHt1cWRkZGRkhKZ7eXt1cWNjY2NkhKd7eXx1cWNjY2NjhKh8eXx2cmJiYmJjhKl8enx2cmJhYWFihKp9en12cmFhYWFhhKt9e312c2BgYGBhhKx+e353c2BgYGBghK1+e353c19fX19ghK5/fH54c19fX19fhK9/fH94dF5eXl5fhLCAff94dF5eXl5ehLGAff95dV1dXV1dhLGBff95dV1dXV1dhLKCfgB6dVxcXFxdhLOCfgB6dlxcXFxchLODfgB6dlxbW1tbhLSEfgF7d1tbW1tbhLWEfwF7d1tbW1tbhLWFfwF7d1taWlpahLaGfwJ8eFpaWlpahLeGgAJ8eFpaWlpahLiHgAJ9eFpZWVlZhLmIgAN9eVlZWVlZhLqIgQN9eVlZWVlZhLuJgQN+eVlYWFhYhLyKgQR+ellYWFhYhL2KggR+ellYWFhYhL6LggR/ellXV1dXhL+MggV/e1dXV1dXhMCMgwV/e1dXV1dXhMGNgwWAfFZWVlZWhMKOgwaAfFZWVlZWhMOOhAaAfVZVVVVVhMSPhAaBfVZVVVVVhMWQhAeBfVZVVVVVhMaRhQeBflVUVFRUhMeRhQiCflRUVFRUhMiShgmCf1RUVFRUhMmThgmDf1RUVFRUhMqUhwqDgFNTU1NThMusugKDgFNTU1NT');
      audio.volume = 0.3;
      audio.play().catch(() => {});
    } catch {}

    console.log('Timer expired - checking settings and position:', {
      method: currentSettings.method,
      hasPrivateKey: !!currentSettings.privateKey,
      isKeyValid: !!parsePrivateKey(currentSettings.privateKey),
      hasPreSignedTx: !!position.preSignedTx,
    });

    // If preSigned method and we have a pre-signed transaction, execute it
    if (currentSettings.method === 'preSigned' && position.preSignedTx) {
      console.log('Executing pre-signed transaction...');
      executePreSigned(position);
      return;
    }

    // If private key method and valid key, auto-close without popup
    if (currentSettings.method === 'privateKey' && parsePrivateKey(currentSettings.privateKey)) {
      console.log('Auto-closing with private key...');
      executeWithPrivateKey(position);
      return;
    }

    // No valid auto-close method available - show error
    console.log('No valid auto-close method available');
    toast.error(
      <div className="flex flex-col gap-2">
        <p className="font-semibold">Auto-close Failed</p>
        <p className="text-sm">Timer expired but no valid close method is configured. Please use Escrow for automatic closing.</p>
      </div>,
      { duration: 10000 }
    );
  }, [executeWithPrivateKey, executePreSigned]);

  // Keep triggerCloseRef in sync for reopen cycle
  useEffect(() => {
    triggerCloseRef.current = triggerClose;
  }, [triggerClose]);

  const addPosition = useCallback((position: Omit<ActivePosition, 'expiresAt'>) => {
    if (!position.timerDuration) {
      console.log('No timer duration set, skipping auto-close registration');
      return;
    }

    console.log('Adding position for auto-close:', {
      positionId: position.positionId,
      poolId: position.poolId,
      timerDuration: position.timerDuration,
      isInEscrow: position.isInEscrow,
    });

    const expiresAt = Date.now() + (position.timerDuration * 1000);
    const newPosition: ActivePosition = {
      ...position,
      expiresAt,
    };

    setActivePositions(prev => [...prev, newPosition]);

    // For escrow positions, don't set up local timer - backend handles the close
    if (position.isInEscrow) {
      console.log('Position is in escrow - backend will handle close');
      toast.success(
        <div>
          <p>Position deposited to escrow!</p>
          <p className="text-xs text-gray-400 mt-1">
            Will auto-close in {formatDuration(position.timerDuration)} - even if you close this browser.
          </p>
        </div>,
        { duration: 4000 }
      );
      return;
    }

    // Set up timer for non-escrow positions
    const timer = setTimeout(() => {
      console.log('Timer expired for position:', position.positionId);
      triggerClose(newPosition);
      timersRef.current.delete(position.positionId);
    }, position.timerDuration * 1000);

    timersRef.current.set(position.positionId, timer);
    console.log('Timer set for', position.timerDuration, 'seconds');

    // Use ref for current settings
    const currentSettings = settingsRef.current;
    let message = "You'll be prompted to approve when timer expires.";
    if (currentSettings.method === 'preSigned' && newPosition.preSignedTx) {
      message = 'Pre-signed transaction will execute automatically when timer expires.';
    } else if (currentSettings.method === 'privateKey' && parsePrivateKey(currentSettings.privateKey)) {
      message = 'Position will auto-close automatically when timer expires.';
    }

    toast.success(
      <div>
        <p>Position will auto-close in {formatDuration(position.timerDuration)}</p>
        <p className="text-xs text-gray-400 mt-1">{message}</p>
      </div>,
      { duration: 4000 }
    );
  }, [triggerClose]);

  const removePosition = useCallback((positionId: string) => {
    // Clear timer
    const timer = timersRef.current.get(positionId);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(positionId);
    }

    setActivePositions(prev => prev.filter(p => p.positionId !== positionId));
  }, []);

  const getTimeRemaining = useCallback((positionId: string): number | null => {
    const position = activePositions.find(p => p.positionId === positionId);
    if (!position) return null;

    const remaining = Math.max(0, position.expiresAt - Date.now());
    return remaining;
  }, [activePositions]);

  const isClosing = useCallback((positionId: string): boolean => {
    return closingPositions.has(positionId);
  }, [closingPositions]);

  const getRemainingRepeats = useCallback((positionId: string): number | 'infinite' | undefined => {
    const position = activePositions.find(p => p.positionId === positionId);
    return position?.remainingRepeats;
  }, [activePositions]);

  const stopInfiniteMode = useCallback((positionId: string) => {
    setActivePositions(prev => prev.map(p => {
      if (p.positionId === positionId) {
        return { ...p, remainingRepeats: 0 };
      }
      return p;
    }));
    toast.info('Infinite mode stopped. Position will close once and not reopen.');
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const contextValue: AutoCloseContextType = {
    activePositions,
    addPosition,
    removePosition,
    getTimeRemaining,
    getRemainingRepeats,
    stopInfiniteMode,
    isClosing,
    requestPreSign,
    settings,
    updateSettings,
    isPrivateKeyValid,
  };

  return (
    <AutoCloseContext.Provider value={contextValue}>
      {children}
    </AutoCloseContext.Provider>
  );
}

export function useAutoClose() {
  const context = useContext(AutoCloseContext);
  if (context === undefined) {
    throw new Error('useAutoClose must be used within an AutoCloseProvider');
  }
  return context;
}

function formatDuration(seconds: number): string {
  if (seconds >= 86400) {
    const days = Math.floor(seconds / 86400);
    return `${days} day${days !== 1 ? 's' : ''}`;
  }
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
}
