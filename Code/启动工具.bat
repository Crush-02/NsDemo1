@echo off
chcp 65001 >nul
:: Switch to script directory (compatible with any path)
cd /d "%~dp0"

:: Check Node.js: try PATH first, then scan common install locations (incl. nvm)
set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 (
    for /f "delims=" %%i in ('where node') do set "NODE_EXE=%%i" & goto :node_ready
)

:: Not in PATH -> scan common locations
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
:: nvm-windows: %NVM_HOME% or %APPDATA%\nvm\<version>\node.exe
if not defined NODE_EXE if defined NVM_HOME (
    for /d %%d in ("%NVM_HOME%\v*") do set "NODE_EXE=%%d\node.exe" & goto :node_ready
)
if not defined NODE_EXE (
    for /d %%d in ("%APPDATA%\nvm\v*") do set "NODE_EXE=%%d\node.exe" & goto :node_ready
)

:: WorkBuddy managed node: %USERPROFILE%\.workbuddy\binaries\node\versions\<ver>\node.exe
if not defined NODE_EXE (
    for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do set "NODE_EXE=%%d\node.exe"
)

:node_ready
if not defined NODE_EXE (
    echo ERROR: Node.js not found in PATH or common install locations.
    echo 1^) Install Node.js LTS from https://nodejs.org/ and tick "Add to PATH" during setup.
    echo 2^) If you use nvm, run:  nvm install lts/*  then  nvm use lts/*
    echo 3^) Or restart your terminal after installing Node.js so PATH is refreshed.
    pause
    exit /b 1
)

:: Put node directory on PATH for this session so npm / npx work too
set "NODE_DIR=%NODE_EXE:\node.exe=%"
set "PATH=%NODE_DIR%;%PATH%"

:: Check if node_modules exists, install if not
if not exist "node_modules\" (
    echo Dependencies not found, installing...
    call npm install --registry=https://registry.npmmirror.com
    if errorlevel 1 (
        echo Install failed! Cleaning cache and retrying...
        call npm cache clean --force
        rmdir /s /q node_modules 2>nul
        call npm install --registry=https://registry.npmmirror.com
        if errorlevel 1 (
            echo Install failed again! Please check network or Node.js version.
            pause
            exit /b 1
        )
    )
)

echo.
echo ============================================
echo   Dev server starting...
echo   Open browser: http://localhost:3000
echo   Press Ctrl+C to stop
echo ============================================
echo.

call npx vite --host
if errorlevel 1 (
    echo.
    echo Server failed to start! Trying to reinstall dependencies...
    echo Cleaning node_modules and npm cache...
    rmdir /s /q node_modules
    call npm cache clean --force
    echo Reinstalling dependencies...
    call npm install --registry=https://registry.npmmirror.com
    if errorlevel 1 (
        echo Reinstall failed! Please check network or Node.js version.
        pause
        exit /b 1
    )
    echo.
    echo Retrying server start...
    call npx vite --host
)

pause