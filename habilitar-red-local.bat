@echo off
rem Abre el puerto 5501 en el firewall de Windows para que otras PCs de la red local entren a la plataforma.
rem Solo se ejecuta una vez. Pide permisos de administrador.
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Pidiendo permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
netsh advfirewall firewall delete rule name="Posiciones de Clientes 5501" >nul 2>&1
netsh advfirewall firewall add rule name="Posiciones de Clientes 5501" dir=in action=allow protocol=TCP localport=5501 profile=private,domain
echo.
echo Listo: el puerto 5501 quedo abierto en redes privadas y de dominio.
pause
