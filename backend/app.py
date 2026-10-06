import os
import csv
import time
import signal
import subprocess
from datetime import datetime
from decimal import Decimal
from flask import Flask, jsonify, request, send_from_directory
import mysql.connector

# ------------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------------
DB_HOST     = os.environ.get("DB_HOST", "localhost")
DB_USER     = os.environ.get("DB_USER", "root")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "root")
DB_NAME     = os.environ.get("DB_NAME", "process_monitor")

BASE_DIR     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENT_FILE   = os.path.join(BASE_DIR, "process_events.csv")
SIGNAL_FILE  = os.path.join(BASE_DIR, "signal_request.txt")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR)

from flask.json.provider import DefaultJSONProvider

class DecimalJsonProvider(DefaultJSONProvider):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o)
        if isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)

app.json_provider_class = DecimalJsonProvider
app.json = DecimalJsonProvider(app)

processed_event_count = 0
current_run_id = None
active_c_process = None

def get_db_connection():
    return mysql.connector.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME
    )

def init_db():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                run_id INT AUTO_INCREMENT PRIMARY KEY,
                parent_pid INT NOT NULL,
                start_time DATETIME NOT NULL,
                end_time DATETIME NULL,
                total_processes INT NOT NULL DEFAULT 100,
                completed_processes INT NOT NULL DEFAULT 0,
                signal_terminated INT NOT NULL DEFAULT 0,
                failed_processes INT NOT NULL DEFAULT 0,
                status VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
                duration_pattern VARCHAR(20) NOT NULL DEFAULT 'mixed'
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS processes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                run_id INT NOT NULL,
                process_no INT NOT NULL,
                pid INT NOT NULL,
                parent_pid INT NOT NULL,
                status VARCHAR(50) NOT NULL,
                duration INT NOT NULL,
                start_time DATETIME NULL,
                end_time DATETIME NULL,
                termination_type VARCHAR(20) NOT NULL DEFAULT 'NONE',
                signal_number INT NOT NULL DEFAULT 0,
                signal_name VARCHAR(20) NOT NULL DEFAULT 'NONE',
                termination_message TEXT NULL,
                reaped TINYINT(1) NOT NULL DEFAULT 0,
                reaped_time DATETIME NULL,
                command VARCHAR(255) NULL,
                peak_memory_mb FLOAT DEFAULT 0.0,
                cpu_time_sec FLOAT DEFAULT 0.0,
                stdout_log TEXT NULL,
                stderr_log TEXT NULL,
                UNIQUE KEY unique_run_process (run_id, process_no)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS process_events (
                event_id INT AUTO_INCREMENT PRIMARY KEY,
                run_id INT NOT NULL,
                process_no INT NULL,
                pid INT NULL,
                event_type VARCHAR(30) NOT NULL,
                event_time DATETIME NOT NULL,
                message TEXT NULL
            )
        """)

        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[init_db] Warning: {e}")

def sync_events_to_db():
    global processed_event_count, current_run_id

    if not os.path.exists(EVENT_FILE):
        return

    try:
        with open(EVENT_FILE, "r", newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            rows = [r for r in reader if r and any(cell.strip() for cell in r)]
    except Exception:
        return

    if len(rows) < processed_event_count:
        processed_event_count = 0

    if len(rows) == processed_event_count:
        return

    new_rows = rows[processed_event_count:]
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    try:
        if current_run_id is None:
            cursor.execute("SELECT run_id FROM runs ORDER BY run_id DESC LIMIT 1")
            last_run = cursor.fetchone()
            if last_run:
                current_run_id = last_run["run_id"]

        for row in new_rows:
            if not row or not row[0].strip():
                continue

            event_type = row[0].strip().upper()
            now = datetime.now()

            if event_type == "START_RUN":
                run_ts     = row[1].strip() if len(row) > 1 else ""
                parent_pid = int(row[2]) if len(row) > 2 and row[2].strip() else 0
                total_proc = int(row[3]) if len(row) > 3 and row[3].strip() else 100
                pattern    = row[4].strip() if len(row) > 4 and row[4].strip() else "mixed"

                cursor.execute("""
                    INSERT INTO runs (parent_pid, start_time, total_processes, status, duration_pattern)
                    VALUES (%s, %s, %s, 'RUNNING', %s)
                """, (parent_pid, now, total_proc, pattern))
                current_run_id = cursor.lastrowid

                cursor.execute("""
                    INSERT INTO process_events (run_id, process_no, pid, event_type, event_time, message)
                    VALUES (%s, NULL, %s, 'START_RUN', %s, %s)
                """, (current_run_id, parent_pid, now, f"Parent process PID {parent_pid} initiated run #{current_run_id} ({total_proc} processes, '{pattern}')"))

            elif event_type == "CREATE" and len(row) >= 4:
                if current_run_id is None:
                    cursor.execute("INSERT INTO runs (parent_pid, start_time, status) VALUES (0, %s, 'RUNNING')", (now,))
                    current_run_id = cursor.lastrowid

                process_no = int(row[1])
                pid        = int(row[2])
                duration   = int(row[3])
                parent_pid = int(row[4]) if len(row) > 4 and row[4].strip() else 0

                cursor.execute("""
                    INSERT INTO processes (run_id, process_no, pid, parent_pid, status, duration, start_time, termination_type)
                    VALUES (%s, %s, %s, %s, 'RUNNING', %s, %s, 'NONE')
                    ON DUPLICATE KEY UPDATE pid=VALUES(pid), status='RUNNING', duration=VALUES(duration)
                """, (current_run_id, process_no, pid, parent_pid, duration, now))

                cursor.execute("""
                    INSERT INTO process_events (run_id, process_no, pid, event_type, event_time, message)
                    VALUES (%s, %s, %s, 'CREATE', %s, %s)
                """, (current_run_id, process_no, pid, now, f"Process {process_no} (PID {pid}) created by parent PID {parent_pid} (duration {duration}s)"))

            elif event_type == "SIGNAL" and len(row) >= 4:
                process_no = int(row[1])
                pid        = int(row[2])
                sig_num    = int(row[3]) if len(row) > 3 and row[3].strip() else 15
                sig_name   = row[4].strip() if len(row) > 4 and row[4].strip() else "SIGTERM"
                msg        = row[5].strip() if len(row) > 5 and row[5].strip() else f"Parent delivered {sig_name} to Process {process_no}"

                cursor.execute("""
                    INSERT INTO process_events (run_id, process_no, pid, event_type, event_time, message)
                    VALUES (%s, %s, %s, 'SIGNAL', %s, %s)
                """, (current_run_id, process_no, pid, now, msg))

            elif event_type == "ZOMBIE" and len(row) >= 3:
                process_no = int(row[1])
                pid        = int(row[2])
                msg        = row[4].strip() if len(row) > 4 and row[4].strip() else "Process exited; parent delaying waitpid(); currently ZOMBIE"

                cursor.execute("""
                    UPDATE processes
                    SET status='ZOMBIE'
                    WHERE run_id=%s AND process_no=%s
                """, (current_run_id, process_no))

                cursor.execute("""
                    INSERT INTO process_events (run_id, process_no, pid, event_type, event_time, message)
                    VALUES (%s, %s, %s, 'ZOMBIE', %s, %s)
                """, (current_run_id, process_no, pid, now, msg))

            elif event_type == "COMPLETE" and len(row) >= 5:
                process_no = int(row[1])
                pid        = int(row[2])
                msg        = row[4].strip()
                term_type  = row[5].strip() if len(row) > 5 and row[5].strip() else "NORMAL"
                sig_num    = int(row[6]) if len(row) > 6 and row[6].strip() else 0
                sig_name   = row[7].strip() if len(row) > 7 and row[7].strip() else "NONE"

                cursor.execute("""
                    UPDATE processes
                    SET status='TERMINATED', end_time=%s, termination_type=%s, signal_number=%s, signal_name=%s, termination_message=%s
                    WHERE run_id=%s AND process_no=%s
                """, (now, term_type, sig_num, sig_name, msg, current_run_id, process_no))

                cursor.execute("""
                    INSERT INTO process_events (run_id, process_no, pid, event_type, event_time, message)
                    VALUES (%s, %s, %s, 'COMPLETE', %s, %s)
                """, (current_run_id, process_no, pid, now, msg))

            elif event_type == "REAPED" and len(row) >= 3:
                process_no = int(row[1])
                pid        = int(row[2])
                msg        = row[4].strip() if len(row) > 4 and row[4].strip() else f"Parent reaped PID {pid} via waitpid()"

                cursor.execute("""
                    UPDATE processes
                    SET status='REAPED', reaped=1, reaped_time=%s
                    WHERE run_id=%s AND process_no=%s
                """, (now, current_run_id, process_no))

                cursor.execute("""
                    INSERT INTO process_events (run_id, process_no, pid, event_type, event_time, message)
                    VALUES (%s, %s, %s, 'REAPED', %s, %s)
                """, (current_run_id, process_no, pid, now, msg))

            elif event_type == "END_RUN":
                normal_cnt = int(row[4]) if len(row) > 4 and row[4].strip() else 0
                signal_cnt = int(row[5]) if len(row) > 5 and row[5].strip() else 0
                if current_run_id:
                    cursor.execute("""
                        UPDATE runs 
                        SET status='COMPLETED', end_time=%s, completed_processes=%s, signal_terminated=%s 
                        WHERE run_id=%s
                    """, (now, normal_cnt, signal_cnt, current_run_id))

                    cursor.execute("""
                        INSERT INTO process_events (run_id, process_no, pid, event_type, event_time, message)
                        VALUES (%s, NULL, NULL, 'END_RUN', %s, %s)
                    """, (current_run_id, now, f"Run #{current_run_id} completed: all processes reaped (Normal: {normal_cnt}, Signaled: {signal_cnt})"))

        processed_event_count = len(rows)
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[sync_events_to_db] Error: {e}")
    finally:
        cursor.close()
        conn.close()

# ------------------------------------------------------------------------------
# Process Manager Subprocess Execution
# ------------------------------------------------------------------------------
def is_c_process_running():
    global active_c_process
    if active_c_process is not None:
        if active_c_process.poll() is None:
            return True
        else:
            active_c_process = None
    return False

def launch_c_process_manager(process_count=100, pattern="mixed", mode="normal"):
    global active_c_process, processed_event_count

    if is_c_process_running():
        return False, "A process manager run is currently active."

    # Clear signal file
    with open(SIGNAL_FILE, "w", encoding="utf-8") as sf:
        sf.write("")

    # Reset event reading counter for new run
    processed_event_count = 0

    if os.name == "nt":
        cmd = ["wsl", "./c_program/process_manager", str(process_count), str(pattern), str(mode)]
    else:
        cmd = ["./c_program/process_manager", str(process_count), str(pattern), str(mode)]

    try:
        log_path = os.path.join(BASE_DIR, "process_manager.log")
        log_fp = open(log_path, "w", encoding="utf-8")
        active_c_process = subprocess.Popen(
            cmd,
            cwd=BASE_DIR,
            stdout=log_fp,
            stderr=subprocess.STDOUT
        )
        return True, "Process run launched successfully."
    except Exception as e:
        return False, f"Failed to launch process manager: {str(e)}"

# ------------------------------------------------------------------------------
# Run Management APIs
# ------------------------------------------------------------------------------
@app.route("/api/run/start", methods=["POST"])
def api_run_start():
    data = request.get_json() or {}
    try:
        process_count = int(data.get("process_count", 100))
    except (TypeError, ValueError):
        return jsonify({"error": "Process count must be a whole number between 1 and 500."}), 400
    pattern = str(data.get("pattern", "mixed")).lower()
    mode = data.get("mode", "normal").lower()

    if process_count < 1 or process_count > 500:
        return jsonify({"error": "Process count must be between 1 and 500."}), 400

    if pattern not in ["short", "medium", "mixed"]:
        pattern = "mixed"

    if mode not in ["normal", "sigterm_demo", "sigkill_demo", "zombie_demo"]:
        mode = "normal"

    ok, msg = launch_c_process_manager(process_count, pattern, mode)
    if not ok:
        return jsonify({"error": msg}), 409

    # Wait briefly for process manager to initialize and emit START_RUN
    time.sleep(0.3)
    sync_events_to_db()

    return jsonify({
        "status": "STARTED",
        "message": msg,
        "process_count": process_count,
        "pattern": pattern,
        "mode": mode,
        "run_id": current_run_id
    }), 200

@app.route("/api/run/status", methods=["GET"])
def api_run_status():
    sync_events_to_db()
    is_running = is_c_process_running()

    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT * FROM runs ORDER BY run_id DESC LIMIT 1")
    latest = cur.fetchone()
    cur.close(); conn.close()

    return jsonify({
        "is_running": is_running,
        "active_run": latest
    })

@app.route("/api/run/stop", methods=["POST"])
def api_run_stop():
    global active_c_process
    if not is_c_process_running():
        return jsonify({"message": "No active process run found."}), 200

    try:
        active_c_process.terminate()
        time.sleep(0.2)
        if active_c_process.poll() is None:
            active_c_process.kill()
        active_c_process = None
        return jsonify({"status": "STOPPED", "message": "Process manager run terminated."}), 200
    except Exception as e:
        return jsonify({"error": f"Failed to stop run: {str(e)}"}), 500

# ------------------------------------------------------------------------------
# Signal Control API
# ------------------------------------------------------------------------------
@app.route("/api/processes/<int:process_no>/signal", methods=["POST"])
def api_process_signal(process_no):
    sync_events_to_db()
    data = request.get_json() or {}
    sig_input = data.get("signal", "SIGTERM").upper()

    sig_num = 15
    sig_name = "SIGTERM"
    if sig_input in ["SIGKILL", "9", 9]:
        sig_num = 9
        sig_name = "SIGKILL"
    elif sig_input in ["SIGTERM", "15", 15]:
        sig_num = 15
        sig_name = "SIGTERM"
    else:
        return jsonify({"error": "Unsupported signal. Only SIGTERM (15) and SIGKILL (9) are supported."}), 400

    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT run_id, status FROM runs ORDER BY run_id DESC LIMIT 1")
    latest_run = cur.fetchone()

    if not latest_run:
        cur.close(); conn.close()
        return jsonify({"error": "No active run detected."}), 404

    run_id = latest_run["run_id"]

    cur.execute("""
        SELECT process_no, pid, status, reaped 
        FROM processes 
        WHERE run_id = %s AND process_no = %s
    """, (run_id, process_no))
    proc = cur.fetchone()
    cur.close(); conn.close()

    if not proc:
        return jsonify({"error": f"Process {process_no} not found in run #{run_id}."}), 404

    if proc["reaped"] or proc["status"] in ["REAPED", "COMPLETED"]:
        return jsonify({"error": f"Process {process_no} (PID {proc['pid']}) is already reaped by parent."}), 400

    if proc["status"] == "TERMINATED":
        return jsonify({"error": f"Process {process_no} (PID {proc['pid']}) is already terminated, awaiting reaping."}), 400

    pid = proc["pid"]

    # Write command to signal_request.txt for C process manager
    try:
        with open(SIGNAL_FILE, "a", encoding="utf-8") as sf:
            sf.write(f"KILL,{process_no},{pid},{sig_num}\n")
    except Exception as e:
        return jsonify({"error": f"Failed to deliver signal request: {str(e)}"}), 500

    return jsonify({
        "status": "SIGNAL_SENT",
        "signal": sig_name,
        "signal_number": sig_num,
        "process_no": process_no,
        "pid": pid,
        "message": f"{sig_name} request queued for Process {process_no} (PID {pid})."
    }), 200

# ------------------------------------------------------------------------------
# Dashboard API Endpoints
# ------------------------------------------------------------------------------
@app.route("/api/processes", methods=["GET"])
def api_processes():
    sync_events_to_db()
    req_run_id = request.args.get("run_id")

    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    
    if req_run_id:
        target_run_id = int(req_run_id)
    else:
        cur.execute("SELECT run_id FROM runs ORDER BY run_id DESC LIMIT 1")
        latest = cur.fetchone()
        if not latest:
            cur.close(); conn.close()
            return jsonify([])
        target_run_id = latest["run_id"]
        
    cur.execute("SELECT * FROM processes WHERE run_id = %s ORDER BY process_no ASC", (target_run_id,))
    rows = cur.fetchall()
    cur.close(); conn.close()

    result = []
    for r in rows:
        result.append({
            "id": r["id"],
            "run_id": r["run_id"],
            "process_no": r["process_no"],
            "pid": r["pid"],
            "parent_pid": r["parent_pid"],
            "status": r["status"],
            "duration": r["duration"],
            "start_time": r["start_time"].isoformat() if r["start_time"] else None,
            "end_time": r["end_time"].isoformat() if r["end_time"] else None,
            "termination_type": r["termination_type"],
            "signal_number": r["signal_number"],
            "signal_name": r["signal_name"],
            "termination_message": r["termination_message"],
            "reaped": bool(r["reaped"]),
            "reaped_time": r["reaped_time"].isoformat() if r["reaped_time"] else None
        })
    return jsonify(result)

@app.route("/api/processes/<int:process_no>", methods=["GET"])
def api_process_detail(process_no):
    sync_events_to_db()
    req_run_id = request.args.get("run_id")

    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)

    if req_run_id:
        target_run_id = int(req_run_id)
    else:
        cur.execute("SELECT run_id FROM runs ORDER BY run_id DESC LIMIT 1")
        latest = cur.fetchone()
        if not latest:
            cur.close(); conn.close()
            return jsonify({"error": "No runs available."}), 404
        target_run_id = latest["run_id"]

    cur.execute("SELECT * FROM processes WHERE run_id = %s AND process_no = %s", (target_run_id, process_no))
    proc = cur.fetchone()

    if not proc:
        cur.close(); conn.close()
        return jsonify({"error": f"Process {process_no} not found."}), 404

    cur.execute("SELECT * FROM process_events WHERE run_id = %s AND (process_no = %s OR pid = %s) ORDER BY event_id ASC",
                (target_run_id, process_no, proc["pid"]))
    events = cur.fetchall()
    cur.close(); conn.close()

    proc["start_time"] = proc["start_time"].isoformat() if proc["start_time"] else None
    proc["end_time"] = proc["end_time"].isoformat() if proc["end_time"] else None
    proc["reaped_time"] = proc["reaped_time"].isoformat() if proc["reaped_time"] else None
    proc["reaped"] = bool(proc["reaped"])

    for ev in events:
        if ev["event_time"]:
            ev["event_time"] = ev["event_time"].isoformat()

    return jsonify({
        "process": proc,
        "events": events
    })

@app.route("/api/parent_sync", methods=["GET"])
def api_parent_sync():
    sync_events_to_db()
    req_run_id = request.args.get("run_id")

    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    
    if req_run_id:
        cur.execute("SELECT * FROM runs WHERE run_id = %s", (int(req_run_id),))
    else:
        cur.execute("SELECT * FROM runs ORDER BY run_id DESC LIMIT 1")
    run = cur.fetchone()

    if not run:
        cur.close(); conn.close()
        return jsonify({"status": "IDLE", "is_running": False})

    cur.execute("""
        SELECT 
            COUNT(*) as total_created, 
            SUM(CASE WHEN status='RUNNING' THEN 1 ELSE 0 END) as running_count, 
            SUM(CASE WHEN status='TERMINATED' THEN 1 ELSE 0 END) as terminated_count,
            SUM(CASE WHEN status='ZOMBIE' THEN 1 ELSE 0 END) as zombie_count,
            SUM(CASE WHEN reaped=1 THEN 1 ELSE 0 END) as reaped_count 
        FROM processes 
        WHERE run_id=%s
    """, (run["run_id"],))
    stats = cur.fetchone()
    cur.close(); conn.close()

    total = int(run["total_processes"] or 100)
    reaped = int(stats["reaped_count"] or 0)
    running = int(stats["running_count"] or 0)
    pct = round((reaped / total * 100.0), 1) if total > 0 else 0.0

    return jsonify({
        "run_id": run["run_id"],
        "parent_pid": run["parent_pid"],
        "total_children": total,
        "created": int(stats["total_created"] or 0),
        "running": running,
        "terminated_unreaped": int(stats["terminated_count"] or 0),
        "zombie": int(stats["zombie_count"] or 0),
        "reaped_by_parent": reaped,
        "remaining": max(0, total - reaped),
        "progress_ratio": f"{reaped} / {total}",
        "progress_percentage": pct,
        "status": run["status"],
        "duration_pattern": run["duration_pattern"],
        "start_time": run["start_time"].isoformat() if run["start_time"] else None,
        "end_time": run["end_time"].isoformat() if run["end_time"] else None,
        "is_running": is_c_process_running()
    })

@app.route("/api/events", methods=["GET"])
def api_events():
    sync_events_to_db()
    limit = int(request.args.get("limit", 150))
    req_run_id = request.args.get("run_id")
    req_pid = request.args.get("pid")

    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)

    if req_run_id:
        target_run_id = int(req_run_id)
    else:
        cur.execute("SELECT run_id FROM runs ORDER BY run_id DESC LIMIT 1")
        latest = cur.fetchone()
        if not latest:
            cur.close(); conn.close()
            return jsonify([])
        target_run_id = latest["run_id"]

    query = "SELECT * FROM process_events WHERE run_id=%s"
    params = [target_run_id]

    if req_pid:
        query += " AND pid=%s"
        params.append(int(req_pid))

    query += " ORDER BY event_id DESC LIMIT %s"
    params.append(limit)

    cur.execute(query, tuple(params))
    events = cur.fetchall()
    cur.close(); conn.close()
    events.reverse()
    
    for ev in events:
        if ev["event_time"]:
            ev["event_time"] = ev["event_time"].isoformat()
    return jsonify(events)

@app.route("/api/statistics", methods=["GET"])
def api_statistics():
    sync_events_to_db()
    req_run_id = request.args.get("run_id")

    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)

    if req_run_id:
        cur.execute("SELECT * FROM runs WHERE run_id = %s", (int(req_run_id),))
    else:
        cur.execute("SELECT * FROM runs ORDER BY run_id DESC LIMIT 1")
    run = cur.fetchone()

    if not run:
        cur.close(); conn.close()
        return jsonify({})

    target_run_id = run["run_id"]

    cur.execute("""
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status='RUNNING' THEN 1 ELSE 0 END) as running,
            SUM(CASE WHEN reaped=1 THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN termination_type='SIGNAL' THEN 1 ELSE 0 END) as signal_terminated,
            SUM(CASE WHEN termination_type='NORMAL' THEN 1 ELSE 0 END) as normal_terminated,
            SUM(CASE WHEN signal_name='SIGTERM' THEN 1 ELSE 0 END) as sigterm_count,
            SUM(CASE WHEN signal_name='SIGKILL' THEN 1 ELSE 0 END) as sigkill_count,
            AVG(duration) as avg_duration, MIN(duration) as min_duration, MAX(duration) as max_duration
        FROM processes WHERE run_id=%s
    """, (target_run_id,))
    agg = cur.fetchone()

    # Duration distribution histogram
    cur.execute("""
        SELECT duration, COUNT(*) as cnt 
        FROM processes 
        WHERE run_id=%s 
        GROUP BY duration 
        ORDER BY duration ASC
    """, (target_run_id,))
    dist_rows = cur.fetchall()

    cur.close(); conn.close()

    total_proc = int(agg["total"] or 0)
    completed_proc = int(agg["completed"] or 0)
    sig_term = int(agg["signal_terminated"] or 0)
    normal_term = int(agg["normal_terminated"] or 0)

    sig_rate = round((sig_term / total_proc * 100.0), 1) if total_proc > 0 else 0.0

    duration_dist = {str(r["duration"]): int(r["cnt"]) for r in dist_rows}

    # Calculate run elapsed time
    run_duration_sec = 0
    if run["start_time"] and run["end_time"]:
        run_duration_sec = int((run["end_time"] - run["start_time"]).total_seconds())

    return jsonify({
        "run_id": target_run_id,
        "parent_pid": run["parent_pid"],
        "status": run["status"],
        "duration_pattern": run["duration_pattern"],
        "total_processes": total_proc,
        "running": int(agg["running"] or 0),
        "completed": completed_proc,
        "signal_terminated": sig_term,
        "normal_terminated": normal_term,
        "sigterm_count": int(agg["sigterm_count"] or 0),
        "sigkill_count": int(agg["sigkill_count"] or 0),
        "signal_rate": sig_rate,
        "remaining": max(0, total_proc - completed_proc),
        "avg_duration": round(float(agg["avg_duration"] or 0.0), 1),
        "min_duration": int(agg["min_duration"] or 0),
        "max_duration": int(agg["max_duration"] or 0),
        "run_duration_sec": run_duration_sec,
        "duration_distribution": duration_dist
    })

@app.route("/api/runs", methods=["GET"])
def api_runs():
    sync_events_to_db()
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute("""
        SELECT r.*,
               TIMESTAMPDIFF(SECOND, r.start_time, r.end_time) as elapsed_sec
        FROM runs r 
        ORDER BY r.run_id DESC
    """)
    runs = cur.fetchall()
    cur.close(); conn.close()
    for r in runs:
        if r["start_time"]: r["start_time"] = r["start_time"].isoformat()
        if r["end_time"]: r["end_time"] = r["end_time"].isoformat()
    return jsonify(runs)

@app.route("/api/runs/<int:run_id>", methods=["GET"])
def api_run_detail(run_id):
    sync_events_to_db()
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute("""
        SELECT r.*,
               TIMESTAMPDIFF(SECOND, r.start_time, r.end_time) as elapsed_sec
        FROM runs r 
        WHERE r.run_id = %s
    """, (run_id,))
    run = cur.fetchone()
    cur.close(); conn.close()
    if not run:
        return jsonify({"error": "Run not found"}), 404
    if run["start_time"]: run["start_time"] = run["start_time"].isoformat()
    if run["end_time"]: run["end_time"] = run["end_time"].isoformat()
    return jsonify(run)

@app.route("/api/compare", methods=["GET"])
def api_compare_runs():
    sync_events_to_db()
    run_a_id = request.args.get("run_a")
    run_b_id = request.args.get("run_b")

    if not run_a_id or not run_b_id:
        return jsonify({"error": "run_a and run_b parameters are required."}), 400

    def get_stats_for(rid):
        conn = get_db_connection()
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM runs WHERE run_id=%s", (rid,))
        r = cur.fetchone()
        if not r:
            cur.close(); conn.close()
            return None

        cur.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN reaped=1 THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN termination_type='SIGNAL' THEN 1 ELSE 0 END) as signal_terminated,
                SUM(CASE WHEN termination_type='NORMAL' THEN 1 ELSE 0 END) as normal_terminated,
                AVG(duration) as avg_duration
            FROM processes WHERE run_id=%s
        """, (rid,))
        agg = cur.fetchone()
        cur.close(); conn.close()

        tot = int(agg["total"] or 0)
        sig = int(agg["signal_terminated"] or 0)
        rate = round((sig / tot * 100.0), 1) if tot > 0 else 0.0
        elapsed = 0
        if r["start_time"] and r["end_time"]:
            elapsed = int((r["end_time"] - r["start_time"]).total_seconds())

        return {
            "run_id": r["run_id"],
            "parent_pid": r["parent_pid"],
            "status": r["status"],
            "duration_pattern": r["duration_pattern"],
            "total_processes": tot,
            "completed": int(agg["completed"] or 0),
            "normal_terminated": int(agg["normal_terminated"] or 0),
            "signal_terminated": sig,
            "signal_rate": rate,
            "avg_duration": round(float(agg["avg_duration"] or 0.0), 1),
            "elapsed_seconds": elapsed,
            "start_time": r["start_time"].isoformat() if r["start_time"] else None,
            "end_time": r["end_time"].isoformat() if r["end_time"] else None
        }

    data_a = get_stats_for(run_a_id)
    data_b = get_stats_for(run_b_id)

    if not data_a or not data_b:
        return jsonify({"error": "One or both runs were not found."}), 404

    return jsonify({
        "run_a": data_a,
        "run_b": data_b
    })

# ------------------------------------------------------------------------------
# Frontend Static Routing
# ------------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)