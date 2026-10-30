Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

userProfile = WshShell.ExpandEnvironmentStrings("%USERPROFILE%")
guardScript = userProfile & "\.gemini\antigravity\bin\antigravity_guard.py"

' Pass any command-line arguments to antigravity_guard.py
args = ""
For i = 0 To WScript.Arguments.Count - 1
    args = args & " """ & WScript.Arguments(i) & """"
Next

WshShell.Run "pythonw.exe """ & guardScript & """" & args, 0, False
