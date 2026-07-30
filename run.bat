@echo off
REM Lokasyon Operasyon Paneli - yerel calistirma
set PATH=%PATH%;C:\Users\Mdegimli\OneDrive - Propelis\Desktop\Claude Code\node-v24.18.0-win-x64
cd /d "%~dp0"
set PORT=3500
node server.js
