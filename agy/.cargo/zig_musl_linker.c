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

    char processed[65536] = {0};
    int dst_idx = 0;
    const char* n1 = "--target=x86_64-unknown-linux-musl";
    int n1_len = (int)strlen(n1);
    const char* r1 = "--target=x86_64-linux-musl";
    int r1_len = (int)strlen(r1);

    const char* n2 = "-target x86_64-unknown-linux-musl";
    int n2_len = (int)strlen(n2);
    const char* r2 = "-target x86_64-linux-musl";
    int r2_len = (int)strlen(r2);

    while (*p) {
        if (strncmp(p, n1, n1_len) == 0) {
            memcpy(&processed[dst_idx], r1, r1_len);
            dst_idx += r1_len;
            p += n1_len;
        } else if (strncmp(p, n2, n2_len) == 0) {
            memcpy(&processed[dst_idx], r2, r2_len);
            dst_idx += r2_len;
            p += n2_len;
        } else {
            processed[dst_idx++] = *p++;
        }
    }
    processed[dst_idx] = '\0';

    strcat(cmd, processed);

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
