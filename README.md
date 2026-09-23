# Process Termination Messages

## Project Overview

Process Termination Messages is a Linux-based Operating Systems and Systems Programming project developed using the C programming language.

The project demonstrates the creation, execution, synchronization, and termination of a child process. The parent process creates a child using `fork()`, waits for the child using `waitpid()`, and the child terminates using `exit()`.

## Technologies Used

- C Programming Language
- Linux / Ubuntu
- GCC Compiler
- Terminal

## Functions Used

### fork()

Used to create a child process from the parent process.

### waitpid()

Used by the parent process to wait for the child process to complete.

### sleep()

Used to provide a short delay while the child process performs its task.

### exit()

Used to terminate the child process after completing its task.

## Working

1. The parent process starts.
2. A child process is created using `fork()`.
3. The child process starts and displays its process ID.
4. The child performs a simple task.
5. The child waits for a short period using `sleep()`.
6. The child terminates using `exit(0)`.
7. The parent process waits for the child using `waitpid()`.
8. After the child terminates, the parent process resumes.
9. The program displays the termination message.

## Compilation

gcc process_termination.c -o process_termination
