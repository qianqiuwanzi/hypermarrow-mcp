const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-test-'));
const indexPath = path.join(__dirname, 'index.js');
const cp = spawn('node', [indexPath], {
  env: { ...process.env, HYPERMARROW_DATA_DIR: tmpdir },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buffer = '';
let step = 0;

function send(msg) {
  cp.stdin.write(JSON.stringify(msg) + '\n');
}

function finish(code, text) {
  try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch {}
  cp.kill();
  console.log(text);
  process.exit(code);
}

cp.stdout.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return finish(1, 'FAIL: non-JSON response: ' + line);
    }
    if (step === 0 && msg.id === 1 && msg.result) {
      step = 1;
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    } else if (step === 1 && msg.id === 2 && Array.isArray(msg.result?.tools)) {
      const count = msg.result.tools.length;
      if (count === 4) return finish(0, `PASS: ${count} tools listed`);
      return finish(1, `FAIL: expected 4 tools, got ${count}`);
    }
  }
});

cp.stderr.on('data', (chunk) => {
  // Surface errors only if fatal.
  process.stderr.write(chunk);
});

setTimeout(() => finish(1, 'FAIL: timeout'), 10000);

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'hm-test', version: '0.1.0' },
  },
});
