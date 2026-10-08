
import base64
import json
import os
import re
import sys
import threading
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from cryptography.fernet import Fernet, InvalidToken

# ---------------- Ajustes ----------------
HOST = "0.0.0.0"            # escucha en la red local, pero SOLO /api/identificar (la tableta) se atiende desde fuera;
                            # las páginas y los datos siguen siendo solo para esta computadora (ver _host_valido)
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


# ---------------- Rostros (InsightFace) ----------------
# Usa los mismos ajustes del Prototipo (Prototipo/config.py). La foto llega, se sacan los
# vectores en memoria y se descarta: a la base de datos solo regresa el vector CIFRADO con
# la llave de este servidor (clave_datos.key), que nunca sale de esta computadora.
sys.path.append(os.path.join(CARPETA_BASE, "Prototipo"))
try:
        import config as config_rostros  # type: ignore
except ImportError:
    config_rostros = None
NOMBRE_MODELO = getattr(config_rostros, "NOMBRE_MODELO", "buffalo_l")
TAMANO_DETECCION = tuple(getattr(config_rostros, "TAMANO_DETECCION", (320, 320)))
UMBRAL_DUPLICADO = getattr(config_rostros, "UMBRAL_DUPLICADO", 0.45)
UMBRAL_RECONOCIMIENTO = getattr(config_rostros, "UMBRAL_RECONOCIMIENTO", 0.45)

analizador_rostros = None
candado_rostros = threading.Lock()


def cargar_analizador():
    """Carga InsightFace la primera vez que se registra un rostro (tarda unos segundos)."""
    global analizador_rostros
    with candado_rostros:
        if analizador_rostros is None:
            from insightface.app import FaceAnalysis
            analizador = FaceAnalysis(name=NOMBRE_MODELO, providers=["CPUExecutionProvider"])
            analizador.prepare(ctx_id=-1, det_size=TAMANO_DETECCION)
            analizador_rostros = analizador
    return analizador_rostros


def vector_de_imagen(imagen_base64):
    """Recibe la captura (JPG en base64) y regresa el vector del único rostro que debe aparecer."""
    import cv2
    import numpy as np
    datos = base64.b64decode(imagen_base64.split(",")[-1])
    imagen = cv2.imdecode(np.frombuffer(datos, np.uint8), cv2.IMREAD_COLOR)
    if imagen is None:
        raise ValueError("La imagen no se pudo leer. Vuelve a escanear el rostro.")
    caras = cargar_analizador().get(imagen)
    if not caras:
        raise ValueError("No se detectó ningún rostro. Vuelve a escanear de frente y con buena luz.")
    if len(caras) > 1:
        raise ValueError("Se detectó más de un rostro. Solo debe aparecer una persona.")
    return caras[0].normed_embedding.astype("float32")


def mejor_coincidencia(cifrador, vector, existentes, umbral):
    """Compara contra los rostros ya registrados (llegan cifrados y se descifran aquí).
    Regresa (id, similitud) del más parecido si llega al umbral; si no, (None, similitud)."""
    import numpy as np
    mejor_id, mejor = None, 0.0
    for item in existentes or []:
        try:
            guardado = np.frombuffer(cifrador.decrypt(item["rostro"].encode("ascii")), dtype="float32")
        except (InvalidToken, KeyError, TypeError, ValueError, AttributeError):
            continue
        if guardado.shape != vector.shape:
            continue
        similitud = float(np.dot(vector, guardado))
        if similitud > mejor:
            mejor_id, mejor = item.get("id"), similitud
    return (mejor_id if mejor >= umbral else None), mejor


def rostro_duplicado(cifrador, vector, existentes):
    return mejor_coincidencia(cifrador, vector, existentes, UMBRAL_DUPLICADO)[0]


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
        # Además del encabezado Host se revisa de dónde viene la conexión: el encabezado lo puede
        # falsificar cualquier equipo de la red, la dirección de origen no.
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("localhost", "127.0.0.1") and self.client_address[0] in ("127.0.0.1", "::1")

    def _identificar(self):
        """Tableta checadora: recibe la foto y los rostros cifrados de la bodega (la tableta los lee
        de Firestore) y dice de quién es. La llave nunca sale de esta computadora."""
        largo = int(self.headers.get("Content-Length") or 0)
        if largo <= 0 or largo > MAX_TAMANO_PETICION:
            return self._responder_json(413, {"error": "Tamaño no válido"})
        try:
            cuerpo = json.loads(self.rfile.read(largo).decode("utf-8"))
            imagen = cuerpo["imagen"]
        except (ValueError, UnicodeDecodeError, KeyError, TypeError):
            return self._responder_json(400, {"error": "Petición no válida"})
        try:
            vector = vector_de_imagen(imagen)
        except ValueError:
            return self._responder_json(200, {"resultado": "sin_rostro"})  # nadie enfrente, o más de una persona
        except Exception as error:
            print(f"ERROR al procesar el rostro: {error!r}")
            return self._responder_json(500, {"error": f"No se pudo procesar el rostro: {error}"})
        quien, similitud = mejor_coincidencia(Manejador.cifrador, vector, cuerpo.get("existentes"), UMBRAL_RECONOCIMIENTO)
        if not quien:
            return self._responder_json(200, {"resultado": "no_reconocido", "similitud": round(similitud, 3)})
        return self._responder_json(200, {"resultado": "reconocido", "id": quien, "similitud": round(similitud, 3)})

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
        ruta = self.path.split("?")[0]
        if ruta == "/api/salud":
            return self._responder_json(200, {"ok": True})
        if not self._host_valido():
            return self._responder_json(403, {"error": "Acceso no permitido"})
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

    def do_POST(self):
        if self.path.split("?")[0] == "/api/identificar":
            return self._identificar()
        if not self._host_valido():
            return self._responder_json(403, {"error": "Acceso no permitido"})
        if self.path.split("?")[0] != "/api/rostro":
            return self._responder_json(404, {"error": "No existe"})

        largo = int(self.headers.get("Content-Length") or 0)
        if largo <= 0 or largo > MAX_TAMANO_PETICION:
            return self._responder_json(413, {"error": "Tamaño no válido"})
        try:
            cuerpo = json.loads(self.rfile.read(largo).decode("utf-8"))
            imagen = cuerpo["imagen"]
        except (ValueError, UnicodeDecodeError, KeyError, TypeError):
            return self._responder_json(400, {"error": "Petición no válida"})

        try:
            vector = vector_de_imagen(imagen)
        except ImportError as error:
            return self._responder_json(503, {"error": f"Falta una librería del reconocimiento facial en el Python del servidor: {error}"})
        except ValueError as error:
            return self._responder_json(422, {"error": str(error)})
        except Exception as error:
            return self._responder_json(500, {"error": f"No se pudo procesar el rostro: {error}"})

        repetido = rostro_duplicado(Manejador.cifrador, vector, cuerpo.get("existentes"))
        if repetido:
            return self._responder_json(409, {"error": f"Este rostro ya está registrado con el trabajador {repetido}."})

        # Solo se regresa el vector cifrado; la foto ya no existe en ningún lado
        rostro = Manejador.cifrador.encrypt(vector.tobytes()).decode("ascii")
        return self._responder_json(200, {"rostro": rostro})

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
            codigo = args[1] if len(args) > 1 else ""
            print(f"[{datetime.now():%H:%M:%S}] {self.command} {self.path.split('?')[0]} -> {codigo}")


def main():
    Manejador.cifrador = obtener_cifrador()
    Manejador.almacen = leer_almacen(Manejador.cifrador)
    print(f"Datos cargados: {', '.join(Manejador.almacen) or 'ninguno todavía'}")
    threading.Thread(target=cargar_analizador, daemon=True).start()  # el modelo queda listo antes de la primera checada
    
    servidor = ThreadingHTTPServer((HOST, PUERTO), Manejador)
    print(f"Servidor listo en http://127.0.0.1:{PUERTO}/  (no cierres esta ventana; Ctrl+C para detener)")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")


if __name__ == "__main__":
    main()