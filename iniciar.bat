@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install --no-audit --no-fund
)
set IP=
for /f %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '10.*' -or $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '172.16.*' } | Select-Object -First 1).IPAddress"') do set IP=%%i
echo.
echo  Posiciones de Clientes - datos reales de Gallo
echo  En esta PC:           http://localhost:5501/app.html
if defined IP echo  Desde la red local:   http://%IP%:5501/app.html
echo  (Si otra PC no abre la pagina, ejecuta habilitar-red-local.bat como administrador, una sola vez)
echo.
start "" http://localhost:5501/app.html
:loop
node servidor.js
echo.
echo  El servidor se detuvo. Reiniciando en 5 segundos... (cerra esta ventana para salir)
timeout /t 5 /nobreak >nul
goto loop
