/**
 * Exit Position Script
 *
 * Exits a registered position from the LP Registry and returns it to the owner's wallet.
 *
 * Usage:
 *   npx ts-node exit-position.ts <registered_position_id>
 *
 * Environment variables:
 *   OPERATOR_PRIVATE_KEY - Your wallet's private key (bech32, hex, or base64)
 *   LP_REGISTRY_PACKAGE_ID - (optional) Override the package ID
 *   LP_REGISTRY_ID - (optional) Override the registry ID
 */

import 'dotenv/config';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

// Old registry (before redeployment)
const OLD_PACKAGE_ID = '0xcdfb76c29f5774f598ef42bf7de8d2335ddbf7d9fd8beabc7b2e9b359606b0f7';
const OLD_REGISTRY_ID = '0xaf3b8b459b0d884491bd9a9149d4005899250b72f50ad3d6ab578f9a9c98cac7';

// New registry (after redeployment with request_rebalance)
const NEW_PACKAGE_ID = '0x2dabb362fffd5bd7fe8f1be4f0d0c2f399d996256a3ce2ee59f719fcb158a3fc';
const NEW_REGISTRY_ID = '0xe1a33c1b1d9537d0f193f1344026d48511dd08f87515d4c1465012de16734c04';

// Use environment variables or default to OLD registry for exit
const PACKAGE_ID = process.env.LP_REGISTRY_PACKAGE_ID || OLD_PACKAGE_ID;
const REGISTRY_ID = process.env.LP_REGISTRY_ID || OLD_REGISTRY_ID;
const CLOCK_ID = '0x6';

const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });

function getKeypair(): Ed25519Keypair {
  const privateKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('OPERATOR_PRIVATE_KEY environment variable is required');
  }

  // Handle different key formats
  if (privateKey.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
  } else if (privateKey.length === 64) {
    // Hex format
    return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey, 'hex'));
  } else {
    // Try base64
    return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));
  }
}

async function getPositionType(registeredPositionId: string): Promise<string | null> {
  try {
    // Get the dynamic field that contains the position
    const dynamicFields = await suiClient.getDynamicFields({
      parentId: registeredPositionId,
    });

    for (const field of dynamicFields.data) {
      if (field.name.value === 'position' ||
          (typeof field.name.value === 'object' && JSON.stringify(field.name.value).includes('position'))) {
        // Get the actual object to find its type
        const obj = await suiClient.getObject({
          id: field.objectId,
          options: { showType: true },
        });

        if (obj.data?.type) {
          // Extract the inner type from DynamicField wrapper
          // Format: 0x2::dynamic_object_field::Wrapper<T>
          const match = obj.data.type.match(/Wrapper<(.+)>$/);
          if (match) {
            return match[1];
          }
          return obj.data.type;
        }
      }
    }

    // Alternative: fetch using getDynamicFieldObject
    const positionField = await suiClient.getDynamicFieldObject({
      parentId: registeredPositionId,
      name: {
        type: 'vector<u8>',
        value: Array.from(Buffer.from('position')),
      },
    });

    if (positionField.data?.type) {
      const match = positionField.data.type.match(/Wrapper<(.+)>$/);
      if (match) {
        return match[1];
      }
    }

    return null;
  } catch (error) {
    console.error('Error fetching position type:', error);
    return null;
  }
}

async function exitPosition(registeredPositionId: string) {
  console.log('='.repeat(60));
  console.log('LP Registry - Exit Position');
  console.log('='.repeat(60));
  console.log(`Package ID: ${PACKAGE_ID}`);
  console.log(`Registry ID: ${REGISTRY_ID}`);
  console.log(`Registered Position ID: ${registeredPositionId}`);
  console.log('');

  // Get keypair
  const keypair = getKeypair();
  const address = keypair.getPublicKey().toSuiAddress();
  console.log(`Wallet address: ${address}`);

  // Fetch the registered position to verify ownership
  console.log('\nFetching registered position...');
  const registeredPosition = await suiClient.getObject({
    id: registeredPositionId,
    options: { showContent: true, showType: true },
  });

  if (!registeredPosition.data) {
    throw new Error(`Registered position not found: ${registeredPositionId}`);
  }

  const content = registeredPosition.data.content as any;
  if (content?.fields?.owner !== address) {
    throw new Error(`You are not the owner of this position. Owner: ${content?.fields?.owner}, Your address: ${address}`);
  }

  console.log(`Owner verified: ${content?.fields?.owner}`);
  console.log(`Pool ID: ${content?.fields?.pool_id}`);
  console.log(`Is paused: ${content?.fields?.is_paused}`);
  console.log(`Is position held: ${content?.fields?.is_position_held}`);

  if (content?.fields?.is_position_held) {
    throw new Error('Position is currently held by an operator. Cannot exit.');
  }

  // Get the position type
  console.log('\nFetching position type...');
  const positionType = await getPositionType(registeredPositionId);

  if (!positionType) {
    throw new Error('Could not determine position type');
  }
  console.log(`Position type: ${positionType}`);

  // Build exit transaction
  console.log('\nBuilding exit transaction...');
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::lp_registry::exit_and_return`,
    typeArguments: [positionType],
    arguments: [
      tx.object(REGISTRY_ID),
      tx.object(registeredPositionId),
    ],
  });

  // Execute transaction
  console.log('\nExecuting transaction...');
  const result = await suiClient.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: {
      showEffects: true,
      showEvents: true,
    },
  });

  console.log('\n' + '='.repeat(60));
  console.log('Transaction Result');
  console.log('='.repeat(60));
  console.log(`Digest: ${result.digest}`);
  console.log(`Status: ${result.effects?.status?.status}`);

  if (result.effects?.status?.status === 'success') {
    console.log('\nPosition successfully exited and returned to your wallet!');
    console.log('You can now re-register it with the new registry if desired.');
  } else {
    console.error('\nTransaction failed:', result.effects?.status?.error);
  }

  return result;
}

// Main
const registeredPositionId = process.argv[2];

if (!registeredPositionId) {
  console.log('Usage: npx ts-node exit-position.ts <registered_position_id>');
  console.log('');
  console.log('Example:');
  console.log('  npx ts-node exit-position.ts 0x1234...abcd');
  console.log('');
  console.log('Environment variables:');
  console.log('  OPERATOR_PRIVATE_KEY - Your wallet private key (required)');
  console.log('  LP_REGISTRY_PACKAGE_ID - Override package ID (optional)');
  console.log('  LP_REGISTRY_ID - Override registry ID (optional)');
  console.log('');
  console.log('Registries:');
  console.log(`  OLD (default): ${OLD_REGISTRY_ID}`);
  console.log(`  NEW: ${NEW_REGISTRY_ID}`);
  process.exit(1);
}

exitPosition(registeredPositionId)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
