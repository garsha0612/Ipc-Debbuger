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
        "messages_per_sec": 0,
        "avg_latency_ms": 0,
        "throughput_kbps": 0,
        "active_processes": 0,
    }
}

# ─────────────────────────────────────────────
# CREATE PROCESS (FIXED FOR FRONTEND)
# ─────────────────────────────────────────────

def create_process():
    pid = str(random.randint(1000, 9999))
    state["processes"][pid] = {
        "pid": pid,
        "name": f"Process-{pid}",
        "state": random.choice(["running", "waiting", "blocked"]),
        "ipc_type": random.choice(["pipe", "queue", "shared_memory"]),

        # ✅ FRONTEND EXPECTED FIELDS
        "cpu_percent": round(random.uniform(5, 50), 2),
        "memory_bytes": random.randint(500000, 5000000),

        "messages_sent": 0,
        "messages_received": 0,
        "buffer_usage": random.random()
    }

# ─────────────────────────────────────────────
# SIMULATION
# ─────────────────────────────────────────────

def simulate():
    while True:
        if len(state["processes"]) < 5:
            create_process()

        pids = list(state["processes"].keys())

        # ✅ CONNECTIONS
        state["connections"] = []
        for i in range(len(pids) - 1):
            state["connections"].append({
                "source": pids[i],
                "target": pids[i+1],
                "ipc_type": random.choice(["pipe", "queue", "shared_memory"])
            })

        # messages
        if len(pids) >= 2:
            src, dst = random.sample(pids, 2)

            state["messages"].append({
                "source": src,
                "target": dst,
                "size_bytes": random.randint(100, 1000),
                "latency_ms": round(random.uniform(0.1, 2.0), 2),
                "timestamp": time.time()
            })

            state["processes"][src]["messages_sent"] += 1
            state["processes"][dst]["messages_received"] += 1

        # logs (FIXED timestamp)
        state["logs"].append({
            "timestamp": time.time(),
            "level": "info",
            "message": "Simulation running"
        })

        # metrics
        state["metrics"]["active_processes"] = len(state["processes"])
        state["metrics"]["messages_per_sec"] = round(random.uniform(1, 10), 2)

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
        "processes": state["processes"],
        "connections": state["connections"],
        "logs": list(state["logs"]),
        "messages": list(state["messages"]),
        "metrics": state["metrics"]
    }

@app.post("/api/process/create")
def api_create_process():
    create_process()
    return {"status": "created"}

@app.post("/api/send_burst")
def send_burst():
    for _ in range(5):
        create_process()
    return {"status": "burst_sent"}

@app.post("/api/inject/deadlock")
def deadlock():
    return {"status": "deadlock_simulated"}

# ─────────────────────────────────────────────
# WEBSOCKET (FINAL FIX)
# ─────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    try:
        while True:
            await asyncio.sleep(1)

            data = {
                "type": "state_update",
                "processes": state["processes"],
                "connections": state["connections"],
                "metrics": state["metrics"],
                "logs": list(state["logs"]),
                "messages": list(state["messages"]),
            }

            # ✅ send as TEXT (frontend compatible)
            await websocket.send_text(json.dumps(data))

    except WebSocketDisconnect:
        print("Client disconnected")