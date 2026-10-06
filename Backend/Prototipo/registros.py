"""Módulo para la gestión, almacenamiento cifrado y eliminación de registros faciales."""
import os
import csv
import json
import unicodedata
from datetime import date, datetime
import numpy as np
from cryptography.fernet import Fernet, InvalidToken

# Rutas base del proyecto
CARPETA_BASE = os.path.dirname(os.path.abspath(__file__))
CARPETA_REGISTROS = os.path.join(CARPETA_BASE, "registros_faciales")
RUTA_CLAVE = os.path.join(CARPETA_BASE, "clave.key")
RUTA_ASISTENCIAS = os.path.join(CARPETA_BASE, "asistencias.csv")


def _obtener_cifrador():
    """Carga o genera la clave simétrica Fernet para cifrar los registros biométricos.
    
    Aviso: Si se elimina 'clave.key', los registros existentes no se podrán recuperar.
    """
    if not os.path.exists(RUTA_CLAVE):
        with open(RUTA_CLAVE, "wb") as f:
            f.write(Fernet.generate_key())
        print("Se generó una llave nueva (clave.key).")

    with open(RUTA_CLAVE, "rb") as f:
        return Fernet(f.read().strip())


def limpiar_nombre(nombre):
    """Elimina acentos, caracteres especiales y espacios redundantes de una cadena."""
    sin_acentos = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode("ascii")
    return " ".join(sin_acentos.split())


def _ruta_archivo(nombre):
    """Genera la ruta absoluta del archivo de registro a partir del nombre de la persona."""
    nombre = limpiar_nombre(nombre).lower()
    seguro = "".join(c if c.isalnum() else "_" for c in nombre)
    return os.path.join(CARPETA_REGISTROS, seguro + ".dat")


def existe_registro(nombre):
    """Verifica si el archivo de registro de una persona ya existe en el disco."""
    return os.path.exists(_ruta_archivo(nombre))


def guardar_registro(nombre, vector):
    """Cifra y almacena el embedding facial asociado al nombre de una persona."""
    os.makedirs(CARPETA_REGISTROS, exist_ok=True)

    # Conversión del embedding a tipo flotante estándar
    vector = np.asarray(vector, dtype=np.float32)

    # Si la persona ya existía (se está actualizando su foto), se conserva su
    # fecha de registro original para no perder su antigüedad
    _, fechas = cargar_registros_con_fechas()
    fecha_registro = fechas.get(nombre) or date.today()

    # Serialización y cifrado de los datos en formato UTF-8
    datos = json.dumps({
        "nombre": nombre,
        "vector": vector.tolist(),
        "fecha_registro": fecha_registro.isoformat(),
    }).encode("utf-8")
    datos_cifrados = _obtener_cifrador().encrypt(datos)

    with open(_ruta_archivo(nombre), "wb") as f:
        f.write(datos_cifrados)


def formatear_fecha(fecha):
    """Muestra una fecha como 24/09/2026. Los registros viejos no tienen fecha."""
    if not fecha:
        return "sin fecha"
    return fecha.strftime("%d/%m/%Y")


def cargar_registros_con_fechas():
    """Descifra todos los registros y devuelve dos diccionarios:
    nombre -> vector facial, y nombre -> fecha de registro (o None si no tiene)."""
    vectores = {}
    fechas = {}
    if not os.path.isdir(CARPETA_REGISTROS):
        return vectores, fechas

    cifrador = _obtener_cifrador()

    for archivo in os.listdir(CARPETA_REGISTROS):
        if not archivo.endswith(".dat"):
            continue

        ruta = os.path.join(CARPETA_REGISTROS, archivo)
        try:
            with open(ruta, "rb") as f:
                datos = json.loads(cifrador.decrypt(f.read()))
            nombre = datos["nombre"]
            vectores[nombre] = np.array(datos["vector"], dtype=np.float32)
            fecha = datos.get("fecha_registro")
            fechas[nombre] = date.fromisoformat(fecha) if fecha else None
        except (InvalidToken, ValueError, KeyError, json.JSONDecodeError):

            # Se omite el archivo si está corrupto o cifrado con una clave distinta
            print(f"Aviso: No se pudo leer o descifrar '{archivo}'. Archivo omitido.")

    return vectores, fechas


def cargar_registros():
    """Igual que antes: solo nombre -> vector facial."""
    vectores, _ = cargar_registros_con_fechas()
    return vectores


def borrar_registro(nombre):
    """Elimina el archivo de registro de una persona del sistema.
    
    Devuelve:
        bool: True si el archivo existía y fue eliminado, False en caso contrario.
    """
    ruta = _ruta_archivo(nombre)
    if os.path.exists(ruta):
        os.remove(ruta)
        return True
    return False


# ---------------- Checadas de entrada y salida ----------------
# Se guardan en asistencias.csv (se puede abrir en Excel), una fila por checada.

COLUMNAS_ASISTENCIAS = ["nombre", "fecha", "hora", "tipo", "estado"]


def guardar_checada(nombre, momento, tipo, estado):
    """Agrega una checada (entrada o salida) al archivo de asistencias."""
    archivo_nuevo = not os.path.exists(RUTA_ASISTENCIAS)

    # utf-8-sig para que Excel muestre bien los acentos
    with open(RUTA_ASISTENCIAS, "a", newline="", encoding="utf-8-sig") as f:
        escritor = csv.writer(f)
        if archivo_nuevo:
            escritor.writerow(COLUMNAS_ASISTENCIAS)
        escritor.writerow([nombre, momento.date().isoformat(), momento.strftime("%H:%M:%S"), tipo, estado])


def cargar_checadas():
    """Lee todas las checadas guardadas. Cada una trae nombre, momento (fecha y hora), tipo y estado."""
    if not os.path.exists(RUTA_ASISTENCIAS):
        return []

    checadas = []
    with open(RUTA_ASISTENCIAS, newline="", encoding="utf-8-sig") as f:
        for fila in csv.DictReader(f):
            try:
                momento = datetime.fromisoformat(f"{fila['fecha']} {fila['hora']}")
            except (KeyError, ValueError):
                continue  # fila dañada, se ignora
            checadas.append({
                "nombre": fila["nombre"],
                "momento": momento,
                "tipo": fila["tipo"],
                "estado": fila["estado"],
            })
    return checadas


def buscar_checada(nombre, dia, tipo):
    """Regresa la checada de esa persona en ese día y tipo, o None si todavía no checa."""
    for checada in cargar_checadas():
        if checada["nombre"] == nombre and checada["tipo"] == tipo and checada["momento"].date() == dia:
            return checada
    return None
