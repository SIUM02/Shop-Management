; Inno Setup script for দোকান ইনভেন্টরি (Dokan Inventory).
;
; Produces a single Setup.exe: the client runs it, clicks through, and gets a
; Start-menu and desktop icon. Nothing else has to be installed on the machine
; — the Node runtime and the database engine are both inside the bundle.
;
; Build it ON WINDOWS:
;   1. Install Inno Setup 6   (https://jrsoftware.org/isdl.php)
;   2. Run packaging/build-windows.sh first (on any OS) to produce build/ShopInventory
;   3. Open this file in Inno Setup Compiler and press Build,
;      or:  ISCC.exe packaging\win\installer.iss
;
; Output lands in build/Output/DokanInventory-Setup.exe

#define AppName "Dokan Inventory"
#define AppNameBangla "দোকান ইনভেন্টরি"
#define AppVersion "1.0.0"
#define AppPublisher "Sium"
#define AppExeName "Shop Inventory.vbs"

[Setup]
AppId={{B4E1B6F2-7C2E-4E23-9A55-3C1D7E9A4F10}
AppName={#AppNameBangla}
AppVersion={#AppVersion}
AppVerName={#AppNameBangla} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\DokanInventory
DefaultGroupName={#AppNameBangla}
DisableProgramGroupPage=yes
; Per-user install by default: it needs no administrator rights, which matters
; on a shop PC whose owner may not have the admin password to hand.
PrivilegesRequiredOverridesAllowed=dialog commandline
PrivilegesRequired=lowest
OutputDir=..\..\build\Output
OutputBaseFilename=DokanInventory-Setup
SetupIconFile=app.ico
UninstallDisplayIcon={app}\icons\app.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; The UI is Bangla; the installer chrome follows Windows' own language.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "ডেস্কটপে আইকন তৈরি করুন (Create a desktop icon)"; GroupDescription: "Shortcuts:"

[Files]
; The whole bundle produced by build-windows.sh.
Source: "..\..\build\ShopInventory\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppNameBangla}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\icons\app.ico"; WorkingDir: "{app}"
Name: "{group}\{#AppNameBangla} বন্ধ করুন"; Filename: "{app}\Stop Shop.bat"; IconFilename: "{app}\icons\app.ico"; WorkingDir: "{app}"
Name: "{autodesktop}\{#AppNameBangla}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\icons\app.ico"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "এখনই চালু করুন (Launch now)"; Flags: shellexec postinstall skipifsilent

[UninstallRun]
; Stop the server before the files go, otherwise node.exe stays locked and
; Windows leaves the folder behind.
Filename: "{app}\Stop Shop.bat"; Flags: runhidden; RunOnceId: "StopShop"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\node_modules"

; NOTE: the shop's data is deliberately NOT removed on uninstall. It lives in
; %LOCALAPPDATA%\DokanInventory (database, config, first-login note), so
; reinstalling or upgrading keeps every product, sale and stock movement.
; To wipe a shop completely, delete that folder by hand.
