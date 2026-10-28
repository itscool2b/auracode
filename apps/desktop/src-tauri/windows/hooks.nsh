; auracode's hooks for Tauri's NSIS uninstaller (tauri.conf.json: bundle > windows > nsis).
;
; What to delete is decided in Rust, by `auracode.exe --uninstall-cleanup`
; (apps/desktop/src-tauri/src/uninstall.rs, over aura-core's uninstall module). This file only
; decides whether that runs, and stops Tauri's own "delete app data" step, which would remove the
; data folder whole, worktrees the person chose to keep included.
;
; - The confirm page's checkbox reads "Keep my auracode data" (windows/English.nsh). Unticked,
;   which is the default, auracode deletes its data. A quiet uninstall (/S or /P) deletes it too,
;   without dialogs, and keeps worktrees with unsaved work; /KEEPDATA keeps everything.
; - An update (/UPDATE) keeps everything, and so does the uninstall a newer installer runs before
;   installing: it runs this uninstaller in place (`_?=`), so $EXEDIR is the install folder, while
;   an uninstall started from Settings runs from a temporary copy.
; - The person's agents, their settings and their repositories are never touched.
;
; Exit codes of the cleanup: 0 done, 3 auracode is still running (nothing deleted), 4 something
; could not be deleted (the cleanup listed it).

Var AuracodeDeleteData
Var AuracodeCleanupFlags
Var AuracodeCleanupLater

; Runs the cleanup from `program`; its exit code lands in $R9 ("none" when it did not start).
!macro AURACODE_CLEANUP program
  ClearErrors
  ExecWait '"${program}" --uninstall-cleanup $AuracodeCleanupFlags' $R9
  ${If} ${Errors}
    StrCpy $R9 "none"
  ${EndIf}
!macroend

!macro AURACODE_CLEANUP_RESULT
  ${If} $R9 == "0"
    DetailPrint "auracode's data is deleted"
  ${ElseIf} $R9 == "4"
    DetailPrint "Some of auracode's data could not be deleted"
  ${Else}
    DetailPrint "auracode's data was not deleted (cleanup result $R9)"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $AuracodeDeleteData 1
  StrCpy $AuracodeCleanupLater 0
  ${If} $DeleteAppDataCheckboxState = 1
    StrCpy $AuracodeDeleteData 0
  ${EndIf}
  ; Tauri's own step removes both data folders whole; the cleanup does it around kept worktrees.
  StrCpy $DeleteAppDataCheckboxState 0
  ${If} $UpdateMode = 1
    StrCpy $AuracodeDeleteData 0
  ${EndIf}
  ${If} $EXEDIR == $INSTDIR
    StrCpy $AuracodeDeleteData 0
  ${EndIf}
  ClearErrors
  ${GetOptions} $CMDLINE "/KEEPDATA" $R9
  ${IfNot} ${Errors}
    StrCpy $AuracodeDeleteData 0
  ${EndIf}
  ${If} $AuracodeDeleteData = 1
    DetailPrint "Deleting auracode's data"
    StrCpy $AuracodeCleanupFlags "--interactive"
    ${If} $PassiveMode = 1
    ${OrIf} ${Silent}
      StrCpy $AuracodeCleanupFlags ""
    ${EndIf}
    !insertmacro AURACODE_CLEANUP "$INSTDIR\${MAINBINARYNAME}.exe"
    ${If} $R9 == "3"
      ; auracode did not quit when asked. Tauri's own check, next, offers to close it; the cleanup
      ; then runs after the files are removed, from a copy of the program.
      InitPluginsDir
      CopyFiles /SILENT "$INSTDIR\${MAINBINARYNAME}.exe" "$PLUGINSDIR\auracode-cleanup.exe"
      StrCpy $AuracodeCleanupLater 1
    ${Else}
      !insertmacro AURACODE_CLEANUP_RESULT
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $AuracodeCleanupLater = 1
    !insertmacro AURACODE_CLEANUP "$PLUGINSDIR\auracode-cleanup.exe"
    !insertmacro AURACODE_CLEANUP_RESULT
  ${EndIf}
  ${If} $AuracodeDeleteData = 1
    ; The installer's own records, as Tauri's "delete app data" step clears them.
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"
    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"
    ; Windows' notification settings for auracode.
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\${BUNDLEID}"
  ${EndIf}
!macroend
