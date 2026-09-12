@echo off
cd /d "%~dp0"
chcp 65001 >nul
node\node.exe stop.mjs
timeout /t 2 >nul
