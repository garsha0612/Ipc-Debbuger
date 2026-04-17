/**
 * IPC Debugger — Main Application
 * Orchestrates all views, panels, and UI interactions
 */

import { Store, connectWS, apiPost, apiDelete, apiGet } from './store.js';
import { GraphRenderer } from './graph.js';
import { Sparkline } from './sparkline.js';

// ── DOM refs ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  statusDot:     $('status-dot'),
  statusText:    $('status-text'),
  deadlockAlert: $('deadlock-alert'),
  deadlockBadge: $('deadlock-badge'),

  // Topbar metrics
  mMsgRate:   $('m-msg-rate'),
  mLatency:   $('m-latency'),
  mThroughput:$('m-throughput'),
  mActive:    $('m-active'),
  mTotal:     $('m-total'),

  // Nav items
  navItems: document.querySelectorAll('.nav-item'),
  mainEl:   $('main'),
  views:    document.querySelectorAll('.view-page'),

  // Graph
  graphCanvas: $('graph-canvas'),

  // Process list
  processList: $('process-list'),

  // Logs
  logList: $('log-list'),

  // Messages table
  msgTbody: $('msg-tbody'),

  // Metrics page
  mcTotal:      $('mc-total'),
  mcRate:       $('mc-rate'),
  mcLatency:    $('mc-latency'),
  mcThroughput: $('mc-throughput'),
  mcActive:     $('mc-active'),
  mcBlocked:    $('mc-blocked'),

  // Detail panel
  detailPanel:  $('detail-panel'),
  detailClose:  $('detail-close'),
  detailPid:    $('detail-pid'),
  detailName:   $('detail-name'),
  detailState:  $('detail-state'),
  detailIpc:    $('detail-ipc'),
  detailCpu:    $('detail-cpu'),
  detailCpuBar: $('detail-cpu-bar'),
  detailMem:    $('detail-mem'),
  detailBuf:    $('detail-buf'),
  detailBufBar: $('detail-buf-bar'),
  detailSent:   $('detail-sent'),
  detailRecv:   $('detail-recv'),
  detailConns:  $('detail-conns'),
  detailActions:$('detail-actions'),

  // Tooltip
  tooltip:     $('graph-tooltip'),
  tooltipName: $('tooltip-name'),
  tooltipState:$('tooltip-state'),
  tooltipCpu:  $('tooltip-cpu'),
  tooltipMem:  $('tooltip-mem'),
  tooltipSent: $('tooltip-sent'),
  tooltipRecv: $('tooltip-recv'),

  // Modal
  modalOverlay: $('modal-overlay'),
  modalClose:   $('modal-close'),
  modalCreate:  $('modal-create'),
  formName:     $('form-name'),
  formIpc:      $('form-ipc'),

  // Extra
  procCountBadge:    $('proc-count-badge'),
  ipcPipePct:        $('ipc-pipe-pct'),
  ipcPipeBar:        $('ipc-pipe-bar'),
  ipcQueuePct:       $('ipc-queue-pct'),
  ipcQueueBar:       $('ipc-queue-bar'),
  ipcShmPct:         $('ipc-shm-pct'),
  ipcShmBar:         $('ipc-shm-bar'),
  stateRunningCount: $('state-running-count'),
  stateWaitingCount: $('state-waiting-count'),
  stateBlockedCount: $('state-blocked-count'),
  stateBars:         $('state-bars'),
  connHealthGrid:    $('conn-health-grid'),
  latencyHistogram:  $('latency-histogram'),
  metricsTs:         $('metrics-ts'),
  toastContainer:    $('toast-container'),
};

// ── Toast Notification System ─────────────────────────────────────
function toast(message, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  dom.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toast-out 0.25s ease forwards';
    setTimeout(() => el.remove(), 250);
  }, duration);
}

// ── Global state ──────────────────────────────────────────────────
let graph = null;
let sparklines = {};
let currentView = 'dashboard';
let lastMsgCount = 0;
let particleTimer = null;

// Expose globals needed by inline HTML handlers
window._clearLogs = () => {
  dom.logList.innerHTML = '';
  logTail.length = 0;
};
window._clearMessages = () => {
  dom.msgTbody.innerHTML = '';
  msgBuffer.length = 0;
};

// ── Navigation ────────────────────────────────────────────────────
function switchView(viewId) {
  currentView = viewId;
  dom.navItems.forEach(el => {
    el.classList.toggle('active', el.dataset.view === viewId);
  });
  dom.views.forEach(el => {
    el.classList.toggle('active', el.id === `view-${viewId}`);
  });
  dom.mainEl.classList.add('active');
}

dom.navItems.forEach(el => {
  el.addEventListener('click', () => switchView(el.dataset.view));
});

// ── Graph setup ───────────────────────────────────────────────────
function initGraph() {
  graph = new GraphRenderer(dom.graphCanvas);

  dom.graphCanvas.addEventListener('node-hover', (e) => {
    const { pid, clientX, clientY } = e.detail;
    if (!pid) {
      dom.tooltip.classList.remove('visible');
      return;
    }
    const proc = Store.get().processes[pid];
    if (!proc) return;

    dom.tooltipName.textContent  = proc.name;
    dom.tooltipState.textContent = proc.state;
    dom.tooltipState.style.color = { running: 'var(--green)', waiting: 'var(--yellow)', blocked: 'var(--red)' }[proc.state] || 'var(--text-muted)';
    dom.tooltipCpu.textContent   = proc.cpu.toFixed(1) + '%';
    dom.tooltipMem.textContent   = (proc.memory_kb / 1024).toFixed(1) + ' MB';
    dom.tooltipSent.textContent  = proc.messages_sent;
    dom.tooltipRecv.textContent  = proc.messages_received;

    const tt = dom.tooltip;
    tt.style.left = (clientX + 14) + 'px';
    tt.style.top  = (clientY - 10) + 'px';
    tt.classList.add('visible');
  });

  dom.graphCanvas.addEventListener('node-click', (e) => {
    const { pid } = e.detail;
    if (pid) {
      openDetailPanel(pid);
      graph.setSelected(pid);
      Store.update({ selectedPid: pid });
    } else {
      closeDetailPanel();
    }
  });
}

// ── Detail Panel ──────────────────────────────────────────────────
async function openDetailPanel(pid) {
  dom.detailPanel.classList.add('open');
  Store.update({ selectedPid: pid });

  // Highlight in list
  document.querySelectorAll('.process-row').forEach(r => {
    r.classList.toggle('selected', r.dataset.pid === pid);
  });

  await refreshDetailPanel(pid);
}

async function refreshDetailPanel(pid) {
  const proc = Store.get().processes[pid];
  if (!proc) return;

  dom.detailPid.textContent  = pid;
  dom.detailName.textContent = proc.name;
  dom.detailIpc.textContent  = proc.ipc_type.replace('_', ' ');
  dom.detailCpu.textContent  = proc.cpu.toFixed(1) + '%';
  dom.detailCpuBar.style.width = Math.min(100, proc.cpu) + '%';
  dom.detailMem.textContent  = (proc.memory_kb / 1024).toFixed(2) + ' MB';
  dom.detailBuf.textContent  = (proc.buffer_usage * 100).toFixed(0) + '%';
  dom.detailBufBar.style.width = (proc.buffer_usage * 100) + '%';
  dom.detailSent.textContent = proc.messages_sent;
  dom.detailRecv.textContent = proc.messages_received;

  // State badge
  dom.detailState.className = `state-badge state-${proc.state}`;
  dom.detailState.textContent = proc.state;

  // Connections
  const conns = Store.get().connections.filter(c => c.source === pid || c.target === pid);
  dom.detailConns.innerHTML = conns.map(c => {
    const other = c.source === pid ? c.target : c.source;
    const dir   = c.source === pid ? '→' : '←';
    const proc2 = Store.get().processes[other];
    const otherName = proc2 ? proc2.name : other;
    return `<div class="detail-kv"><span class="detail-key">${dir} ${otherName}</span><span class="detail-val" style="font-size:10px">${c.ipc_type}</span></div>`;
  }).join('') || '<div style="color:var(--text-muted);font-size:11px">No connections</div>';
}

function closeDetailPanel() {
  dom.detailPanel.classList.remove('open');
  dom.detailClose.onclick = closeDetailPanel;
  Store.update({ selectedPid: null });
  if (graph) graph.setSelected(null);
  document.querySelectorAll('.process-row').forEach(r => r.classList.remove('selected'));
}

dom.detailClose.addEventListener('click', closeDetailPanel);

// ── Process List Rendering ────────────────────────────────────────
function renderProcessList(processes) {
  const pids = Object.keys(processes);

  // Update count badge
  if (dom.procCountBadge) dom.procCountBadge.textContent = pids.length;

  const existing = new Map([...dom.processList.querySelectorAll('.process-row')].map(el => [el.dataset.pid, el]));

  // Remove stale rows
  for (const [pid, el] of existing) {
    if (!processes[pid]) el.remove();
  }

  const IPC_CLASS = { pipe: 'ipc-pipe', queue: 'ipc-queue', shared_memory: 'ipc-shm' };
  const IPC_LABEL = { pipe: 'PIPE', queue: 'QUEUE', shared_memory: 'SHM' };

  pids.forEach(pid => {
    const proc = processes[pid];
    let row = dom.processList.querySelector(`[data-pid="${pid}"]`);

    if (!row) {
      row = document.createElement('div');
      row.className = 'process-row fade-in';
      row.dataset.pid = pid;
      row.addEventListener('click', () => openDetailPanel(pid));
      dom.processList.appendChild(row);
    }

    row.dataset.state = proc.state;
    row.innerHTML = `
      <div></div>
      <div class="process-info">
        <div class="process-name">${proc.name}</div>
        <div class="process-meta">
          <span class="process-ipc-badge ${IPC_CLASS[proc.ipc_type] || ''}">${IPC_LABEL[proc.ipc_type] || proc.ipc_type}</span>
          <span>${pid}</span>
        </div>
      </div>
      <div class="process-stats">
        <div class="process-cpu">${proc.cpu.toFixed(0)}%</div>
        <div class="process-mem">${(proc.memory_kb/1024).toFixed(1)}M</div>
      </div>
    `;

    if (Store.get().selectedPid === pid) row.classList.add('selected');
    else row.classList.remove('selected');
  });
}

// ── Log Rendering ─────────────────────────────────────────────────
let logTail = [];
function renderLogs(logs) {
  if (!logs || !logs.length) return;

  // Only append new entries
  const newLogs = logs.slice(logTail.length);
  if (!newLogs.length) {
    // Full refresh scenario
    if (logs.length !== logTail.length) {
      dom.logList.innerHTML = '';
      logTail = [];
      logs.forEach(appendLog);
    }
    return;
  }

  newLogs.forEach(appendLog);
  logTail = [...logs];
}

function appendLog(entry) {
  const el = document.createElement('div');
  el.className = `log-entry ${entry.level}`;
  el.innerHTML = `
    <span class="log-ts">${entry.timestamp}</span>
    <span class="log-level">${entry.level}</span>
    <span class="log-msg">${entry.message}</span>
  `;
  dom.logList.appendChild(el);

  // Auto-scroll if near bottom
  const { scrollTop, scrollHeight, clientHeight } = dom.logList;
  if (scrollHeight - scrollTop - clientHeight < 80) {
    dom.logList.scrollTop = dom.logList.scrollHeight;
  }

  // Trim
  while (dom.logList.children.length > 150) {
    dom.logList.removeChild(dom.logList.firstChild);
  }
}

// ── Messages Table ────────────────────────────────────────────────
const msgBuffer = [];
function renderMessages(messages) {
  if (!messages || !messages.length) return;

  messages.forEach(msg => {
    const tr = document.createElement('tr');
    const IPC_COLORS = { pipe: 'var(--ipc-pipe)', queue: 'var(--ipc-queue)', shared_memory: 'var(--ipc-shm)' };
    const proc_src = Store.get().processes[msg.source];
    const proc_dst = Store.get().processes[msg.target];

    tr.innerHTML = `
      <td>${msg.ts_human}</td>
      <td style="color:${IPC_COLORS[msg.ipc_type]}">${msg.ipc_type.replace('_',' ')}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:10.5px">${proc_src ? proc_src.name : msg.source}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:10.5px">${proc_dst ? proc_dst.name : msg.target}</td>
      <td>${msg.size_bytes}</td>
      <td>${msg.latency_ms}</td>
    `;

    dom.msgTbody.insertBefore(tr, dom.msgTbody.firstChild);
    // Trim table
    while (dom.msgTbody.children.length > 200) {
      dom.msgTbody.removeChild(dom.msgTbody.lastChild);
    }

    // Spawn graph particle
    if (graph) {
      graph.spawnParticle(msg.source, msg.target, msg.ipc_type);
    }
  });
}

// ── Metrics View ──────────────────────────────────────────────────

// Rolling latency history for histogram
const _latencyHistory = [];

function renderMetricsView(metrics) {
  if (dom.mcTotal)      dom.mcTotal.textContent      = metrics.total_messages.toLocaleString();
  if (dom.mcRate)       dom.mcRate.textContent       = metrics.messages_per_sec.toFixed(1);
  if (dom.mcLatency)    dom.mcLatency.textContent    = metrics.avg_latency_ms.toFixed(2);
  if (dom.mcThroughput) dom.mcThroughput.textContent = metrics.throughput_kbps.toFixed(1);
  if (dom.mcActive)     dom.mcActive.textContent     = metrics.active_processes;
  if (dom.metricsTs)    dom.metricsTs.textContent    = new Date().toLocaleTimeString();

  const procs = Object.values(Store.get().processes);
  const running = procs.filter(p => p.state === 'running').length;
  const waiting = procs.filter(p => p.state === 'waiting').length;
  const blocked = procs.filter(p => p.state === 'blocked').length;

  if (dom.mcBlocked)          dom.mcBlocked.textContent        = blocked;
  if (dom.stateRunningCount)  dom.stateRunningCount.textContent = running;
  if (dom.stateWaitingCount)  dom.stateWaitingCount.textContent = waiting;
  if (dom.stateBlockedCount)  dom.stateBlockedCount.textContent = blocked;

  // Per-process CPU mini bar chart
  if (dom.stateBars) {
    dom.stateBars.innerHTML = procs.map(p => {
      const color = { running: 'var(--green)', waiting: 'var(--yellow)', blocked: 'var(--red)' }[p.state] || 'var(--text-muted)';
      const h = Math.max(8, Math.round((p.cpu / 100) * 52));
      return `<div title="${p.name}: ${p.cpu.toFixed(0)}% CPU (${p.state})"
        style="flex:1;max-width:28px;height:52px;display:flex;align-items:flex-end;cursor:default;">
        <div style="width:100%;background:${color};opacity:0.7;border-radius:2px 2px 0 0;height:${h}px;
          transition:height 0.4s var(--ease);box-shadow:0 0 6px ${color}60;"></div>
      </div>`;
    }).join('') || '<span style="color:var(--text-muted);font-size:11px">No processes</span>';
  }

  // IPC channel breakdown from connections
  const conns = Store.get().connections;
  const ipcCounts = { pipe: 0, queue: 0, shared_memory: 0 };
  conns.forEach(c => { if (c.ipc_type in ipcCounts) ipcCounts[c.ipc_type]++; });
  const totalConns = Object.values(ipcCounts).reduce((a, b) => a + b, 0) || 1;

  const setPct = (pctEl, barEl, val, tot) => {
    const pct = Math.round((val / tot) * 100);
    if (pctEl) pctEl.textContent = `${val} conn · ${pct}%`;
    if (barEl) barEl.style.width = pct + '%';
  };
  setPct(dom.ipcPipePct,  dom.ipcPipeBar,  ipcCounts.pipe,          totalConns);
  setPct(dom.ipcQueuePct, dom.ipcQueueBar, ipcCounts.queue,         totalConns);
  setPct(dom.ipcShmPct,   dom.ipcShmBar,   ipcCounts.shared_memory, totalConns);

  // Latency histogram (canvas)
  _latencyHistory.push(metrics.avg_latency_ms);
  if (_latencyHistory.length > 40) _latencyHistory.shift();
  renderLatencyHistogram();

  // Connection health grid
  renderConnHealthGrid(conns);

  // Sparklines
  if (sparklines.latency)    sparklines.latency.push(metrics.avg_latency_ms);
  if (sparklines.throughput) sparklines.throughput.push(metrics.throughput_kbps);
  if (sparklines.rate)       sparklines.rate.push(metrics.messages_per_sec);
}

function renderLatencyHistogram() {
  const canvas = dom.latencyHistogram;
  if (!canvas) return;
  canvas.width  = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const data = _latencyHistory;
  if (data.length < 2) return;

  ctx.clearRect(0, 0, W, H);

  // Bucket into 12 bins
  const BINS = 12;
  const min  = Math.min(...data);
  const max  = Math.max(...data) || 1;
  const range = max - min || 1;
  const bins  = new Array(BINS).fill(0);
  data.forEach(v => {
    const i = Math.min(BINS - 1, Math.floor(((v - min) / range) * BINS));
    bins[i]++;
  });
  const maxBin = Math.max(...bins) || 1;
  const barW = Math.floor(W / BINS);

  bins.forEach((count, i) => {
    const h   = Math.max(2, Math.round((count / maxBin) * (H - 4)));
    const x   = i * barW + 1;
    const pct = i / BINS;
    // color gradient: green → yellow → red
    const hue = 130 - pct * 130;
    const color = `hsl(${hue},90%,55%)`;
    ctx.fillStyle = color + 'b0';
    ctx.fillRect(x, H - h, barW - 2, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, H - h, barW - 2, 2);
  });

  // X-axis labels
  ctx.fillStyle = 'rgba(74,85,104,0.8)';
  ctx.font = '8px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(min.toFixed(1) + 'ms', 2, H - 1);
  ctx.textAlign = 'right';
  ctx.fillText(max.toFixed(1) + 'ms', W - 2, H - 1);
}

function renderConnHealthGrid(conns) {
  const grid = dom.connHealthGrid;
  if (!grid) return;
  const IPC_COLORS = { pipe: '#00d4ff', queue: '#a78bfa', shared_memory: '#00ff88' };
  grid.innerHTML = conns.map(c => {
    const color = IPC_COLORS[c.ipc_type] || '#4a5568';
    const procs = Store.get().processes;
    const srcName = procs[c.source]?.name || c.source;
    const dstName = procs[c.target]?.name || c.target;
    const bw = c.bandwidth ? c.bandwidth.toFixed(1) + ' kbps' : 'idle';
    return `<div class="conn-health-dot"
      title="${srcName} → ${dstName} [${c.ipc_type}] ${bw}"
      style="background:${color}50;border:1px solid ${color}80;box-shadow:0 0 4px ${color}40;"></div>`;
  }).join('') || '<span style="color:var(--text-muted);font-size:10px;font-family:monospace;">No connections</span>';
}

// ── Main update handler ───────────────────────────────────────────
Store.on('update', (state) => {
  const { processes, connections, metrics, logs, messages } = state;

  // Topbar metrics
  dom.mMsgRate.textContent    = metrics.messages_per_sec.toFixed(1) + '/s';
  dom.mLatency.textContent    = metrics.avg_latency_ms.toFixed(1) + 'ms';
  dom.mThroughput.textContent = metrics.throughput_kbps.toFixed(1) + ' kbps';
  dom.mActive.textContent     = metrics.active_processes;
  dom.mTotal.textContent      = metrics.total_messages.toLocaleString();

  // Deadlock alert
  const dl = metrics.deadlock_detected;
  dom.deadlockAlert.classList.toggle('visible', dl);
  dom.deadlockBadge.classList.toggle('visible', dl);

  // Graph
  if (graph) {
    graph.update(processes, connections, metrics.deadlock_nodes);
  }

  // Process list
  renderProcessList(processes);

  // Logs (only fresh entries)
  if (logs && logs.length) {
    const freshLogs = logs.filter(l => !logTail.find(e => e.id === l.id));
    freshLogs.forEach(appendLog);
    logTail = [...logs];
  }

  // New messages → particles + table
  const newMessages = messages.filter(m => !msgBuffer.find(x => x.id === m.id));
  newMessages.forEach(m => msgBuffer.push(m));
  if (msgBuffer.length > 500) msgBuffer.splice(0, msgBuffer.length - 500);
  renderMessages(newMessages);

  // Metrics view
  renderMetricsView(metrics);

  // Refresh detail panel if open
  const selPid = state.selectedPid;
  if (selPid && dom.detailPanel.classList.contains('open')) {
    refreshDetailPanel(selPid);
  }
});

Store.on('connected', () => {
  dom.statusDot.classList.add('connected');
  dom.statusText.textContent = 'Live';
});

Store.on('disconnected', () => {
  dom.statusDot.classList.remove('connected');
  dom.statusText.textContent = 'Reconnecting...';
});

// Periodically update RTT display in status bar
setInterval(() => {
  const { rtt, connected } = Store.get();
  if (connected && rtt !== null && dom.statusText) {
    dom.statusText.textContent = `Live · ${rtt}ms RTT`;
  }
}, 5000);

// ── Topbar Actions ────────────────────────────────────────────────
$('btn-new-process').addEventListener('click', () => {
  dom.modalOverlay.classList.add('open');
});

$('btn-deadlock').addEventListener('click', async () => {
  const res = await apiPost('/api/inject/deadlock');
  if (res.status === 'ok') toast('⚠ Deadlock injected — circular wait active', 'warn');
  else toast('Need at least 3 processes to inject deadlock', 'error');
});

$('btn-clear').addEventListener('click', async () => {
  await apiPost('/api/inject/clear');
  toast('✓ Deadlock cleared — all processes resumed', 'success');
});

$('btn-burst').addEventListener('click', async () => {
  const res = await apiPost('/api/send_burst', { count: 30 });
  toast(`⚡ Burst: ${res.injected || 30} messages injected`, 'info');
});

// Fit graph button
const btnFit = $('btn-fit-graph');
if (btnFit) btnFit.addEventListener('click', () => { if (graph) graph.fitToScreen(); });

// Modal
dom.modalClose.addEventListener('click', () => dom.modalOverlay.classList.remove('open'));
dom.modalOverlay.addEventListener('click', (e) => { if (e.target === dom.modalOverlay) dom.modalOverlay.classList.remove('open'); });

dom.modalCreate.addEventListener('click', async () => {
  const name    = dom.formName.value.trim() || undefined;
  const ipcType = dom.formIpc.value || undefined;
  const res = await apiPost('/api/process/create', { name, ipc_type: ipcType });
  dom.modalOverlay.classList.remove('open');
  dom.formName.value = '';
  if (res.process) toast(`✓ Spawned ${res.process.name} (${res.process.ipc_type})`, 'success');
});

$('detail-kill').addEventListener('click', async () => {
  const pid = Store.get().selectedPid;
  if (!pid) return;
  const proc = Store.get().processes[pid];
  await apiDelete(`/api/process/${pid}`);
  closeDetailPanel();
  toast(`✕ Killed ${proc ? proc.name : pid}`, 'warn');
});

// Detail state buttons
['running', 'waiting', 'blocked'].forEach(s => {
  const btn = $(`btn-set-${s}`);
  if (btn) btn.addEventListener('click', async () => {
    const pid = Store.get().selectedPid;
    if (!pid) return;
    await apiPost(`/api/process/${pid}/state`, { state: s });
    toast(`→ ${Store.get().processes[pid]?.name || pid} set to ${s}`, 'info');
  });
});

// ── Sparklines init ───────────────────────────────────────────────
function initSparklines() {
  const sl = (id, color) => {
    const canvas = document.getElementById(id);
    return canvas ? new Sparkline(canvas, color) : null;
  };
  sparklines.latency    = sl('spark-latency',    '#00d4ff');
  sparklines.throughput = sl('spark-throughput', '#00ff88');
  sparklines.rate       = sl('spark-rate',       '#a78bfa');
}

// ── Keyboard Shortcuts ────────────────────────────────────────────
document.addEventListener('keydown', async (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  switch (e.key) {
    case '1': switchView('dashboard'); break;
    case '2': switchView('metrics'); break;
    case '3': switchView('messages'); break;
    case 'n': case 'N': dom.modalOverlay.classList.add('open'); break;
    case 'd': case 'D': await apiPost('/api/inject/deadlock'); break;
    case 'c': case 'C': await apiPost('/api/inject/clear'); break;
    case 'b': case 'B': await apiPost('/api/send_burst', { count: 30 }); break;
    case 'f': case 'F': if (graph) graph.fitToScreen(); break;
    case 'Escape':
      dom.modalOverlay.classList.remove('open');
      closeDetailPanel();
      break;
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────
async function init() {
  switchView('dashboard');
  initGraph();
  initSparklines();
  renderKeyboardHints();

  // Fetch initial state
  try {
    const data = await apiGet('/api/state');
    Store.update({
      processes:   data.processes,
      connections: data.connections,
      metrics:     data.metrics,
      logs:        data.logs || [],
    });
  } catch (e) {
    console.warn('Initial state fetch failed, waiting for WS');
  }

  connectWS();
}

function renderKeyboardHints() {
  const hint = document.getElementById('kbd-hints');
  if (!hint) return;
  const keys = [
    ['1/2/3', 'Views'], ['N', 'New Process'], ['D', 'Deadlock'],
    ['C', 'Clear'], ['B', 'Burst'], ['F', 'Fit Graph'], ['Esc', 'Close'],
  ];
  hint.innerHTML = keys.map(([k, v]) =>
    `<span class="kbd-item"><kbd>${k}</kbd> ${v}</span>`
  ).join('');
}

init();
