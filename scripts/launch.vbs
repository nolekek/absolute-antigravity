Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

userProfile = WshShell.ExpandEnvironmentStrings("%USERPROFILE%")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 1. Start agy-daemon in background (Watchdog & Named Pipe IPC Server)
agyBin = ""
candidates = Array(_
    userProfile & "\.gemini\antigravity\bin\agy.exe", _
    scriptDir & "\..\agy\target\release\agy.exe", _
    scriptDir & "\bin\agy.exe" _
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
        userProfile & "\.gemini\antigravity\bin\agy-daemon.exe", _
        scriptDir & "\..\agy\target\release\agy-daemon.exe" _
    )
    For Each dc In daemonCandidates
        If fso.FileExists(dc) Then
            WshShell.Run """" & dc & """", 0, False
            Exit For
        End If
    Next
End If

' 2. Launch Antigravity Guard (ensures patches and launches client)
guardScript = userProfile & "\.gemini\antigravity\bin\antigravity_guard.py"
If Not fso.FileExists(guardScript) Then
    guardScript = scriptDir & "\antigravity_guard.py"
End If

args = ""
For i = 0 To WScript.Arguments.Count - 1
    args = args & " """ & WScript.Arguments(i) & """"
Next

If fso.FileExists(guardScript) Then
    WshShell.Run "pythonw.exe """ & guardScript & """" & args, 0, False
End If
