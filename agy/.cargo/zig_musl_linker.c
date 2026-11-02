#include <windows.h>
#include <stdio.h>
#include <string.h>

int main() {
    char cmd[65536] = "zig cc -target x86_64-linux-musl ";
    char* orig_cmd = GetCommandLineA();
    char* p = orig_cmd;
    if (*p == '"') {
        p++;
        while (*p && *p != '"') p++;
        if (*p == '"') p++;
    } else {
        while (*p && *p != ' ') p++;
    }
    while (*p == ' ') p++;
    strcat(cmd, p);

    STARTUPINFOA si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    if (!CreateProcessA(NULL, cmd, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
        return 1;
    }
    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD exit_code = 0;
    GetExitCodeProcess(pi.hProcess, &exit_code);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    return exit_code;
}
