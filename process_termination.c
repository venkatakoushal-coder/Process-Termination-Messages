#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main()
{
    pid_t pid;
    int status;

    printf("========================================\n");
    printf("       PROCESS TERMINATION MESSAGES\n");
    printf("========================================\n\n");

    printf("Parent Process Started\n");
    printf("Parent PID: %d\n\n", getpid());

    printf("Creating Child Process...\n\n");

    pid = fork();

    if (pid < 0)
    {
        printf("Failed to create child process.\n");
        return 1;
    }

    if (pid == 0)
    {
        printf("Child Process Started\n");
        printf("Child PID: %d\n", getpid());

        printf("Child is performing a simple task...\n");

        sleep(3);

        printf("Child Process Completed.\n");

        exit(0);
    }
    else
    {
        printf("Parent Process is waiting for the child...\n");

        waitpid(pid, &status, 0);

        printf("\nParent Process Resumed.\n");

        if (WIFEXITED(status))
        {
            printf("Child Process Terminated Normally.\n");
            printf("Child Exit Status: %d\n", WEXITSTATUS(status));
        }
    }

    printf("\n========================================\n");
    printf("          PROJECT COMPLETED\n");
    printf("========================================\n");

    return 0;
}
