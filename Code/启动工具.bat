@echo off
chcp 65001 >nul
:: 切换到脚本所在目录（兼容任何路径）
cd /d "%~dp0"

:: Check Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: 检查 node_modules 是否存在，不存在则安装依赖
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
