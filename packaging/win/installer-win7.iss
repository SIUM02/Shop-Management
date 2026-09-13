; Inno Setup script for the WINDOWS 7 (32-bit) build.
;
; Separate from installer.iss because this one must not assume a 64-bit
; machine and must refuse anything older than Windows 7.
;
; Build it ON WINDOWS:
;   1. Install Inno Setup 6   (https://jrsoftware.org/isdl.php)
;   2. Run packaging/build-windows7.sh first (on any OS)
;   3. ISCC.exe packaging\win\installer-win7.iss
;
; Output: build/Output/JanataInventory-Win7-Setup.exe

#define AppName "Janata Electric & Electronics"
#define AppNameBangla "জনতা ইলেকট্রিক এন্ড ইলেকট্রনিক্স"
#define AppVersion "1.0.0"
#define AppExeName "JanataInventory.exe"

[Setup]
AppId={{9C3F2A61-58D4-4E77-B0C2-7E5A1F8D4B92}
AppName={#AppNameBangla}
AppVersion={#AppVersion}
AppVerName={#AppNameBangla} {#AppVersion}
AppPublisher=Sium
DefaultDirName={autopf}\JanataInventory
DefaultGroupName={#AppNameBangla}
DisableProgramGroupPage=yes

; Windows 7 SP1 and up. 6.1 is Windows 7; anything older is refused with a
; clear message rather than installing and failing at launch.
MinVersion=6.1

; No architecture restriction: this build is 32-bit and runs on both 32- and
; 64-bit Windows. Do NOT add ArchitecturesInstallIn64BitMode here — it would
; install into Program Files (64) and break on the 32-bit target.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog commandline

OutputDir=..\..\build\Output
OutputBaseFilename=JanataInventory-Win7-Setup
SetupIconFile=app.ico
UninstallDisplayIcon={app}\{#AppExeName}
; lzma2 with a smaller dictionary: the default is tuned for machines with more
; memory than a Windows 7 shop PC is likely to have.
Compression=lzma2/normal
LZMANumBlockThreads=1
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "ডেস্কটপে আইকন তৈরি করুন (Create a desktop icon)"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\..\build\ShopInventory-win7\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppNameBangla}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\resources\app\icons\app.ico"; WorkingDir: "{app}"
Name: "{autodesktop}\{#AppNameBangla}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\resources\app\icons\app.ico"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "এখনই চালু করুন (Launch now)"; Flags: nowait postinstall skipifsilent

; NOTE: the shop's data is deliberately NOT removed on uninstall. It lives in
; %LOCALAPPDATA%\DokanInventory (database, config, first-login note), so
; reinstalling or upgrading keeps every product, sale and stock movement.
