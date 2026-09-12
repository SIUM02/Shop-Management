@echo off
rem Same launcher as the shortcut, but leaves the console visible so that
rem any error stays on screen instead of vanishing with the window.
cd /d "%~dp0"
chcp 65001 >nul
title Dokan Inventory
node\node.exe launch.mjs
echo.
echo Shop stopped. Close this window.
pause
