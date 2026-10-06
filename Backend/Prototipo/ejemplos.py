from datetime import datetime

import registros
from reconocimiento import evaluar_checada

# fecha: (entrada, salida). Los dias que no estan = ausencia. Domingo no cuenta.
SEMANA = {
    "2026-10-12": ("08:30", "14:00"),  # sabado, retardo
    # lunes 14: falta
    "2026-10-15": ("08:25", "18:16"),  # martes, retardo
    "2026-10-16": ("08:10", "18:23"),  # miercoles
    "2026-10-17": ("07:50", "18:53"),  # jueves
    "2026-10-18": ("08:01", "18:34"),  # viernes
}

for nombre in registros.cargar_registros():
    for fecha, horas in SEMANA.items():
        for hora, tipo in zip(horas, ("entrada", "salida")):
            momento = datetime.fromisoformat(f"{fecha} {hora}")
            registros.guardar_checada(nombre, momento, tipo, evaluar_checada(momento, tipo)[0])

print("Listo.")