"""Historial de trabajadores: horas trabajadas, pago, puntualidad y faltas.
Todo se calcula a partir de las checadas guardadas en asistencias.csv."""

from datetime import date, timedelta
from fractions import Fraction

import config
import registros

DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
LINEA = "-" * 78


# ---------------- Formatos ----------------

def formatear_horas(segundos):
    """9030 -> '2 h 30 min 30 s'"""
    minutos, seg = divmod(int(segundos), 60)
    horas, minutos = divmod(minutos, 60)
    return f"{horas} h {minutos:02d} min {seg:02d} s"


def formatear_hora(momento):
    """Hora como la leemos normalmente, por ejemplo: 9:42 a.m."""
    hora_12 = momento.hour % 12 or 12
    sufijo = "a.m." if momento.hour < 12 else "p.m."
    return f"{hora_12}:{momento.minute:02d} {sufijo}"


# Precio exacto de un segundo de trabajo: 1000 / (57 h x 3600 s). Es una fracción exacta,
# no un decimal, así que no se pierde nada al multiplicar; solo se redondea al final.
TARIFA_POR_SEGUNDO = Fraction(config.PAGO_SEMANAL, config.HORAS_POR_SEMANA * 3600)
TARIFA_POR_HORA = TARIFA_POR_SEGUNDO * 3600


def pago_por_segundos(segundos):
    """Cuánto se paga por ese tiempo trabajado, exacto (sin redondear)."""
    return TARIFA_POR_SEGUNDO * int(segundos)


def a_centavos(cantidad):
    """Redondea una cantidad exacta al centavo: .005 o más sube."""
    centavos = cantidad * 100
    entero = centavos.numerator // centavos.denominator
    if centavos - entero >= Fraction(1, 2):
        entero += 1
    return entero


def pago_final(bruto, descuento):
    """Redondea cada parte al centavo y luego resta, para que lo que se ve
    en pantalla cuadre exacto: Por horas - Descuento = Pago."""
    centavos = a_centavos(bruto) - a_centavos(descuento)
    return Fraction(max(centavos, 0), 100)


def formatear_dinero(cantidad):
    """Fraction exacta -> '$1,234.56'"""
    centavos = a_centavos(cantidad)
    signo = "-" if centavos < 0 else ""
    pesos, cent = divmod(abs(centavos), 100)
    return f"{signo}${pesos:,}.{cent:02d}"


def calcular_antiguedad(desde, hasta):
    """Tiempo que lleva trabajando: '1 año, 3 meses' o '12 días' si es menos de un mes."""
    meses = (hasta.year - desde.year) * 12 + hasta.month - desde.month
    if hasta.day < desde.day:
        meses -= 1

    if meses < 1:
        dias = (hasta - desde).days
        return f"{dias} día" if dias == 1 else f"{dias} días"

    anios, meses = divmod(meses, 12)
    partes = []
    if anios:
        partes.append(f"{anios} año" if anios == 1 else f"{anios} años")
    if meses:
        partes.append(f"{meses} mes" if meses == 1 else f"{meses} meses")
    return ", ".join(partes)


# ---------------- Fechas ----------------

def dias_laborables(desde, hasta):
    """Días de lunes a sábado entre dos fechas, incluyendo ambas."""
    dia = desde
    while dia <= hasta:
        if dia.weekday() != 6:  # 6 = domingo
            yield dia
        dia += timedelta(days=1)


def rango_semana(dia):
    """Sábado y viernes de la semana de pago en la que cae ese día."""
    sabado = dia - timedelta(days=(dia.weekday() - 5) % 7)
    return sabado, sabado + timedelta(days=6)


def rango_mes(dia):
    """Primer y último día del mes en el que cae ese día."""
    primero = dia.replace(day=1)
    siguiente = (primero + timedelta(days=32)).replace(day=1)
    return primero, siguiente - timedelta(days=1)


def titulo_periodo(inicio, fin, por_mes):
    if por_mes:
        return f"{MESES[inicio.month - 1].capitalize()} {inicio.year}"
    return f"Semana del Sábado {inicio:%d/%m/%Y} al Viernes {fin:%d/%m/%Y}"


# ---------------- Cálculos ----------------

def dias_descontados_por_retardo(dias):
    """Por cada 3 retardos en la misma semana de pago se descuenta 1 día (no la semana).
    Los retardos se cuentan por separado en cada semana y no pasan a la siguiente."""
    retardos_por_semana = {}
    for d in dias:
        if d["retardo"]:
            inicio, _ = rango_semana(d["dia"])
            retardos_por_semana[inicio] = retardos_por_semana.get(inicio, 0) + 1
    return sum(n // config.RETARDOS_POR_DESCUENTO for n in retardos_por_semana.values())


def agrupar_por_dia(checadas):
    """Acomoda las checadas de una persona así: {fecha: {"entrada": ..., "salida": ...}}"""
    por_dia = {}
    for checada in checadas:
        dia = checada["momento"].date()
        por_dia.setdefault(dia, {})[checada["tipo"]] = checada
    return por_dia


def segundos_trabajados(checadas_dia):
    """Segundos exactos entre la entrada y la salida. None si falta alguna de las dos."""
    entrada = checadas_dia.get("entrada")
    salida = checadas_dia.get("salida")
    if not entrada or not salida or salida["momento"] <= entrada["momento"]:
        return None
    return int((salida["momento"] - entrada["momento"]).total_seconds())


def revisar_dia(dia, checadas_dia, hoy):
    """Todo lo que pasó en un día: horas, horas que se pagan y observaciones."""
    if not checadas_dia:
        nota = "Hoy, todavía no checa" if dia == hoy else "Ausencia"
        return {"dia": dia, "entrada": None, "salida": None, "segundos": 0,
                "vino": False, "nota": nota, "falta": dia < hoy, "retardo": False, "puntual": False}

    entrada = checadas_dia.get("entrada")
    salida = checadas_dia.get("salida")
    segundos = segundos_trabajados(checadas_dia)

    notas = []
    retardo = bool(entrada) and entrada["estado"] == "Asistencia con retardo"
    puntual = bool(entrada) and entrada["estado"] == "Asistencia puntual"
    if puntual:
        notas.append("Puntual")
    if retardo:
        notas.append("Retardo")
    if not entrada:
        notas.append("No checó entrada, no se paga")
    if not salida:
        notas.append("Todavía no sale" if dia == hoy else "No checó salida, no se paga")
    elif salida["estado"] == "Salida fuera de horario":
        notas.append("Salió antes")
    if entrada and salida and segundos is None:
        notas.append("Revisar: salida antes de entrada")

    return {
        "dia": dia,
        "entrada": entrada["momento"] if entrada else None,
        "salida": salida["momento"] if salida else None,
        "segundos": segundos or 0,
        "vino": True,
        "nota": ", ".join(notas),
        "falta": False,
        "retardo": retardo,
        "puntual": puntual,
    }


def fecha_inicio(fecha_registro, checadas):
    """Desde cuándo trabaja: el día que se registró o su primera checada, lo que sea antes.
    (Si alguien tiene checadas anteriores a su registro, no se le esconden.)"""
    fechas = [c["momento"].date() for c in checadas]
    if fecha_registro:
        fechas.append(fecha_registro)
    return min(fechas) if fechas else None


def calcular_periodo(checadas, fecha_registro, inicio, fin, hoy):
    """Revisa día por día a una persona entre inicio y fin (sin pasar de hoy)."""
    por_dia = agrupar_por_dia(checadas)
    empezo = fecha_inicio(fecha_registro, checadas)
    if not empezo or empezo > min(fin, hoy):
        return None  # todavía no trabajaba en este periodo

    dias = [revisar_dia(d, por_dia.get(d), hoy)
            for d in dias_laborables(max(inicio, empezo), min(fin, hoy))]
    ya_pasaron = [d for d in dias if d["dia"] < hoy or d["entrada"] or d["salida"]]
    asistio = sum(1 for d in ya_pasaron if not d["falta"])
    segundos = sum(d["segundos"] for d in dias)
    descontados = dias_descontados_por_retardo(dias)
    bruto = pago_por_segundos(segundos)
    descuento = descontados * config.HORAS_DIA_DESCUENTO * TARIFA_POR_HORA

    return {
        "dias": dias,
        "segundos": segundos,
        "puntuales": sum(d["puntual"] for d in dias),
        "retardos": [d["dia"] for d in dias if d["retardo"]],
        "faltas": [d["dia"] for d in dias if d["falta"]],
        "asistio": asistio,
        "descontados": descontados,
        "bruto": bruto,
        "descuento": descuento,
        "pago": pago_final(bruto, descuento),
        "laborables": len(ya_pasaron),
    }


# ---------------- Pantallas ----------------

def mostrar_tabla_dias(dias):
    """Tabla con un renglón por día."""
    print(f"  {'Día':<11}{'Entrada':<12}{'Salida':<12}{'Horas':<18}Observaciones")
    print("  " + LINEA[:76])
    for d in dias:
        etiqueta = f"{DIAS[d['dia'].weekday()]} {d['dia']:%d/%m}"
        entrada = formatear_hora(d["entrada"]) if d["entrada"] else "--"
        salida = formatear_hora(d["salida"]) if d["salida"] else "--"
        horas = formatear_horas(d["segundos"]) if d["segundos"] else "--"
        print(f"  {etiqueta:<11}{entrada:<12}{salida:<12}{horas:<18}{d['nota']}")


def mostrar_semanas_del_mes(dias):
    """En la vista por mes: cuánto trabajó y cuánto ganó cada semana."""
    semanas = {}
    for d in dias:
        inicio, fin = rango_semana(d["dia"])
        semana = semanas.setdefault(inicio, {"fin": fin, "segundos": 0, "lista": []})
        semana["segundos"] += d["segundos"]
        semana["lista"].append(d)
    for s in semanas.values():
        s["bruto"] = pago_por_segundos(s["segundos"])
        s["descuento"] = (dias_descontados_por_retardo(s["lista"])
                          * config.HORAS_DIA_DESCUENTO * TARIFA_POR_HORA)
        s["pago"] = pago_final(s["bruto"], s["descuento"])

    print("\n  PAGO POR SEMANA")
    print(f"  {'Semana':<20}{'Horas trabajadas':<20}{'Por horas':<14}{'Descuento':<14}Pago")
    print("  " + LINEA[:76])
    for inicio, s in semanas.items():
        rango = f"{inicio:%d/%m} al {s['fin']:%d/%m}"
        print(f"  {rango:<20}{formatear_horas(s['segundos']):<20}{formatear_dinero(s['bruto']):<14}"
              f"{formatear_dinero(-s['descuento']) if s['descuento'] else '--':<14}{formatear_dinero(s['pago'])}")


def mostrar_trabajador(nombre, fecha_registro, checadas, inicio, fin, por_mes, hoy):
    """Pantalla completa de un trabajador: resumen arriba y detalle abajo."""
    print("\n" + "=" * 78)
    print(f"  {nombre.upper()}")
    print(f"  {titulo_periodo(inicio, fin, por_mes)}")
    empezo = fecha_inicio(fecha_registro, checadas)
    if empezo:
        print(f"  Fecha de Ingreso: {empezo:%d/%m/%Y}")
    print("=" * 78)

    datos = calcular_periodo(checadas, fecha_registro, inicio, fin, hoy)
    if not datos:
        print("\n  No hay checadas de esta persona en este periodo.")
        return

    print("\n  RESUMEN")
    print(f"    Días Laborados:    {datos['asistio']} de {datos['laborables']}")
    print(f"    Horas trabajadas:  {formatear_horas(datos['segundos'])}")
    print(f"    Precio por hora:   {formatear_dinero(TARIFA_POR_HORA)}"
          f"   (${config.PAGO_SEMANAL:,} / {config.HORAS_POR_SEMANA} h)")
    print(f"    Por horas:         {formatear_dinero(datos['bruto'])}"
          f"   ({formatear_horas(datos['segundos'])} x ${config.PAGO_SEMANAL:,}/{config.HORAS_POR_SEMANA})")
    if datos["descontados"]:
        print(f"    Descuento:         {formatear_dinero(-datos['descuento'])}"
              f"   ({datos['descontados']} día(s) de {config.HORAS_DIA_DESCUENTO} h por retardos)")
    print(f"    Pago:              {formatear_dinero(datos['pago'])}")
    print(f"    Puntualidad:       {datos['puntuales']} a tiempo, "
          f"{len(datos['retardos'])} retardos, {len(datos['faltas'])} ausencias")

    print("\n  DETALLE POR DÍA")
    mostrar_tabla_dias(datos["dias"])

    if por_mes:
        mostrar_semanas_del_mes(datos["dias"])


def mostrar_todos(fechas, todas, inicio, fin, por_mes, hoy):
    """Una tabla con el resumen de todos los trabajadores en el periodo."""
    print("\n" + "=" * 78)
    print("  RESUMEN DE TODOS LOS TRABAJADORES")
    print(f"  {titulo_periodo(inicio, fin, por_mes)}")
    print("=" * 78)
    print(f"\n  {'Trabajador':<20}{'Vino':<9}{'Horas':<19}{'Pago':<14}{'Retardos':<10}Ausencias")
    print("  " + LINEA[:76])
    for nombre in sorted(fechas):
        propias = [c for c in todas if c["nombre"] == nombre]
        datos = calcular_periodo(propias, fechas[nombre], inicio, fin, hoy)
        if not datos:
            print(f"  {nombre[:19]:<20}Sin checadas en este periodo")
            continue
        vino = f"{datos['asistio']}/{datos['laborables']}"
        print(f"  {nombre[:19]:<20}{vino:<9}{formatear_horas(datos['segundos']):<19}"
              f"{formatear_dinero(datos['pago']):<14}{len(datos['retardos']):<10}{len(datos['faltas'])}")


def preguntar(titulo, opciones):
    """Muestra opciones numeradas y regresa la que se eligió (o None si no es válida)."""
    print(f"\n{titulo}")
    for numero, texto in opciones:
        print(f"  {numero}. {texto}")
    eleccion = input("Elige una opción: ").strip().upper()
    return eleccion if eleccion in [n for n, _ in opciones] else None


# ---------------- Menú del historial ----------------

def mostrar_historial():
    """Menú del historial: elegir trabajador, elegir semana o mes, y moverse entre periodos."""
    _, fechas = registros.cargar_registros_con_fechas()
    if not fechas:
        print("\nNo hay trabajadores registrados.")
        return

    todas = registros.cargar_checadas()
    nombres = sorted(fechas)
    hoy = date.today()

    while True:
        # 1) ¿De quién?
        opciones = [(str(i), n) for i, n in enumerate(nombres, start=1)]
        opciones += [("T", "Todos (resumen)"), ("0", "Volver al menú principal")]
        print("\n===== HISTORIAL DE TRABAJADORES =====")
        quien = preguntar("¿De quién quieres ver el historial?", opciones)
        if quien is None:
            print("Opción no válida.")
            continue
        if quien == "0":
            return

        # 2) ¿Semana o mes?
        periodo = preguntar("¿Qué quieres ver?", [("1", "Por semana"), ("2", "Por mes")])
        if periodo is None:
            print("Opción no válida.")
            continue
        por_mes = periodo == "2"
        rango = rango_mes if por_mes else rango_semana
        palabra = "mes" if por_mes else "semana"
        inicio, fin = rango(hoy)  # se empieza por el periodo actual

        # 3) Mostrar y dejar moverse entre periodos
        while True:
            if quien == "T":
                mostrar_todos(fechas, todas, inicio, fin, por_mes, hoy)
            else:
                nombre = nombres[int(quien) - 1]
                propias = [c for c in todas if c["nombre"] == nombre]
                mostrar_trabajador(nombre, fechas[nombre], propias, inicio, fin, por_mes, hoy)

            siguiente = f"Ver {palabra} siguiente" if fin < hoy else f"Ver {palabra} siguiente (aún no llega)"
            accion = preguntar("¿Qué quieres hacer ahora?", [
                ("1", f"Ver {palabra} anterior"),
                ("2", siguiente),
                ("3", "Elegir otro trabajador"),
                ("0", "Volver al menú principal"),
            ])

            if accion == "1":
                inicio, fin = rango(inicio - timedelta(days=1))
            elif accion == "2":
                if fin >= hoy:
                    print("Ese periodo todavía no llega; te sigo mostrando el actual.")
                else:
                    inicio, fin = rango(fin + timedelta(days=1))  # el día después del fin = inicio del siguiente periodo
            elif accion == "3":
                break
            elif accion == "0":
                return
            else:
                print("Opción no válida.")