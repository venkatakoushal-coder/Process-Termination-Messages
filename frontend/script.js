/* ==========================================================================
   Process Termination Messages — Linux OS Process Control Center
   Core Frontend Orchestration Script
   ========================================================================== */

"use strict";

/* State Management */
const STATE = {
    activeRunId: null,
    inspectingRunId: null,
    selectedProcessNo: null,
    selectedPid: null,
    processes: [],
    events: [],
    sync: {},
    stats: {},
    runs: [],
    isRunning: false,
    sortCol: "process_no",
    sortAsc: true,
    fullSortCol: "process_no",
    fullSortAsc: true,
    filterStatus: "ALL",
    searchQuery: "",
    eventFilterType: "ALL",
    eventFilterPid: "",
    autoScrollEvents: true
};

const POLL_INTERVAL_MS = 1000;
let pollTimer = null;

/* DOM Element References */
const DOM = {
    // Header & Run Controls
    cfgCount: document.getElementById("cfg-count"),
    cfgPattern: document.getElementById("cfg-pattern"),
    btnStartRun: document.getElementById("btn-start-run"),
    btnStopRun: document.getElementById("btn-stop-run"),
    runStatusBadge: document.getElementById("run-status-badge"),
    runStatusDot: document.getElementById("run-status-dot"),
    runStatusText: document.getElementById("run-status-text"),
    connBadge: document.getElementById("connection-badge"),
    connText: document.getElementById("connection-text"),
    historicalBanner: document.getElementById("historical-banner"),
    histRunId: document.getElementById("hist-run-id"),
    btnReturnCurrent: document.getElementById("btn-return-current"),

    // Summary Bar Metrics
    smTotal: document.getElementById("sm-total"),
    smRunning: document.getElementById("sm-running"),
    smCompleted: document.getElementById("sm-completed"),
    smSignaled: document.getElementById("sm-signaled"),
    smReaped: document.getElementById("sm-reaped"),

    // Overview Tab
    ovRunId: document.getElementById("ov-run-id"),
    ovParentPid: document.getElementById("ov-parent-pid"),
    ovStartTime: document.getElementById("ov-start-time"),
    ovPattern: document.getElementById("ov-pattern"),
    ovStatusBadge: document.getElementById("ov-status-badge"),
    ovProgressText: document.getElementById("ov-progress-text"),
    ovProgressBar: document.getElementById("ov-progress-bar"),
    ovProcessTbody: document.getElementById("ov-process-tbody"),
    ovSearchInput: document.getElementById("ov-search-input"),
    ovTableCount: document.getElementById("ov-table-count"),
    ovRecentEvents: document.getElementById("ov-recent-events"),
    recentEventsCount: document.getElementById("recent-events-count"),

    // Selected Process Detail Panel
    selBadgePid: document.getElementById("sel-badge-pid"),
    selProcessNo: document.getElementById("sel-process-no"),
    selPid: document.getElementById("sel-pid"),
    selParentPid: document.getElementById("sel-parent-pid"),
    selStatusBadge: document.getElementById("sel-status-badge"),
    selDuration: document.getElementById("sel-duration"),
    selTermType: document.getElementById("sel-term-type"),
    selSignalName: document.getElementById("sel-signal-name"),
    selReapedStatus: document.getElementById("sel-reaped-status"),
    selTermMsg: document.getElementById("sel-term-msg"),
    btnSigterm: document.getElementById("btn-sigterm"),
    btnSigkill: document.getElementById("btn-sigkill"),
    selEventsList: document.getElementById("sel-events-list"),
    stepCreate: document.getElementById("step-create"),
    stepRun: document.getElementById("step-run"),
    stepTerm: document.getElementById("step-term"),
    stepTermLabel: document.getElementById("step-term-label"),
    stepReap: document.getElementById("step-reap"),
    line1: document.getElementById("line-1"),
    line2: document.getElementById("line-2"),
    line3: document.getElementById("line-3"),

    // Process Relationship Tree
    treeParentPid: document.getElementById("tree-parent-pid"),
    treeChildrenList: document.getElementById("tree-children-list"),
    treeCount: document.getElementById("tree-count"),

    // Full Processes Tab
    fullProcessTbody: document.getElementById("full-process-tbody"),
    procSearch: document.getElementById("proc-search"),
    procFilterStatus: document.getElementById("proc-filter-status"),
    procSortCol: document.getElementById("proc-sort-col"),
    fullTableCount: document.getElementById("full-table-count"),

    // Parent Sync Tab
    syncTabBadge: document.getElementById("sync-tab-badge"),
    syncTabPpid: document.getElementById("sync-tab-ppid"),
    syncTabTotal: document.getElementById("sync-tab-total"),
    syncTabCreated: document.getElementById("sync-tab-created"),
    syncTabRunning: document.getElementById("sync-tab-running"),
    syncTabReaped: document.getElementById("sync-tab-reaped"),
    syncTabRemaining: document.getElementById("sync-tab-remaining"),
    syncTabPct: document.getElementById("sync-tab-pct"),
    syncTabProgressBar: document.getElementById("sync-tab-progress-bar"),

    // Live Events Tab
    eventsStreamFull: document.getElementById("events-stream-full"),
    eventFilterPid: document.getElementById("event-filter-pid"),
    eventFilterType: document.getElementById("event-filter-type"),
    eventAutoscroll: document.getElementById("event-autoscroll"),
    eventsCountBadge: document.getElementById("events-count-badge"),

    // Statistics Tab
    statsRunBadge: document.getElementById("stats-run-badge"),
    stTotal: document.getElementById("st-total"),
    stRunning: document.getElementById("st-running"),
    stNormal: document.getElementById("st-normal"),
    stSignaled: document.getElementById("st-signaled"),
    stSigRate: document.getElementById("st-sig-rate"),
    stReaped: document.getElementById("st-reaped"),
    stAvgDur: document.getElementById("st-avg-dur"),
    stMinDur: document.getElementById("st-min-dur"),
    stMaxDur: document.getElementById("st-max-dur"),
    stSigtermCnt: document.getElementById("st-sigterm-cnt"),
    stSigkillCnt: document.getElementById("st-sigkill-cnt"),
    durationChart: document.getElementById("duration-chart"),

    // Run History Tab
    historyTbody: document.getElementById("history-tbody"),
    historyCount: document.getElementById("history-count"),
    compRunA: document.getElementById("comp-run-a"),
    compRunB: document.getElementById("comp-run-b"),
    btnCompare: document.getElementById("btn-compare"),
    compareResults: document.getElementById("compare-results"),
    compareTbody: document.getElementById("compare-tbody"),
    thCompA: document.getElementById("th-comp-a"),
    thCompB: document.getElementById("th-comp-b")
};

/* ==========================================================================
   Initialization & Event Listeners
   ========================================================================== */
function init() {
    setupTabNavigation();
    setupRunControls();
    setupSignalControls();
    setupProcessTableControls();
    setupEventControls();
    setupHistoryControls();

    // Start live polling loop
    pollTick();
    pollTimer = setInterval(pollTick, POLL_INTERVAL_MS);
}

/* Tab Navigation */
function setupTabNavigation() {
    document.querySelectorAll(".nav-tab").forEach(tabBtn => {
        tabBtn.addEventListener("click", () => {
            const targetTab = tabBtn.dataset.tab;
            document.querySelectorAll(".nav-tab").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
            tabBtn.classList.add("active");
            const targetPane = document.getElementById("tab-" + targetTab);
            if (targetPane) targetPane.classList.add("active");
        });
    });
}

/* Run Controls */
function setupRunControls() {
    if (DOM.btnStartRun) {
        const launchFromControls = () => {
            const raw = (DOM.cfgCount.value || "").trim();
            const count = Number(raw);
            if (!/^\d+$/.test(raw) || count < 1 || count > 500) {
                showToast("Enter a whole number of processes between 1 and 500.", "error");
                DOM.cfgCount.focus();
                DOM.cfgCount.select();
                return;
            }
            const pattern = DOM.cfgPattern.value || "mixed";
            startNewRun(count, pattern, "normal");
        };
        DOM.btnStartRun.addEventListener("click", launchFromControls);
        // Pressing Enter inside the number box starts the run too
        DOM.cfgCount.addEventListener("keydown", (e) => {
            if (e.key === "Enter") launchFromControls();
        });
    }

    if (DOM.btnStopRun) {
        DOM.btnStopRun.addEventListener("click", async () => {
            try {
                const res = await fetch("/api/run/stop", { method: "POST" });
                const data = await res.json();
                showToast(data.message || "Run stopped.", "info");
                pollTick();
            } catch (err) {
                showToast("Failed to stop run: " + err.message, "error");
            }
        });
    }

    if (DOM.btnReturnCurrent) {
        DOM.btnReturnCurrent.addEventListener("click", () => {
            STATE.inspectingRunId = null;
            if (DOM.historicalBanner) DOM.historicalBanner.style.display = "none";
            showToast("Returned to live run.", "info");
            pollTick();
        });
    }
}

/* Signal Controls */
function setupSignalControls() {
    if (DOM.btnSigterm) {
        DOM.btnSigterm.addEventListener("click", () => {
            if (STATE.selectedProcessNo) {
                sendSignalToProcess(STATE.selectedProcessNo, "SIGTERM");
            }
        });
    }

    if (DOM.btnSigkill) {
        DOM.btnSigkill.addEventListener("click", () => {
            if (STATE.selectedProcessNo) {
                killProcessWithConfirm(STATE.selectedProcessNo, STATE.selectedPid);
            }
        });
    }
}

/* Process Tables Search / Filter / Sort */
function setupProcessTableControls() {
    if (DOM.ovSearchInput) {
        DOM.ovSearchInput.addEventListener("input", renderOverviewProcessTable);
    }

    if (DOM.procSearch) {
        DOM.procSearch.addEventListener("input", renderFullProcessTable);
    }

    if (DOM.procFilterStatus) {
        DOM.procFilterStatus.addEventListener("change", (e) => {
            STATE.filterStatus = e.target.value;
            renderFullProcessTable();
        });
    }

    if (DOM.procSortCol) {
        DOM.procSortCol.addEventListener("change", (e) => {
            STATE.fullSortCol = e.target.value;
            renderFullProcessTable();
        });
    }
}

/* Event Feed Filters */
function setupEventControls() {
    if (DOM.eventFilterType) {
        DOM.eventFilterType.addEventListener("change", (e) => {
            STATE.eventFilterType = e.target.value;
            renderLiveEvents();
        });
    }

    if (DOM.eventFilterPid) {
        DOM.eventFilterPid.addEventListener("input", (e) => {
            STATE.eventFilterPid = e.target.value.trim();
            renderLiveEvents();
        });
    }

    if (DOM.eventAutoscroll) {
        DOM.eventAutoscroll.addEventListener("change", (e) => {
            STATE.autoScrollEvents = e.target.checked;
        });
    }
}

/* Run History & Comparison Controls */
function setupHistoryControls() {
    if (DOM.btnCompare) {
        DOM.btnCompare.addEventListener("click", async () => {
            const runA = DOM.compRunA.value;
            const runB = DOM.compRunB.value;
            if (!runA || !runB) {
                showToast("Please select two distinct runs to compare.", "error");
                return;
            }
            if (runA === runB) {
                showToast("Please select two different runs.", "error");
                return;
            }
            try {
                const res = await fetch(`/api/compare?run_a=${runA}&run_b=${runB}`);
                if (!res.ok) throw new Error("Comparison failed: HTTP " + res.status);
                const data = await res.json();
                renderComparisonResults(data);
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }
}

/* ==========================================================================
   API Communication & Data Polling
   ========================================================================== */
async function startNewRun(count, pattern, mode = "normal") {
    try {
        const res = await fetch("/api/run/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ process_count: count, pattern, mode })
        });
        const data = await res.json();

        if (res.ok) {
            STATE.inspectingRunId = null;
            if (DOM.historicalBanner) DOM.historicalBanner.style.display = "none";
            showToast(`Launched run: ${count} processes ('${pattern}', mode: ${mode})`, "success");
            switchToTab("overview");
            pollTick();
        } else {
            showToast(data.error || "Failed to start run.", "error");
        }
    } catch (err) {
        showToast("Network error: " + err.message, "error");
    }
}

window.startExperiment = function(count, pattern, mode) {
    startNewRun(count, pattern, mode);
};

async function sendSignalToProcess(processNo, sigName) {
    try {
        const res = await fetch(`/api/processes/${processNo}/signal`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signal: sigName })
        });
        const data = await res.json();

        if (res.ok) {
            showToast(`Delivered ${sigName} to PID ${data.pid}`, "info");
            pollTick();
        } else {
            showToast(data.error || "Signal delivery rejected.", "error");
        }
    } catch (err) {
        showToast("Signal failed: " + err.message, "error");
    }
}

/* SIGKILL cannot be caught or ignored, so always ask before sending it */
function killProcessWithConfirm(processNo, pid) {
    const ok = confirm(
        `Send SIGKILL (unconditional force-kill) to Process ${processNo} (PID ${pid})?\n\n` +
        `Warning: SIGKILL cannot be handled or caught by the process.`
    );
    if (ok) sendSignalToProcess(processNo, "SIGKILL");
}

function getEffectiveRunId() {
    return STATE.inspectingRunId || STATE.activeRunId;
}

async function pollTick() {
    try {
        const runIdParam = STATE.inspectingRunId ? `?run_id=${STATE.inspectingRunId}` : "";

        const [syncRes, procRes, evRes, statsRes, runsRes] = await Promise.all([
            fetch(`/api/parent_sync${runIdParam}`),
            fetch(`/api/processes${runIdParam}`),
            fetch(`/api/events${runIdParam ? runIdParam + "&limit=150" : "?limit=150"}`),
            fetch(`/api/statistics${runIdParam}`),
            fetch("/api/runs")
        ]);

        if (syncRes.ok) STATE.sync = await syncRes.json();
        if (procRes.ok) STATE.processes = await procRes.json();
        if (evRes.ok) STATE.events = await evRes.json();
        if (statsRes.ok) STATE.stats = await statsRes.json();
        if (runsRes.ok) STATE.runs = await runsRes.json();

        if (!STATE.inspectingRunId && STATE.sync.run_id) {
            STATE.activeRunId = STATE.sync.run_id;
        }

        STATE.isRunning = Boolean(STATE.sync.is_running);

        setConnectionStatus(true);
        updateHeaderStatus();
        renderSummaryBar();
        renderOverviewTab();
        renderFullProcessTable();
        renderParentSyncTab();
        renderLiveEvents();
        renderStatisticsTab();
        renderHistoryTab();

    } catch (err) {
        setConnectionStatus(false);
    }
}

function setConnectionStatus(connected) {
    if (!DOM.connBadge) return;
    DOM.connBadge.className = "connection-badge " + (connected ? "connected" : "error");
    if (DOM.connText) DOM.connText.textContent = connected ? "Live Bridge" : "Disconnected";
}

function updateHeaderStatus() {
    const isLive = !STATE.inspectingRunId;
    const running = STATE.isRunning;

    if (DOM.runStatusDot && DOM.runStatusText) {
        if (!isLive) {
            DOM.runStatusDot.className = "status-dot dot-idle";
            DOM.runStatusText.textContent = `HISTORICAL #${STATE.inspectingRunId}`;
        } else if (running) {
            DOM.runStatusDot.className = "status-dot dot-running";
            DOM.runStatusText.textContent = `RUNNING (PID ${STATE.sync.parent_pid || "--"})`;
        } else if (STATE.sync.status === "COMPLETED") {
            DOM.runStatusDot.className = "status-dot dot-completed";
            DOM.runStatusText.textContent = "COMPLETED";
        } else {
            DOM.runStatusDot.className = "status-dot dot-idle";
            DOM.runStatusText.textContent = "IDLE";
        }
    }

    if (DOM.btnStartRun) DOM.btnStartRun.disabled = running;
    if (DOM.btnStopRun) DOM.btnStopRun.style.display = running ? "inline-flex" : "none";
}

/* ==========================================================================
   Rendering: Summary Metrics Bar
   ========================================================================== */
function renderSummaryBar() {
    const total = STATE.sync.total_children || STATE.stats.total_processes || 0;
    const running = STATE.sync.running || STATE.stats.running || 0;
    const completed = STATE.stats.completed || STATE.sync.reaped_by_parent || 0;
    const signaled = STATE.stats.signal_terminated || 0;
    const reaped = STATE.sync.reaped_by_parent || 0;

    if (DOM.smTotal) DOM.smTotal.textContent = total;
    if (DOM.smRunning) DOM.smRunning.textContent = running;
    if (DOM.smCompleted) DOM.smCompleted.textContent = completed;
    if (DOM.smSignaled) DOM.smSignaled.textContent = signaled;
    if (DOM.smReaped) DOM.smReaped.textContent = reaped;
}

/* ==========================================================================
   Rendering: Overview Tab (Cockpit)
   ========================================================================== */
function renderOverviewTab() {
    // Run Information
    const runId = STATE.inspectingRunId ? `#${STATE.inspectingRunId} (Historical)` : (STATE.sync.run_id ? `#${STATE.sync.run_id}` : "--");
    if (DOM.ovRunId) DOM.ovRunId.textContent = runId;
    if (DOM.ovParentPid) DOM.ovParentPid.textContent = STATE.sync.parent_pid || "--";
    if (DOM.ovStartTime) {
        DOM.ovStartTime.textContent = STATE.sync.start_time ? formatTime(STATE.sync.start_time) : "--";
    }
    if (DOM.ovPattern) DOM.ovPattern.textContent = STATE.sync.duration_pattern || "--";

    if (DOM.ovStatusBadge) {
        const st = STATE.sync.status || "IDLE";
        DOM.ovStatusBadge.textContent = st;
        DOM.ovStatusBadge.className = `badge ${st === 'RUNNING' ? 'badge-running' : st === 'COMPLETED' ? 'badge-completed' : ''}`;
    }

    // Progress Bar
    const pct = STATE.sync.progress_percentage || 0.0;
    const reaped = STATE.sync.reaped_by_parent || 0;
    const total = STATE.sync.total_children || 0;
    if (DOM.ovProgressText) DOM.ovProgressText.textContent = `${reaped} / ${total} reaped (${pct}%)`;
    if (DOM.ovProgressBar) DOM.ovProgressBar.style.width = `${pct}%`;

    // Process Table & Relationship Tree
    renderOverviewProcessTable();
    renderProcessRelationshipTree();
    renderSelectedProcessForensics();
    renderRecentActivityStream();
}

function renderOverviewProcessTable() {
    if (!DOM.ovProcessTbody) return;

    let procs = STATE.processes;
    const query = DOM.ovSearchInput ? DOM.ovSearchInput.value.trim().toLowerCase() : "";

    if (query) {
        procs = procs.filter(p =>
            String(p.process_no).includes(query) ||
            String(p.pid).includes(query) ||
            p.status.toLowerCase().includes(query) ||
            (p.termination_message && p.termination_message.toLowerCase().includes(query))
        );
    }

    if (DOM.ovTableCount) DOM.ovTableCount.textContent = `${procs.length} items`;

    if (procs.length === 0) {
        DOM.ovProcessTbody.innerHTML = `<tr><td colspan="6" class="placeholder-cell">No matching processes found.</td></tr>`;
        return;
    }

    // Default select first process if none selected
    if (!STATE.selectedProcessNo && procs.length > 0) {
        STATE.selectedProcessNo = procs[0].process_no;
        STATE.selectedPid = procs[0].pid;
    }

    DOM.ovProcessTbody.innerHTML = procs.map(p => {
        const isSel = STATE.selectedProcessNo === p.process_no;
        const statusBadge = getStatusBadgeHtml(p.status, p.termination_type);
        const exitText = p.termination_type === "SIGNAL" ? (p.signal_name || `Sig ${p.signal_number}`) : (p.status === "REAPED" || p.status === "COMPLETED" ? "0" : "--");

        return `
            <tr class="${isSel ? 'selected' : ''}" onclick="selectProcess(${p.process_no}, ${p.pid})">
                <td class="mono">#${p.process_no}</td>
                <td class="mono font-bold">${p.pid}</td>
                <td>${statusBadge}</td>
                <td class="mono">${p.duration}s</td>
                <td class="mono">${exitText}</td>
                <td>
                    <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); selectProcess(${p.process_no}, ${p.pid});">
                        Inspect
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function renderProcessRelationshipTree() {
    if (!DOM.treeChildrenList) return;

    const parentPid = STATE.sync.parent_pid || "--";
    if (DOM.treeParentPid) DOM.treeParentPid.textContent = `PID ${parentPid}`;

    const procs = STATE.processes;
    if (DOM.treeCount) DOM.treeCount.textContent = `${procs.length} children`;

    if (procs.length === 0) {
        DOM.treeChildrenList.innerHTML = `<div class="tree-placeholder">Waiting for process run…</div>`;
        return;
    }

    DOM.treeChildrenList.innerHTML = procs.map(p => {
        const isSel = STATE.selectedProcessNo === p.process_no;
        const dotColor = p.status === "RUNNING" ? "var(--amber)" :
                         p.termination_type === "SIGNAL" ? "var(--crimson)" :
                         p.status === "ZOMBIE" ? "var(--purple)" : "var(--emerald)";

        return `
            <div class="tree-node ${isSel ? 'selected' : ''}" onclick="selectProcess(${p.process_no}, ${p.pid})">
                <span class="tree-branch">├──</span>
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${dotColor};"></span>
                <span class="mono">Child #${p.process_no} (PID ${p.pid})</span>
                <span style="font-size:0.68rem; color:var(--text-muted); margin-left:auto;">${p.status}</span>
            </div>
        `;
    }).join("");
}

window.selectProcess = function(processNo, pid) {
    STATE.selectedProcessNo = processNo;
    STATE.selectedPid = pid;
    renderSelectedProcessForensics();
    renderOverviewProcessTable();
    renderProcessRelationshipTree();
    renderFullProcessTable();
};

function renderSelectedProcessForensics() {
    const proc = STATE.processes.find(p => p.process_no === STATE.selectedProcessNo);

    if (!proc) {
        if (DOM.selBadgePid) DOM.selBadgePid.textContent = "PID --";
        if (DOM.selProcessNo) DOM.selProcessNo.textContent = "--";
        if (DOM.selPid) DOM.selPid.textContent = "--";
        if (DOM.selParentPid) DOM.selParentPid.textContent = "--";
        if (DOM.selStatusBadge) DOM.selStatusBadge.innerHTML = `<span class="badge">--</span>`;
        if (DOM.selDuration) DOM.selDuration.textContent = "--";
        if (DOM.selTermType) DOM.selTermType.textContent = "--";
        if (DOM.selSignalName) DOM.selSignalName.textContent = "--";
        if (DOM.selReapedStatus) DOM.selReapedStatus.textContent = "--";
        if (DOM.selTermMsg) DOM.selTermMsg.textContent = "Select a process from the table or tree view.";
        if (DOM.btnSigterm) DOM.btnSigterm.disabled = true;
        if (DOM.btnSigkill) DOM.btnSigkill.disabled = true;
        updateLifecycleStepper(null);
        if (DOM.selEventsList) DOM.selEventsList.innerHTML = `<div class="event-placeholder">No process selected.</div>`;
        return;
    }

    if (DOM.selBadgePid) DOM.selBadgePid.textContent = `PID ${proc.pid}`;
    if (DOM.selProcessNo) DOM.selProcessNo.textContent = `#${proc.process_no}`;
    if (DOM.selPid) DOM.selPid.textContent = proc.pid;
    if (DOM.selParentPid) DOM.selParentPid.textContent = proc.parent_pid;
    if (DOM.selStatusBadge) DOM.selStatusBadge.innerHTML = getStatusBadgeHtml(proc.status, proc.termination_type);
    if (DOM.selDuration) DOM.selDuration.textContent = `${proc.duration}s`;
    if (DOM.selTermType) {
        const isSig = proc.termination_type === "SIGNAL";
        DOM.selTermType.innerHTML = isSig ? `<span style="color:var(--crimson); font-weight:700;">SIGNAL TERMINATED</span>` :
                                   proc.status === "REAPED" || proc.status === "COMPLETED" ? `<span style="color:var(--emerald); font-weight:700;">NORMAL EXIT (0)</span>` : `<span style="color:var(--text-muted);">ACTIVE</span>`;
    }
    if (DOM.selSignalName) {
        DOM.selSignalName.textContent = proc.signal_name && proc.signal_name !== "NONE" ? `${proc.signal_name} (${proc.signal_number})` : "None";
    }
    if (DOM.selReapedStatus) {
        DOM.selReapedStatus.innerHTML = proc.reaped ? `<span style="color:var(--emerald);">Yes (waitpid cleared)</span>` : `<span style="color:var(--amber);">Pending / Running</span>`;
    }
    if (DOM.selTermMsg) {
        DOM.selTermMsg.textContent = proc.termination_message || (proc.status === "RUNNING" ? `Process is actively executing sleep(${proc.duration}).` : "Terminated.");
    }

    // Signal Buttons Enable/Disable: Only running and unreaped processes in live run
    const canSignal = proc.status === "RUNNING" && !proc.reaped && !STATE.inspectingRunId;
    if (DOM.btnSigterm) DOM.btnSigterm.disabled = !canSignal;
    if (DOM.btnSigkill) DOM.btnSigkill.disabled = !canSignal;

    // Visual Lifecycle Stepper
    updateLifecycleStepper(proc);

    // Audit trail for this selected PID
    renderSelectedProcessAuditTrail(proc.pid, proc.process_no);
}

function updateLifecycleStepper(proc) {
    if (!DOM.stepCreate || !DOM.stepRun || !DOM.stepTerm || !DOM.stepReap) return;

    // Reset classes
    [DOM.stepCreate, DOM.stepRun, DOM.stepTerm, DOM.stepReap].forEach(s => {
        s.className = "step";
    });
    [DOM.line1, DOM.line2, DOM.line3].forEach(l => {
        l.className = "step-line";
    });

    if (!proc) return;

    DOM.stepCreate.classList.add("completed");
    DOM.line1.classList.add("completed");

    if (proc.status === "RUNNING") {
        DOM.stepRun.classList.add("active");
        DOM.stepTermLabel.textContent = "TERMINATED";
    } else if (proc.status === "ZOMBIE") {
        DOM.stepRun.classList.add("completed");
        DOM.line2.classList.add("active");
        DOM.stepTerm.classList.add("active");
        DOM.stepTermLabel.textContent = "ZOMBIE (WAITING REAP)";
    } else if (proc.status === "TERMINATED" || proc.status === "REAPED" || proc.status === "COMPLETED") {
        DOM.stepRun.classList.add("completed");
        DOM.line2.classList.add("completed");

        if (proc.termination_type === "SIGNAL") {
            DOM.stepTerm.classList.add("signaled");
            DOM.stepTermLabel.textContent = `SIGNAL (${proc.signal_name || "KILL"})`;
        } else {
            DOM.stepTerm.classList.add("completed");
            DOM.stepTermLabel.textContent = "NORMAL EXIT";
        }

        if (proc.reaped || proc.status === "REAPED") {
            DOM.line3.classList.add("completed");
            DOM.stepReap.classList.add("completed");
        } else {
            DOM.line3.classList.add("active");
            DOM.stepReap.classList.add("active");
        }
    }
}

function renderSelectedProcessAuditTrail(pid, processNo) {
    if (!DOM.selEventsList) return;

    const pidEvents = STATE.events.filter(e => e.pid === pid || e.process_no === processNo);

    if (pidEvents.length === 0) {
        DOM.selEventsList.innerHTML = `<div class="event-placeholder">No specific events recorded yet.</div>`;
        return;
    }

    DOM.selEventsList.innerHTML = pidEvents.map(e => `
        <div class="event-line-compact">
            <span style="color:var(--text-faint);">${formatTime(e.event_time)}</span>
            <span class="badge ${getEventBadgeClass(e.event_type)}">${e.event_type}</span>
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(e.message)}</span>
        </div>
    `).join("");
}

function renderRecentActivityStream() {
    if (!DOM.ovRecentEvents) return;

    if (DOM.recentEventsCount) DOM.recentEventsCount.textContent = `${STATE.events.length} events`;

    if (STATE.events.length === 0) {
        DOM.ovRecentEvents.innerHTML = `<div class="event-placeholder">Waiting for system events…</div>`;
        return;
    }

    const recent = STATE.events.slice(-30);
    DOM.ovRecentEvents.innerHTML = recent.map(e => `
        <div class="event-row">
            <span class="event-time">${formatTime(e.event_time)}</span>
            <span class="badge ${getEventBadgeClass(e.event_type)} event-type-badge">${e.event_type}</span>
            <span class="mono" style="color:var(--cyan); flex-shrink:0;">PID ${e.pid || "--"}</span>
            <span class="event-msg">${escapeHtml(e.message)}</span>
        </div>
    `).join("");

    DOM.ovRecentEvents.scrollTop = DOM.ovRecentEvents.scrollHeight;
}

/* ==========================================================================
   Rendering: Full Processes Tab
   ========================================================================== */
function renderFullProcessTable() {
    if (!DOM.fullProcessTbody) return;

    let list = [...STATE.processes];
    const query = DOM.procSearch ? DOM.procSearch.value.trim().toLowerCase() : "";
    const filter = STATE.filterStatus;

    if (query) {
        list = list.filter(p =>
            String(p.process_no).includes(query) ||
            String(p.pid).includes(query) ||
            p.status.toLowerCase().includes(query) ||
            (p.termination_message && p.termination_message.toLowerCase().includes(query))
        );
    }

    if (filter !== "ALL") {
        if (filter === "SIGNAL") {
            list = list.filter(p => p.termination_type === "SIGNAL");
        } else if (filter === "NORMAL") {
            list = list.filter(p => p.termination_type === "NORMAL");
        } else {
            list = list.filter(p => p.status === filter);
        }
    }

    // Sort
    const col = STATE.fullSortCol;
    list.sort((a, b) => {
        if (col === "process_no") return a.process_no - b.process_no;
        if (col === "pid") return a.pid - b.pid;
        if (col === "duration") return a.duration - b.duration;
        if (col === "status") return a.status.localeCompare(b.status);
        return 0;
    });

    if (DOM.fullTableCount) DOM.fullTableCount.textContent = `${list.length} processes`;

    if (list.length === 0) {
        DOM.fullProcessTbody.innerHTML = `<tr><td colspan="10" class="placeholder-cell">No matching processes found.</td></tr>`;
        return;
    }

    DOM.fullProcessTbody.innerHTML = list.map(p => {
        const isSel = STATE.selectedProcessNo === p.process_no;
        const statusBadge = getStatusBadgeHtml(p.status, p.termination_type);
        const canSignal = p.status === "RUNNING" && !p.reaped && !STATE.inspectingRunId;
        const sigCol = p.termination_type === "SIGNAL" ? `<span style="color:var(--crimson); font-weight:600;">${p.signal_name || `Sig ${p.signal_number}`}</span>` : `<span style="color:var(--text-faint);">None</span>`;

        return `
            <tr class="${isSel ? 'selected' : ''}" onclick="selectProcess(${p.process_no}, ${p.pid})">
                <td class="mono font-bold">#${p.process_no}</td>
                <td class="mono">${p.pid}</td>
                <td class="mono">${p.parent_pid}</td>
                <td>${statusBadge}</td>
                <td class="mono">${p.duration}s</td>
                <td class="mono">${p.start_time ? formatTime(p.start_time) : "--"}</td>
                <td class="mono">${p.end_time ? formatTime(p.end_time) : "--"}</td>
                <td style="max-width:240px; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(p.termination_message || "")}">
                    ${escapeHtml(p.termination_message || (p.status === 'RUNNING' ? 'Running workload...' : 'Completed'))}
                </td>
                <td class="mono">${sigCol}</td>
                <td>
                    <div style="display:flex; gap:4px;">
                        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); selectProcess(${p.process_no}, ${p.pid}); switchToTab('overview');">
                            Inspect
                        </button>
                        <button class="btn btn-warning btn-sm" ${canSignal ? '' : 'disabled'} onclick="event.stopPropagation(); sendSignalToProcess(${p.process_no}, 'SIGTERM');">
                            SIGTERM
                        </button>
                        <button class="btn btn-danger btn-sm" ${canSignal ? '' : 'disabled'} title="Force-kill a running process (signal 9)" onclick="event.stopPropagation(); killProcessWithConfirm(${p.process_no}, ${p.pid});">
                            SIGKILL
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

/* ==========================================================================
   Rendering: Parent Sync Tab
   ========================================================================== */
function renderParentSyncTab() {
    const st = STATE.sync.status || "IDLE";
    if (DOM.syncTabBadge) DOM.syncTabBadge.textContent = st;
    if (DOM.syncTabPpid) DOM.syncTabPpid.textContent = STATE.sync.parent_pid || "--";
    if (DOM.syncTabTotal) DOM.syncTabTotal.textContent = STATE.sync.total_children || 0;
    if (DOM.syncTabCreated) DOM.syncTabCreated.textContent = STATE.sync.created || 0;
    if (DOM.syncTabRunning) DOM.syncTabRunning.textContent = STATE.sync.running || 0;
    if (DOM.syncTabReaped) DOM.syncTabReaped.textContent = STATE.sync.reaped_by_parent || 0;
    if (DOM.syncTabRemaining) DOM.syncTabRemaining.textContent = STATE.sync.remaining || 0;

    const pct = STATE.sync.progress_percentage || 0.0;
    if (DOM.syncTabPct) DOM.syncTabPct.textContent = `${pct}%`;
    if (DOM.syncTabProgressBar) DOM.syncTabProgressBar.style.width = `${pct}%`;
}

/* ==========================================================================
   Rendering: Live Events Tab
   ========================================================================== */
function renderLiveEvents() {
    if (!DOM.eventsStreamFull) return;

    let events = [...STATE.events];
    const typeFilter = STATE.eventFilterType;
    const pidFilter = STATE.eventFilterPid;

    if (typeFilter !== "ALL") {
        events = events.filter(e => e.event_type === typeFilter);
    }

    if (pidFilter) {
        const targetPid = parseInt(pidFilter, 10);
        events = events.filter(e => e.pid === targetPid);
    }

    if (DOM.eventsCountBadge) DOM.eventsCountBadge.textContent = `${events.length} events`;

    if (events.length === 0) {
        DOM.eventsStreamFull.innerHTML = `<div class="event-placeholder">No matching events logged.</div>`;
        return;
    }

    DOM.eventsStreamFull.innerHTML = events.map(e => `
        <div class="event-row">
            <span class="event-time">${formatTime(e.event_time)}</span>
            <span class="badge ${getEventBadgeClass(e.event_type)} event-type-badge">${e.event_type}</span>
            <span class="mono" style="color:var(--cyan); flex-shrink:0;">PID ${e.pid || "--"}</span>
            <span class="event-msg">${escapeHtml(e.message)}</span>
        </div>
    `).join("");

    if (STATE.autoScrollEvents) {
        DOM.eventsStreamFull.scrollTop = DOM.eventsStreamFull.scrollHeight;
    }
}

/* ==========================================================================
   Rendering: Statistics Tab
   ========================================================================== */
function renderStatisticsTab() {
    const s = STATE.stats;
    if (DOM.statsRunBadge) DOM.statsRunBadge.textContent = `Run #${s.run_id || "--"}`;
    if (DOM.stTotal) DOM.stTotal.textContent = s.total_processes || 0;
    if (DOM.stRunning) DOM.stRunning.textContent = s.running || 0;
    if (DOM.stNormal) DOM.stNormal.textContent = s.normal_terminated || 0;
    if (DOM.stSignaled) DOM.stSignaled.textContent = s.signal_terminated || 0;
    if (DOM.stSigRate) DOM.stSigRate.textContent = `${s.signal_rate || 0.0}%`;
    if (DOM.stReaped) DOM.stReaped.textContent = s.completed || 0;
    if (DOM.stAvgDur) DOM.stAvgDur.textContent = `${s.avg_duration || 0.0}s`;
    if (DOM.stMinDur) DOM.stMinDur.textContent = `${s.min_duration || 0}s`;
    if (DOM.stMaxDur) DOM.stMaxDur.textContent = `${s.max_duration || 0}s`;
    if (DOM.stSigtermCnt) DOM.stSigtermCnt.textContent = s.sigterm_count || 0;
    if (DOM.stSigkillCnt) DOM.stSigkillCnt.textContent = s.sigkill_count || 0;

    // Render duration histogram
    if (DOM.durationChart) {
        const dist = s.duration_distribution || {};
        const entries = Object.entries(dist);
        if (entries.length === 0) {
            DOM.durationChart.innerHTML = `<div class="event-placeholder">No duration data available yet.</div>`;
        } else {
            const maxVal = Math.max(...Object.values(dist), 1);
            DOM.durationChart.innerHTML = entries.map(([dur, cnt]) => {
                const heightPct = Math.round((cnt / maxVal) * 100);
                return `
                    <div class="hist-bar-group">
                        <span class="hist-bar-val">${cnt}</span>
                        <div class="hist-bar-fill" style="height:${heightPct}%;"></div>
                        <span class="hist-bar-label">${dur}s</span>
                    </div>
                `;
            }).join("");
        }
    }
}

/* ==========================================================================
   Rendering: History & Comparison Tab
   ========================================================================== */
function renderHistoryTab() {
    if (!DOM.historyTbody) return;

    const runs = STATE.runs;
    if (DOM.historyCount) DOM.historyCount.textContent = `${runs.length} runs`;

    // Populate comparison dropdowns if count changed
    if (DOM.compRunA && DOM.compRunB && DOM.compRunA.options.length <= 1) {
        runs.forEach(r => {
            const optA = new Option(`Run #${r.run_id} (${r.total_processes} procs, ${r.status})`, r.run_id);
            const optB = new Option(`Run #${r.run_id} (${r.total_processes} procs, ${r.status})`, r.run_id);
            DOM.compRunA.add(optA);
            DOM.compRunB.add(optB);
        });
    }

    if (runs.length === 0) {
        DOM.historyTbody.innerHTML = `<tr><td colspan="9" class="placeholder-cell">No historical runs recorded.</td></tr>`;
        return;
    }

    DOM.historyTbody.innerHTML = runs.map(r => {
        const isCurrent = STATE.activeRunId === r.run_id && !STATE.inspectingRunId;
        const isInspecting = STATE.inspectingRunId === r.run_id;
        const durationText = r.elapsed_sec ? `${r.elapsed_sec}s` : "--";

        return `
            <tr class="${isInspecting ? 'selected' : ''}">
                <td class="mono font-bold">#${r.run_id} ${isCurrent ? '<span class="badge badge-running">LIVE</span>' : ''}</td>
                <td class="mono">${r.parent_pid}</td>
                <td class="capitalize">${r.duration_pattern}</td>
                <td class="mono">${r.total_processes}</td>
                <td class="mono" style="color:var(--emerald);">${r.completed_processes}</td>
                <td class="mono" style="color:var(--crimson);">${r.signal_terminated}</td>
                <td class="mono">${durationText}</td>
                <td><span class="badge ${r.status === 'COMPLETED' ? 'badge-completed' : 'badge-running'}">${r.status}</span></td>
                <td>
                    <button class="btn btn-ghost btn-sm" onclick="inspectHistoricalRun(${r.run_id})">
                        ${isInspecting ? 'Viewing' : 'Inspect'}
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

window.inspectHistoricalRun = function(runId) {
    STATE.inspectingRunId = runId;
    if (DOM.historicalBanner) {
        DOM.historicalBanner.style.display = "flex";
        if (DOM.histRunId) DOM.histRunId.textContent = `#${runId}`;
    }
    showToast(`Loaded Historical Run #${runId}`, "info");
    switchToTab("overview");
    pollTick();
};

function renderComparisonResults(data) {
    if (!DOM.compareResults || !DOM.compareTbody) return;

    DOM.compareResults.style.display = "block";
    DOM.thCompA.textContent = `Run #${data.run_a.run_id} (${data.run_a.duration_pattern})`;
    DOM.thCompB.textContent = `Run #${data.run_b.run_id} (${data.run_b.duration_pattern})`;

    const rows = [
        ["Total Processes", data.run_a.total_processes, data.run_b.total_processes],
        ["Status", data.run_a.status, data.run_b.status],
        ["Normal Exit Terminations", data.run_a.normal_terminated, data.run_b.normal_terminated],
        ["Signal Terminations", data.run_a.signal_terminated, data.run_b.signal_terminated],
        ["Signal Termination Rate", `${data.run_a.signal_rate}%`, `${data.run_b.signal_rate}%`],
        ["Average Process Lifetime", `${data.run_a.avg_duration}s`, `${data.run_b.avg_duration}s`],
        ["Total Run Elapsed Time", `${data.run_a.elapsed_seconds}s`, `${data.run_b.elapsed_seconds}s`],
        ["Duration Pattern", data.run_a.duration_pattern, data.run_b.duration_pattern]
    ];

    DOM.compareTbody.innerHTML = rows.map(([metric, valA, valB]) => `
        <tr>
            <td style="font-weight:600; color:var(--text-muted);">${metric}</td>
            <td class="mono font-bold">${valA}</td>
            <td class="mono font-bold">${valB}</td>
        </tr>
    `).join("");
}

/* ==========================================================================
   Utility Helpers
   ========================================================================== */
function switchToTab(tabName) {
    const btn = document.getElementById("tab-btn-" + tabName);
    if (btn) btn.click();
}

function getStatusBadgeHtml(status, termType) {
    if (termType === "SIGNAL" || status === "SIGNAL") {
        return `<span class="badge badge-signal">SIGNAL</span>`;
    }
    if (status === "RUNNING") {
        return `<span class="badge badge-running">RUNNING</span>`;
    }
    if (status === "REAPED" || status === "COMPLETED") {
        return `<span class="badge badge-reaped">REAPED</span>`;
    }
    if (status === "TERMINATED") {
        return `<span class="badge badge-terminated">TERMINATED</span>`;
    }
    if (status === "ZOMBIE") {
        return `<span class="badge badge-zombie">ZOMBIE</span>`;
    }
    return `<span class="badge">${status}</span>`;
}

function getEventBadgeClass(type) {
    if (!type) return "badge";
    if (type.includes("SIGNAL") || type.includes("KILL")) return "badge-signal";
    if (type === "CREATE") return "badge-terminated";
    if (type === "REAPED") return "badge-reaped";
    if (type === "COMPLETE") return "badge-completed";
    if (type === "ZOMBIE") return "badge-zombie";
    return "badge";
}

function formatTime(isoStr) {
    if (!isoStr) return "--";
    try {
        const d = new Date(isoStr);
        return d.toLocaleTimeString("en-GB", { hour12: false });
    } catch {
        return isoStr;
    }
}

function escapeHtml(str) {
    return (str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function showToast(msg, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast-msg toast-${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transition = "opacity 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

// Kick off initialization on DOM ready
document.addEventListener("DOMContentLoaded", init);