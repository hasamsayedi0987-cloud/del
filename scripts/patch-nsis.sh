#!/usr/bin/env bash
# پچ NSIS برای بیلد تک‌مرحله‌ای ویندوز بدون wine — همراه apps/desktop/build/installer.nsi دل
# اجرا: بعد از اولین بیلد electron-builder (که NSIS و قالب‌ها را می‌آورد)
# نکته: پچ روی قالب‌های electron-builder اعمال می‌شود (app-builder-lib/templates/nsis/include)، نه کش NSIS.
set -e
TPL=$(ls -d /home/z/my-project/del/node_modules/.pnpm/app-builder-lib@25.1.8*/node_modules/app-builder-lib/templates/nsis/include 2>/dev/null | head -1)
[ -d "$TPL" ] || { echo "app-builder-lib templates not found"; exit 1; }

python3 - "$TPL" <<'PYEOF'
import sys, os
inc = sys.argv[1]

# ۱) getProcessInfo.nsh — dispatch بر اساس __UNINSTALL__ برای اسکریپت تک‌فازی (بدون wine)
src = os.path.join(inc, 'getProcessInfo.nsh')
text = open(src).read()
new = text.replace("""    !ifdef BUILD_UNINSTALLER
        Call un._GetProcessInfo
    !else
        Call _GetProcessInfo
    !endif""", """    !ifdef __UNINSTALL__
        Call un._GetProcessInfo
    !else
        Call _GetProcessInfo
    !endif""").replace("""!ifndef BUILD_UNINSTALLER
Function _GetProcessInfo
    !insertmacro FUNC_GETPROCESSINFO
FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
Function un._GetProcessInfo
    !insertmacro FUNC_GETPROCESSINFO
FunctionEnd
!endif""", """Function _GetProcessInfo
    !insertmacro FUNC_GETPROCESSINFO
FunctionEnd

Function un._GetProcessInfo
    !insertmacro FUNC_GETPROCESSINFO
FunctionEnd""")
if '__UNINSTALL__' in new:
    open(src,'w').write(new)
    print("getProcessInfo.nsh patched")
else:
    print("getProcessInfo.nsh: pattern not found — check stock file")

# ۲) installer.nsh — گارد Fileِ UNINSTALLER_OUT_FILE (uninstaller واقعی موقع نصب ساخته می‌شود)
src = os.path.join(inc, 'installer.nsh')
text = open(src).read()
if 'DEL_NO_UNINSTALLER_FILE' not in text:
    old = '  File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"'
    if old in text:
        new = text.replace(old, """  !ifndef DEL_NO_UNINSTALLER_FILE
  File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"
  !endif""")
        open(src,'w').write(new)
        print("installer.nsh patched")
    else:
        print("installer.nsh: File line not found — check stock file")
else:
    print("installer.nsh already patched")
print("NSIS patch done")
PYEOF
