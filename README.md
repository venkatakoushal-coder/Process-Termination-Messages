# Process Termination Messages

A Linux job-process monitoring system built for the Operating Systems and Systems Programming course (25CS2104E) by K.V. Koushal, Y. Charan Sai and B. Shashank.

## About the Project

On a real Linux server, many independent jobs run at once: file processing, report generation, background tasks. This project models that situation. A C parent process creates 100 or more real child processes with `fork()`, and each child stands for one job. The parent keeps track of all of them, waits for them to finish, and records everything that happens to them.

A web dashboard lets an administrator watch the whole thing live, see which jobs are running and how much time they have left, and send signals to the ones they want to stop. It is a simplified educational model of real OS concepts, not a replacement for production monitoring software.

## How It Works

The C program is the core of the system. Each child gets a real Linux PID and runs concurrently with the others, sleeping for an assigned duration to simulate its task. The parent synchronizes with them using a non-blocking `waitpid(-1, &status, WNOHANG)` loop, which reaps every finished child immediately so no zombies pile up.

When a child ends, the parent uses `WIFEXITED`, `WEXITSTATUS`, `WIFSIGNALED` and `WTERMSIG` to work out whether it exited normally or was killed by a signal, and which one. This is where the project gets its name: every process ends with a clear termination message explaining exactly why it died.

## Process Lifecycle

Every process moves through four stages. It is created when `fork()` returns in the parent, it runs while the child sleeps through its task, it is terminated when it exits or receives a signal, and it is reaped when the parent's `waitpid()` call collects it and removes it from the process table. A process killed by a signal follows the same path, but it is recorded as a signal termination along with the signal that caused it.

The C program writes each of these events to `process_events.csv`. The Flask backend reads that file continuously and syncs the events into MySQL, and the dashboard polls the backend's REST API, so what you see in the browser is only a fraction of a second behind what the kernel is doing.

## Sending Signals

Signals travel the opposite way. When you click terminate on a running process, Flask writes a request to `signal_request.txt`. The C parent reads it, checks that the PID really belongs to one of its running children, and only then calls `kill()` with either `SIGTERM` (15) or `SIGKILL` (9).

The child dies, the parent's `waitpid()` call picks it up as a signal termination, and the dashboard records which signal caused it. `SIGTERM` is the polite request that a process can handle, while `SIGKILL` cannot be caught or ignored, and seeing both side by side is one of the clearest ways to learn the difference.

## Dashboard

The dashboard has six tabs. The Overview tab shows summary cards for total, running, completed, signal-terminated, reaped and remaining processes, along with a run banner, a live synchronization progress bar and a feed of the most recent events.

The Processes tab is a searchable, filterable and sortable table of every child, with live countdowns for running jobs and a terminate button on each one. Clicking a row opens a detail panel with the process metadata, the exit cause and a four-stage lifecycle view.

The Parent Sync tab tracks `waitpid()` progress in real time, showing how many children exist, how many are still running and how many the parent has reaped. The Live Events tab streams the colour-coded event log, with a configurable history length and optional auto-scroll.

The Statistics tab charts the duration distribution and the split between normal and signal terminations. The Run History tab lists every past run, and any run can be opened in isolation so its processes and events never get mixed up with a live run. Two runs can also be compared side by side.

## Run Configuration and Experiments

You can configure a run from the dashboard or the command line by choosing how many processes to create and which duration pattern to use. The `short` pattern gives each child 1 to 3 seconds, `medium` gives 3 to 7 seconds, and `mixed` gives 1 to 9 seconds, which is the default.

Six built-in OS lab experiments turn the project into a teaching tool. They demonstrate normal exit, SIGTERM, SIGKILL, parent synchronization, the zombie state and orphan adoption, each in a controlled setup so the behaviour is easy to observe and explain.

## Safety

Signals can only be sent to running processes from the current tracked run. The PID is validated by the backend and again by the C program before `kill()` is called. Only `SIGTERM` and `SIGKILL` are accepted, and the project never uses `system()`, `popen()` or any shell execution, so the dashboard cannot be used to run arbitrary commands.

## Tech Stack

The process manager is written in C using `fork()`, `waitpid()`, `kill()`, `sleep()` and `exit()`. The backend is Python with Flask, which serves the REST API, runs the event bridge and controls the C program. The database is MySQL with three tables: `runs` for execution history, `processes` for per-process lifecycle data and `process_events` for the chronological event log. The frontend is plain HTML, CSS and vanilla JavaScript with no frameworks.

## Getting Started

You need Linux or WSL, Python 3.8 or newer, MySQL Server and GCC. Start MySQL, create the database, then install the dependencies and start the backend:

```bash
sudo service mysql start
python3 database/migrate.py
pip install -r backend/requirements.txt
DB_PASSWORD=your_password python3 backend/app.py
```

The backend reads `DB_HOST`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` from the environment, defaulting to `localhost`, `root`, `root` and `process_monitor`. In a second terminal, compile and run the C program:

```bash
cd c_program
gcc -Wall -o process_manager process_manager.c
./process_manager 150 short
```

The arguments are the number of processes (default 100) and the duration pattern. Then open `http://localhost:5000/` in your browser. Use `medium` or `mixed` if you want enough time to signal processes before they finish on their own.

## REST API

The backend exposes a small REST API that the dashboard uses, and you can call it directly too. `GET /api/processes` returns the process list and accepts `status`, `type`, `search`, `sort`, `order` and `run_id` parameters, while `GET /api/processes/<n>` returns one process with its full timeline. Signals are requested with a `POST` to the process endpoint.

`GET /api/parent_sync`, `/api/statistics` and `/api/events` provide the live metrics, and `GET /api/runs`, `/api/runs/<id>` and `/api/compare` cover run history and comparison. `POST /api/run/start` and `/api/run/stop` launch and stop a run, and `GET /api/run/status` reports on it.

## What You Learn From It

The project is built to make several core OS ideas visible rather than abstract. You can watch `fork()` produce many real processes with their own PIDs, see why a parent must call `waitpid()` to avoid leaving zombies behind, and compare a normal `exit(0)` with a signal termination through the same status macros.

It also shows how a parent and its children are linked: when a child finishes, the parent is the one responsible for collecting it, and the lifecycle view makes that hand-off easy to follow step by step.

## Troubleshooting

If the dashboard shows a placeholder, that is expected until the C program has been run at least once, because all the data comes from the events it writes. The C program needs Linux or WSL, so it will not compile on plain Windows.

If the backend cannot connect to the database, make sure MySQL is running and that `DB_PASSWORD` matches your MySQL password. If processes finish before you can click terminate, run with the `medium` or `mixed` pattern to give yourself more time.

## Project Layout

`c_program/process_manager.c` holds the core OS program. `backend/app.py` is the Flask API and the CSV-to-MySQL sync. `frontend/` contains the dashboard (`index.html`, `style.css`, `script.js`), `database/` has the schema and migration script, and `docs/REPORT.md` is the full project report. `process_events.csv` and `signal_request.txt` are bridge files generated at runtime and are not part of the source.

## Team

K.V. Koushal, Y. Charan Sai and B. Shashank, for Operating Systems and Systems Programming (25CS2104E).
