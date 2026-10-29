@echo off
chcp 65001 >nul
title SillyTavern-世界观构建 · PC 一键启动总控
node "%~dp0一键启动.mjs" %*
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [提示] 启动器异常退出（退出码: %ERRORLEVEL%），请检查上方日志。
  pause
)
