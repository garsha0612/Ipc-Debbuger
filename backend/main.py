from fastapi import FastAPI
from fastapi.responses import JSONResponse
import random
import time
import asyncio
from typing import List, Dict

app = FastAPI(title="Process Monitoring System")

# -----------------------------
# Fake Process Database
# -----------------------------

process_store: List[Dict] = []

states = ["running", "waiting", "blocked", "terminated"]
services = ["Database", "Auth", "Cache", "Scheduler", "Worker"]


def generate_process():
    pid = random.randint(1000, 9999)

    return {
        "pid": pid,
        "service_name": random.choice(services),
        "state": random.choice(states),
        "cpu_usage": round(random.uniform(5, 95), 2),
        "memory_usage_mb": random.randint(100, 4000),
        "threads": random.randint(1, 20),
        "created_at": time.time(),
        "last_updated": time.time()
    }


def refresh_processes():
    global process_store

    if len(process_store) < 5:
        for _ in range(3):
            process_store.append(generate_process())

    for process in process_store:
        process["cpu_usage"] = round(
            max(0, min(100, process["cpu_usage"] + random.uniform(-10, 10))), 2
        )
        process["memory_usage_mb"] += random.randint(-50, 50)
        process["state"] = random.choice(states)
        process["last_updated"] = time.time()


def get_system_metrics():
    total_cpu = sum(p["cpu_usage"] for p in process_store)
    total_memory = sum(p["memory_usage_mb"] for p in process_store)

    return {
        "total_processes": len(process_store),
        "avg_cpu_usage": round(total_cpu / max(1, len(process_store)), 2),
        "total_memory_mb": total_memory,
        "healthy": total_cpu < 400
    }


# -----------------------------
# Background Auto Refresh
# -----------------------------

async def auto_refresh():
    while True:
        refresh_processes()
        await asyncio.sleep(2)


@app.on_event("startup")
async def startup_event():
    asyncio.create_task(auto_refresh())


# -----------------------------
# Routes
# -----------------------------

@app.get("/")
def home():
    return {
        "message": "Process Monitoring System Running"
    }


@app.get("/api/processes")
def get_processes():
    return JSONResponse(content={
        "status": "success",
        "data": process_store
    })


@app.get("/api/metrics")
def metrics():
    return JSONResponse(content={
        "status": "success",
        "metrics": get_system_metrics()
    })


@app.post("/api/process/create")
def create_process():
    new_process = generate_process()
    process_store.append(new_process)

    return {
        "status": "created",
        "process": new_process
    }


@app.delete("/api/process/{pid}")
def delete_process(pid: int):
    global process_store

    before = len(process_store)
    process_store = [p for p in process_store if p["pid"] != pid]

    if len(process_store) == before:
        return {
            "status": "not_found",
            "message": f"Process {pid} not found"
        }

    return {
        "status": "deleted",
        "pid": pid
    }


@app.get("/api/process/{pid}")
def process_detail(pid: int):
    for process in process_store:
        if process["pid"] == pid:
            return {
                "status": "success",
                "process": process
            }

    return {
        "status": "not_found",
        "message": f"Process {pid} not found"
    }