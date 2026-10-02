' Runs the PowerShell launcher without flashing a console window. Arguments
' (such as -NewWindow, from the taskbar's right-click menu) are passed on.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
args = ""
For Each a In WScript.Arguments
  args = args & " " & a
Next
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\OpenTerminal.ps1""" & args, 0, False
