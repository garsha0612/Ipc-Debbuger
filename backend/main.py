from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import asyncio
import os
import random
import time
import json

app = FastAPI(title="IPC Async Actor Engine")

# ───────────── STATIC ─────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "../frontend")

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
async def index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

# ───────────── ACTOR MODEL ─────────────

class ProcessActor:
    def __init__(self, pid):
        self.pid = pid
        self.name = f"Actor-{pid}"
        self.state = "running"
        self.ipc_type = random.choice(["pipe", "queue", "shared_memory"])
        self.cpu = random.uniform(5, 50)
        self.mem = random.randint(1_000_000, 5_000_000)
        self.created_at = time.time()
        self.sent = 0
        self.recv = 0
        self.buffer = random.random()

    def tick(self):
        self.cpu = max(0, min(100, self.cpu + random.uniform(-3, 3)))
        self.mem += random.randint(-10000, 10000)
        self.state = random.choice(["running", "waiting", "blocked"])

    def to_dict(self):
        return {
            "pid": self.pid,
            "name": self.name,
            "state": self.state,
            "ipc_type": self.ipc_type,
            "cpu_percent": round(self.cpu, 2),
            "memory_bytes": self.mem,
            "created_at": self.created_at,
            "messages_sent": self.sent,
            "messages_received": self.recv,
            "buffer_usage": self.buffer
        }

# ───────────── ENGINE ─────────────

class AsyncEngine:
    def __init__(self):
        self.actors = {}
        self.logs = []
        self.messages = []
        self.connections = []
        self.metrics = {}

    def spawn(self):
        pid = str(random.randint(1000, 9999))
        self.actors[pid] = ProcessActor(pid)

    def step(self):
        if len(self.actors) < 6:
            self.spawn()

        ids = list(self.actors.keys())

        # update actors
        for a in self.actors.values():
            a.tick()

        # connections
        self.connections = [
            {
                "source": ids[i],
                "target": ids[(i+1) % len(ids)],
                "ipc_type": random.choice(["pipe", "queue", "shared_memory"])
            }
            for i in range(len(ids))
        ]

        # messages
        if len(ids) > 1:
            a, b = random.sample(ids, 2)
            msg = {
                "source": a,
                "target": b,
                "size_bytes": random.randint(100, 1000),
                "latency_ms": round(random.uniform(0.2, 2.0), 2),
                "timestamp": time.time()
            }
            self.messages.append(msg)

            self.actors[a].sent += 1
            self.actors[b].recv += 1

        # logs
        self.logs.append({
            "timestamp": time.time(),
            "level": "info",
            "message": "engine tick"
        })

        # metrics
        self.metrics = {
            "messages_per_sec": random.uniform(1, 10),
            "avg_latency_ms": random.uniform(0.5, 1.5),
            "throughput_kbps": random.uniform(20, 100),
            "active_processes": len(self.actors)
        }

    def snapshot(self):
        return {
            "processes": {k: v.to_dict() for k, v in self.actors.items()},
            "connections": self.connections,
            "logs": self.logs[-50:],
            "messages": self.messages[-50:],
            "metrics": self.metrics
        }

engine = AsyncEngine()

# ───────────── ASYNC LOOP ─────────────

async def run_loop():
    while True:
        engine.step()
        await asyncio.sleep(1)

@app.on_event("startup")
async def startup():
    asyncio.create_task(run_loop())

# ───────────── API ─────────────

@app.get("/api/state")
async def get_state():
    return engine.snapshot()

# ───────────── WEBSOCKET ─────────────

clients = []

@app.websocket("/ws")
async def ws(socket: WebSocket):
    await socket.accept()
    clients.append(socket)

    try:
        while True:
            await asyncio.sleep(1)
            data = json.dumps({
                "type": "state_update",
                **engine.snapshot()
            })
            await socket.send_text(data)
    except:
        clients.remove(socket)