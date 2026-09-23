# Process Termination Messages

## 1. Introduction

Process Termination Messages is a Linux-based Operating Systems and Systems Programming project developed using the C programming language.

The project demonstrates the basic lifecycle of a parent and child process. It focuses on process creation, execution, synchronization, and termination.

## 2. Problem Statement

Processes are created and terminated frequently in a multitasking operating system. For beginners, it can be difficult to understand how a parent process creates a child process and waits for its completion.

This project provides a simple Linux-based implementation to demonstrate this process using basic Linux system calls.

## 3. Objectives

- To create a child process.
- To demonstrate the parent-child relationship.
- To demonstrate process execution and termination.
- To synchronize the parent and child processes.
- To display a clear termination message.

## 4. Technologies Used

- C Programming Language
- Linux / Ubuntu
- GCC Compiler
- Terminal

## 5. Functions Used

### fork()

Creates a child process from the parent process.

### waitpid()

Allows the parent process to wait for the child process to complete.

### sleep()

Provides a short delay while the child process performs its task.

### exit()

Terminates the child process after completing its task.

## 6. Methodology

1. The program starts with the parent process.
2. The parent creates a child process using `fork()`.
3. The child process starts execution.
4. The child performs a simple task.
5. The child uses `sleep()` to create a short delay.
6. The child terminates using `exit(0)`.
7. The parent waits for the child using `waitpid()`.
8. After the child terminates, the parent process resumes.
9. The program displays the termination message.

## 7. Implementation

The project is implemented in C using Linux process-management functions.

The main source file is:

process_termination.c

========================================
       PROCESS TERMINATION MESSAGES
========================================

Parent Process Started
Parent PID: 845

Creating Child Process...

Parent Process is waiting for the child...
Child Process Started
Child PID: 846
Child is performing a simple task...
Child Process Completed.

Parent Process Resumed.
Child Process Terminated Normally.
Child Exit Status: 0

========================================
          PROJECT COMPLETED
========================================

Project Structure:- 

Process-Termination-Messages/
│
├── process_termination.c
├── README.md
├── screenshots/
│   └──png1... 
│
└── project_report.md

Team Members
K.V.KOUSHAL
Y.CHARAN SAI
B.SHASHANK


Conclusion:-
The project demonstrates the basic process lifecycle in Linux. It shows how a parent process creates a child process, allows it to perform a task, waits for its completion, and displays a termination message.
