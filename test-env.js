require('dotenv').config({ path: '.env.local' });

console.log('[ENV CHECK]');
console.log('MEXC_API_KEY:', process.env.MEXC_API_KEY ? '✓ Loaded (' + process.env.MEXC_API_KEY.substring(0, 10) + '...)' : '✗ Missing');
console.log('BINANCE_API_KEY:', process.env.BINANCE_API_KEY ? '✓ Loaded (' + process.env.BINANCE_API_KEY.substring(0, 10) + '...)' : '✗ Missing');
console.log('DEDICATED_IP:', process.env.DEDICATED_IP || 'Not set');

// Test MEXC API endpoint
console.log('\n[MEXC CONNECTIVITY TEST]');
fetch('https://api.mexc.com/api/v3/ticker/price?symbol=BTCUSDT', {
  method: 'GET',
  headers: { 'X-MEXC-APIKEY': process.env.MEXC_API_KEY || '' }
})
  .then(r => r.json())
  .then(d => {
    if (d.price) {
      console.log('✓ MEXC API responding. BTC/USDT: $' + d.price);
    } else {
      console.log('✗ MEXC API error:', d.msg || d.error || 'Unknown');
    }
  })
  .catch(e => console.log('✗ MEXC Connection failed:', e.message));

// Test Binance API endpoint
console.log('\n[BINANCE CONNECTIVITY TEST]');
fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
  .then(r => r.json())
  .then(d => {
    if (d.price) {
      console.log('✓ Binance API responding. BTC/USDT: $' + d.price);
    } else {
      console.log('✗ Binance API error:', d.msg || d.error || 'Unknown');
    }
  })
  .catch(e => console.log('✗ Binance Connection failed:', e.message));
