@echo off
title Dominio do Chefe
chcp 65001 >nul
cd /d "%~dp0"

rem Usa o Node que vem no pacote (pasta runtime). Se nao tiver, usa o instalado no PC.
set "NODE=node"
if exist "%~dp0runtime\node.exe" set "NODE=%~dp0runtime\node.exe"

"%NODE%" -v >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Node.js nao encontrado. A pasta "runtime" esta faltando no pacote.
  echo.
  pause
  exit /b 1
)

rem Tela de abertura + chave Pix (so na abertura, nao nas reinicializacoes)
"%NODE%" src\inicio.js
if errorlevel 1 (
  pause
  exit /b 1
)

:loop
"%NODE%" src\index.js
echo.
echo Sistema parou. Reiniciando em 10 segundos... (feche a janela para parar)
timeout /t 10 /nobreak >nul
goto loop
