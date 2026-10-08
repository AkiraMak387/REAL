@echo off
title Servidor El Nevado
cd /d "%~dp0Backend"

rem Busca Python: primero el entorno virtual .venv, luego "py", luego "python"
set "PY="
if exist "%~dp0.venv\Scripts\python.exe" set PY="%~dp0.venv\Scripts\python.exe"
if not defined PY if exist "%~dp0Backend\.venv\Scripts\python.exe" set PY="%~dp0Backend\.venv\Scripts\python.exe"
if not defined PY (py -3.11 --version >nul 2>&1 && set "PY=py -3.11")
if not defined PY (py --version >nul 2>&1 && set "PY=py")
if not defined PY (python --version >nul 2>&1 && set "PY=python")
if not defined PY (
    echo No se encontro Python en esta computadora.
    echo Instala Python 3.11 desde python.org y marca "Add python.exe to PATH".
    pause
    exit /b
)
echo Usando: %PY%
%PY% -c "import sys; print('Ruta de Python:', sys.executable)"

rem Instala la libreria de cifrado si hace falta
%PY% -c "import cryptography" >nul 2>&1 || %PY% -m pip install cryptography

rem Instala el reconocimiento facial si hace falta (en el mismo Python que corre el servidor)
%PY% -c "import cv2, numpy, onnxruntime, insightface" >nul 2>&1 || (
    echo Instalando el reconocimiento facial, esto puede tardar unos minutos...
    %PY% -m pip install numpy opencv-python onnxruntime insightface
)

rem Abre el navegador en 2 segundos, cuando el servidor ya este listo
start "" /b cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8000"

%PY% servidor.py
pause