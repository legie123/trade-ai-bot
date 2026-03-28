// Run via: npx ts-node -r dotenv/config src/scripts/testDiscovery.ts
import { generateAndDeployNewStrategy } from '../lib/engine/discoveryLLM';

async function run() {
  console.log('🤖 Triggering AI Discovery Engine...');
  const res = await generateAndDeployNewStrategy();
  console.log('\n--- RESULT ---');
  console.dir(res, { depth: null });
}

run();
