import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const VAULT_PACKAGE_ID = '0x4554604e6a3fcc8a412884a45c47d1265588644a99a32029b8070e5ff8067e94';

async function checkUserVaults() {
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  const userAddress = '0x1550ba252570518586057353392f78b7bfedb66bd0e3171c3101b854a97879bf';

  console.log('Checking vaults for:', userAddress);
  console.log('');

  const eventType = `${VAULT_PACKAGE_ID}::cycling_vault::VaultCreated`;

  const events = await client.queryEvents({
    query: { MoveEventType: eventType },
    order: 'descending',
    limit: 50,
  });

  console.log(`Found ${events.data.length} vault creation events total`);
  console.log('');

  let foundCount = 0;
  for (const event of events.data) {
    const eventData = event.parsedJson as { vault_id: string; owner: string; pool_id: string };

    if (eventData.owner.toLowerCase() === userAddress.toLowerCase()) {
      foundCount++;
      console.log(`YOUR VAULT #${foundCount}`);
      console.log('================');
      console.log(`Vault ID: ${eventData.vault_id}`);
      console.log(`Pool ID: ${eventData.pool_id}`);

      try {
        const vaultObj = await client.getObject({
          id: eventData.vault_id,
          options: { showContent: true, showType: true },
        });

        if (vaultObj.data?.content && vaultObj.data.content.dataType === 'moveObject') {
          const fields = vaultObj.data.content.fields as any;

          const balanceX = fields.balance_x?.fields?.value || fields.balance_x || '0';
          const balanceY = fields.balance_y?.fields?.value || fields.balance_y || '0';

          console.log('Vault Status:');
          console.log(`  Balance X: ${balanceX}`);
          console.log(`  Balance Y: ${balanceY}`);
          console.log(`  Has Position: ${fields.has_position}`);
          console.log(`  Is Active: ${fields.is_active}`);
          console.log(`  Cycles Completed: ${fields.cycles_completed}`);
          console.log(`  Max Cycles: ${fields.max_cycles || 'infinite'}`);
          console.log(`  Timer Duration: ${Number(fields.timer_duration_ms) / 1000}s`);
          const nextExec = new Date(Number(fields.next_execution_at));
          console.log(`  Next Execution: ${nextExec.toISOString()}`);
          console.log(`  Time until next: ${Math.max(0, (Number(fields.next_execution_at) - Date.now()) / 1000).toFixed(0)}s`);
          console.log('');
        }
      } catch (error: any) {
        console.log(`Error reading vault: ${error.message}`);
        console.log('');
      }
    }
  }

  if (foundCount === 0) {
    console.log('No vaults found for your address.');
    console.log('This might mean:');
    console.log('  1. You haven\'t created a vault yet');
    console.log('  2. The vault was deleted');
    console.log('  3. Wrong address');
  } else {
    console.log(`Total vaults found: ${foundCount}`);
  }
}

checkUserVaults().catch(console.error);
