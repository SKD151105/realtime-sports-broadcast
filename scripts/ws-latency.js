import { WebSocket } from 'ws';

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args.set(key.slice(2), true);
    } else {
      args.set(key.slice(2), next);
      i += 1;
    }
  }
  return args;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function fmt(ms) {
  if (ms === null || ms === undefined) return 'n/a';
  return `${ms.toFixed(2)}ms`;
}

const args = parseArgs(process.argv.slice(2));

const url = process.env.WS_URL || args.get('url') || 'ws://localhost:8000/ws?all=1';
const count = Number(args.get('count') ?? 50);
const intervalMs = Number(args.get('interval') ?? 50);
const timeoutMs = Number(args.get('timeout') ?? 5000);

if (!Number.isFinite(count) || count <= 0) {
  console.error('Invalid --count');
  process.exit(1);
}

const pending = new Map(); // id -> bigint start
const samples = [];
let sent = 0;
let received = 0;
let timer = null;
let done = false;

const nowNs = () => process.hrtime.bigint();
const nsToMs = (ns) => Number(ns) / 1e6;

function finish(reason) {
  if (done) return;
  done = true;
  if (timer) clearInterval(timer);

  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0] ?? null;
  const max = sorted[sorted.length - 1] ?? null;
  const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null;

  console.log(`\nWS latency probe (${reason})`);
  console.log(`URL: ${url}`);
  console.log(`Sent: ${sent}, Received: ${received}, Lost: ${Math.max(0, sent - received)}`);
  console.log(`min: ${fmt(min)}  avg: ${fmt(avg)}  p50: ${fmt(quantile(sorted, 0.5))}  p95: ${fmt(quantile(sorted, 0.95))}  p99: ${fmt(quantile(sorted, 0.99))}  max: ${fmt(max)}`);
}

const ws = new WebSocket(url);

const hardTimeout = setTimeout(() => {
  try { ws.close(); } catch {}
  finish('timeout');
  process.exit(2);
}, timeoutMs);

ws.on('open', () => {
  console.log(`Connected. Probing ${count} pings every ${intervalMs}ms...`);

  timer = setInterval(() => {
    if (sent >= count) return;
    const id = `p${sent + 1}`;
    pending.set(id, nowNs());
    sent += 1;
    ws.send(JSON.stringify({ type: 'ping', id, clientTs: Date.now() }));
  }, intervalMs);
});

ws.on('message', (buf) => {
  let msg;
  try {
    msg = JSON.parse(buf.toString());
  } catch {
    return;
  }

  if (msg?.type !== 'pong') return;
  const id = msg?.id;
  if (!id) return;

  const start = pending.get(id);
  if (!start) return;

  pending.delete(id);
  received += 1;
  const rttMs = nsToMs(nowNs() - start);
  samples.push(rttMs);

  if (received >= count) {
    clearTimeout(hardTimeout);
    try { ws.close(); } catch {}
    finish('complete');
    process.exit(0);
  }
});

ws.on('error', (err) => {
  clearTimeout(hardTimeout);
  console.error('WS error:', err?.message || err);
  finish('error');
  process.exit(1);
});

ws.on('close', () => {
  clearTimeout(hardTimeout);
  if (!done) {
    finish('closed');
    process.exit(2);
  }
});
