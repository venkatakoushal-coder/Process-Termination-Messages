/* ==========================================================================
 *  PROCESS TERMINATION MESSAGES
 *  Operating Systems and Systems Programming (25CS2104E)
 *
 *  Core Concept:
 *  - Linux parent process creates child processes using fork()
 *  - Each child process simulates a workload by sleeping for an assigned duration
 *  - Parent synchronizes with children using waitpid(-1, &status, WNOHANG)
 *  - Supports NORMAL termination (exit(0)) and SIGNAL termination (SIGTERM, SIGKILL)
 *  - Captures exact termination status using WIFEXITED, WEXITSTATUS, WIFSIGNALED, WTERMSIG
 *  - Records lifecycle events (CREATE, SIGNAL, COMPLETE, REAPED, ZOMBIE) to CSV event bridge
 *  - Supports educational OS experiments: Normal, SIGTERM, SIGKILL, Zombie
 * ========================================================================== */

#define _DEFAULT_SOURCE
#define _XOPEN_SOURCE 700
#define _POSIX_C_SOURCE 200809L

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <signal.h>
#include <time.h>
#include <errno.h>

/* Default configuration */
#define DEFAULT_PROCESS_COUNT 100
#define MAX_PROCESSES         500

/* Relative file paths for CSV event bridge and signal control file. */
static char event_file_path[256]  = "process_events.csv";
static char signal_file_path[256] = "signal_request.txt";

/* Locate the relative paths depending on launch location */
static void init_file_paths(void)
{
    FILE *test_root = fopen("c_program/process_manager.c", "r");
    if (test_root != NULL) {
        fclose(test_root);
        strncpy(event_file_path, "process_events.csv", sizeof(event_file_path) - 1);
        strncpy(signal_file_path, "signal_request.txt", sizeof(signal_file_path) - 1);
        return;
    }

    FILE *test_parent = fopen("../c_program/process_manager.c", "r");
    if (test_parent != NULL) {
        fclose(test_parent);
        strncpy(event_file_path, "../process_events.csv", sizeof(event_file_path) - 1);
        strncpy(signal_file_path, "../signal_request.txt", sizeof(signal_file_path) - 1);
        return;
    }

    strncpy(event_file_path, "process_events.csv", sizeof(event_file_path) - 1);
    strncpy(signal_file_path, "signal_request.txt", sizeof(signal_file_path) - 1);
}

/* Event writing functions */
static void write_start_run_event(FILE *fp, long run_id, pid_t parent_pid, int total, const char *pattern)
{
    fprintf(fp, "START_RUN,%ld,%d,%d,%s\n", run_id, (int)parent_pid, total, pattern);
    fflush(fp);
}

static void write_create_event(FILE *fp, int process_no, pid_t pid, int duration, pid_t parent_pid)
{
    fprintf(fp, "CREATE,%d,%d,%d,%d\n", process_no, (int)pid, duration, (int)parent_pid);
    fflush(fp);
}

static void write_signal_event(FILE *fp, int process_no, pid_t pid, int sig_num, const char *sig_name)
{
    fprintf(fp, "SIGNAL,%d,%d,%d,%s,Parent delivered %s to Process %d (PID %d)\n",
            process_no, (int)pid, sig_num, sig_name, sig_name, process_no, (int)pid);
    fflush(fp);
}

static void write_complete_event(FILE *fp, int process_no, pid_t pid, int duration,
                                 const char *term_type, int sig_num, const char *sig_name,
                                 const char *msg)
{
    fprintf(fp, "COMPLETE,%d,%d,%d,%s,%s,%d,%s\n",
            process_no, (int)pid, duration, msg, term_type, sig_num, sig_name);
    fflush(fp);
}

static void write_reaped_event(FILE *fp, int process_no, pid_t pid, const char *msg)
{
    fprintf(fp, "REAPED,%d,%d,,%s\n", process_no, (int)pid, msg);
    fflush(fp);
}

static void write_zombie_event(FILE *fp, int process_no, pid_t pid, const char *msg)
{
    fprintf(fp, "ZOMBIE,%d,%d,,%s\n", process_no, (int)pid, msg);
    fflush(fp);
}

static void write_end_run_event(FILE *fp, long run_id, pid_t parent_pid, int total, int normal_cnt, int signal_cnt)
{
    fprintf(fp, "END_RUN,%ld,%d,%d,%d,%d\n", run_id, (int)parent_pid, total, normal_cnt, signal_cnt);
    fflush(fp);
}

/* Read signal_request.txt for commands from dashboard or API */
static void check_and_handle_signal_requests(pid_t child_pids[], const int reaped[], int total_processes, FILE *event_fp)
{
    FILE *sfp = fopen(signal_file_path, "r");
    if (!sfp) return;

    char line[128];
    int handled_any = 0;

    while (fgets(line, sizeof(line), sfp) != NULL) {
        int req_process_no = 0;
        int req_pid = 0;
        int req_sig = SIGTERM;

        if (sscanf(line, "KILL,%d,%d,%d", &req_process_no, &req_pid, &req_sig) >= 2) {
            int idx = req_process_no - 1;

            if (idx >= 0 && idx < total_processes) {
                if (child_pids[idx] == (pid_t)req_pid && !reaped[idx]) {
                    const char *sig_name = (req_sig == SIGKILL) ? "SIGKILL" : "SIGTERM";

                    printf(">>> [PARENT SIGNAL] Sending %s (%d) to Process %d (PID: %d)...\n",
                           sig_name, req_sig, req_process_no, req_pid);

                    if (kill((pid_t)req_pid, req_sig) == 0) {
                        write_signal_event(event_fp, req_process_no, (pid_t)req_pid, req_sig, sig_name);
                        printf(">>> [PARENT SIGNAL] Signal %s successfully delivered to PID %d\n", sig_name, req_pid);
                    } else {
                        perror("kill");
                    }
                    handled_any = 1;
                }
            }
        }
    }
    fclose(sfp);

    if (handled_any) {
        sfp = fopen(signal_file_path, "w");
        if (sfp) fclose(sfp);
    }
}

/* Uniform random integer in [lo, hi]. */
static int random_between(int lo, int hi)
{
    return lo + (int)(rand() % (hi - lo + 1));
}

/* Every child gets its own random duration (rand() is seeded once in main),
 * so each run is a different, genuinely mixed workload:
 *     short  -> 1 to 3 seconds
 *     medium -> 3 to 7 seconds
 *     mixed  -> 1 to 30 seconds                                            */
static int compute_duration(int index, const char *pattern)
{
    (void)index;
    if (strcmp(pattern, "short") == 0) {
        return random_between(1, 3);
    } else if (strcmp(pattern, "medium") == 0) {
        return random_between(3, 7);
    } else {
        return random_between(1, 30);
    }
}

/* --------------------------------------------------------------------------
 *  OS Experiment: Controlled Zombie State Demonstration
 *  Parent creates child -> child exits -> parent delays waitpid() ->
 *  child exists as ZOMBIE in Linux kernel -> parent calls waitpid() -> reaped
 * -------------------------------------------------------------------------- */
static int run_zombie_experiment(FILE *event_fp, long run_id, pid_t parent_pid)
{
    pid_t child_pid;
    int status;

    printf("\n=== OS EXPERIMENT: CONTROLLED ZOMBIE PROCESS DEMONSTRATION ===\n");
    printf("1. Parent PID: %d will fork 1 child process.\n", (int)parent_pid);
    printf("2. Child will terminate immediately with exit(0).\n");
    printf("3. Parent will sleep for 6 seconds WITHOUT calling waitpid().\n");
    printf("4. During this window, child remains in kernel process table as [ZOMBIE / defunct].\n");
    printf("5. Parent will then invoke waitpid() to reap the zombie.\n\n");

    write_start_run_event(event_fp, run_id, parent_pid, 1, "zombie_demo");

    child_pid = fork();
    if (child_pid < 0) {
        perror("fork");
        return 1;
    }

    if (child_pid == 0) {
        /* Child: exits immediately */
        printf("[CHILD PID %d] Started. Exiting immediately with code 0...\n", (int)getpid());
        exit(0);
    }

    /* Parent: record create */
    write_create_event(event_fp, 1, child_pid, 1, parent_pid);
    printf("[PARENT] Forked Child PID %d. Waiting 1 second for child exit...\n", (int)child_pid);
    sleep(1);

    /* Child has exited, but parent has not reaped it yet! */
    write_zombie_event(event_fp, 1, child_pid, "Child exited. Parent intentionally delaying waitpid() — PID is ZOMBIE");
    printf("\n>>> [REAL OS STATE] Process %d is now a ZOMBIE in the Linux kernel!\n", (int)child_pid);
    printf(">>> Check 'ps aux | grep %d' or /proc/%d/status (State: Z)\n", (int)child_pid, (int)child_pid);
    printf(">>> Parent sleeping for 5 more seconds before reaping...\n\n");
    sleep(5);

    printf(">>> Parent now calling waitpid(%d, &status, 0)...\n", (int)child_pid);
    waitpid(child_pid, &status, 0);

    write_complete_event(event_fp, 1, child_pid, 1, "NORMAL", 0, "NONE",
                         "Child exited with code 0 (delayed reaping demonstrated zombie state)");
    write_reaped_event(event_fp, 1, child_pid, "Parent called waitpid() — Zombie cleared from process table");
    write_end_run_event(event_fp, run_id, parent_pid, 1, 1, 0);

    printf(">>> [REAPED] Zombie PID %d collected and cleared from OS process table.\n", (int)child_pid);
    printf("=== ZOMBIE EXPERIMENT COMPLETED ===\n\n");
    return 0;
}

int main(int argc, char *argv[])
{
    int   total_processes = DEFAULT_PROCESS_COUNT;
    char  pattern[32]     = "mixed";
    char  mode[32]        = "normal";
    pid_t child_pids[MAX_PROCESSES];
    int   durations[MAX_PROCESSES];
    int   reaped[MAX_PROCESSES];
    int   i;
    int   completed_count = 0;
    int   normal_count    = 0;
    int   signal_count    = 0;
    pid_t parent_pid;
    long  run_id;
    FILE *event_fp;
    time_t start_time_sec;

    if (argc >= 2) {
        int parsed = atoi(argv[1]);
        if (parsed > 0 && parsed <= MAX_PROCESSES) {
            total_processes = parsed;
        } else {
            total_processes = DEFAULT_PROCESS_COUNT;
        }
    }

    if (argc >= 3) {
        if (strcmp(argv[2], "short") == 0 || strcmp(argv[2], "medium") == 0 || strcmp(argv[2], "mixed") == 0) {
            strncpy(pattern, argv[2], sizeof(pattern) - 1);
        }
    }

    if (argc >= 4) {
        strncpy(mode, argv[3], sizeof(mode) - 1);
    }

    init_file_paths();

    FILE *init_sig = fopen(signal_file_path, "w");
    if (init_sig) fclose(init_sig);

    parent_pid = getpid();
    run_id     = (long)time(NULL);

    /* Seed the random generator once so durations differ on every run */
    srand((unsigned int)time(NULL) ^ ((unsigned int)parent_pid << 8));

    printf("========================================================\n");
    printf("   PROCESS TERMINATION MESSAGES\n");
    printf("   Linux OS Process Management Laboratory\n");
    printf("========================================================\n");
    printf("Parent Process Started (PID: %d)\n", (int)parent_pid);
    printf("Configuration: %d processes, pattern: '%s', mode: '%s'\n", total_processes, pattern, mode);
    printf("========================================================\n\n");

    event_fp = fopen(event_file_path, "w");
    if (event_fp == NULL) {
        perror("fopen event file");
        return 1;
    }

    /* Check for specialized OS educational experiments */
    if (strcmp(mode, "zombie_demo") == 0) {
        int ret = run_zombie_experiment(event_fp, run_id, parent_pid);
        fclose(event_fp);
        return ret;
    }

    /* Normal & Signal Demo Runs */
    write_start_run_event(event_fp, run_id, parent_pid, total_processes, pattern);

    for (i = 0; i < total_processes; i++) {
        child_pids[i] = -1;
        durations[i]  = 0;
        reaped[i]     = 0;
    }

    /* Fork Loop */
    for (i = 0; i < total_processes; i++) {
        pid_t pid;
        int   duration = compute_duration(i, pattern);
        durations[i] = duration;

        pid = fork();

        if (pid < 0) {
            perror("fork failed");
            child_pids[i] = -1;
            continue;
        }

        if (pid == 0) {
            /* Child execution */
            sleep((unsigned int)duration);
            /* _exit(), not exit(): exit() would flush a COPY of the parent's
             * buffered stdout (inherited by fork) into the log file once per child */
            _exit(0);
        }

        /* Parent execution */
        child_pids[i] = pid;
        write_create_event(event_fp, i + 1, pid, duration, parent_pid);
        printf("[CREATED] Process %3d  |  PID: %6d  |  Duration: %ds\n", i + 1, (int)pid, duration);
    }

    printf("\nParent entering waitpid() synchronization loop...\n\n");
    start_time_sec = time(NULL);

    /* If mode is sigterm_demo or sigkill_demo, schedule an auto-signal if not signaled by user */
    int auto_signaled = 0;

    /* Parent Synchronization Loop */
    while (completed_count < total_processes) {
        pid_t finished_pid;
        int   status;

        check_and_handle_signal_requests(child_pids, reaped, total_processes, event_fp);

        /* Auto-demonstration for experiment modes if active */
        if (!auto_signaled && (time(NULL) - start_time_sec) >= 2) {
            if (strcmp(mode, "sigterm_demo") == 0 && total_processes >= 1 && !reaped[0]) {
                printf("\n>>> [DEMO ACTION] Automatically delivering SIGTERM to Process 1 (PID: %d)...\n", (int)child_pids[0]);
                kill(child_pids[0], SIGTERM);
                write_signal_event(event_fp, 1, child_pids[0], SIGTERM, "SIGTERM");
                auto_signaled = 1;
            } else if (strcmp(mode, "sigkill_demo") == 0 && total_processes >= 1 && !reaped[0]) {
                printf("\n>>> [DEMO ACTION] Automatically delivering SIGKILL to Process 1 (PID: %d)...\n", (int)child_pids[0]);
                kill(child_pids[0], SIGKILL);
                write_signal_event(event_fp, 1, child_pids[0], SIGKILL, "SIGKILL");
                auto_signaled = 1;
            }
        }

        finished_pid = waitpid(-1, &status, WNOHANG);

        if (finished_pid > 0) {
            int j;
            for (j = 0; j < total_processes; j++) {
                if (child_pids[j] == finished_pid && !reaped[j]) {
                    char term_msg[256];
                    char reaped_msg[128];

                    if (WIFEXITED(status)) {
                        int exit_code = WEXITSTATUS(status);
                        snprintf(term_msg, sizeof(term_msg), "Process %d terminated normally (exit code %d)", j + 1, exit_code);
                        write_complete_event(event_fp, j + 1, finished_pid, durations[j], "NORMAL", 0, "NONE", term_msg);
                        normal_count++;
                        printf("[EXITED] Process %3d (PID %6d) exited normally (code %d)\n", j + 1, (int)finished_pid, exit_code);
                    } else if (WIFSIGNALED(status)) {
                        int sig_num = WTERMSIG(status);
                        const char *sig_name = (sig_num == SIGTERM) ? "SIGTERM" : (sig_num == SIGKILL) ? "SIGKILL" : "SIGNAL";
                        snprintf(term_msg, sizeof(term_msg), "Process %d terminated by %s (signal %d)", j + 1, sig_name, sig_num);
                        write_complete_event(event_fp, j + 1, finished_pid, durations[j], "SIGNAL", sig_num, sig_name, term_msg);
                        signal_count++;
                        printf("[SIGNALED] Process %3d (PID %6d) killed by %s (%d)\n", j + 1, (int)finished_pid, sig_name, sig_num);
                    }

                    snprintf(reaped_msg, sizeof(reaped_msg), "Parent reaped PID %d via waitpid()", (int)finished_pid);
                    write_reaped_event(event_fp, j + 1, finished_pid, reaped_msg);

                    reaped[j] = 1;
                    completed_count++;
                    break;
                }
            }
        } else {
            usleep(20000);
        }
    }

    write_end_run_event(event_fp, run_id, parent_pid, total_processes, normal_count, signal_count);
    fclose(event_fp);

    printf("\n========================================================\n");
    printf("   RUN COMPLETED — ALL %d PROCESSES REAPED BY PARENT\n", total_processes);
    printf("   Normal: %d | Signal Terminated: %d\n", normal_count, signal_count);
    printf("========================================================\n");

    return 0;
}