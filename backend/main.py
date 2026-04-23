from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dataclasses import dataclass, asdict
import os
import random
import time
import asyncio
from typing import Dict, List

app = FastAPI(title="IPC Polling Engine")

# ───────────── STATIC ─────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "../frontend")

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
async def index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

# ───────────── DATA MODELS ─────────────

@dataclass
class Process:
    pid: str
    name: str
    state: str
    ipc_type: str
    cpu_percent: float
    memory_bytes: int
    created_at: float
    messages_sent: int
    messages_received: int
    buffer_usage: float

@dataclass
class Message:
    source: str
    target: str
    size_bytes: int
    latency_ms: float
    timestamp: float

# ───────────── ENGINE ─────────────

class PollingEngine:
    def __init__(self):
        self.processes: Dict[str, Process] = {}
        self.messages: List[Message] = []
        self.connections = []
        self.logs = []
        self.metrics = {}

    def spawn(self):
        pid = str(random.randint(1000, 9999))
        self.processes[pid] = Process(
            pid=pid,
            name=f"Proc-{pid}",
            state=random.choice(["running", "waiting", "blocked"]),
            ipc_type=random.choice(["pipe", "queue", "shared_memory"]),
            cpu_percent=random.uniform(5, 60),
            memory_bytes=random.randint(1_000_000, 6_000_000),
            created_at=time.time(),
            messages_sent=0,
            messages_received=0,
            buffer_usage=random.random()
        )

    def simulate_step(self):
        if len(self.processes) < 5:
            self.spawn()

        pids = list(self.processes.keys())

        # update processes
        for p in self.processes.values():
            p.cpu_percent = max(0, min(100, p.cpu_percent + random.uniform(-2, 2)))
            p.memory_bytes += random.randint(-10000, 10000)
            p.state = random.choice(["running", "waiting", "blocked"])

        # connections
        self.connections = []
        for i in range(len(pids) - 1):
            self.connections.append({
                "source": pids[i],
                "target": pids[i+1],
                "ipc_type": random.choice(["pipe", "queue", "shared_memory"])
            })

        # message
        if len(pids) > 1:
            a, b = random.sample(pids, 2)
            msg = Message(
                source=a,
                target=b,
                size_bytes=random.randint(100, 1000),
                latency_ms=random.uniform(0.2, 2.0),
                timestamp=time.time()
            )
            self.messages.append(msg)

            self.processes[a].messages_sent += 1
            self.processes[b].messages_received += 1

        # logs
        self.logs.append({
            "timestamp": time.time(),
            "level": "info",
            "message": "step executed"
        })

        # metrics
        self.metrics = {
            "messages_per_sec": random.uniform(1, 10),
            "avg_latency_ms": random.uniform(0.5, 1.5),
            "throughput_kbps": random.uniform(20, 100),
            "active_processes": len(self.processes)
        }

    def snapshot(self):
        return {
            "processes": {k: asdict(v) for k, v in self.processes.items()},
            "connections": self.connections,
            "messages": [asdict(m) for m in self.messages[-50:]],
            "logs": self.logs[-50:],
            "metrics": self.metrics
        }

engine = PollingEngine()

# ───────────── SCHEDULER LOOP ─────────────

async def scheduler():
    while True:
        engine.simulate_step()
        await asyncio.sleep(1)

@app.on_event("startup")
async def start_scheduler():
    asyncio.create_task(scheduler())

# ───────────── API ─────────────

@app.get("/api/state")
async def get_state():
    return engine.snapshot()

@app.post("/api/process/create")
async def create():
    engine.spawn()
    return {"status": "created"}

@app.post("/api/reset")
async def reset():
    engine.processes.clear()
    engine.messages.clear()
    engine.logs.clear()
    return {"status": "reset"}