from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import asyncio
import os
import time
import random
from collections import deque
import threading
import json
import uuid

app = FastAPI()

# ─────────────────────────────────────────────
# STATIC FILES
# ─────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "../frontend")

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
async def serve():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

# ─────────────────────────────────────────────
# GLOBAL STATE
# ─────────────────────────────────────────────

state = {
    "processes": {},
    "connections": [],
    "logs": deque(maxlen=100),
    "messages": deque(maxlen=100),
    "metrics": {
        # FIX 1: Added total_messages — frontend calls .toLocaleString() on this
        "total_messages": 0,
        "messages_per_sec": 0,
        "avg_latency_ms": 0,
        "throughput_kbps": 0,
        "active_processes": 0,
        "deadlock_detected": False,
        "deadlock_nodes": [],
    }
}

# ─────────────────────────────────────────────
# CREATE PROCESS
# ─────────────────────────────────────────────

def create_process(name=None, ipc_type=None):
    pid = str(random.randint(1000, 9999))
    cpu_percent = round(random.uniform(5, 50), 2)
    memory_bytes = random.randint(500_000, 5_000_000)

    state["processes"][pid] = {
        "pid": pid,
        "name": name or f"Process-{pid}",
        "state": random.choice(["running", "waiting", "blocked"]),
        "ipc_type": ipc_type or random.choice(["pipe", "queue", "shared_memory"]),

        # ✅ FIX 2: Frontend uses proc.cpu and proc.memory_kb — provide both aliases
        "cpu": cpu_percent,                        # used by app.js renderProcessList / detailPanel
        "cpu_percent": cpu_percent,                # keep original too
        "memory_kb": memory_bytes // 1024,         # app.js does memory_kb / 1024 → MB
        "memory_bytes": memory_bytes,              # keep original too

        "messages_sent": 0,
        "messages_received": 0,
        "buffer_usage": round(random.random(), 3),
    }
    return state["processes"][pid]

# ─────────────────────────────────────────────
# SIMULATION
# ─────────────────────────────────────────────

def simulate():
    while True:
        if len(state["processes"]) < 5:
            create_process()

        pids = list(state["processes"].keys())

        # Randomly update CPU/memory each tick so the UI feels alive
        for pid, proc in state["processes"].items():
            proc["cpu"] = round(random.uniform(5, 50), 2)
            proc["cpu_percent"] = proc["cpu"]
            proc["memory_kb"] = random.randint(500, 5000)
            proc["memory_bytes"] = proc["memory_kb"] * 1024
            proc["buffer_usage"] = round(random.random(), 3)

        # ✅ CONNECTIONS
        state["connections"] = []
        for i in range(len(pids) - 1):
            state["connections"].append({
                "source": pids[i],
                "target": pids[i + 1],
                "ipc_type": random.choice(["pipe", "queue", "shared_memory"]),
            })

        # ✅ FIX 3: Messages now include all fields the frontend expects:
        #   - id          (for deduplication in msgBuffer)
        #   - ipc_type    (renderMessages reads msg.ipc_type)
        #   - ts_human    (renderMessages renders msg.ts_human)
        if len(pids) >= 2:
            src, dst = random.sample(pids, 2)
            ipc_type = random.choice(["pipe", "queue", "shared_memory"])
            latency  = round(random.uniform(0.1, 2.0), 2)
            size     = random.randint(100, 1000)
            ts       = time.time()

            state["messages"].append({
                "id":          str(uuid.uuid4()),          # ✅ dedup key
                "source":      src,
                "target":      dst,
                "ipc_type":    ipc_type,                   # ✅ required by renderMessages
                "size_bytes":  size,
                "latency_ms":  latency,
                "timestamp":   ts,
                "ts_human":    time.strftime("%H:%M:%S", time.localtime(ts)),  # ✅ required by renderMessages
            })

            state["processes"][src]["messages_sent"]     += 1
            state["processes"][dst]["messages_received"] += 1
            state["metrics"]["total_messages"]           += 1  # ✅ increment total

        # ✅ FIX 4: Logs now include an id for deduplication (store.js filters by l.id)
        state["logs"].append({
            "id":        str(uuid.uuid4()),
            "timestamp": time.strftime("%H:%M:%S"),
            "level":     "info",
            "message":   "Simulation tick",
        })

        # Metrics
        state["metrics"]["active_processes"]  = len(state["processes"])
        state["metrics"]["messages_per_sec"]  = round(random.uniform(1, 10), 2)
        state["metrics"]["avg_latency_ms"]    = round(random.uniform(0.1, 3.0), 2)
        state["metrics"]["throughput_kbps"]   = round(random.uniform(10, 200), 2)

        time.sleep(1)

# ─────────────────────────────────────────────
# START SIMULATION
# ─────────────────────────────────────────────

for _ in range(4):
    create_process()

threading.Thread(target=simulate, daemon=True).start()

# ─────────────────────────────────────────────
# API ENDPOINTS
# ─────────────────────────────────────────────

@app.get("/api/state")
def get_state():
    return {
        "processes":   state["processes"],
        "connections": state["connections"],
        "logs":        list(state["logs"]),
        "messages":    list(state["messages"]),
        "metrics":     state["metrics"],
    }

@app.post("/api/process/create")
def api_create_process(body: dict = {}):
    proc = create_process(
        name=body.get("name"),
        ipc_type=body.get("ipc_type"),
    )
    return {"status": "created", "process": proc}

@app.delete("/api/process/{pid}")
def api_kill_process(pid: str):
    if pid in state["processes"]:
        del state["processes"][pid]
        return {"status": "killed"}
    return {"status": "not_found"}

@app.post("/api/process/{pid}/state")
async def api_set_state(pid: str, body: dict):
    if pid in state["processes"]:
        state["processes"][pid]["state"] = body.get("state", "running")
        return {"status": "ok"}
    return {"status": "not_found"}

@app.post("/api/send_burst")
def send_burst(body: dict = {}):
    count = body.get("count", 5)
    for _ in range(count):
        create_process()
    return {"status": "burst_sent", "injected": count}

@app.post("/api/inject/deadlock")
def inject_deadlock():
    pids = list(state["processes"].keys())
    if len(pids) < 3:
        return {"status": "error", "detail": "Need at least 3 processes"}
    nodes = pids[:3]
    for pid in nodes:
        state["processes"][pid]["state"] = "blocked"
    state["metrics"]["deadlock_detected"] = True
    state["metrics"]["deadlock_nodes"]    = nodes
    return {"status": "ok", "nodes": nodes}

@app.post("/api/inject/clear")
def clear_deadlock():
    state["metrics"]["deadlock_detected"] = False
    state["metrics"]["deadlock_nodes"]    = []
    for proc in state["processes"].values():
        if proc["state"] == "blocked":
            proc["state"] = "running"
    return {"status": "ok"}

# ─────────────────────────────────────────────
# WEBSOCKET
# ─────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await asyncio.sleep(1)
            data = {
                "type":        "state_update",
                "processes":   state["processes"],
                "connections": state["connections"],
                "metrics":     state["metrics"],
                "logs":        list(state["logs"]),
                "messages":    list(state["messages"]),
            }
            await websocket.send_text(json.dumps(data))
    except WebSocketDisconnect:
        print("Client disconnected")