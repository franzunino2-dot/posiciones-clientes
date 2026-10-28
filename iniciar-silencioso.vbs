' Lanza servidor-siempre.ps1 sin ventana. Es lo que se ejecuta al iniciar sesión en Windows.
' La ruta es fija para que también funcione copiado a la carpeta Inicio (shell:startup).
carpeta = "C:\Users\Usuario\Documents\GitHub\posiciones-clientes"
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & carpeta & "\servidor-siempre.ps1""", 0, False
