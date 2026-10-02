@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install --no-audit --no-fund
)
echo Iniciando Posiciones de Clientes en http://localhost:5501 ...
start "" http://localhost:5501
node servidor.js
