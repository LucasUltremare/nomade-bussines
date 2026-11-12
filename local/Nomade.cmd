@echo off
rem =======================================================================
rem Nomade Business - Windows: double-click to start Nomade.
rem No Docker, no admin rights, no PowerShell. Uses the system Node (20.19+)
rem or downloads a portable Node to %LOCALAPPDATA%\NomadeBusiness\runtime
rem with the curl.exe and tar.exe that ship with Windows 10 and 11.
rem
rem   Nomade.cmd                start
rem   Nomade.cmd configurar     answer the setup questions again
rem   Nomade.cmd diagnostico    check what works on this computer
rem
rem This file must keep CRLF line endings and plain ASCII (.gitattributes).
rem =======================================================================
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Nomade Business

set "AQUI=%~dp0"
if exist "%AQUI%package.json" (set "RAIZ=%AQUI%") else (set "RAIZ=%AQUI%..\")
cd /d "%RAIZ%"

set "NODE_VER=24.22.2"
set "ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
if defined NOMADE_DADOS (set "DADOS=%NOMADE_DADOS%") else (set "DADOS=%LOCALAPPDATA%\NomadeBusiness")
set "RUNTIME=%DADOS%\runtime"
set "NOME=node-v%NODE_VER%-win-%ARCH%"
set "NODE=%RUNTIME%\%NOME%\node.exe"

if exist "%NODE%" goto rodar

rem is the system Node new enough?
if "%NOMADE_NODE_PORTATIL%"=="1" goto baixar
where node >nul 2>nul
if errorlevel 1 goto baixar
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)" >nul 2>nul
if errorlevel 1 goto baixar
set "NODE=node"
goto rodar

:baixar
rem company proxy set only in Windows settings, not in the environment: curl needs it.
rem Per-protocol lists like http=a:1;https=b:2 are skipped here; iniciar.mjs reads them.
if not defined HTTPS_PROXY (
  set "PXON="
  for /f "tokens=3" %%a in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable 2^>nul ^| find "ProxyEnable"') do set "PXON=%%a"
  if "!PXON!"=="0x1" (
    for /f "tokens=3" %%a in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer 2^>nul ^| find "ProxyServer"') do set "PX=%%a"
    if defined PX if "!PX:http=!"=="!PX!" set "HTTPS_PROXY=http://!PX!"
  )
)
where curl.exe >nul 2>nul
if errorlevel 1 goto manual
where tar.exe >nul 2>nul
if errorlevel 1 goto manual
if not exist "%RUNTIME%" mkdir "%RUNTIME%"
set "ZIP=%RUNTIME%\%NOME%.zip"
set "URL=https://nodejs.org/dist/v%NODE_VER%/%NOME%.zip"
if not exist "%ZIP%" if exist "%USERPROFILE%\Downloads\%NOME%.zip" copy /y "%USERPROFILE%\Downloads\%NOME%.zip" "%ZIP%" >nul
if exist "%ZIP%" goto conferir
echo.
echo   Node.js %NODE_VER% (~35 MB, once / uma vez / una vez)...
curl.exe -fL --retry 2 --connect-timeout 20 --progress-bar -o "%ZIP%" "%URL%"
if errorlevel 1 (
  del /q "%ZIP%" >nul 2>nul
  goto manual
)

:conferir
set "ESPERADO="
set "OBTIDO="
curl.exe -fsSL -o "%RUNTIME%\SHASUMS256.txt" "https://nodejs.org/dist/v%NODE_VER%/SHASUMS256.txt" >nul 2>nul
if exist "%RUNTIME%\SHASUMS256.txt" (
  for /f "tokens=1" %%h in ('findstr /c:"%NOME%.zip" "%RUNTIME%\SHASUMS256.txt"') do set "ESPERADO=%%h"
  del /q "%RUNTIME%\SHASUMS256.txt" >nul 2>nul
)
for /f "skip=1 delims=" %%h in ('certutil -hashfile "%ZIP%" SHA256') do if not defined OBTIDO set "OBTIDO=%%h"
set "OBTIDO=!OBTIDO: =!"
if defined ESPERADO if /i not "!OBTIDO!"=="!ESPERADO!" (
  del /q "%ZIP%" >nul 2>nul
  echo   x The Node download is corrupted. Open Nomade again. / O download veio corrompido. Abra de novo.
  goto erro
)
tar.exe -xf "%ZIP%" -C "%RUNTIME%"
if errorlevel 1 goto manual
del /q "%ZIP%" >nul 2>nul
if not exist "%NODE%" goto manual
goto rodar

:manual
echo.
echo   x Download failed / Nao deu pra baixar / No se pudo descargar:
echo     https://nodejs.org/dist/v%NODE_VER%/%NOME%.zip
echo     -^> %RUNTIME%\
echo   Download it in the browser, put the .zip in that folder and open Nomade again.
echo   Baixe pelo navegador, coloque o .zip nessa pasta e abra o Nomade de novo.
if not exist "%RUNTIME%" mkdir "%RUNTIME%"
start "" explorer.exe "%RUNTIME%"
goto erro

:rodar
"%NODE%" "%RAIZ%local\iniciar.mjs" %*
if errorlevel 1 goto erro
exit /b 0

:erro
echo.
pause
exit /b 1
