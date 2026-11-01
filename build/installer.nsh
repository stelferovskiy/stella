!include nsDialogs.nsh
!include LogicLib.nsh

; Страница выбора ярлыков (после выбора папки установки)
!macro customHeader
  ; Цвета Stella: тёмный фон шапки и страниц приветствия/завершения, светлый текст, акцент
  !ifdef MUI_BGCOLOR
    !undef MUI_BGCOLOR
  !endif
  !define MUI_BGCOLOR 08080D
  !ifdef MUI_TEXTCOLOR
    !undef MUI_TEXTCOLOR
  !endif
  !define MUI_TEXTCOLOR ECEAE4
  BrandingText "Stella"
!macroend

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
    ; Тихое обновление (/S): страницы нет, поэтому ярлыки создаём сами, если их нет
    ${If} ${Silent}
      ${IfNot} ${FileExists} "$DESKTOP\Stella.lnk"
        CreateShortCut "$DESKTOP\Stella.lnk" "$INSTDIR\Stella.exe" "" "$INSTDIR\resources\icon.ico" 0
      ${EndIf}
      ${IfNot} ${FileExists} "$SMPROGRAMS\Stella.lnk"
        CreateShortCut "$SMPROGRAMS\Stella.lnk" "$INSTDIR\Stella.exe" "" "$INSTDIR\resources\icon.ico" 0
      ${EndIf}
    ${EndIf}
    ${If} $StellaWantDesktop == ${BST_CHECKED}
        CreateShortCut "$DESKTOP\Stella.lnk" "$INSTDIR\Stella.exe" "" "$INSTDIR\resources\icon.ico" 0
    ${EndIf}
    ${If} $StellaWantStart == ${BST_CHECKED}
        CreateShortCut "$SMPROGRAMS\Stella.lnk" "$INSTDIR\Stella.exe" "" "$INSTDIR\resources\icon.ico" 0
    ${EndIf}
  !endif
!macroend

!macro customUnInstall
  ; Тихий запуск деинсталлятора = обновление: ярлыки оставляем
  ${IfNot} ${Silent}
    Delete "$DESKTOP\Stella.lnk"
    Delete "$SMPROGRAMS\Stella.lnk"
  ${EndIf}
!macroend
