import 'dotenv/config';
import http from 'http';

const PORT = process.env.PORT || 3001;
const HOST = 'localhost';

async function login() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ user: 'admin', password: 'supersecretpass3' });

    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'] || [];
        const cookie = setCookie.map(c => c.split(';')[0]).join('; ');
        console.log('[login] status:', res.statusCode);
        console.log('[login] cookie:', cookie ? 'obtained' : 'none');
        if (res.statusCode === 200) {
          resolve({ cookie, body: JSON.parse(body) });
        } else {
          reject(new Error(`Login failed: ${res.statusCode} ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function triggerRefresh(cookie, force = false) {
  return new Promise((resolve, reject) => {
    const data = force ? JSON.stringify({ force: true }) : '{}';

    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: '/api/stocks/refresh',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Cookie': cookie,
        'Accept': 'text/event-stream',
      },
    }, (res) => {
      console.log('[refresh] status:', res.statusCode);
      console.log('[refresh] headers:', res.headers);

      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', c => errBody += c);
        res.on('end', () => reject(new Error(`Refresh failed: ${res.statusCode} ${errBody}`)));
        return;
      }

      let buffer = '';
      const events = [];

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt = JSON.parse(line.slice(6));
              events.push(evt);
              console.log('[SSE EVENT]', JSON.stringify(evt));

              if (evt.type === 'done' || evt.type === 'error') {
                res.destroy();
                resolve({ events, final: evt });
              }
            } catch (e) {
              console.log('[SSE raw]', line);
            }
          }
        }
      });

      res.on('end', () => {
        resolve({ events, final: null });
      });

      res.on('error', reject);

      // Safety timeout
      setTimeout(() => {
        res.destroy();
        resolve({ events, final: { type: 'timeout' }, timedOut: true });
      }, 120000); // 2 minutes max for the big screener call
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== Server-side Refresh Diagnostic ===\n');

  try {
    const { cookie } = await login();

    console.log('\n--- Triggering refresh (force=false, should use cache) ---');
    const result1 = await triggerRefresh(cookie, false);
    console.log('\nNon-force result:', result1.final?.type);

    // Small pause
    await new Promise(r => setTimeout(r, 2000));

    console.log('\n--- Triggering refresh (force=true, real FMP call) ---');
    const result2 = await triggerRefresh(cookie, true);
    console.log('\nForce result:', result2.final?.type || 'completed');

    if (result2.events) {
      const doneEvt = result2.events.find(e => e.type === 'done');
      if (doneEvt) {
        console.log('Stocks returned:', doneEvt.stocks?.length || 0);
      }
    }

  } catch (err) {
    console.error('Diagnostic failed:', err.message);
    process.exitCode = 1;
  }
}

main();