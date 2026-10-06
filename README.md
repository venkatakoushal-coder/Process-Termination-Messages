Process Termination Messages

A Linux job-process monitor: a C parent creates 100+ real child processes with fork(), synchronizes with them using waitpid(), and a live web dashboard shows every lifecycle event.

Course: Operating Systems and Systems Programming (25CS2104E) Team: K.V. Koushal · Y. Charan Sai · B. Shashank

Overview

Each child process stands for one server job (report generation, file processing, background tasks). The parent manages all jobs, reaps them without leaving zombies, and records the full lifecycle. An administrator watches it live from the dashboard and can signal running processes.

A simplified educational model of real Linux OS concepts, not production monitoring software.

Features
Feature	What it does
Real processes	100+ children created with fork(), each with a real Linux PID, all running concurrently
Non-blocking synchronization	waitpid(-1, &status, WNOHANG) loop, so no zombies accumulate
Termination detection	WIFEXITED, WEXITSTATUS, WIFSIGNALED, WTERMSIG
Run configuration	Choose process count and duration pattern (short, medium, mixed) from the UI or CLI
Signal controls	Send SIGTERM (15) or SIGKILL (9) to running processes via kill()
Process tree and forensics	Parent-to-child tree, plus a detail panel with exit cause and a 4-stage lifecycle stepper
OS lab experiments	6 experiments: Normal Exit, SIGTERM, SIGKILL, Parent Sync, Zombie, Orphan adoption
Run history and comparison	Inspect any past run in isolation and compare runs side by side
Live event bridge	Sub-second streaming of lifecycle events from C to MySQL to the browser
Architecture
C Process Manager ──writes──▶ process_events.csv ──Flask syncs──▶ MySQL ──REST──▶ Dashboard
 fork / waitpid / kill  ◀──reads── signal_request.txt ◀──writes── Flask API
Layer	Technology
Process management	C: fork(), waitpid(), kill(), sleep(), exit()
Backend	Python / Flask (REST API, event bridge, run controller)
Database	MySQL: runs, processes, process_events
Frontend	HTML5, CSS3, vanilla JavaScript (no frameworks)
Process Lifecycle
CREATED → RUNNING → TERMINATED → REAPED   (reaped by parent waitpid())
              └── SIGTERM / SIGKILL ──▶ SIGNAL TERMINATED → REAPED
CREATED: fork() returns in the parent and a CREATE event is written.
RUNNING: the child sleeps, simulating its task.
TERMINATED: the child exits normally or is killed by a signal, and the parent detects it with waitpid().
REAPED: the parent removes the child from the process table.

Signal flow: Dashboard → Flask writes KILL,<n>,<pid>,<sig> to signal_request.txt → the C parent validates ownership → kill(pid, sig) → child dies → WIFSIGNALED / WTERMSIG → status saved as SIGNAL.

Quick Start (Linux / WSL)

Requirements: Python 3.8+, MySQL Server, GCC

bash
# 1. Start MySQL
sudo service mysql start

# 2. Create the database
python3 database/migrate.py

# 3. Install dependencies and start the backend
pip install -r backend/requirements.txt
DB_PASSWORD=your_password python3 backend/app.py

# 4. Compile the C program (new terminal)
cd c_program && gcc -Wall -o process_manager process_manager.c

# 5. Run it
./process_manager                 # 100 processes, mixed pattern
./process_manager 150 short       # 150 processes, 1-3 s

Open http://localhost:5000/ to see the dashboard.

Environment variable	Default
DB_HOST / DB_USER	localhost / root
DB_PASSWORD	root
DB_NAME	process_monitor
Pattern	Durations (cycling)
short	1, 2, 3 s
medium	3, 5, 7 s
mixed	1, 3, 5, 7, 9 s
Dashboard Tabs
Tab	Shows
Overview	Summary cards, run banner, live sync progress bar, event feed
Processes	Searchable, filterable, sortable table with live countdowns and signal buttons
Parent Sync	waitpid() progress and metrics
Live Events	Colour-coded chronological event stream
Statistics	Duration distribution and normal vs signal termination charts
Run History	Every past run, with comparison
REST API
Method	Endpoint	Purpose
POST	/api/run/start · /api/run/stop	Launch or stop a C run
GET	/api/run/status	Run execution status
GET	/api/processes	Process list (status, type, search, sort, order, run_id)
GET	/api/processes/<n>	Process forensics and timeline
POST	/api/processes/<n>/signal	Send SIGTERM / SIGKILL
GET	/api/parent_sync · /api/statistics · /api/events	Live metrics
GET	/api/runs · /api/runs/<id> · /api/compare	History and comparison
Project Structure
Process-Termination-Messages/
├── c_program/process_manager.c   # Core OS program (fork, waitpid, kill)
├── backend/app.py                # Flask API + CSV-to-MySQL sync
├── frontend/                     # index.html, style.css, script.js
├── database/                     # schema.sql, migrate.py
├── docs/REPORT.md                # Full project report
└── process_events.csv / signal_request.txt   # Runtime bridge files (generated)
Safety
Signals go only to running processes of the current tracked run.
The PID is validated twice: by the backend, and again by the C program before kill().
Only SIGTERM and SIGKILL are accepted. There is no system(), popen(), or shell execution.
