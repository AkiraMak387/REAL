"""Este archivo se encarga de la interacción del usuario con la consola."""

import historial
import reconocimiento
import registros

# Umbral de similitud para detectar duplicados al registrar
UMBRAL_DUPLICADO = 0.45


def registrar_persona(app):
    """Registra a una persona nueva capturando su rostro desde la cámara."""
    nombre = registros.limpiar_nombre(input("\nNombre de la persona: "))

    # Validar que el nombre no esté vacío
    if not nombre:
        print("El nombre no puede estar vacío.")
        return

    # Si el nombre ya existe, permite sobrescribirlo (actualizar foto)
    if registros.existe_registro(nombre):
        respuesta = input(f"Ya existe '{nombre}'. ¿Quieres reemplazarlo? (s/n): ").strip().lower()

        # Cancelar el registro si el usuario no confirma
        if respuesta != "s":
            print("Registro cancelado.")
            return

    print("Mira a la cámara. ESPACIO para capturar, ESC para cancelar.")

    # Abrir la cámara. Regresa None si se presiona ESC o no hay rostro válido
    vector = reconocimiento.capturar_rostro(
        app, f"Registrando a {nombre} - ESPACIO capturar, ESC salir"
    )

    if vector is None:
        print("Registro cancelado.")
        return

    # --- Control de duplicados ---
    # Comparamos el rostro nuevo contra todos los ya registrados
    existentes = registros.cargar_registros()
    existentes.pop(nombre, None)
    parecido, similitud = reconocimiento.identificar_rostro(vector, existentes, UMBRAL_DUPLICADO)

    # identificar_rostro devuelve "Desconocido" cuando no hay un rostro similar
    if parecido != "Desconocido":
        print(f"Este rostro ya está registrado como '{parecido}' (similitud {similitud:.2f}). No se guardó.")
        return

    registros.guardar_registro(nombre, vector)
    print(f"'{nombre}' registrado correctamente.")


def reconocer_en_vivo(app, tipo):
    """Abre la cámara para checar entrada o salida (tipo = "entrada" o "salida")."""
    datos = registros.cargar_registros()

    # Validar si existen registros previos
    if not datos:
        print("\nNo hay personas registradas todavía. Registra a alguien primero.")
        return

    print(f"\n{len(datos)} persona(s) cargada(s). Presiona ESC para salir.")

    # Inicia el modo de reconocimiento continuo en vivo
    reconocimiento.capturar_rostro(app, f"Checar {tipo} - ESC para salir", registros=datos, tipo=tipo)


def ver_registrados():
    """Imprime en consola la lista de personas registradas, ordenada alfabéticamente."""
    _, fechas = registros.cargar_registros_con_fechas()
    nombres = sorted(fechas)

    if not nombres:
        print("\nNo hay personas registradas.")
        return

    print(f"\nPersonas registradas ({len(nombres)}):")
    for i, nombre in enumerate(nombres, start=1):
        print(f"  {i}. {nombre} - registrado el {registros.formatear_fecha(fechas[nombre])}")


def borrar_persona():
    """Elimina el registro de una persona.
    
    Muestra la lista de registrados y pide confirmación antes de borrar.
    """
    nombres = sorted(registros.cargar_registros().keys())

    if not nombres:
        print("\nNo hay personas registradas para borrar.")
        return

    ver_registrados()

    # Limpiar el nombre ingresado para que coincida con el formato guardado
    nombre = registros.limpiar_nombre(input("\nEscribe el nombre a borrar (o Enter para cancelar): "))

    if not nombre:
        print("Cancelado.")
        return

    if not registros.existe_registro(nombre):
        print(f"No existe ningún registro con el nombre '{nombre}'.")
        return

    confirmar = input(f"¿Seguro que quieres borrar a '{nombre}'? (s/n): ").strip().lower()
    if confirmar == "s":
        registros.borrar_registro(nombre)
        print(f"'{nombre}' fue borrado.")
    else:
        print("Cancelado.")


def main():
    """Punto de entrada: carga el modelo y muestra el menú principal en bucle."""
    # Carga el modelo una sola vez al inicio para optimizar rendimiento
    app = reconocimiento.cargar_modelo()

    while True:
        print("\n===== SISTEMA DE REGISTRO FACIAL =====")
        print("1. Registrar persona")
        print("2. Checar entrada")
        print("3. Checar salida")
        print("4. Historial de trabajadores")
        print("5. Borrar una persona")
        print("0. Salir")

        opcion = input("Elige una opción: ").strip()

        if opcion == "1":
            registrar_persona(app)
        elif opcion == "2":
            reconocer_en_vivo(app, "entrada")
        elif opcion == "3":
            reconocer_en_vivo(app, "salida")
        elif opcion == "4":
            historial.mostrar_historial()
        elif opcion == "5":
            borrar_persona()
        elif opcion == "0":
            print("Hasta luego.")
            break
        else:
            print("Opción no válida.")


if __name__ == "__main__":
    main()
