Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

userProfile = WshShell.ExpandEnvironmentStrings("%USERPROFILE%")
localAppData = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 1. Start agy-daemon in background (Watchdog & Named Pipe IPC Server)
agyBin = ""
candidates = Array(_
    scriptDir & "\resources\bin\agy.exe", _
    scriptDir & "\resources\app.asar.unpacked\bin\agy.exe", _
    scriptDir & "\..\resources\bin\agy.exe", _
    scriptDir & "\..\resources\app.asar.unpacked\bin\agy.exe", _
    scriptDir & "\bin\agy.exe", _
    scriptDir & "\..\bin\agy.exe", _
    scriptDir & "\..\binaries\windows-x64\agy.exe", _
    scriptDir & "\..\agy\target\release\agy.exe", _
    userProfile & "\.gemini\antigravity\bin\agy.exe" _
)
For Each c In candidates
    If fso.FileExists(c) Then
        agyBin = c
        Exit For
    End If
Next

If agyBin <> "" Then
    ' agy daemon start checks if daemon is already running via Named Pipe IPC
    WshShell.Run """" & agyBin & """ daemon start", 0, False
Else
    daemonCandidates = Array(_
        scriptDir & "\resources\bin\agy-daemon.exe", _
        scriptDir & "\resources\app.asar.unpacked\bin\agy-daemon.exe", _
        scriptDir & "\..\resources\bin\agy-daemon.exe", _
        scriptDir & "\..\resources\app.asar.unpacked\bin\agy-daemon.exe", _
        scriptDir & "\bin\agy-daemon.exe", _
        scriptDir & "\..\bin\agy-daemon.exe", _
        scriptDir & "\..\binaries\windows-x64\agy-daemon.exe", _
        scriptDir & "\..\agy\target\release\agy-daemon.exe", _
        userProfile & "\.gemini\antigravity\bin\agy-daemon.exe" _
    )
    For Each dc In daemonCandidates
        If fso.FileExists(dc) Then
            WshShell.Run """" & dc & """", 0, False
            Exit For
        End If
    Next
End If

' 2. Launch Standalone Client or Antigravity Guard
args = ""
For i = 0 To WScript.Arguments.Count - 1
    args = args & " """ & WScript.Arguments(i) & """"
Next

standaloneExe = ""
exeCandidates = Array(_
    scriptDir & "\Antigravity.exe", _
    scriptDir & "\..\Antigravity.exe" _
)
For Each ec In exeCandidates
    If fso.FileExists(ec) Then
        standaloneExe = ec
        Exit For
    End If
Next

If standaloneExe <> "" Then
    ' Direct launch of standalone Antigravity Absolute executable
    WshShell.Run """" & standaloneExe & """" & args, 1, False
Else
    guardScript = userProfile & "\.gemini\antigravity\bin\antigravity_guard.py"
    If Not fso.FileExists(guardScript) Then
        guardScript = scriptDir & "\antigravity_guard.py"
    End If
    If Not fso.FileExists(guardScript) Then
        guardScript = scriptDir & "\..\scripts\antigravity_guard.py"
    End If

    If fso.FileExists(guardScript) Then
        WshShell.Run "pythonw.exe """ & guardScript & """" & args, 0, False
    Else
        installedExe = localAppData & "\Programs\antigravity\Antigravity.exe"
        If fso.FileExists(installedExe) Then
            WshShell.Run """" & installedExe & """" & args, 1, False
        End If
    End If
End If
