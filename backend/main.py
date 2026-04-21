from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import asyncio
import os
import random
import time
import threading
from collections import deque
import json

app = FastAPI(title="IPC Debugger Pro")

# ───────────── STATIC ─────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "../frontend")

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
async def index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

# ───────────── CONNECTION MANAGER ─────────────

class WSManager:
    def __init__(self):
        self.clients = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.clients.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.clients:
            self.clients.remove(ws)

    async def broadcast(self, data):
        dead = []
        for c in self.clients:
            try:
                await c.send_text(data)
            except:
                dead.append(c)
        for d in dead:
            self.disconnect(d)

manager = WSManager()

# ───────────── CORE ENGINE ─────────────

class Engine:
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

    def spawn(self):
        pid = str(random.randint(1000, 9999))
        self.processes[pid] = {
            "pid": pid,
            "name": f"Node-{pid}",
            "state": random.choice(["running", "waiting", "blocked"]),
            "ipc_type": random.choice(["pipe", "queue", "shared_memory"]),
            "cpu_percent": random.uniform(5, 70),
            "memory_bytes": random.randint(1_000_000, 6_000_000),
            "created_at": time.time(),
            "messages_sent": 0,
            "messages_received": 0,
            "buffer_usage": random.random()
        }

    def step(self):
        if len(self.processes) < 5:
            self.spawn()

        pids = list(self.processes.keys())

        # rebuild connections (graph style)
        self.connections = []
        for i in range(len(pids) - 1):
            self.connections.append({
                "source": pids[i],
                "target": pids[i+1],
                "ipc_type": random.choice(["pipe", "queue", "shared_memory"])
            })

        # simulate message
        if len(pids) > 1:
            s, t = random.sample(pids, 2)
            latency = round(random.uniform(0.2, 2.0), 2)

            self.messages.append({
                "source": s,
                "target": t,
                "size_bytes": random.randint(100, 1000),
                "latency_ms": latency,
                "timestamp": time.time()
            })

            self.processes[s]["messages_sent"] += 1
            self.processes[t]["messages_received"] += 1

        # fluctuate cpu/memory
        for p in self.processes.values():
            p["cpu_percent"] = max(0, min(100, p["cpu_percent"] + random.uniform(-4, 4)))
            p["memory_bytes"] += random.randint(-50000, 50000)

        # logs
        self.logs.append({
            "timestamp": time.time(),
            "level": "info",
            "message": "tick"
        })

        # metrics
        self.metrics["active_processes"] = len(self.processes)
        self.metrics["messages_per_sec"] = random.uniform(2, 9)
        self.metrics["avg_latency_ms"] = random.uniform(0.5, 1.5)
        self.metrics["throughput_kbps"] = random.uniform(30, 120)

engine = Engine()

# ───────────── BACKGROUND LOOP ─────────────

def run_engine():
    while True:
        engine.step()
        time.sleep(1)

threading.Thread(target=run_engine, daemon=True).start()

# ───────────── API ─────────────

@app.get("/api/state")
def state():
    return {
        "processes": engine.processes,
        "connections": engine.connections,
        "logs": list(engine.logs),
        "messages": list(engine.messages),
        "metrics": engine.metrics
    }

@app.post("/api/process/create")
def create():
    engine.spawn()
    return {"status": "ok"}

# ───────────── WEBSOCKET ─────────────

@app.websocket("/ws")
async def websocket(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await asyncio.sleep(1)
            await manager.broadcast(json.dumps({
                "type": "state_update",
                "processes": engine.processes,
                "connections": engine.connections,
                "metrics": engine.metrics,
                "logs": list(engine.logs),
                "messages": list(engine.messages)
            }))
    except WebSocketDisconnect:
        manager.disconnect(ws)