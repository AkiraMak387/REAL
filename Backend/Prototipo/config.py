# Ajustes generales del sistema.

# Qué tanto se tiene que parecer una cara a una registrada para reconocerla va de 0 a 1: entre más alto, más estricto.
UMBRAL_RECONOCIMIENTO = 0.45

# Al registrar a alguien nuevo, si su cara se parece a una guardada,se asume que es la misma persona y no se deja registrar dos veces.
UMBRAL_DUPLICADO = 0.45

# Modelo de reconocimiento facial que usamos (viene incluido con InsightFace).
NOMBRE_MODELO = "buffalo_l"

# Tamaño de imagen en el que el modelo buscador de caras trabajo. Más chico = más rápido.
TAMANO_DETECCION = (320, 320)

# Resolución de la cámara.
ANCHO_CAMARA = 640
ALTO_CAMARA = 480

# Horarios de la empresa, en formato (hora, minuto) de 24 horas.
# Entrada de lunes a sábado: hasta esta hora cuenta como puntual.
HORA_LIMITE_ENTRADA = (8, 15)

# Salida: a partir de esta hora cuenta como salida normal.
HORA_SALIDA_SEMANA = (18, 0)   # lunes a viernes
HORA_SALIDA_SABADO = (14, 0)   # sábado

# A partir de esta hora, cualquier checada cuenta como salida aunque se haya elegido "Checar entrada".
HORA_CAMBIO_A_SALIDA = (16, 0)

# Pago: $1000 a la semana repartidos entre las horas de la semana:
# 10 h lunes + 10 h martes + 10 h miércoles + 10 h jueves + 10 h viernes + 7 h sábado = 57 h.
# Precio de la hora = 1000 / 57 (se usa la fracción exacta, sin redondear).
# Se paga cada hora trabajada (contando minutos y segundos) a ese precio.
PAGO_SEMANAL = 1000
HORAS_POR_SEMANA = 57

# Cuántas horas vale el día que se descuenta por retardos.
HORAS_DIA_DESCUENTO = 10

# Cada tantos retardos dentro de la misma semana de pago (sábado a viernes) se descuenta 1 día.
# Los retardos no se acumulan de una semana a otra.
RETARDOS_POR_DESCUENTO = 3