; Update the per-user PATH through the registry: [Environment]::GetEnvironmentVariable
; returns expanded values, and writing those back would permanently replace entries
; such as %JAVA_HOME%\bin with literal paths. The install directory is passed through
; the environment because it may contain characters that are special to PowerShell.
!macro ORCASVN_UPDATE_USER_PATH SCRIPT
  System::Call 'kernel32::SetEnvironmentVariable(t "ORCASVN_INSTDIR", t "$INSTDIR")'
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$d=$$env:ORCASVN_INSTDIR; $$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); $$p=$$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $$parts=@($$p -split ';' | Where-Object { $$_ -and $$_.TrimEnd('\') -ne $$d.TrimEnd('\') }); ${SCRIPT}; $$k.Close()"`
  ; nsExec leaves its result on the stack.
  Exch $0
  StrCmp $0 "0" +2
  DetailPrint "Could not update the user PATH: $0"
  Pop $0
  ; 0xFFFF is HWND_BROADCAST and 0x1A is WM_SETTINGCHANGE; a registry write does not
  ; notify other processes, and new terminals inherit their environment from Explorer.
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=5000
!macroend

; OrcaSVN and ForkSVN share the executable and app identifier. Migrate only the
; legacy per-user registration whose uninstaller points to this exact install.
!macro FORKSVN_MIGRATE_SHORTCUT DIRECTORY
  !insertmacro IsShortcutTarget "${DIRECTORY}\OrcaSVN.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    ${IfNot} ${FileExists} "${DIRECTORY}\ForkSVN.lnk"
      Rename "${DIRECTORY}\OrcaSVN.lnk" "${DIRECTORY}\ForkSVN.lnk"
    ${Else}
      !insertmacro IsShortcutTarget "${DIRECTORY}\ForkSVN.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $0
      ${If} $0 = 1
        Delete "${DIRECTORY}\OrcaSVN.lnk"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; Register the install directory in the per-user PATH so `orcasvn` works from a new terminal.
!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OrcaSVN" "UninstallString"
  StrCpy $1 '"$INSTDIR\uninstall.exe"'
  ${If} $0 == $1
    !insertmacro FORKSVN_MIGRATE_SHORTCUT "$SMPROGRAMS"
    !insertmacro FORKSVN_MIGRATE_SHORTCUT "$DESKTOP"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OrcaSVN"
  ${EndIf}
  Pop $1
  Pop $0
  !insertmacro ORCASVN_UPDATE_USER_PATH "$$k.SetValue('Path',((@($$parts)+$$d) -join ';'),[Microsoft.Win32.RegistryValueKind]::ExpandString)"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro ORCASVN_UPDATE_USER_PATH "if ($$parts.Count) { $$k.SetValue('Path',($$parts -join ';'),[Microsoft.Win32.RegistryValueKind]::ExpandString) } else { $$k.DeleteValue('Path',$$false) }"
!macroend
