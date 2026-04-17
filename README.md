# IPC Debugger — Inter-Process Communication Visualizer

A production-quality, real-time debugging and visualization system for IPC mechanisms. Built with FastAPI, WebSockets, and Vanilla JS.

## Architecture

```
ipc-debugger/
├── backend/
│   ├── main.py              # FastAPI app, IPC simulation, WebSocket broadcast
│   └── requirements.txt     # Python dependencies
├── frontend/
│   ├── index.html           # Full SPA layout
│   ├── css/
│   │   └── style.css        # Design system + glassmorphism theme
│   └── js/
│       ├── app.js           # Main orchestrator (views, panels, events)
│       ├── store.js         # WebSocket client + reactive state store
│       ├── graph.js         # Force-directed Canvas 2D graph renderer
│       └── sparkline.js     # Mini sparkline chart widget
├── setup.sh                 # One-time environment setup
├── run.sh                   # Quick start script
└── README.md
```

## Features

### IPC Simulation Engine
- **Pipes** — half-duplex byte streams with 0.05ms base latency model
- **Message Queues** — discrete priority message passing, 0.12ms base latency
- **Shared Memory** — zero-copy memory regions, 0.01ms base latency
- Dynamic process creation and termination
- Realistic CPU / memory / buffer usage simulation

### Graph Visualization
- Force-directed layout with spring physics (repulsion + gravity)
- Curved directional edges with animated arrowheads
- Draggable nodes, pan, and zoom (scroll wheel)
- Real-time particle animation along edges (data flow)
- IPC type color-coded (pipe=cyan, queue=purple, shm=green)

### Process State Visualization
- 🟢 **Running** — green border + glow
- 🟡 **Waiting** — yellow border
- 🔴 **Blocked** — red border + pulse animation
- Buffer usage arc shown inside each node
- CPU % label inside node

### Deadlock Detection
- Cycle detection on wait-for graph (DFS-based)
- Deadlock nodes highlighted with red glow animation
- Topbar alert banner with pulse animation
- One-click deadlock injection for demo purposes

### Performance Metrics
- Rolling 5-second message rate window
- Average latency (last 50 messages)
- Throughput in kbps
- Live sparkline charts per metric

### Logging System
- Timestamped event log (send, receive, state changes, errors)
- Color-coded by severity (info/send/warn/error)
- Auto-scroll with manual clear

### Interactivity
- Click node → slide-in detail panel with full stats
- Drag nodes to rearrange graph
- Hover → tooltip with process info
- Manual state override (running/waiting/blocked)
- Kill any process
- Message burst injection

## Setup & Run

### Prerequisites
- Python 3.10+
- No Node.js required (pure Vanilla JS, no build step)

### Quick Start

```bash
# 1. Clone / unzip the project
cd ipc-debugger

# 2. One-time setup (creates venv + installs deps)
chmod +x setup.sh run.sh
./setup.sh

# 3. Start the server
./run.sh

# 4. Open browser
open http://localhost:8000
```

### Manual Setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/state` | Full state snapshot |
| `POST` | `/api/process/create` | Spawn new process `{name?, ipc_type?}` |
| `DELETE` | `/api/process/{pid}` | Kill a process |
| `POST` | `/api/process/{pid}/state` | Set process state `{state}` |
| `GET`  | `/api/process/{pid}` | Process detail + recent messages |
| `POST` | `/api/inject/deadlock` | Force a circular wait deadlock |
| `POST` | `/api/inject/clear` | Resolve all deadlocks |
| `POST` | `/api/send_burst` | Inject N messages `{count?}` |
| `WS`   | `/ws` | Real-time state stream (250ms cadence) |

## WebSocket Protocol

**Server → Client** (every 250ms):
```json
{
  "type": "state_update",
  "processes": { "<pid>": { "name": "...", "state": "running", ... } },
  "connections": [ { "source": "...", "target": "...", "ipc_type": "..." } ],
  "metrics": { "messages_per_sec": 4.2, "avg_latency_ms": 1.3, ... },
  "logs": [ { "timestamp": "12:34:56.789", "level": "send", "message": "..." } ],
  "messages": [ { "source": "...", "target": "...", "size_bytes": 512, ... } ]
}
```

**Client → Server** (ping):
```json
{ "type": "ping" }
```

## Tech Stack

- **Backend**: Python 3.10+, FastAPI, Uvicorn, multiprocessing
- **Real-time**: WebSockets (via Starlette / FastAPI)
- **Frontend**: HTML5, CSS3 (custom design system), Vanilla ES2022 modules
- **Graph**: Canvas 2D API (no WebGL, no D3, no lib)
- **Design**: Glassmorphism, dark theme, JetBrains Mono + DM Sans
