!include nsDialogs.nsh
!include LogicLib.nsh

; Страница выбора ярлыков (после выбора папки установки)
!macro customPageAfterChangeDir
  Var StellaShortcutDialog
  Var StellaDesktopBox
  Var StellaStartBox
  Var StellaWantDesktop
  Var StellaWantStart

  Page custom StellaShortcutsCreate StellaShortcutsLeave

  Function StellaShortcutsCreate
    !insertmacro MUI_HEADER_TEXT "Ярлыки" "Где создать ярлыки для запуска Stella?"
    nsDialogs::Create 1018
    Pop $StellaShortcutDialog
    ${If} $StellaShortcutDialog == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 20u "Отметьте, где нужны ярлыки. Это можно изменить позже, переустановив программу."
    Pop $0
    ${NSD_CreateCheckbox} 0 28u 100% 14u "Создать ярлык на рабочем столе"
    Pop $StellaDesktopBox
    ${NSD_CreateCheckbox} 0 48u 100% 14u "Создать ярлык в меню «Пуск»"
    Pop $StellaStartBox
    ${If} $StellaWantDesktop == ""
      ${NSD_Check} $StellaDesktopBox
      ${NSD_Check} $StellaStartBox
    ${Else}
      ${If} $StellaWantDesktop == ${BST_CHECKED}
        ${NSD_Check} $StellaDesktopBox
      ${EndIf}
      ${If} $StellaWantStart == ${BST_CHECKED}
        ${NSD_Check} $StellaStartBox
      ${EndIf}
    ${EndIf}
    nsDialogs::Show
  FunctionEnd

  Function StellaShortcutsLeave
    ${NSD_GetState} $StellaDesktopBox $StellaWantDesktop
    ${NSD_GetState} $StellaStartBox $StellaWantStart
  FunctionEnd
!macroend

!macro customInstall
  !ifndef BUILD_UNINSTALLER
    ${If} $StellaWantDesktop == ${BST_CHECKED}
      CreateShortCut "$DESKTOP\Stella.lnk" "$INSTDIR\Stella.exe" "" "$INSTDIR\resources\icon.ico" 0
    ${EndIf}
    ${If} $StellaWantStart == ${BST_CHECKED}
      CreateShortCut "$SMPROGRAMS\Stella.lnk" "$INSTDIR\Stella.exe" "" "$INSTDIR\resources\icon.ico" 0
    ${EndIf}
  !endif
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Stella.lnk"
  Delete "$SMPROGRAMS\Stella.lnk"
!macroend
