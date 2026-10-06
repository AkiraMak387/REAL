"""Módulo encargado de la gestión de la cámara y reconocimiento facial."""

import threading
from datetime import datetime
import cv2
import numpy as np
from insightface.app import FaceAnalysis

import config
import registros as almacen  # "registros" ya se usa como nombre de parámetro aquí


def cargar_modelo():
    """Prepara el reconocimiento facial. Tarda unos segundos, por eso se hace una sola vez al iniciar."""
    print("Cargando modelo...")
    app = FaceAnalysis(name=config.NOMBRE_MODELO)
    app.prepare(ctx_id=-1, det_size=config.TAMANO_DETECCION)  # ctx_id=-1 = usar el procesador, no tarjeta de video
    print("Modelo listo.")
    return app


def calcular_similitud(vector_a, vector_b):
    """Compara dos caras y dice qué tanto se parecen.
    El resultado va de 0 a 1: entre más cerca de 1, más parecidas son."""
    return np.dot(vector_a, vector_b) / (
        np.linalg.norm(vector_a) * np.linalg.norm(vector_b)
    )


def obtener_saludo(momento):
    """Elige el saludo según la hora: buenos días, buenas tardes o buenas noches."""
    hora = momento.hour
    if 5 <= hora < 12:
        return "Buenos dias"
    elif 12 <= hora < 19:
        return "Buenas tardes"
    else:
        return "Buenas noches"


def formatear_hora(momento):
    """Muestra la hora como la leemos normalmente, por ejemplo: 9:42 a.m."""
    hora_12 = momento.hour % 12 or 12
    sufijo = "a.m." if momento.hour < 12 else "p.m."
    return f"{hora_12}:{momento.minute:02d} {sufijo}"


def evaluar_checada(momento, tipo):
    """Dice cómo quedó la checada según el horario de la empresa.
    Devuelve el texto del estado y si está dentro de horario (True/False)."""
    dia = momento.weekday()  # 0 = lunes ... 5 = sábado, 6 = domingo
    hora = (momento.hour, momento.minute)

    if dia == 6:
        return "Dia no laborable", False

    if tipo == "entrada":
        if hora <= config.HORA_LIMITE_ENTRADA:
            return "Asistencia puntual", True
        return "Asistencia con retardo", False

    # Salida: el sábado se sale más temprano
    limite = config.HORA_SALIDA_SABADO if dia == 5 else config.HORA_SALIDA_SEMANA
    if hora >= limite:
        return "Salida normal", True
    return "Salida fuera de horario", False


def identificar_rostro(embedding, registros, umbral=config.UMBRAL_RECONOCIMIENTO):
    """Compara la cara que ve la cámara contra todas las registradas
    y se queda con la que más se parezca.
    Si ninguna se parece lo suficiente, la persona es 'Desconocido'."""
    mejor_nombre = "Desconocido"
    mejor_similitud = 0.0

    for nombre, vector_registrado in registros.items():
        similitud = calcular_similitud(embedding, vector_registrado)
        if similitud > mejor_similitud:
            mejor_similitud = similitud
            mejor_nombre = nombre

    if mejor_similitud < umbral:
        return "Desconocido", mejor_similitud
    return mejor_nombre, mejor_similitud


def dibujar_franja(frame, texto, color, posicion="abajo"):
    """Dibuja una barra de color de lado a lado de la pantalla con un mensaje en medio.
    Si el mensaje es muy largo, hace la letra más chica para que quepa.
    Nota: los colores van en orden azul, verde, rojo (así los maneja OpenCV)."""
    alto_franja = 60
    alto_frame, ancho_frame = frame.shape[:2]
    fuente = cv2.FONT_HERSHEY_SIMPLEX

    # Va achicando la letra hasta que el texto quepa en la pantalla
    escala = 0.9
    while escala > 0.4:
        (ancho_texto, alto_texto), _ = cv2.getTextSize(texto, fuente, escala, 2)
        if ancho_texto <= ancho_frame - 20:
            break
        escala -= 0.05

    y_inicio = 0 if posicion == "arriba" else alto_frame - alto_franja
    cv2.rectangle(frame, (0, y_inicio), (ancho_frame, y_inicio + alto_franja), color, -1)

    # Centra el texto dentro de la barra
    x = (ancho_frame - ancho_texto) // 2
    y = y_inicio + (alto_franja + alto_texto) // 2
    cv2.putText(frame, texto, (x, y), fuente, escala, (255, 255, 255), 2)


def mostrar_saludo(frame, rostros, registros, checadas, tipo):
    """Si reconoce a la persona, muestra su checada (entrada o salida) y cómo quedó.
    Si no la reconoce, avisa que no está registrada (barra roja).
    Cada persona solo checa una entrada y una salida por día; si ya checó, se le muestra la que tiene."""
    if len(rostros) != 1:
        return  # solo se atiende a una persona a la vez

    nombre, _ = identificar_rostro(rostros[0].normed_embedding, registros)

    if nombre == "Desconocido":
        dibujar_franja(frame, "Persona no registrada", (0, 0, 255), "abajo")  # rojo
        return

    # Solo se procesa la primera vez que aparece la persona en esta sesión
    if nombre not in checadas:
        ahora = datetime.now()

        # Después de las 4 p.m. ya no se checa entrada: se toma como salida
        tipo_checada = tipo
        if (ahora.hour, ahora.minute) >= config.HORA_CAMBIO_A_SALIDA:
            tipo_checada = "salida"

        # Si ya checó hoy (aunque haya sido en otra sesión), no se duplica
        previa = almacen.buscar_checada(nombre, ahora.date(), tipo_checada)
        if previa:
            momento = previa["momento"]
            estado, a_tiempo = evaluar_checada(momento, tipo_checada)
            print(f"{nombre} ya había checado {tipo_checada} hoy a las {formatear_hora(momento)}")
        else:
            momento = ahora
            estado, a_tiempo = evaluar_checada(momento, tipo_checada)
            almacen.guardar_checada(nombre, momento, tipo_checada, estado)
            print(f"{tipo_checada.capitalize()}: {nombre} el {momento:%d/%m/%Y} a las {formatear_hora(momento)} - {estado}")

        checadas[nombre] = (momento, tipo_checada, estado, a_tiempo)

    momento, tipo_checada, estado, a_tiempo = checadas[nombre]

    if tipo_checada == "entrada":
        texto = f"{obtener_saludo(momento)}, {nombre} - Entrada: {formatear_hora(momento)}"
    else:
        texto = f"Hasta luego, {nombre} - Salida: {formatear_hora(momento)}"
    dibujar_franja(frame, texto, (0, 200, 0), "abajo")  # verde

    # Arriba va la fecha y el estado: verde si está en horario, naranja si no
    color_estado = (0, 200, 0) if a_tiempo else (0, 140, 255)
    dibujar_franja(frame, f"{momento:%d/%m/%Y} - {estado}", color_estado, "arriba")


def capturar_rostro(app, titulo_ventana="Registro facial - ESPACIO para capturar, ESC para salir", registros=None, tipo="entrada"):
    """Abre la cámara y muestra el video en vivo. Trabaja de dos formas:
    - Para registrar: marca la cara con un cuadro verde y al presionar ESPACIO la guarda.
    - Para reconocer (cuando se le pasan los registros): muestra la entrada o salida según `tipo`.
    Si hay más de una persona frente a la cámara, avisa y no deja capturar.
    ESC cierra la cámara."""

    camara = cv2.VideoCapture(0)  # 0 = la cámara principal de la computadora
    camara.set(cv2.CAP_PROP_FRAME_WIDTH, config.ANCHO_CAMARA)
    camara.set(cv2.CAP_PROP_FRAME_HEIGHT, config.ALTO_CAMARA)

    if not camara.isOpened():
        print("Error: no se pudo abrir la cámara")
        return None

    # El procesamiento se realiza en segundo plano para mantener la fluidez del video
    ultimo_frame_para_detectar = None
    rostros_detectados = []
    lock = threading.Lock()  # evita condiciones de carrera entre hilos
    detectando = False
    detener_hilo = False
    checadas = {}  # quienes ya checaron en esta sesión

    def detectar_en_segundo_plano():
        """Trabaja por detrás: toma la imagen más reciente y busca caras en ella."""
        nonlocal rostros_detectados, detectando, ultimo_frame_para_detectar
        while not detener_hilo:
            with lock:
                frame_actual = ultimo_frame_para_detectar

            if frame_actual is not None:
                resultado = app.get(frame_actual)  # búsqueda de rostros
                with lock:
                    rostros_detectados = resultado
                    detectando = False
            else:
                cv2.waitKey(1)

    hilo = threading.Thread(target=detectar_en_segundo_plano, daemon=True)
    hilo.start()

    vector_capturado = None

    while True:
        ret, frame = camara.read()
        if not ret:
            print("Error al leer la imagen de la cámara")
            break

        with lock:
            if not detectando:
                ultimo_frame_para_detectar = frame.copy()
                detectando = True
            rostros_mostrar = rostros_detectados

        if registros:
            # Modo reconocimiento: checada de entrada o salida
            mostrar_saludo(frame, rostros_mostrar, registros, checadas, tipo)
        else:
            # Modo registro: cuadro verde alrededor de la cara
            for rostro in rostros_mostrar:
                x1, y1, x2, y2 = rostro.bbox.astype(int)
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)

        # Aviso si hay más de una persona frente a la cámara
        if len(rostros_mostrar) > 1:
            dibujar_franja(frame, "Una sola persona a la vez", (0, 0, 255), "arriba")

        cv2.imshow(titulo_ventana, frame)

        tecla = cv2.waitKey(1) & 0xFF

        if tecla == 27:  # ESC = salir
            break

        elif tecla == 32:  # ESPACIO = capturar
            rostros_finales = app.get(frame)

            if len(rostros_finales) == 0:
                print("No se detectó ningún rostro, intenta de nuevo")
                continue

            if len(rostros_finales) > 1:
                print("Hay más de una persona. Solo debe haber una frente a la cámara.")
                continue

            # CAMBIO CLAVE: Usamos normed_embedding para que coincida con el modo reconocimiento
            vector_capturado = rostros_finales[0].normed_embedding
            break

    # Limpieza de recursos
    detener_hilo = True
    camara.release()
    cv2.destroyAllWindows()

    return vector_capturado
