' Autostart script for agy-daemon (Antigravity v3.0 Background IPC Watchdog)
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

userProfile = WshShell.ExpandEnvironmentStrings("%USERPROFILE%")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

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
