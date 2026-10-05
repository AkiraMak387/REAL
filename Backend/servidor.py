"""Servidor local del sistema El Nevado.

Hace dos cosas:
  1. Entrega las páginas de la carpeta Frontend (ya no se abren como archivo).
  2. Guarda todo lo que el sistema registra en UN solo archivo cifrado:
     datos/almacen.dat  (cifrado con Fernet: AES-128 + HMAC).

Sin la llave (clave_datos.key) el archivo no se puede leer, así que:
  - NUNCA subas clave_datos.key ni la carpeta datos/ a GitHub.
  - Si pierdes la llave, se pierden los datos. Guárdala en un lugar seguro aparte.

Uso:
    pip install cryptography
    python servidor.py
    -> abre http://127.0.0.1:8000/  (o usa iniciar.bat)
"""
import json
import os
import re
import sys
import threading
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from cryptography.fernet import Fernet, InvalidToken

# ---------------- Ajustes ----------------
HOST = "127.0.0.1"          # solo esta computadora; nadie de la red puede entrar
PUERTO = 8000
MAX_RESPALDOS = 30          # copias anteriores (también cifradas) que se conservan
MAX_TAMANO_PETICION = 10 * 1024 * 1024  # 10 MB

CARPETA_BASE = os.path.dirname(os.path.abspath(__file__))
CARPETA_FRONTEND = os.path.join(CARPETA_BASE, "..", "Frontend")
CARPETA_DATOS = os.path.join(CARPETA_BASE, "datos")
CARPETA_RESPALDOS = os.path.join(CARPETA_DATOS, "respaldos")
RUTA_ALMACEN = os.path.join(CARPETA_DATOS, "almacen.dat")
RUTA_CLAVE = os.path.join(CARPETA_BASE, "clave_datos.key")

# Solo se aceptan claves del sistema, p. ej. "elnevado.empleados.v2"
PATRON_CLAVE = re.compile(r"^elnevado\.[a-z0-9_.-]{1,60}$")

candado = threading.Lock()


# ---------------- Cifrado ----------------
def obtener_cifrador():
    """Carga la llave. Si no existe la crea, pero solo cuando todavía no hay datos:
    crear una llave nueva con datos existentes los dejaría ilegibles para siempre."""
    if not os.path.exists(RUTA_CLAVE):
        if os.path.exists(RUTA_ALMACEN):
            sys.exit(
                "ERROR: existe datos/almacen.dat pero falta clave_datos.key.\n"
                "Recupera la llave original; no se generará una nueva para no perder los datos."
            )
        with open(RUTA_CLAVE, "wb") as f:
            f.write(Fernet.generate_key())
        print("Se generó una llave nueva: clave_datos.key (respáldala y no la subas a GitHub).")

    with open(RUTA_CLAVE, "rb") as f:
        return Fernet(f.read().strip())


def leer_almacen(cifrador):
    """Descifra el archivo y regresa un diccionario {clave: valor}."""
    if not os.path.exists(RUTA_ALMACEN):
        return {}
    with open(RUTA_ALMACEN, "rb") as f:
        contenido = f.read()
    try:
        return json.loads(cifrador.decrypt(contenido).decode("utf-8"))
    except InvalidToken:
        sys.exit("ERROR: almacen.dat no se puede descifrar con esta llave (¿llave equivocada o archivo dañado?).")


def escribir_almacen(cifrador, datos):
    """Cifra y guarda. Primero respalda la versión anterior y luego escribe
    en un archivo temporal que reemplaza al original de un solo golpe,
    así un corte de luz a medio guardado no corrompe los datos."""
    os.makedirs(CARPETA_RESPALDOS, exist_ok=True)

    if os.path.exists(RUTA_ALMACEN):
        sello = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        with open(RUTA_ALMACEN, "rb") as origen, \
             open(os.path.join(CARPETA_RESPALDOS, f"almacen-{sello}.dat"), "wb") as copia:
            copia.write(origen.read())
        respaldos = sorted(os.listdir(CARPETA_RESPALDOS))
        for viejo in respaldos[:-MAX_RESPALDOS]:
            os.remove(os.path.join(CARPETA_RESPALDOS, viejo))

    cifrado = cifrador.encrypt(json.dumps(datos, ensure_ascii=False).encode("utf-8"))
    temporal = RUTA_ALMACEN + ".tmp"
    with open(temporal, "wb") as f:
        f.write(cifrado)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temporal, RUTA_ALMACEN)


# ---------------- Servidor ----------------
class Manejador(SimpleHTTPRequestHandler):
    cifrador = None
    almacen = {}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=CARPETA_FRONTEND, **kwargs)

    # Evita que otra página web abierta en el navegador use este servidor
    # (protección contra "DNS rebinding"): solo se atiende a localhost.
    def _host_valido(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("localhost", "127.0.0.1")

    def _responder_json(self, codigo, cuerpo):
        datos = json.dumps(cuerpo, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def _clave_de_ruta(self):
        clave = self.path.split("?")[0].removeprefix("/api/datos/")
        return clave if PATRON_CLAVE.match(clave) else None

    def do_GET(self):
        if not self._host_valido():
            return self._responder_json(403, {"error": "Acceso no permitido"})
        ruta = self.path.split("?")[0]
        if ruta == "/api/salud":
            return self._responder_json(200, {"ok": True})
        if ruta == "/api/datos":
            with candado:
                return self._responder_json(200, Manejador.almacen)
        if ruta.startswith("/api/"):
            return self._responder_json(404, {"error": "No existe"})
        return super().do_GET()

    def do_HEAD(self):
        if not self._host_valido():
            return self._responder_json(403, {"error": "Acceso no permitido"})
        return super().do_HEAD()

    def do_PUT(self):
        if not self._host_valido():
            return self._responder_json(403, {"error": "Acceso no permitido"})
        clave = self._clave_de_ruta()
        if not clave:
            return self._responder_json(400, {"error": "Clave no válida"})

        largo = int(self.headers.get("Content-Length") or 0)
        if largo <= 0 or largo > MAX_TAMANO_PETICION:
            return self._responder_json(413, {"error": "Tamaño no válido"})
        try:
            valor = json.loads(self.rfile.read(largo).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self._responder_json(400, {"error": "JSON no válido"})

        with candado:
            nuevo = {**Manejador.almacen, clave: valor}
            try:
                escribir_almacen(Manejador.cifrador, nuevo)
            except OSError as error:
                return self._responder_json(500, {"error": f"No se pudo escribir el archivo: {error}"})
            Manejador.almacen = nuevo
        return self._responder_json(200, {"ok": True})

    def do_DELETE(self):
        if not self._host_valido():
            return self._responder_json(403, {"error": "Acceso no permitido"})
        clave = self._clave_de_ruta()
        if not clave:
            return self._responder_json(400, {"error": "Clave no válida"})
        with candado:
            if clave in Manejador.almacen:
                nuevo = {k: v for k, v in Manejador.almacen.items() if k != clave}
                escribir_almacen(Manejador.cifrador, nuevo)
                Manejador.almacen = nuevo
        return self._responder_json(200, {"ok": True})

    def log_message(self, formato, *args):
        # Solo se muestran en consola las peticiones a la API (no cada CSS o imagen)
        if self.path.startswith("/api/") and not self.path.startswith("/api/salud"):
            print(f"[{datetime.now():%H:%M:%S}] {self.command} {self.path.split('?')[0]}")


def main():
    Manejador.cifrador = obtener_cifrador()
    Manejador.almacen = leer_almacen(Manejador.cifrador)
    print(f"Datos cargados: {', '.join(Manejador.almacen) or 'ninguno todavía'}")

    servidor = ThreadingHTTPServer((HOST, PUERTO), Manejador)
    print(f"Servidor listo en http://127.0.0.1:{PUERTO}/  (no cierres esta ventana; Ctrl+C para detener)")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")


if __name__ == "__main__":
    main()
