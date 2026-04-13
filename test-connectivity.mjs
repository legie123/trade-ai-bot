import { testMexcConnection } from './src/lib/exchange/mexcClient.ts';
import { testBinanceConnection } from './src/lib/exchange/binanceClient.ts';

async function test() {
  console.log('[TEST] Checking MEXC...');
  try {
    const mexc = await testMexcConnection();
    console.log('MEXC:', mexc);
  } catch (e) {
    console.log('MEXC Error:', e.message);
  }

  console.log('[TEST] Checking Binance...');
  try {
    const binance = await testBinanceConnection();
    console.log('Binance:', binance);
  } catch (e) {
    console.log('Binance Error:', e.message);
  }
}

test();
