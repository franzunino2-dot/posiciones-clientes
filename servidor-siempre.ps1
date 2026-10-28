# Mantiene el servidor de Posiciones de Clientes siempre arriba:
#  - lo reinicia a los 5 segundos si se cae por cualquier motivo,
#  - le avisa a Windows que no suspenda la PC mientras corre (la suspensión era lo que lo bajaba),
#  - deja todo lo que pasa en servidor.log, para saber por qué se detuvo.
# Se lanza solo al iniciar sesión (acceso directo en la carpeta Inicio) o a mano con iniciar-silencioso.vbs.

Set-Location $PSScriptRoot
$log = Join-Path $PSScriptRoot 'servidor.log'

# Una sola copia: si el puerto ya está en uso, hay otro servidor andando.
if (Get-NetTCPConnection -LocalPort 5501 -State Listen -ErrorAction SilentlyContinue) { exit 0 }

Add-Type -Namespace Win -Name Energia -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
$ES_CONTINUOUS_SISTEMA = [uint32]2147483649   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED: la PC no se suspende por inactividad

while ($true) {
  [Win.Energia]::SetThreadExecutionState($ES_CONTINUOUS_SISTEMA) | Out-Null
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) { Move-Item $log "$log.1" -Force }
  "[$(Get-Date -Format 's')] arrancando el servidor" | Add-Content $log
  cmd /c "node servidor.js >> ""$log"" 2>&1"
  "[$(Get-Date -Format 's')] el servidor se detuvo (código $LASTEXITCODE); se reinicia en 5 segundos" | Add-Content $log
  Start-Sleep -Seconds 5
}
