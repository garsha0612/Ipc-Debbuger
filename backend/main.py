from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import asyncio
import os
import random
import time
import threading
from collections import deque
import json

app = FastAPI(title="IPC Debugger v2")

# ─────────────── STATIC ───────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "../frontend")

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
async def serve():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

# ─────────────── STATE CLASS ───────────────

class IPCState:
    def __init__(self):
        self.processes = {}
        self.connections = []
        self.logs = deque(maxlen=200)
        self.messages = deque(maxlen=200)
        self.metrics = {
            "messages_per_sec": 0,
            "avg_latency_ms": 0,
            "throughput_kbps": 0,
            "active_processes": 0
        }

    def add_log(self, msg, level="info"):
        self.logs.append({
            "timestamp": time.time(),
            "level": level,
            "message": msg
        })

state = IPCState()

# ─────────────── PROCESS ENGINE ───────────────

def new_process():
    pid = str(random.randint(1000, 9999))
    state.processes[pid] = {
        "pid": pid,
        "name": f"P-{pid}",
        "state": "running",
        "ipc_type": random.choice(["pipe", "queue", "shared_memory"]),
        "cpu_percent": round(random.uniform(10, 60), 2),
        "memory_bytes": random.randint(1_000_000, 5_000_000),
        "created_at": time.time(),
        "messages_sent": 0,
        "messages_received": 0,
        "buffer_usage": random.random()
    }

# ─────────────── SIMULATION LOOP ───────────────

def engine():
    while True:
        if len(state.processes) < 6:
            new_process()

        pids = list(state.processes.keys())

        # connections
        state.connections = [
            {
                "source": pids[i],
                "target": pids[(i + 1) % len(pids)],
                "ipc_type": random.choice(["pipe", "queue", "shared_memory"])
            }
            for i in range(len(pids))
        ]

        # messages
        if len(pids) > 1:
            a, b = random.sample(pids, 2)
            size = random.randint(100, 1200)
            latency = round(random.uniform(0.2, 2.5), 2)

            state.messages.append({
                "source": a,
                "target": b,
                "size_bytes": size,
                "latency_ms": latency,
                "timestamp": time.time()
            })

            state.processes[a]["messages_sent"] += 1
            state.processes[b]["messages_received"] += 1

        # update cpu & memory
        for p in state.processes.values():
            p["cpu_percent"] = max(0, min(100, p["cpu_percent"] + random.uniform(-3, 3)))
            p["memory_bytes"] += random.randint(-20000, 20000)

        # metrics
        state.metrics["active_processes"] = len(state.processes)
        state.metrics["messages_per_sec"] = round(random.uniform(2, 8), 2)
        state.metrics["avg_latency_ms"] = round(random.uniform(0.5, 1.8), 2)
        state.metrics["throughput_kbps"] = round(random.uniform(20, 120), 2)

        state.add_log("Engine tick")

        time.sleep(1)

# start engine
for _ in range(3):
    new_process()

threading.Thread(target=engine, daemon=True).start()

# ─────────────── API ───────────────

@app.get("/api/state")
def get_state():
    return {
        "processes": state.processes,
        "connections": state.connections,
        "logs": list(state.logs),
        "messages": list(state.messages),
        "metrics": state.metrics
    }

@app.post("/api/process/create")
def create():
    new_process()
    return {"ok": True}

@app.post("/api/clear")
def clear():
    state.processes.clear()
    state.connections.clear()
    return {"cleared": True}

# ─────────────── WEBSOCKET ───────────────

@app.websocket("/ws")
async def ws(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            await asyncio.sleep(1)
            await ws.send_text(json.dumps({
                "type": "state_update",
                "processes": state.processes,
                "connections": state.connections,
                "metrics": state.metrics,
                "logs": list(state.logs),
                "messages": list(state.messages)
            }))
    except:
        pass