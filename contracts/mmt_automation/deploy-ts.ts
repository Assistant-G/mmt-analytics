/**
 * MMT Automation Escrow Contracts Deployment Script (TypeScript)
 * Uses @mysten/sui SDK for deployment
 *
 * Usage:
 * 1. Fund the wallet address shown below with ~0.5 SUI
 * 2. Set DEPLOYER_PRIVATE_KEY environment variable
 * 3. Run: npx ts-node contracts/mmt_automation/deploy-ts.ts
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import * as fs from 'fs';
import * as path from 'path';

const NETWORK = 'mainnet';

async function deploy() {
  console.log('=== MMT Automation Escrow Deployment (TypeScript) ===\n');

  // Get private key from environment or keystore
  let keypair: Ed25519Keypair;

  if (process.env.DEPLOYER_PRIVATE_KEY) {
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (privateKey.startsWith('suiprivkey')) {
      keypair = Ed25519Keypair.fromSecretKey(privateKey);
    } else {
      // Assume hex or base64
      const keyBytes = privateKey.length === 64
        ? Buffer.from(privateKey, 'hex')
        : fromBase64(privateKey);
      keypair = Ed25519Keypair.fromSecretKey(keyBytes);
    }
  } else {
    // Try to read from sui keystore
    const keystorePath = path.join(process.env.HOME || '/root', '.sui/sui_config/sui.keystore');
    if (fs.existsSync(keystorePath)) {
      const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf-8'));
      if (keystore.length > 0) {
        keypair = Ed25519Keypair.fromSecretKey(keystore[0]);
      } else {
        throw new Error('Keystore is empty');
      }
    } else {
      throw new Error('No private key found. Set DEPLOYER_PRIVATE_KEY env var');
    }
  }

  const address = keypair.getPublicKey().toSuiAddress();
  console.log(`Deployer address: ${address}`);

  // Initialize client
  const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

  // Check balance
  const balance = await client.getBalance({ owner: address });
  console.log(`Balance: ${Number(balance.totalBalance) / 1e9} SUI`);

  if (BigInt(balance.totalBalance) < BigInt(100_000_000)) { // 0.1 SUI minimum
    console.log('\n❌ Insufficient balance for deployment.');
    console.log(`Please send at least 0.5 SUI to: ${address}`);
    console.log('\nAfter funding, re-run this script.');
    return;
  }

  // Read compiled bytecode
  const buildDir = path.join(__dirname, 'build/mmt_automation');
  const modulesDir = path.join(buildDir, 'bytecode_modules');

  if (!fs.existsSync(modulesDir)) {
    console.log('\n❌ Bytecode not found. Run `sui move build` first.');
    return;
  }

  // Read package bytes
  const packagePath = path.join(buildDir, 'package.json');

  // For Move publishing, we need the compiled modules
  const escrowRegistryBytes = fs.readFileSync(
    path.join(modulesDir, 'escrow_registry.mv')
  );
  const simpleEscrowBytes = fs.readFileSync(
    path.join(modulesDir, 'simple_escrow.mv')
  );

  console.log('\nPublishing package...');

  // Note: Direct publishing via SDK requires building the publish transaction
  // which is complex. Using sui CLI is recommended.
  console.log('\n⚠️  For actual deployment, use the sui CLI:');
  console.log('   cd contracts/mmt_automation && sui client publish --gas-budget 100000000');
  console.log('\nOr run: ./deploy.sh');
}

deploy().catch(console.error);
