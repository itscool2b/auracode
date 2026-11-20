; o7's hooks for Tauri's NSIS uninstaller (tauri.conf.json: bundle > windows > nsis).
;
; What to delete is decided in Rust, by `o7.exe --uninstall-cleanup`
; (apps/desktop/src-tauri/src/uninstall.rs, over o7-core's uninstall module). This file only
; decides whether that runs, and stops Tauri's own "delete app data" step, which would remove the
; data folder whole, worktrees the person chose to keep included.
;
; - The confirm page's checkbox reads "Keep my o7 data" (windows/English.nsh). Unticked,
;   which is the default, o7 deletes its data. A quiet uninstall (/S or /P) deletes it too,
;   without dialogs, and keeps worktrees with unsaved work; /KEEPDATA keeps everything.
; - An update (/UPDATE) keeps everything, and so does the uninstall a newer installer runs before
;   installing: it runs this uninstaller in place (`_?=`), so $EXEDIR is the install folder, while
;   an uninstall started from Settings runs from a temporary copy.
; - The person's agents, their settings and their repositories are never touched.
;
; Exit codes of the cleanup: 0 done, 3 o7 is still running (nothing deleted), 4 something
; could not be deleted (the cleanup listed it).

Var O7DeleteData
Var O7CleanupFlags
Var O7CleanupLater

; Runs the cleanup from `program`; its exit code lands in $R9 ("none" when it did not start).
!macro O7_CLEANUP program
  ClearErrors
  ExecWait '"${program}" --uninstall-cleanup $O7CleanupFlags' $R9
  ${If} ${Errors}
    StrCpy $R9 "none"
  ${EndIf}
!macroend

!macro O7_CLEANUP_RESULT
  ${If} $R9 == "0"
    DetailPrint "o7's data is deleted"
  ${ElseIf} $R9 == "4"
    DetailPrint "Some of o7's data could not be deleted"
  ${Else}
    DetailPrint "o7's data was not deleted (cleanup result $R9)"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $O7DeleteData 1
  StrCpy $O7CleanupLater 0
  ${If} $DeleteAppDataCheckboxState = 1
    StrCpy $O7DeleteData 0
  ${EndIf}
  ; Tauri's own step removes both data folders whole; the cleanup does it around kept worktrees.
  StrCpy $DeleteAppDataCheckboxState 0
  ${If} $UpdateMode = 1
    StrCpy $O7DeleteData 0
  ${EndIf}
  ${If} $EXEDIR == $INSTDIR
    StrCpy $O7DeleteData 0
  ${EndIf}
  ClearErrors
  ${GetOptions} $CMDLINE "/KEEPDATA" $R9
  ${IfNot} ${Errors}
    StrCpy $O7DeleteData 0
  ${EndIf}
  ${If} $O7DeleteData = 1
    DetailPrint "Deleting o7's data"
    StrCpy $O7CleanupFlags "--interactive"
    ${If} $PassiveMode = 1
    ${OrIf} ${Silent}
      StrCpy $O7CleanupFlags ""
    ${EndIf}
    !insertmacro O7_CLEANUP "$INSTDIR\${MAINBINARYNAME}.exe"
    ${If} $R9 == "3"
      ; o7 did not quit when asked. Tauri's own check, next, offers to close it; the cleanup
      ; then runs after the files are removed, from a copy of the program.
      InitPluginsDir
      CopyFiles /SILENT "$INSTDIR\${MAINBINARYNAME}.exe" "$PLUGINSDIR\o7-cleanup.exe"
      StrCpy $O7CleanupLater 1
    ${Else}
      !insertmacro O7_CLEANUP_RESULT
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Earlier versions registered auracode:// links with Windows, for a sign-in page that no longer
  ; exists; this version's installer registers none, so its uninstaller would leave theirs behind.
  ; Remove the registration when it still points at this install, as their uninstallers did.
  ClearErrors
  ReadRegStr $R9 SHCTX "Software\Classes\auracode\shell\open\command" ""
  ${If} $R9 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
    DeleteRegKey SHCTX "Software\Classes\auracode"
  ${EndIf}
  ClearErrors
  ${If} $O7CleanupLater = 1
    !insertmacro O7_CLEANUP "$PLUGINSDIR\o7-cleanup.exe"
    !insertmacro O7_CLEANUP_RESULT
  ${EndIf}
  ${If} $O7DeleteData = 1
    ; The installer's own records, as Tauri's "delete app data" step clears them.
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"
    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"
    ; Windows' notification settings for o7.
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\${BUNDLEID}"
  ${EndIf}
!macroend

; o7 was called auracode until 19 November 2026, and a product's name is its install folder and its
; entry in Windows' list of apps. So the update from auracode installs o7 beside it, and Tauri's
; template, in update mode, makes no shortcuts. This retires auracode's install once o7's files are
; in place: o7's shortcuts take the place of auracode's, a taskbar pin opens o7, and auracode's
; program, its entry in the list of apps and its installer records go.
;
; auracode's program is deleted only in its default per-user folder, only when auracode.exe is in
; it, and never when o7 was installed in or under that folder: a folder read from the registry is
; never deleted. An auracode installed elsewhere loses its entry in the list of apps and its
; shortcuts but keeps its files, so its uninstaller, which would delete the data o7 now uses, is no
; longer offered. auracode's data is never touched: o7 opens it where it is (o7-core's paths.rs).
!macro O7_RETIRE_AURACODE
  StrCpy $R7 "$LOCALAPPDATA\auracode"
  ; Where auracode's entry in the list of apps says it is; the value is quoted.
  ClearErrors
  ReadRegStr $R5 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\auracode" "InstallLocation"
  StrCpy $R4 $R5 1
  ${If} $R4 == "$\""
    StrCpy $R5 $R5 "" 1
    StrCpy $R5 $R5 -1
  ${EndIf}
  ClearErrors
  ${If} ${FileExists} "$R7\auracode.exe"
  ${OrIf} ${FileExists} "$R5\auracode.exe"
    DetailPrint "Replacing auracode with o7"
    ; The Start menu and the desktop: o7's shortcut where auracode's was.
    ${If} ${FileExists} "$SMPROGRAMS\auracode.lnk"
      Delete "$SMPROGRAMS\auracode.lnk"
    ${EndIf}
    ${IfNot} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}
    ${If} ${FileExists} "$DESKTOP\auracode.lnk"
      Delete "$DESKTOP\auracode.lnk"
      ${IfNot} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk"
        CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
        !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
      ${EndIf}
    ${EndIf}
    ; A taskbar pin keeps its place and opens o7.
    StrCpy $R6 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\auracode.lnk"
    ${If} ${FileExists} $R6
      !insertmacro SetShortcutTarget $R6 "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId $R6
    ${EndIf}
    ; auracode's records: its entry in the list of apps, its install location, its notification
    ; settings, and a link registration from an earlier version still pointing at it.
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\auracode"
    DeleteRegKey HKCU "Software\auracode\auracode"
    DeleteRegKey /ifempty HKCU "Software\auracode"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\si.auracode.desktop"
    ClearErrors
    ReadRegStr $R6 HKCU "Software\Classes\auracode\shell\open\command" ""
    ${If} $R6 == "$\"$R7\auracode.exe$\" $\"%1$\""
    ${OrIf} $R6 == "$\"$R5\auracode.exe$\" $\"%1$\""
      DeleteRegKey HKCU "Software\Classes\auracode"
    ${EndIf}
    ClearErrors
    ; Its program, in its default folder only. The update closed it before this installer started.
    ${If} $LOCALAPPDATA != ""
    ${AndIf} ${FileExists} "$R7\auracode.exe"
      GetFullPathName $R3 $R7
      GetFullPathName $R2 $INSTDIR
      StrLen $R1 "$R3\"
      StrCpy $R8 $R2 $R1
      ${If} $R2 != $R3
      ${AndIf} $R8 != "$R3\"
        RMDir /r $R3
        ${If} ${FileExists} "$R3\auracode.exe"
          DetailPrint "auracode's old program could not be removed yet: $R3"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro O7_RETIRE_AURACODE
!macroend
