' দোকান ইনভেন্টরি — starts the shop with no console window.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root

If Not fso.FileExists(root & "\node\node.exe") Then
  MsgBox "node\node.exe পাওয়া যায়নি। সফটওয়্যারটি আবার ইনস্টল করুন।", 16, "দোকান ইনভেন্টরি"
  WScript.Quit 1
End If

' 0 = hidden window, False = do not wait for it to finish.
sh.Run """" & root & "\node\node.exe"" ""launch.mjs""", 0, False
