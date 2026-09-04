@echo off
cd /d "%~dp0"
echo Iniciando Posiciones de Clientes en http://localhost:5501 ...
start "" http://localhost:5501
npx --yes serve -l 5501 .
