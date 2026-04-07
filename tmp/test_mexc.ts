import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const MEXC_BASE_URL = 'https://api.mexc.com';

function sign(queryString: string): string {
  const apiSecret = process.env.MEXC_API_SECRET || '';
  return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

async function testAuth() {
  const apiKey = process.env.MEXC_API_KEY || '';
  const timestamp = Date.now();
  const params = `recvWindow=5000&timestamp=${timestamp}`;
  const signature = sign(params);
  
  const url = `${MEXC_BASE_URL}/api/v3/account?${params}&signature=${signature}`;
  
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-MEXC-APIKEY': apiKey,
        'Content-Type': 'application/json'
      }
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(err);
  }
}

testAuth();
