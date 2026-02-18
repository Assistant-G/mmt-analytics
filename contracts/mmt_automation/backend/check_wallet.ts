import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

async function checkWallet() {
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  const address = '0x1550ba252570518586057353392f78b7bfedb66bd0e3171c3101b854a97879bf';

  console.log('Checking USDC balances for:', address);
  console.log('');

  // Get all USDC coins
  const coins = await client.getCoins({
    owner: address,
    coinType: USDC_TYPE,
  });

  console.log('USDC Coin Objects:');
  console.log('==================');

  let totalBalance = BigInt(0);
  coins.data.forEach((coin, index) => {
    const balance = BigInt(coin.balance);
    totalBalance += balance;
    const balanceFormatted = (Number(balance) / 1e6).toFixed(6);

    console.log(`USDC - ${index + 1}:`);
    console.log(`  Object ID: ${coin.coinObjectId}`);
    console.log(`  Balance: ${balanceFormatted} USDC`);
    console.log(`  Version: ${coin.version}`);
    console.log('');
  });

  const totalFormatted = (Number(totalBalance) / 1e6).toFixed(6);
  console.log('==================');
  console.log(`Total USDC: ${totalFormatted} USDC`);
  console.log(`Number of coin objects: ${coins.data.length}`);

  // Get recent transactions
  console.log('\nRecent Transactions:');
  console.log('==================');
  const txs = await client.queryTransactionBlocks({
    filter: { FromAddress: address },
    limit: 5,
    order: 'descending',
  });

  for (const tx of txs.data) {
    console.log(`TX: ${tx.digest}`);
    console.log(`  Time: ${new Date(Number(tx.timestampMs)).toISOString()}`);
  }
}

checkWallet().catch(console.error);
