@echo off
title Clicks Burger - Recompilando .exe...
color 0E
echo.
echo  ================================================
echo   CLICKS BURGER - Generador de ejecutable
echo  ================================================
echo.
echo  Compilando nuevo Clicks Burger.exe...
echo  (Esto puede tardar 1-2 minutos la primera vez)
echo.

cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo  ERROR: Node.js no esta instalado.
  echo  Instala Node.js desde https://nodejs.org y volvé a ejecutar este archivo.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\pkg.cmd" (
  echo  Instalando dependencias...
  call npm install
  if %errorlevel% neq 0 (
    echo  ERROR al instalar dependencias.
    pause
    exit /b 1
  )
)

echo  Compilando...
call node_modules\.bin\pkg . --output "Clicks Burger.exe"
if %errorlevel% neq 0 (
  echo.
  echo  ERROR al compilar. Revisa los mensajes de arriba.
  pause
  exit /b 1
)

echo.
echo  ================================================
echo   LISTO! Clicks Burger.exe fue actualizado.
echo  ================================================
echo.
echo  Ya podes cerrar esta ventana.
echo.
pause
