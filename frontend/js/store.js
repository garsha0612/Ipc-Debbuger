/**
 * IPC Debugger — WebSocket Client & State Manager
 */

const API_BASE = `${location.protocol}//${location.host}`;
const WS_URL   = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

// ── Reactive state store ──────────────────────────────────────────
const Store = (() => {
  let _state = {
    processes: {},
    connections: [],
    metrics: {
      total_messages: 0, messages_per_sec: 0,
      avg_latency_ms: 0, throughput_kbps: 0,
      active_processes: 0, deadlock_detected: false, deadlock_nodes: [],
    },
    logs: [],
    messages: [],
    connected: false,
    selectedPid: null,
    ws: null,
    pingInterval: null,
    pingTs: null,
    rtt: null,
    // Rolling history for sparklines
    history: {
      latency: [],
      throughput: [],
      msg_rate: [],
    },
  };

  const _listeners = {};

  function on(event, cb) {
    (_listeners[event] = _listeners[event] || []).push(cb);
  }

  function emit(event, data) {
    (_listeners[event] || []).forEach(cb => cb(data));
  }

  function update(patch) {
    Object.assign(_state, patch);
    emit('update', _state);
  }

  function get() { return _state; }

  return { on, emit, update, get };
})();

// ── WebSocket connection ──────────────────────────────────────────
function connectWS() {
  const ws = new WebSocket(WS_URL);
  Store.get().ws = ws;

  ws.addEventListener('open', () => {
    Store.update({ connected: true });
    Store.emit('connected');
    // Start ping every 10s to measure RTT
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        Store.get().pingTs = performance.now();
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 10000);
    Store.get().pingInterval = pingInterval;
  });

  ws.addEventListener('message', (evt) => {
    const msg = JSON.parse(evt.data);

    if (msg.type === 'pong') {
      const rtt = Math.round(performance.now() - Store.get().pingTs);
      Store.update({ rtt });
      return;
    }

    if (msg.type === 'state_update') {
      const prev = Store.get().metrics;
      const h = Store.get().history;

      // Update rolling history (max 60 pts)
      const push = (arr, val) => { arr.push(val); if (arr.length > 60) arr.shift(); };
      push(h.latency,    msg.metrics.avg_latency_ms);
      push(h.throughput, msg.metrics.throughput_kbps);
      push(h.msg_rate,   msg.metrics.messages_per_sec);

      Store.update({
        processes:   msg.processes,
        connections: msg.connections,
        metrics:     msg.metrics,
        logs:        msg.logs,
        messages:    msg.messages,
      });
    }
  });

  ws.addEventListener('close', () => {
    clearInterval(Store.get().pingInterval);
    Store.update({ connected: false });
    Store.emit('disconnected');
    // Reconnect in 2s
    setTimeout(connectWS, 2000);
  });

  ws.addEventListener('error', () => { ws.close(); });
}

// ── REST helpers ──────────────────────────────────────────────────
async function apiPost(path, body = {}) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function apiDelete(path) {
  const r = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
  return r.json();
}

async function apiGet(path) {
  const r = await fetch(`${API_BASE}${path}`);
  return r.json();
}

export { Store, connectWS, apiPost, apiDelete, apiGet };
