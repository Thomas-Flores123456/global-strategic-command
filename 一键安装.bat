@echo off
chcp 65001 >nul
title SillyTavern-世界观构建 · PC 一键依赖安装
echo ========================================================================
echo [统帅部] 正在检查本地运行环境并安装工程依赖...
echo ========================================================================
echo.
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 goto :NO_NODE
where pnpm >nul 2>nul
if %ERRORLEVEL% EQU 0 goto :DO_INSTALL
echo [提示] 未检测到 pnpm，正在为您自动安装全局 pnpm...
call npm install -g pnpm
where pnpm >nul 2>nul
if %ERRORLEVEL% EQU 0 goto :DO_INSTALL
echo [提示] 正在尝试通过 corepack 启用 pnpm...
call corepack enable
call corepack prepare pnpm@latest --activate
where pnpm >nul 2>nul
if %ERRORLEVEL% NEQ 0 goto :NO_PNPM
:DO_INSTALL
echo [安装] 正在进入 mvu指挥系统 执行 pnpm install...
pushd "%~dp0mvu指挥系统"
call pnpm install
set INSTALL_CODE=%ERRORLEVEL%
popd
if %INSTALL_CODE% NEQ 0 goto :INSTALL_FAIL
echo.
echo ========================================================================
echo [完成] 所有依赖安装完毕！接下来只需：
echo   1. 在酒馆助手页面中安装根目录下的「同步世界书-酒馆助手脚本.js」
echo   2. 双击运行「一键启动.bat」启动项目
echo   3. 打开角色卡，Enjoy!
echo ========================================================================
if /I not "%~1"=="--no-pause" pause
exit /b 0
:NO_NODE
echo [错误] 未检测到 Node.js，请先前往 https://nodejs.org/ 安装 Node.js (建议 ^>= 20)。
if /I not "%~1"=="--no-pause" pause
exit /b 1
:NO_PNPM
echo [错误] pnpm 自动安装失败，请手动执行: npm install -g pnpm
if /I not "%~1"=="--no-pause" pause
exit /b 1
:INSTALL_FAIL
echo [错误] 依赖安装异常退出（退出码: %INSTALL_CODE%），请检查上方报错日志。
if /I not "%~1"=="--no-pause" pause
exit /b %INSTALL_CODE%
