(function datosDePrueba() {
    const ID = '00100002';

    const INGRESO_PRUEBA = '2026-09-01';

    // [fecha, entrada, salida]  ·  semanas de sábado a viernes
    const REGISTROS = [
        // ---------- Semana 12 - 18 sep ----------
        ['2026-09-12', '07:55', '14:01'],
        ['2026-09-14', '08:00', '18:20'],
        ['2026-09-15', '07:45', '18:02'],
        ['2026-09-16', '08:10', '18:10'],
        ['2026-09-17', '07:30', '18:14'],
        ['2026-09-18', '08:01', '18:05'],

        // ---------- Semana 19 - 25 sep ----------
        ['2026-09-19', '08:55', '14:01'],
        ['2026-09-22', '08:45', '18:02'],   // impuntual 1
        ['2026-09-23', '08:10', '18:10'],
        ['2026-09-24', '07:30', '18:14'],
        ['2026-09-25', '08:01', '18:05'],

        // ---------- Semana 26 sep - 2 oct ----------
        ['2026-09-26', '07:58', '14:03'],
        ['2026-09-28', '08:02', '18:07'],
        ['2026-09-29', '07:50', '18:12'],
        ['2026-09-30', '08:50', '18:20'],   // impuntual 2
        ['2026-10-01', '07:45', '17:58'],
        ['2026-10-02', '08:05', '18:15'],

        // ---------- Semana 3 - 9 oct (en curso) ----------
        ['2026-10-03', '07:58', '14:00'],
        ['2026-10-05', '08:48', '18:03'],   // impuntual 3
        ['2026-10-06', '07:55', '18:10'],
        ['2026-10-07', '08:00', '18:30']
    ];

    const FALTAS = [
        '2026-09-21',
        '2026-10-08'
    ];

    const emp = TODOS_EMPLEADOS.find((e) => e.id === ID);
    if (!emp) {
        console.warn(`[Prueba] No se encontró al trabajador ${ID}`);
        return;
    }

    const ingresoReal = emp.ingreso;
    const checadasPrueba = REGISTROS.flatMap(([fecha, entrada, salida]) => [
        { fecha, tipo: 'entrada', hora: entrada, prueba: true },
        { fecha, tipo: 'salida', hora: salida, prueba: true }
    ]);
    const faltasPrueba = FALTAS.map((fecha) => ({ fecha, tipo: 'falta', detalle: 'Registro de prueba', prueba: true }));

    function ponerPrueba() {
        if (emp.ingreso > INGRESO_PRUEBA) emp.ingreso = INGRESO_PRUEBA;
        emp.checadas = (emp.checadas || []).filter((c) => !c.prueba).concat(checadasPrueba);
        emp.incidencias = (emp.incidencias || []).filter((i) => !i.prueba).concat(faltasPrueba);
    }

    function quitarPrueba() {
        if (emp.ingreso === INGRESO_PRUEBA) emp.ingreso = ingresoReal;
        emp.checadas = (emp.checadas || []).filter((c) => !c.prueba);
        emp.incidencias = (emp.incidencias || []).filter((i) => !i.prueba);
    }

    const guardarCambiosOriginal = guardarCambios;
    guardarCambios = function () {
        quitarPrueba();
        try {
            return guardarCambiosOriginal.apply(this, arguments);
        } finally {
            ponerPrueba();
        }
    };

    ponerPrueba();
    console.info(`[Prueba] Datos de prueba cargados para ${emp.nombre} (${ID}). No se guardan en la base de datos.`);
})();