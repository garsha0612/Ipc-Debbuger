/**
 * IPC Debugger — Graph Renderer
 * Force-directed layout with Canvas 2D API
 * Features: nodes, edges, particles, deadlock glow, drag
 */

export class GraphRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.nodes  = new Map();   // pid → node object
    this.edges  = [];
    this.particles = [];
    this.deadlockNodes = new Set();
    this.selectedPid = null;
    this.hoveredPid  = null;

    // View transform
    this.scale    = 1;
    this.offsetX  = 0;
    this.offsetY  = 0;

    // Drag state
    this._drag = { active: false, nodeId: null, startX: 0, startY: 0, nodeStartX: 0, nodeStartY: 0 };
    this._pan  = { active: false, startX: 0, startY: 0, startOX: 0, startOY: 0 };

    this._raf = null;
    this._resizeObserver = null;

    // Particle pool
    this._particleId = 0;

    this._bindEvents();
    this._startLoop();
    this._observe();
  }

  // ── Public API ─────────────────────────────────────────────────

  update(processes, connections, deadlockNodes) {
    this.deadlockNodes = new Set(deadlockNodes || []);

    const existingPids = new Set(Object.keys(processes));

    // Remove stale nodes
    for (const [pid] of this.nodes) {
      if (!existingPids.has(pid)) this.nodes.delete(pid);
    }

    // Add / update nodes
    const cx = this.canvas.width  / 2;
    const cy = this.canvas.height / 2;
    const r  = Math.min(cx, cy) * 0.6;
    const pids = [...existingPids];

    pids.forEach((pid, i) => {
      const proc = processes[pid];
      if (this.nodes.has(pid)) {
        // Update properties but keep position
        const n = this.nodes.get(pid);
        n.state   = proc.state;
        n.name    = proc.name;
        n.ipcType = proc.ipc_type;
        n.cpu     = proc.cpu;
        n.memKb   = proc.memory_kb;
        n.sent    = proc.messages_sent;
        n.recv    = proc.messages_received;
        n.bufferUsage = proc.buffer_usage;
      } else {
        // Place new node in circular layout with slight jitter
        const angle = (i / pids.length) * Math.PI * 2 - Math.PI / 2;
        const jitter = (Math.random() - 0.5) * 60;
        this.nodes.set(pid, {
          pid,
          name:    proc.name,
          state:   proc.state,
          ipcType: proc.ipc_type,
          cpu:     proc.cpu,
          memKb:   proc.memory_kb,
          sent:    proc.messages_sent,
          recv:    proc.messages_received,
          bufferUsage: proc.buffer_usage,
          x: cx + Math.cos(angle) * (r + jitter),
          y: cy + Math.sin(angle) * (r + jitter),
          vx: 0, vy: 0,
          radius: 34,
          pulsePhase: Math.random() * Math.PI * 2,
        });
      }
    });

    // Rebuild edges
    this.edges = connections.map(c => ({
      id:      c.id,
      source:  c.source,
      target:  c.target,
      ipcType: c.ipc_type,
      bw:      c.bandwidth,
    })).filter(e => this.nodes.has(e.source) && this.nodes.has(e.target));
  }

  spawnParticle(srcPid, dstPid, ipcType) {
    const src = this.nodes.get(srcPid);
    const dst = this.nodes.get(dstPid);
    if (!src || !dst) return;

    const color = { pipe: '#00d4ff', queue: '#a78bfa', shared_memory: '#00ff88' }[ipcType] || '#00d4ff';

    this.particles.push({
      id:    this._particleId++,
      srcPid, dstPid,
      color,
      size:  3 + Math.random() * 2,
      t:     0,
      speed: 0.006 + Math.random() * 0.006,
      trail: [],
    });
  }

  setSelected(pid) { this.selectedPid = pid; }

  /** Fit all nodes into view with padding */
  fitToScreen() {
    if (this.nodes.size === 0) return;
    const padding = 80;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes.values()) {
      minX = Math.min(minX, n.x - n.radius);
      minY = Math.min(minY, n.y - n.radius);
      maxX = Math.max(maxX, n.x + n.radius);
      maxY = Math.max(maxY, n.y + n.radius);
    }
    const W = this.canvas.width, H = this.canvas.height;
    const contentW = maxX - minX, contentH = maxY - minY;
    this.scale = Math.min(
      (W - padding * 2) / (contentW || 1),
      (H - padding * 2) / (contentH || 1),
      1.5
    );
    this.offsetX = (W - contentW * this.scale) / 2 - minX * this.scale;
    this.offsetY = (H - contentH * this.scale) / 2 - minY * this.scale;
  }

  // ── Event Binding ──────────────────────────────────────────────

  _bindEvents() {
    this.canvas.addEventListener('mousedown',  e => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove',  e => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup',    e => this._onMouseUp(e));
    this.canvas.addEventListener('mouseleave', e => this._onMouseUp(e));
    this.canvas.addEventListener('wheel',      e => this._onWheel(e), { passive: false });
    this.canvas.addEventListener('click',      e => this._onClick(e));
  }

  _canvasPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left), (e.clientY - r.top)];
  }

  _worldPos(cx, cy) {
    return [(cx - this.offsetX) / this.scale, (cy - this.offsetY) / this.scale];
  }

  _hitTest(cx, cy) {
    const [wx, wy] = this._worldPos(cx, cy);
    for (const [pid, n] of this.nodes) {
      const d = Math.hypot(wx - n.x, wy - n.y);
      if (d <= n.radius + 6) return pid;
    }
    return null;
  }

  _onMouseDown(e) {
    const [cx, cy] = this._canvasPos(e);
    const hit = this._hitTest(cx, cy);
    if (hit) {
      const n = this.nodes.get(hit);
      this._drag = { active: true, nodeId: hit, startX: cx, startY: cy, nodeStartX: n.x, nodeStartY: n.y };
      this.canvas.style.cursor = 'grabbing';
    } else {
      this._pan = { active: true, startX: cx, startY: cy, startOX: this.offsetX, startOY: this.offsetY };
    }
  }

  _onMouseMove(e) {
    const [cx, cy] = this._canvasPos(e);

    // Drag node
    if (this._drag.active) {
      const n = this.nodes.get(this._drag.nodeId);
      if (n) {
        const dx = (cx - this._drag.startX) / this.scale;
        const dy = (cy - this._drag.startY) / this.scale;
        n.x = this._drag.nodeStartX + dx;
        n.y = this._drag.nodeStartY + dy;
        n.vx = 0; n.vy = 0;
      }
      return;
    }

    // Pan canvas
    if (this._pan.active) {
      this.offsetX = this._pan.startOX + (cx - this._pan.startX);
      this.offsetY = this._pan.startOY + (cy - this._pan.startY);
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    // Hover
    const hit = this._hitTest(cx, cy);
    this.hoveredPid = hit;
    this.canvas.style.cursor = hit ? 'pointer' : 'grab';

    // Tooltip
    this._emitHover(hit, e.clientX, e.clientY);
  }

  _onMouseUp(e) {
    this._drag.active = false;
    this._pan.active  = false;
    this.canvas.style.cursor = 'grab';
  }

  _onWheel(e) {
    e.preventDefault();
    const [cx, cy] = this._canvasPos(e);
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const newScale = Math.max(0.3, Math.min(3, this.scale * factor));
    // Zoom towards cursor
    this.offsetX = cx - (cx - this.offsetX) * (newScale / this.scale);
    this.offsetY = cy - (cy - this.offsetY) * (newScale / this.scale);
    this.scale   = newScale;
  }

  _onClick(e) {
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 3) return;
    const [cx, cy] = this._canvasPos(e);
    const hit = this._hitTest(cx, cy);
    this._emitClick(hit);
  }

  _emitHover(pid, clientX, clientY) {
    this.canvas.dispatchEvent(new CustomEvent('node-hover', { detail: { pid, clientX, clientY }, bubbles: true }));
  }

  _emitClick(pid) {
    this.canvas.dispatchEvent(new CustomEvent('node-click', { detail: { pid }, bubbles: true }));
  }

  // ── Force simulation ───────────────────────────────────────────

  _applyForces() {
    const nodes = [...this.nodes.values()];
    const cx = this.canvas.width  / (2 * this.scale);
    const cy = this.canvas.height / (2 * this.scale);
    const gravity = 0.04;
    const repulsion = 8000;
    const edgeLen   = 160;
    const damping   = 0.82;

    for (const n of nodes) {
      if (this._drag.active && this._drag.nodeId === n.pid) continue;

      // Gravity towards center
      n.vx += (cx - n.x) * gravity;
      n.vy += (cy - n.y) * gravity;

      // Repulsion between nodes
      for (const m of nodes) {
        if (m.pid === n.pid) continue;
        const dx = n.x - m.x;
        const dy = n.y - m.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const force = repulsion / (dist * dist);
        n.vx += (dx / dist) * force;
        n.vy += (dy / dist) * force;
      }

      n.vx *= damping;
      n.vy *= damping;
    }

    // Spring forces along edges
    for (const e of this.edges) {
      const src = this.nodes.get(e.source);
      const dst = this.nodes.get(e.target);
      if (!src || !dst) continue;

      const dx = dst.x - src.x;
      const dy = dst.y - src.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const force = (dist - edgeLen) * 0.03;

      src.vx += (dx / dist) * force;
      src.vy += (dy / dist) * force;
      dst.vx -= (dx / dist) * force;
      dst.vy -= (dy / dist) * force;
    }

    for (const n of nodes) {
      if (this._drag.active && this._drag.nodeId === n.pid) continue;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  // ── Render ─────────────────────────────────────────────────────

  _startLoop() {
    const tick = (ts) => {
      this._raf = requestAnimationFrame(tick);
      this._applyForces();
      this._updateParticles();
      this._draw(ts);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _observe() {
    this._resizeObserver = new ResizeObserver(() => {
      this.canvas.width  = this.canvas.clientWidth;
      this.canvas.height = this.canvas.clientHeight;
    });
    this._resizeObserver.observe(this.canvas);
    this.canvas.width  = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._resizeObserver?.disconnect();
  }

  // ── Draw ───────────────────────────────────────────────────────

  _draw(ts) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    this._drawEdges(ts);
    this._drawParticles(ts);
    this._drawNodes(ts);

    ctx.restore();

    this._drawOverlay(ts);
    this._drawMinimap();
  }

  _drawOverlay(ts) {
    const { ctx, canvas } = this;
    // Node + edge count (top-left HUD)
    ctx.save();
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(74,85,104,0.9)';
    ctx.fillText(`${this.nodes.size} processes  ·  ${this.edges.length} connections`, 14, 20);
    ctx.fillText(`scale ${this.scale.toFixed(2)}x  ·  [F] fit`, 14, 34);
    ctx.restore();
  }

  _drawMinimap() {
    const { ctx, canvas, nodes, edges } = this;
    if (nodes.size < 2) return;

    const MM_W = 120, MM_H = 80, MM_X = canvas.width - MM_W - 10, MM_Y = canvas.height - MM_H - 10;
    const padding = 10;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes.values()) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
    }
    const rw = (maxX - minX) || 1, rh = (maxY - minY) || 1;
    const scx = (MM_W - padding * 2) / rw, scy = (MM_H - padding * 2) / rh;
    const sc  = Math.min(scx, scy);
    const ox  = MM_X + padding - minX * sc + (MM_W - padding * 2 - rw * sc) / 2;
    const oy  = MM_Y + padding - minY * sc + (MM_H - padding * 2 - rh * sc) / 2;

    ctx.save();

    // Background
    ctx.fillStyle = 'rgba(8,12,18,0.85)';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(MM_X, MM_Y, MM_W, MM_H, 6);
    ctx.fill(); ctx.stroke();

    ctx.beginPath();
    ctx.rect(MM_X, MM_Y, MM_W, MM_H);
    ctx.clip();

    // Edges
    const IPC_COLORS = { pipe: '#00d4ff', queue: '#a78bfa', shared_memory: '#00ff88' };
    for (const e of edges) {
      const s = nodes.get(e.source), d = nodes.get(e.target);
      if (!s || !d) continue;
      ctx.beginPath();
      ctx.moveTo(s.x * sc + ox, s.y * sc + oy);
      ctx.lineTo(d.x * sc + ox, d.y * sc + oy);
      ctx.strokeStyle = (IPC_COLORS[e.ipcType] || '#4a5568') + '60';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Nodes
    const STATE_COLORS = { running: '#00ff88', waiting: '#ffd94d', blocked: '#ff4466' };
    for (const n of nodes.values()) {
      ctx.beginPath();
      ctx.arc(n.x * sc + ox, n.y * sc + oy, 3, 0, Math.PI * 2);
      ctx.fillStyle = STATE_COLORS[n.state] || '#8b9ab5';
      ctx.fill();
    }

    // Viewport indicator
    const vx1 = (-this.offsetX / this.scale) * sc + ox;
    const vy1 = (-this.offsetY / this.scale) * sc + oy;
    const vx2 = vx1 + (canvas.width / this.scale) * sc;
    const vy2 = vy1 + (canvas.height / this.scale) * sc;
    ctx.strokeStyle = 'rgba(0,212,255,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx1, vy1, vx2 - vx1, vy2 - vy1);

    ctx.restore();
  }

  _drawEdges(ts) {
    const { ctx } = this;
    const IPC_COLORS = { pipe: '#00d4ff', queue: '#a78bfa', shared_memory: '#00ff88' };

    for (const edge of this.edges) {
      const src = this.nodes.get(edge.source);
      const dst = this.nodes.get(edge.target);
      if (!src || !dst) continue;

      const color = IPC_COLORS[edge.ipcType] || '#4a5568';
      const isDeadlockEdge = this.deadlockNodes.has(edge.source) && this.deadlockNodes.has(edge.target);

      ctx.save();
      ctx.beginPath();

      // Curved edge
      const mx = (src.x + dst.x) / 2;
      const my = (src.y + dst.y) / 2;
      const nx = -(dst.y - src.y) * 0.15;
      const ny =  (dst.x - src.x) * 0.15;

      ctx.moveTo(src.x, src.y);
      ctx.quadraticCurveTo(mx + nx, my + ny, dst.x, dst.y);

      if (isDeadlockEdge) {
        ctx.strokeStyle = `rgba(255, 68, 102, 0.7)`;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        const phase = (ts / 300) % 10;
        ctx.lineDashOffset = -phase;
      } else {
        ctx.strokeStyle = color + '40';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
      }

      ctx.stroke();
      ctx.restore();

      // Arrowhead
      this._drawArrow(ctx, src, dst, color, mx + nx, my + ny);
    }
  }

  _drawArrow(ctx, src, dst, color, cpx, cpy) {
    const t = 0.85;
    const ax = (1-t)*(1-t)*src.x + 2*(1-t)*t*cpx + t*t*dst.x;
    const ay = (1-t)*(1-t)*src.y + 2*(1-t)*t*cpy + t*t*dst.y;
    const bx = (1-0.84)*(1-0.84)*src.x + 2*(1-0.84)*0.84*cpx + 0.84*0.84*dst.x;
    const by = (1-0.84)*(1-0.84)*src.y + 2*(1-0.84)*0.84*cpy + 0.84*0.84*dst.y;
    const angle = Math.atan2(ay - by, ax - bx);
    const size = 7;

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size * 0.5);
    ctx.lineTo(-size,  size * 0.5);
    ctx.closePath();
    ctx.fillStyle = color + 'a0';
    ctx.fill();
    ctx.restore();
  }

  _drawNodes(ts) {
    const { ctx } = this;
    const STATE_COLORS = { running: '#00ff88', waiting: '#ffd94d', blocked: '#ff4466' };

    for (const [pid, n] of this.nodes) {
      const color  = STATE_COLORS[n.state] || '#8b9ab5';
      const isHovered  = this.hoveredPid  === pid;
      const isSelected = this.selectedPid === pid;
      const isDeadlock = this.deadlockNodes.has(pid);
      const pulse  = Math.sin(ts / 900 + n.pulsePhase) * 0.5 + 0.5; // 0..1

      ctx.save();
      ctx.translate(n.x, n.y);

      // Deadlock glow ring
      if (isDeadlock) {
        const glowAlpha = 0.3 + 0.4 * pulse;
        const glowR = n.radius + 12 + 8 * pulse;
        const grad = ctx.createRadialGradient(0, 0, n.radius, 0, 0, glowR);
        grad.addColorStop(0, `rgba(255,68,102,${glowAlpha})`);
        grad.addColorStop(1, 'rgba(255,68,102,0)');
        ctx.beginPath();
        ctx.arc(0, 0, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Selection ring
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(0, 0, n.radius + 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#00d4ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.lineDashOffset = -(ts / 100) % 7;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Hover ring
      if (isHovered && !isSelected) {
        ctx.beginPath();
        ctx.arc(0, 0, n.radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Node body
      const bodyGrad = ctx.createRadialGradient(-8, -8, 2, 0, 0, n.radius);
      bodyGrad.addColorStop(0, '#1a2438');
      bodyGrad.addColorStop(1, '#0d1420');

      ctx.beginPath();
      ctx.arc(0, 0, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = bodyGrad;
      ctx.fill();

      // State-colored border
      const borderAlpha = n.state === 'blocked' ? (0.6 + 0.4 * pulse) : 0.9;
      ctx.beginPath();
      ctx.arc(0, 0, n.radius, 0, Math.PI * 2);
      ctx.strokeStyle = color + Math.round(borderAlpha * 255).toString(16).padStart(2,'0');
      ctx.lineWidth = n.state === 'blocked' ? 2.5 : 1.8;
      ctx.stroke();

      // Buffer ring (arc)
      const bufAngle = n.bufferUsage * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(0, 0, n.radius - 5, -Math.PI / 2, -Math.PI / 2 + bufAngle);
      ctx.strokeStyle = color + '50';
      ctx.lineWidth = 3;
      ctx.stroke();

      // IPC type icon (text)
      const IPC_ICONS = { pipe: '⇄', queue: '≡', shared_memory: '◈' };
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillStyle = '#4a5568';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(IPC_ICONS[n.ipcType] || '•', 0, -8);

      // Process name
      const maxLen = 9;
      const label  = n.name.length > maxLen ? n.name.slice(0, maxLen) + '…' : n.name;
      ctx.font = '600 9px DM Sans, sans-serif';
      ctx.fillStyle = '#e8edf5';
      ctx.fillText(label, 0, 5);

      // CPU label
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillStyle = color + 'cc';
      ctx.fillText(`${n.cpu.toFixed(0)}%`, 0, 16);

      // PID badge
      ctx.font = '8px JetBrains Mono, monospace';
      ctx.fillStyle = '#4a5568';
      ctx.fillText(pid, 0, n.radius + 12);

      ctx.restore();
    }
  }

  _updateParticles() {
    for (const p of this.particles) {
      p.t += p.speed;
      const src = this.nodes.get(p.srcPid);
      const dst = this.nodes.get(p.dstPid);
      if (src && dst) {
        // Store trail
        const mx = (src.x + dst.x) / 2;
        const my = (src.y + dst.y) / 2;
        const nx = -(dst.y - src.y) * 0.15;
        const ny =  (dst.x - src.x) * 0.15;
        const t = p.t;
        const x = (1-t)*(1-t)*src.x + 2*(1-t)*t*(mx+nx) + t*t*dst.x;
        const y = (1-t)*(1-t)*src.y + 2*(1-t)*t*(my+ny) + t*t*dst.y;
        p.trail.push({ x, y });
        if (p.trail.length > 8) p.trail.shift();
      }
    }
    this.particles = this.particles.filter(p => p.t < 1.0);
  }

  _drawParticles(ts) {
    const { ctx } = this;
    for (const p of this.particles) {
      const src = this.nodes.get(p.srcPid);
      const dst = this.nodes.get(p.dstPid);
      if (!src || !dst) continue;

      // Trail
      for (let i = 1; i < p.trail.length; i++) {
        const a = (i / p.trail.length) * (1 - p.t) * 0.6;
        ctx.beginPath();
        ctx.moveTo(p.trail[i-1].x, p.trail[i-1].y);
        ctx.lineTo(p.trail[i].x, p.trail[i].y);
        ctx.strokeStyle = p.color + Math.round(a * 255).toString(16).padStart(2,'0');
        ctx.lineWidth = p.size * (i / p.trail.length);
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Particle head
      if (p.trail.length > 0) {
        const head = p.trail[p.trail.length - 1];
        const alpha = (1 - p.t) * 0.95;
        ctx.beginPath();
        ctx.arc(head.x, head.y, p.size, 0, Math.PI * 2);

        const grad = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, p.size * 2.5);
        grad.addColorStop(0, p.color);
        grad.addColorStop(1, p.color + '00');
        ctx.fillStyle = grad;
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
}
