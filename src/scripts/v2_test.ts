import 'dotenv/config';
import { ManagerVizionar } from '../lib/v2/manager/managerVizionar';
import { gladiatorStore } from '../lib/store/gladiatorStore';
import { Signal } from '../lib/types/radar';

async function runV2Test() {
  console.log("=========================================");
  console.log("🔥 INITIATING PHOENIX V2 MASTER TEST 🔥");
  console.log("=========================================\n");

  const manager = ManagerVizionar.getInstance();
  const symbol = 'BTCUSDT'; // Use standard format
  const gladiator = gladiatorStore.findBestGladiator(symbol);

  if (!gladiator) {
     console.error('❌ Failed: No Gladiator found to accept the signal.');
     process.exit(1);
  }

  console.log(`[TEST] Assigning signal to Gladiator: ${gladiator.name} (Rank: ${gladiator.rank}, Arena: ${gladiator.arena})`);

  const testSignal: Signal = {
    id: `test_v2_${Date.now()}`,
    symbol,
    signal: 'BUY',
    price: 52000,
    timestamp: new Date().toISOString(),
    source: 'TEST_CLI',
    timeframe: '15m'
  };

  console.log(`[TEST] Dispatching signal: ${testSignal.signal} @ $${testSignal.price}`);
  
  try {
     console.log("=========================================");
     console.log("🔮 WAITING FOR SYNDICATE CONSENSUS...");
     console.log("=========================================");
     
     const startTime = Date.now();
     await manager.processSignal(gladiator, testSignal);
     const duration = ((Date.now() - startTime) / 1000).toFixed(2);
     
     console.log("\n=========================================");
     console.log(`✅ PHOENIX V2 CYCLE COMPLETED IN ${duration}s`);
     console.log("=========================================\n");
  } catch (err) {
     console.error('\n❌ CRITICAL FAILURE IN SYNDICATE CONSENSUS:', err);
  }
}

runV2Test();
