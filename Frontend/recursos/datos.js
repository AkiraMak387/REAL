// Datos y utilidades compartidas por todas las páginas del sistema.
// Los trabajadores se leen de la base de datos (ALMACEN, en sesion.js), de modo que
// todas las páginas muestran exactamente la misma información.

// =====================================================================
//  CONFIGURACIÓN (se edita en Configuración y se aplica en todo el sistema)
// =====================================================================
const CLAVE_CONFIGURACION = 'elnevado.configuracion.v1';

const CONFIGURACION_INICIAL = {
    // Políticas de asistencia
    toleranciaMinutos: 15,          // minutos después de las 08:00 que no cuentan como retardo
                                    // (el retardo se registra pero no descuenta: RH habla con el trabajador)
    // Centro de nómina
    diaPago: 'Viernes',
    salarioMinimoDiario: 315.04,    // salario mínimo general 2026 (CONASAMI)
    bonoPuntualidad: 200,           // por semana sin retardos ni faltas; solo el Super usuario lo otorga
    // Alertas (0 = sin aviso)
    avisoVacacionesDias: 14,        // días de anticipación para avisar salidas y regresos de vacaciones
    avisoIncapacidadDias: 3         // días de anticipación para avisar el fin de una incapacidad
};

// ALMACEN (sesion.js) guarda en Firebase si está configurado; si no, en este navegador
const CONFIGURACION = { ...CONFIGURACION_INICIAL, ...(ALMACEN.leer(CLAVE_CONFIGURACION) || {}) };

function guardarConfiguracion(nueva) {
    return ALMACEN.escribir(CLAVE_CONFIGURACION, nueva);
}

// Horario laboral en minutos desde las 00:00
const HORARIO = {
    entrada: 8 * 60,
    salida: 18 * 60,        // lunes a viernes
    salidaSabado: 14 * 60,
    // Minutos de comida que se descuentan de lunes a viernes.
    // En 0: las horas se cuentan directo de la hora de entrada a la hora de salida.
    // (Para volver a descontar 1 hora de comida, cambia este valor a 60)
    comida: 0
};

// ---- Salida automática ----
// Si el trabajador checó entrada pero se le olvidó checar salida, a las 11:50 pm
// el sistema le pone salida a las 6:00 pm y calcula sus horas con esa hora.
const SALIDA_AUTOMATICA = 18 * 60;          // 6:00 pm
const HORA_CIERRE_DIA = 23 * 60 + 50;       // 11:50 pm

// El día ya "cerró" si es un día pasado, o si es hoy y ya son las 11:50 pm o más
function diaCerrado(iso) {
    const ahora = new Date();
    const ahoraIso = aISO(ahora);
    if (iso < ahoraIso) return true;
    return iso === ahoraIso && ahora.getHours() * 60 + ahora.getMinutes() >= HORA_CIERRE_DIA;
}

function salidaOficial(fecha) {
    return fecha.getDay() === 6 ? HORARIO.salidaSabado : HORARIO.salida;
}

// Solo cuentan las horas extra completas después de la salida:
// de lunes a viernes, 19:00 → 0, 19:01 a 20:00 → 1, 20:01 a 21:00 → 2, y así sucesivamente
function horasExtra(fecha, minutosSalida) {
    const despues = minutosSalida - salidaOficial(fecha);
    return despues > 0 ? Math.floor((despues - 1) / 60) : 0;
}

// Datos generales de la empresa (se muestran en Información)
const EMPRESA = {
    razonSocial: 'Distribuidora El Nevado S.A. de C.V.',
    rfc: 'DENE-140305-AB',
    domicilioFiscal: 'Av. Industrial San Jerónimo #412, Toluca, Edo. Méx.',
    sucursalPrincipal: '00',
    horario: 'Lunes a viernes 08:00 – 18:00 · Sábado 08:00 – 14:00',
    periodoNomina: 'Semanal (sábado a viernes)'
};

// =====================================================================
//  CATÁLOGOS
// =====================================================================
// El usuario con la sesión abierta (USUARIO_ACTUAL) y sus permisos vienen de sesion.js

const SUCURSALES = {
    '00': 'Oficina central',
    '01': 'Colón',
    '02': 'Pacífico',
    '03': 'Torres',
    '04': 'Temoaya',
    '05': 'Atlacomulco',
    '06': 'Huixquilucan',
    '07': 'Sica Store Atlacomulco',
    '08': 'Tenango',
    '10': 'Sica Store Mexicaltzingo',
    '11': 'Jilotepec',
    '12': 'San Pablo Autopan',
    '13': 'Santiago Tianguistenco'
};

// Bodegas (sucursales). Cada una se guarda como un registro propio: en Firebase es el documento
// bodegas/{clave}, y adentro quedan sus trabajadores, solicitudes y reportes.
const CLAVE_BODEGAS = 'elnevado.bodegas.v1';
const CLAVE_SUCURSALES = 'elnevado.sucursales.v1'; // formato anterior: solo las agregadas, todas juntas
// Claves de las sucursales borradas: sin esta lista, las de base volverían a aparecer al recargar
const CLAVE_SUCURSALES_BORRADAS = 'elnevado.sucursales-borradas.v1';
const BODEGAS = ALMACEN.leer(CLAVE_BODEGAS) || [];

function guardarBodegas() {
    return ALMACEN.escribir(CLAVE_BODEGAS, [...BODEGAS].sort((a, b) => a.clave.localeCompare(b.clave)));
}

(function cargarBodegas() {
    const anteriores = ALMACEN.leer(CLAVE_SUCURSALES) || {};
    Object.assign(SUCURSALES, anteriores);
    BODEGAS.forEach((b) => { SUCURSALES[b.clave] = b.nombre; });
    (ALMACEN.leer(CLAVE_SUCURSALES_BORRADAS) || []).forEach((clave) => {
        if (!BODEGAS.some((b) => b.clave === clave)) delete SUCURSALES[clave];
    });
    // Las bodegas de base (y las del formato anterior) que aún no tienen su registro se crean una vez
    const faltantes = Object.keys(SUCURSALES).filter((clave) => !BODEGAS.some((b) => b.clave === clave));
    if (!faltantes.length || !puede('editarSucursales')) return;
    faltantes.forEach((clave) => BODEGAS.push({ clave, nombre: SUCURSALES[clave] }));
    if (!guardarBodegas()) BODEGAS.splice(BODEGAS.length - faltantes.length, faltantes.length);
    else if (Object.keys(anteriores).length) ALMACEN.borrar(CLAVE_SUCURSALES);
})();

// Lista ordenada por clave. Ojo: Object.entries pondría "10"-"13" antes que "00"-"08"
// El admin de sucursal solo ve la suya
function listaSucursales() {
    return Object.entries(SUCURSALES)
        .filter(([clave]) => puede('verTodasSucursales') || clave === USUARIO_ACTUAL?.sucursal)
        .map(([clave, nombre]) => ({ clave, nombre }))
        .sort((a, b) => a.clave.localeCompare(b.clave));
}

// Crea la bodega con su registro propio. Sus colecciones (empleados, solicitudes, reportes)
// se van llenando dentro de ella conforme se registran datos.
function agregarSucursal(clave, nombre) {
    BODEGAS.push({ clave, nombre, creada: new Date().toISOString(), creadaPor: USUARIO_ACTUAL ? USUARIO_ACTUAL.usuario : '' });
    if (!guardarBodegas()) {
        BODEGAS.pop();
        return false;
    }
    SUCURSALES[clave] = nombre;
    return true;
}

// Quita la bodega y anota su clave como borrada. Regresa true solo si quedó guardado.
// Quien la llama revisa antes que no tenga trabajadores ni usuarios (ver informacion.html).
function borrarSucursal(clave) {
    const borradas = ALMACEN.leer(CLAVE_SUCURSALES_BORRADAS) || [];
    if (!ALMACEN.escribir(CLAVE_SUCURSALES_BORRADAS, [...new Set([...borradas, clave])])) return false;
    const posicion = BODEGAS.findIndex((b) => b.clave === clave);
    const [bodega] = posicion >= 0 ? BODEGAS.splice(posicion, 1) : [];
    if (bodega && !guardarBodegas()) {
        // No se pudo guardar: se regresa como estaba
        BODEGAS.splice(posicion, 0, bodega);
        ALMACEN.escribir(CLAVE_SUCURSALES_BORRADAS, borradas);
        return false;
    }
    delete SUCURSALES[clave];
    return true;
}

// Cambia solo el nombre de la bodega. La clave no cambia: de ella dependen los ID de sus trabajadores
// y en qué bodega se guardan sus datos. Regresa true solo si quedó guardado.
function renombrarSucursal(clave, nombre) {
    let bodega = BODEGAS.find((b) => b.clave === clave);
    const esNueva = !bodega;
    if (esNueva) {
        bodega = { clave, nombre: SUCURSALES[clave] };
        BODEGAS.push(bodega);
    }
    const anterior = { ...bodega };
    Object.assign(bodega, { nombre, modificada: new Date().toISOString(), modificadaPor: USUARIO_ACTUAL ? USUARIO_ACTUAL.usuario : '' });
    if (!guardarBodegas()) {
        // No se pudo guardar: se regresa como estaba
        if (esNueva) BODEGAS.pop();
        else {
            Object.keys(bodega).forEach((campo) => delete bodega[campo]);
            Object.assign(bodega, anterior);
        }
        return false;
    }
    SUCURSALES[clave] = nombre;
    return true;
}

// Enteros = departamentos, decimales = puestos
const DEPARTAMENTOS = [
    { grupo: 'Oficina', clave: '00', nombre: 'Director general', puestos: [] },
    { grupo: 'Oficina', clave: '01', nombre: 'Coordinación ventas', puestos: [] },
    { grupo: 'Oficina', clave: '02', nombre: 'Coordinación sucursales', puestos: [] },
    { grupo: 'Oficina', clave: '03', nombre: 'Coordinación administrativo', puestos: [] },
    { grupo: 'Oficina', clave: '04', nombre: 'RH', puestos: [] },
    { grupo: 'Oficina', clave: '05', nombre: 'Contabilidad', puestos: [] },
    { grupo: 'Oficina', clave: '06', nombre: 'Facturación', puestos: [
        { clave: '6.1', nombre: 'Jefe de facturación' },
        { clave: '6.2', nombre: 'Auxiliar de facturación' },
        { clave: '6.3', nombre: 'Becario' }
    ] },
    { grupo: 'Oficina', clave: '07', nombre: 'Inventarios', puestos: [
        { clave: '7.1', nombre: 'Jefa de inventarios' },
        { clave: '7.2', nombre: 'Auxiliar en inventarios' }
    ] },
    { grupo: 'Oficina', clave: '08', nombre: 'Compras', puestos: [] },
    { grupo: 'Oficina', clave: '09', nombre: 'Logística', puestos: [] },
    { grupo: 'Oficina', clave: '10', nombre: 'Sistemas', puestos: [
        { clave: '10.1', nombre: 'Jefe de departamento' },
        { clave: '10.2', nombre: 'Empleado' },
        { clave: '10.3', nombre: 'Becario' }
    ] },
    { grupo: 'Traileros de empresa', clave: '11', nombre: 'Traileros de empresa', puestos: [] },
    { grupo: 'Bodegas', clave: '12', nombre: 'Admin general', puestos: [
        { clave: '12', nombre: 'Admin general' },
        { clave: '12.1', nombre: 'Ayudante de admin' }
    ] },
    { grupo: 'Bodegas', clave: '13', nombre: 'Almacenista', puestos: [] },
    { grupo: 'Bodegas', clave: '14', nombre: 'Montacargista', puestos: [] },
    { grupo: 'Bodegas', clave: '15', nombre: 'Operadores', puestos: [
        { clave: '15.1', nombre: 'Torton' },
        { clave: '15.2', nombre: 'Rabón' },
        { clave: '15.3', nombre: 'Camionetas' }
    ] },
    { grupo: 'Bodegas', clave: '16', nombre: 'Ayudante general', puestos: [] }
];

// Un departamento sin puestos decimales tiene un único puesto con su mismo nombre
function puestosDe(nombreDepto) {
    const depto = DEPARTAMENTOS.find((d) => d.nombre === nombreDepto);
    if (!depto) return [];
    return depto.puestos.length ? depto.puestos : [{ clave: depto.clave, nombre: depto.nombre }];
}

// Salario mínimo general 2026 (CONASAMI, vigente desde el 1 de enero de 2026).
// Todas las sucursales están en el Estado de México: aplica la zona general, no la frontera norte.
const SALARIO_MINIMO_DIARIO = CONFIGURACION.salarioMinimoDiario;
const SALARIO_MINIMO_SEMANAL = Math.round(SALARIO_MINIMO_DIARIO * 7 * 100) / 100; // 7 días: incluye el día de descanso

const MOTIVOS_BAJA = ['Renuncia voluntaria', 'Término de contrato', 'Abandono de trabajo', 'Despido justificado', 'Jubilación', 'Defunción'];

// =====================================================================
//  TRABAJADORES: se llenan desde la base de datos (ya no hay datos ficticios)
// =====================================================================
const TODOS_EMPLEADOS = [];

// ---------------------------------------------------------------------
//  Lo que se registra en una página (altas, importaciones, vacaciones,
//  permisos, incapacidades, incidencias, bajas) se guarda con ALMACEN
//  (Firebase o navegador) y se ve también en las demás.
//  v4: plantilla real. Las claves anteriores (v2, v3) tenían datos de prueba y ya no se leen.
// ---------------------------------------------------------------------
const CLAVE_ALMACEN = 'elnevado.empleados.v4';

(function cargarCambiosGuardados() {
    const guardado = ALMACEN.leer(CLAVE_ALMACEN);
    if (Array.isArray(guardado)) TODOS_EMPLEADOS.splice(0, TODOS_EMPLEADOS.length, ...guardado);
})();

// Trabajadores que ve el usuario: todos para Super usuario y RH, solo su sucursal para el admin.
// Si es la lista filtrada, las altas se agregan aquí y guardarCambios las pasa a la lista completa.
const EMPLEADOS = puede('verTodasSucursales')
    ? TODOS_EMPLEADOS
    : TODOS_EMPLEADOS.filter((e) => e.suc === USUARIO_ACTUAL?.sucursal);

function guardarCambios() {
    EMPLEADOS.forEach((emp) => {
        if (!TODOS_EMPLEADOS.includes(emp)) TODOS_EMPLEADOS.push(emp);
    });
    // Regresa true solo si quedó guardado (en Firebase o en el navegador)
    return ALMACEN.escribir(CLAVE_ALMACEN, TODOS_EMPLEADOS);
}

// ---------------------------------------------------------------------
//  ID DEL TRABAJADOR: 8 dígitos = sucursal (2) + departamento (2) + número (4)
//  Ej. 01 13 0001 = Colón · Almacenista · trabajador 1.
//  El número es consecutivo dentro de la misma sucursal + departamento y NUNCA se
//  repite, aunque el trabajador se borre: se guarda el último número usado de cada
//  combinación (en Firebase: ajustes/elnevado.ids-usados.v1).
// ---------------------------------------------------------------------
const CLAVE_IDS_USADOS = 'elnevado.ids-usados.v1';
const LARGO_NUMERO_ID = 4;

function prefijoId(suc, deptoNombre) {
    const depto = DEPARTAMENTOS.find((d) => d.nombre === deptoNombre);
    return suc && depto ? String(suc) + depto.clave : '';
}

function ultimoNumeroUsado(prefijo, usados) {
    const enPlantilla = [...TODOS_EMPLEADOS, ...EMPLEADOS]
        .map((e) => String(e.id))
        .filter((id) => id.length === prefijo.length + LARGO_NUMERO_ID && id.startsWith(prefijo) && /^\d+$/.test(id))
        .map((id) => Number(id.slice(prefijo.length)));
    return Math.max(0, Number(usados[prefijo]) || 0, ...enPlantilla);
}

const armarId = (prefijo, numero) => prefijo + String(numero).padStart(LARGO_NUMERO_ID, '0');

// El ID que le tocaría a la siguiente alta (solo para mostrarlo; no lo aparta). '' si falta sucursal o departamento.
function siguienteIdTrabajador(suc, deptoNombre) {
    const prefijo = prefijoId(suc, deptoNombre);
    if (!prefijo) return '';
    return armarId(prefijo, ultimoNumeroUsado(prefijo, ALMACEN.leer(CLAVE_IDS_USADOS) || {}) + 1);
}

// Aparta el siguiente ID al momento de guardar el alta: queda anotado para que no se vuelva a dar
function reservarIdTrabajador(suc, deptoNombre) {
    const prefijo = prefijoId(suc, deptoNombre);
    if (!prefijo) throw new Error('Elige la sucursal y el departamento para asignar el ID.');
    const usados = ALMACEN.leer(CLAVE_IDS_USADOS) || {};
    const numero = ultimoNumeroUsado(prefijo, usados) + 1;
    if (numero >= 10 ** LARGO_NUMERO_ID) throw new Error('Ya no hay números de trabajador libres para esta sucursal y departamento.');
    usados[prefijo] = numero;
    if (!ALMACEN.escribir(CLAVE_IDS_USADOS, usados)) throw new Error('No se pudo apartar el ID en la base de datos. Revisa la conexión e inténtalo de nuevo.');
    return armarId(prefijo, numero);
}

// Borra todo lo registrado: trabajadores, reglas y sucursales agregadas (deja la plantilla vacía)
function restablecerDatosDemo() {
    [CLAVE_ALMACEN, CLAVE_CONFIGURACION, CLAVE_SUCURSALES, CLAVE_BODEGAS, CLAVE_SUCURSALES_BORRADAS].forEach((clave) => ALMACEN.borrar(clave));
    location.reload();
}

// =====================================================================
//  UTILIDADES DE FECHAS Y FORMATO
// =====================================================================
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const TOLERANCIA_MINUTOS = CONFIGURACION.toleranciaMinutos;

function fechaDesdeISO(iso) {
    const [anio, mes, dia] = iso.split('-').map(Number);
    return new Date(anio, mes - 1, dia, 12);
}

function aISO(fecha) {
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

function sumarDias(fecha, dias) {
    const resultado = new Date(fecha);
    resultado.setDate(resultado.getDate() + dias);
    return resultado;
}

function formatoFecha(iso) {
    const fecha = fechaDesdeISO(iso);
    return `${String(fecha.getDate()).padStart(2, '0')} ${MESES_CORTOS[fecha.getMonth()]} ${fecha.getFullYear()}`;
}

function formatoCorto(fecha) {
    return `${String(fecha.getDate()).padStart(2, '0')} ${MESES_CORTOS[fecha.getMonth()]}`;
}

function formatoDinero(valor) {
    return valor.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

function formatoTelefono(tel) {
    return tel && tel.length === 10 ? `${tel.slice(0, 3)} ${tel.slice(3, 6)} ${tel.slice(6)}` : (tel || '—');
}

function formatoHoras(horas) {
    return `${Number.isInteger(horas) ? horas : horas.toFixed(1)} h`;
}

function normalizar(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function escaparHtml(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function enRango(iso, inicio, fin) {
    return iso >= inicio && iso <= fin;
}

function diasEntre(inicioIso, finIso) {
    return Math.round((fechaDesdeISO(finIso) - fechaDesdeISO(inicioIso)) / 86400000) + 1;
}

const HOY = new Date();
HOY.setHours(12, 0, 0, 0);
const HOY_ISO = aISO(HOY);

// La semana de nómina empieza en sábado y termina en viernes
function inicioSemanaNomina(fecha) {
    return sumarDias(fecha, -((fecha.getDay() + 1) % 7));
}

// Semanas (sáb–vie) que tocan algún día del mes
function semanasDelMes(anio, mes) {
    const ultimoDia = new Date(anio, mes + 1, 0, 12);
    const semanas = [];
    let inicio = inicioSemanaNomina(new Date(anio, mes, 1, 12));
    while (inicio <= ultimoDia) {
        semanas.push({ inicio, fin: sumarDias(inicio, 6) });
        inicio = sumarDias(inicio, 7);
    }
    return semanas;
}

function etiquetaSemana(semana) {
    return `Sáb ${formatoCorto(semana.inicio)} – Vie ${formatoCorto(semana.fin)}`;
}

// =====================================================================
//  ESTADO DEL EMPLEADO
// =====================================================================
function finIncapacidad(incapacidad) {
    return aISO(sumarDias(fechaDesdeISO(incapacidad.inicio), incapacidad.dias - 1));
}

function vacacionEn(emp, iso) {
    return (emp.vacaciones || []).find((v) => enRango(iso, v.inicio, v.fin));
}

function incapacidadEn(emp, iso) {
    return (emp.incapacidades || []).find((i) => enRango(iso, i.inicio, finIncapacidad(i)));
}

// Permiso: ausencia autorizada por RH (con o sin goce de sueldo). No es incapacidad del IMSS.
function permisoEn(emp, iso) {
    return (emp.permisos || []).find((p) => enRango(iso, p.inicio, p.fin));
}

// Incidencias registradas a mano en Asistencia (retardo, falta o salida temprana)
function incidenciaEn(emp, iso) {
    return (emp.incidencias || []).find((i) => i.fecha === iso);
}

const TIPOS_INCAPACIDAD = ['Enfermedad general', 'Riesgo de trabajo', 'Maternidad'];

const NOMBRES_INCIDENCIA = {
    vacaciones: 'Vacaciones',
    permiso: 'Permiso',
    incapacidad: 'Incapacidad',
    retardo: 'Retardo',
    'retardo-justificado': 'Retardo justificado',
    falta: 'Falta',
    'salida-temprana': 'Salida temprana'
};

// ---------------------------------------------------------------------
//  Días de descanso obligatorio (Ley Federal del Trabajo, artículo 74)
// ---------------------------------------------------------------------
function enesimoLunes(anio, mes, n) {
    let dia = new Date(anio, mes, 1, 12);
    while (dia.getDay() !== 1) dia = sumarDias(dia, 1);
    return sumarDias(dia, 7 * (n - 1));
}

function descansosObligatorios(anio) {
    const lista = [
        { fecha: new Date(anio, 0, 1, 12), nombre: 'Año Nuevo', regla: '1 de enero' },
        { fecha: enesimoLunes(anio, 1, 1), nombre: 'Día de la Constitución', regla: 'Primer lunes de febrero (conmemora el 5 de febrero)' },
        { fecha: enesimoLunes(anio, 2, 3), nombre: 'Natalicio de Benito Juárez', regla: 'Tercer lunes de marzo (conmemora el 21 de marzo)' },
        { fecha: new Date(anio, 4, 1, 12), nombre: 'Día del Trabajo', regla: '1 de mayo' },
        { fecha: new Date(anio, 8, 16, 12), nombre: 'Día de la Independencia', regla: '16 de septiembre' },
        { fecha: enesimoLunes(anio, 10, 3), nombre: 'Día de la Revolución Mexicana', regla: 'Tercer lunes de noviembre (conmemora el 20 de noviembre)' },
        { fecha: new Date(anio, 11, 25, 12), nombre: 'Navidad', regla: '25 de diciembre' }
    ];
    // 1 de octubre, cada seis años, cuando toma posesión el Presidente de la República (2024, 2030...)
    if (anio >= 2024 && (anio - 2024) % 6 === 0) {
        lista.push({ fecha: new Date(anio, 9, 1, 12), nombre: 'Transmisión del Poder Ejecutivo Federal', regla: '1 de octubre, cada seis años' });
    }
    return lista
        .map((f) => ({ ...f, iso: aISO(f.fecha) }))
        .sort((a, b) => a.iso.localeCompare(b.iso));
}

const FERIADOS_POR_ANIO = {};

function feriadoEn(iso) {
    const anio = Number(iso.slice(0, 4));
    if (!FERIADOS_POR_ANIO[anio]) FERIADOS_POR_ANIO[anio] = new Map(descansosObligatorios(anio).map((f) => [f.iso, f]));
    return FERIADOS_POR_ANIO[anio].get(iso);
}

function textoDias(n) {
    return n === 1 ? '1 día' : `${n} días`;
}

// Días que cuentan como laborables: no cuentan los domingos ni los descansos obligatorios
// (el sábado sí se trabaja)
function diasHabiles(inicioIso, finIso) {
    let dias = 0;
    for (let f = fechaDesdeISO(inicioIso); aISO(f) <= finIso; f = sumarDias(f, 1)) {
        if (f.getDay() !== 0 && !feriadoEn(aISO(f))) dias++;
    }
    return dias;
}

function vacacionesTomadas(emp, anio) {
    return (emp.vacaciones || [])
        .filter((v) => Number(v.inicio.slice(0, 4)) === anio)
        .reduce((total, v) => total + diasHabiles(v.inicio, v.fin), 0);
}

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function fechaLarga(fecha) {
    return `${DIAS_SEMANA[fecha.getDay()]}, ${fecha.getDate()} de ${MESES[fecha.getMonth()].toLowerCase()} de ${fecha.getFullYear()}`;
}

// ---------------------------------------------------------------------
//  ALTA DEL SEGURO: al terminar una incapacidad (de cualquier tipo) el trabajador no puede
//  volver a trabajar hasta presentar su alta médica del IMSS. El admin de la sucursal lo
//  regresa y, cuando la trae, la sube en Incapacidades: inc.alta = { fecha, archivo, ... }.
// ---------------------------------------------------------------------
// Las incapacidades que terminaron antes de esta fecha se dan por cerradas (no se les pide alta)
const ALTA_OBLIGATORIA_DESDE = '2026-10-08';

// RH (o el Super usuario) revisa cada alta que sube el admin: inc.alta.estado es
// 'revision' (por aprobar), 'aprobada' o 'rechazada' (devuelta con motivo: hay que subirla de nuevo).
// Las que suben RH o el Super usuario quedan aprobadas de una vez.
// false = con el alta subida el trabajador ya puede trabajar mientras RH la revisa.
// true  = el trabajador sigue sin poder trabajar hasta que RH la apruebe.
const ALTA_BLOQUEA_HASTA_APROBAR = false;

// ¿La incapacidad tiene un alta que cuenta? (una devuelta no cuenta)
function altaVigente(inc) {
    if (!inc.alta || inc.alta.estado === 'rechazada') return false;
    return !(ALTA_BLOQUEA_HASTA_APROBAR && inc.alta.estado === 'revision');
}

// La incapacidad ya terminada por la que el trabajador sigue sin presentar su alta, o null.
// Solo cuenta la última: si el IMSS le dio otra incapacidad después, el alta se pide por esa.
function incapacidadSinAlta(emp) {
    if (emp.baja || !(emp.incapacidades || []).length) return null;
    const ultima = emp.incapacidades.reduce((a, b) => (finIncapacidad(b) > finIncapacidad(a) ? b : a));
    const fin = finIncapacidad(ultima);
    return fin < HOY_ISO && fin >= ALTA_OBLIGATORIA_DESDE && !altaVigente(ultima) ? ultima : null;
}

// Altas que subió el admin y esperan la revisión de RH: [{ emp, inc }]
function altasPorAprobar() {
    return EMPLEADOS.flatMap((emp) => (emp.baja ? [] : emp.incapacidades || [])
        .filter((inc) => inc.alta && inc.alta.estado === 'revision')
        .map((inc) => ({ emp, inc })));
}

// Trabajadores (de los que ve este usuario) que no pueden trabajar porque les falta el alta
function trabajadoresSinAlta() {
    return EMPLEADOS.filter((emp) => incapacidadSinAlta(emp));
}

function estadoActual(emp) {
    if (emp.baja) return 'baja';
    if (incapacidadEn(emp, HOY_ISO)) return 'incapacitado';
    if (incapacidadSinAlta(emp)) return 'sinAlta';
    if (vacacionEn(emp, HOY_ISO)) return 'vacaciones';
    return 'activo';
}

const ESTADOS = {
    activo: { texto: 'Activo', badge: 'color-asistencia' },
    incapacitado: { texto: 'Incapacidad', badge: 'color-incapacidad' },
    sinAlta: { texto: 'Sin alta del seguro', badge: 'color-falta' },
    vacaciones: { texto: 'Vacaciones', badge: 'color-vacaciones' },
    baja: { texto: 'Baja', badge: 'color-baja' }
};

function antiguedadAnios(emp) {
    const ingreso = fechaDesdeISO(emp.ingreso);
    const referencia = emp.baja ? fechaDesdeISO(emp.baja.fecha) : HOY;
    let anios = referencia.getFullYear() - ingreso.getFullYear();
    if (referencia < new Date(referencia.getFullYear(), ingreso.getMonth(), ingreso.getDate(), 12)) anios--;
    return Math.max(0, anios);
}

// Días de vacaciones según la Ley Federal del Trabajo (reforma 2023)
function getVacationDaysForYear(tenureYears) {
    if (tenureYears < 1) return 0;
    if (tenureYears <= 5) return 10 + tenureYears * 2;
    return 22 + Math.floor((tenureYears - 6) / 5) * 2;
}

// =====================================================================
//  ASISTENCIA (checadas capturadas por RH; las de las checadoras llegarán después)
// =====================================================================
function aleatorio(semilla) {
    let h = 2166136261;
    for (const c of semilla) {
        h ^= c.charCodeAt(0);
        h = Math.imul(h, 16777619);
    }
    // Mezcla final para que semillas parecidas (mismo ID, días seguidos) no den valores parecidos
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
}

function horaTexto(minutos) {
    return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

const aMinutosDelDia = (hora) => { const [h, m] = hora.split(':').map(Number); return h * 60 + m; };

// Arma el registro de un día con checada (de la checadora o capturada a mano por RH).
// Las horas se cuentan de la hora de entrada a la hora de salida (menos la comida, que hoy está en 0).
function registroChecada(fecha, entrada, salida, extra = {}) {
    const comida = fecha.getDay() === 6 ? 0 : HORARIO.comida;
    const horas = Math.max(0, Math.round(((salida - entrada - comida) / 60) * 100) / 100);
    // Hoy, mientras no llega la hora de salida, todavía no hay horas extra
    const ahora = new Date();
    const turnoAbierto = aISO(fecha) === HOY_ISO && ahora.getHours() * 60 + ahora.getMinutes() < salida;
    return {
        estado: entrada - HORARIO.entrada > TOLERANCIA_MINUTOS ? 'retardo' : 'asistencia',
        entrada: horaTexto(entrada),
        salida: horaTexto(salida),
        horas,
        extras: turnoAbierto ? 0 : horasExtra(fecha, salida),
        ...extra
    };
}

function retardoJustificadoEn(emp, iso) {
    return (emp.incidencias || []).some((i) => i.fecha === iso && i.tipo === 'retardo-justificado');
}

// Si RH justificó el retardo de ese día, cuenta como asistencia normal
function conRetardoJustificado(emp, iso, registro) {
    if (registro.estado !== 'retardo' || !retardoJustificadoEn(emp, iso)) return registro;
    return { ...registro, estado: 'asistencia', retardoJustificado: true };
}

function asistenciaManualEn(emp, iso) {
    return (emp.asistenciasManuales || []).find((a) => a.fecha === iso) || null;
}

// Checadas que registró la tableta ese día: la primera entrada y la última salida.
// Cada checada es { fecha: '2026-10-05', tipo: 'entrada' | 'salida', hora: '08:02', ... }
function checadaDelDia(emp, iso) {
    let entrada = null;
    let salida = null;
    (emp.checadas || []).forEach((c) => {
        if (c.fecha !== iso) return;
        if (c.tipo === 'entrada' && (!entrada || c.hora < entrada)) entrada = c.hora;
        if (c.tipo === 'salida' && (!salida || c.hora > salida)) salida = c.hora;
    });
    return entrada || salida ? { entrada, salida } : null;
}

// Devuelve el registro de un día o null si no aplica (antes del ingreso, después de la baja o día futuro)
function registroDia(emp, fecha) {
    const iso = aISO(fecha);
    if (iso < emp.ingreso || iso > HOY_ISO || (emp.baja && iso > emp.baja.fecha)) return null;
    if (fecha.getDay() === 0) return { estado: 'descanso', horas: 0, extras: 0 };
    const feriado = feriadoEn(iso);
    if (feriado) return { estado: 'descanso', horas: 0, extras: 0, feriado };
    // Mismo orden que estadoActual(): si una incapacidad coincide con vacaciones, cuenta la incapacidad
    const incapacidad = incapacidadEn(emp, iso);
    if (incapacidad) return { estado: 'incapacidad', horas: 0, extras: 0, incapacidad };
    if (vacacionEn(emp, iso)) return { estado: 'vacaciones', horas: 0, extras: 0 };
    const permiso = permisoEn(emp, iso);
    if (permiso) return { estado: 'permiso', horas: 0, extras: 0, permiso };

    // Asistencia capturada por RH (entrada y salida a mano): sus horas se calculan siempre
    const manual = asistenciaManualEn(emp, iso);
    if (manual) return conRetardoJustificado(emp, iso, registroChecada(fecha, aMinutosDelDia(manual.entrada), aMinutosDelDia(manual.salida), { manual }));

    if ((emp.incidencias || []).some((i) => i.fecha === iso && i.tipo === 'falta')) return { estado: 'falta', horas: 0, extras: 0 };

    // Checadas de la tableta (checador.html)
    const checada = checadaDelDia(emp, iso);
    if (checada && checada.entrada) {
        const entrada = aMinutosDelDia(checada.entrada);

        // 1) Checó su salida en el escáner: se usan sus horas reales
        if (checada.salida) {
            return conRetardoJustificado(emp, iso, registroChecada(fecha, entrada, Math.max(entrada, aMinutosDelDia(checada.salida)), { checadora: true }));
        }

        // 2) Todavía no checa salida y aún no son las 11:50 pm: está "en turno".
        //    La salida queda vacía (se muestra --) y NO se cuentan horas.
        if (!diaCerrado(iso)) {
            return conRetardoJustificado(emp, iso, {
                ...registroChecada(fecha, entrada, entrada, { checadora: true, sinSalida: true, enTurno: true }),
                salida: '',
                horas: 0,
                extras: 0
            });
        }

        // 3) Ya son las 11:50 pm (o es un día pasado) y nunca checó salida:
        //    se le pone salida automática a las 6:00 pm y se calculan sus horas.
        //    Una salida automática nunca genera horas extra.
        const salidaAutomatica = Math.max(entrada, SALIDA_AUTOMATICA);
        return conRetardoJustificado(emp, iso, {
            ...registroChecada(fecha, entrada, salidaAutomatica, { checadora: true, sinSalida: true, salidaAutomatica: true }),
            extras: 0
        });
    }

    // Sin checada ni captura de RH no se inventa asistencia: el día queda "sin registro".
    return null;
}

function resumenRango(emp, inicio, fin) {
    const resumen = { horas: 0, extras: 0, asistencias: 0, faltas: 0, retardos: 0, permisos: 0, incapacidades: 0 };
    for (let fecha = new Date(inicio); fecha <= fin; fecha = sumarDias(fecha, 1)) {
        const registro = registroDia(emp, fecha);
        if (!registro) continue;
        resumen.horas += registro.horas;
        resumen.extras += registro.extras || 0;
        if (registro.estado === 'asistencia' || registro.estado === 'retardo') resumen.asistencias++;
        if (registro.estado === 'retardo') resumen.retardos++;
        if (registro.estado === 'falta') resumen.faltas++;
        if (registro.estado === 'permiso') resumen.permisos++;
        if (registro.estado === 'incapacidad') resumen.incapacidades++;
    }
    resumen.horas = Math.round(resumen.horas * 10) / 10;
    return resumen;
}

// =====================================================================
//  NÓMINA: RECIBO SEMANAL, HORAS EXTRA Y BONO
// =====================================================================
const redondear = (valor) => Math.round(valor * 100) / 100;

// El sueldo se guarda por semana (7 días, con el descanso incluido)
function sueldoDiario(emp) {
    return redondear(emp.sueldo / 7);
}

// Bonos de una semana: los da el Super usuario desde el recibo, cada uno con su concepto y su monto
function bonosDeSemana(emp, inicioIso) {
    return (emp.bonos || [])
        .filter((b) => b.semana === inicioIso)
        .map((b) => ({ ...b, concepto: b.concepto || 'Puntualidad' }));
}

// Recibo guardado de una semana: quién lo guardó y, si ya se pagó, quién registró el pago
function reciboGuardado(emp, inicioIso) {
    return (emp.recibos || []).find((r) => r.semana === inicioIso) || null;
}

function marcarRecibo(emp, inicioIso, cambios) {
    let registro = reciboGuardado(emp, inicioIso);
    if (!registro) {
        registro = { semana: inicioIso };
        (emp.recibos = emp.recibos || []).push(registro);
    }
    return Object.assign(registro, cambios);
}

// Recibo de una semana de nómina (sábado a viernes):
// - Se pagan los días trabajados, el descanso, las vacaciones y los permisos con goce.
// - No se pagan las faltas ni los permisos sin goce; las incapacidades las paga el IMSS.
// - Los retardos no descuentan.
// - Horas extra: las primeras 9 de la semana al doble y las siguientes al triple (LFT, art. 67 y 68).
function reciboSemana(emp, inicio) {
    const fin = sumarDias(inicio, 6);
    const diario = sueldoDiario(emp);
    const recibo = {
        emp, inicio, fin, diario,
        dias: [], descansos: [], diasPagados: 0, diasConGoce: 0, faltas: 0, retardos: 0, permisosSinGoce: 0, incapacidad: 0, extras: 0
    };
    for (let fecha = new Date(inicio); fecha <= fin; fecha = sumarDias(fecha, 1)) {
        const reg = registroDia(emp, fecha);
        if (!reg) continue;
        if (reg.estado === 'asistencia' || reg.estado === 'retardo') {
            recibo.dias.push({ fecha: aISO(fecha), ...reg });
            recibo.diasPagados++;
            recibo.extras += reg.extras;
            if (reg.estado === 'retardo') recibo.retardos++;
        } else if (reg.estado === 'falta') recibo.faltas++;
        else if (reg.estado === 'incapacidad') recibo.incapacidad++;
        else if (reg.estado === 'permiso' && !reg.permiso.goce) recibo.permisosSinGoce++;
        else {
            recibo.diasPagados++;
            if (reg.estado === 'descanso') recibo.descansos.push({ fecha: aISO(fecha), feriado: reg.feriado ? reg.feriado.nombre : '' });
            else recibo.diasConGoce++; // vacaciones o permiso con goce
        }
    }
    const pagoHora = diario / 8;
    recibo.extrasDobles = Math.min(recibo.extras, 9);
    recibo.extrasTriples = recibo.extras - recibo.extrasDobles;
    recibo.pagoDias = redondear(emp.sueldo * recibo.diasPagados / 7); // sin arrastrar el redondeo del diario
    recibo.pagoExtras = redondear(recibo.extrasDobles * pagoHora * 2 + recibo.extrasTriples * pagoHora * 3);
    recibo.elegibleBono = recibo.dias.length > 0 && recibo.retardos === 0 && recibo.faltas === 0;
    recibo.bonos = bonosDeSemana(emp, aISO(inicio));
    recibo.totalBonos = redondear(recibo.bonos.reduce((total, b) => total + b.monto, 0));
    recibo.guardado = reciboGuardado(emp, aISO(inicio));
    recibo.total = redondear(recibo.pagoDias + recibo.pagoExtras + recibo.totalBonos);
    return recibo;
}

// =====================================================================
//  REPORTES DE FALLA DE LA CHECADORA
//  El admin reporta a quien no pudo checar, Sistemas confirma si la checadora
//  falló y RH captura la asistencia a mano. Si nadie lo reporta, queda como falta.
// =====================================================================
const CLAVE_REPORTES = 'elnevado.reportes.v1';

function listaReportes() {
    const guardados = ALMACEN.leer(CLAVE_REPORTES);
    return Array.isArray(guardados) ? guardados : [];
}

function guardarReportes(reportes) {
    return ALMACEN.escribir(CLAVE_REPORTES, reportes);
}

function reporteDe(empId, iso) {
    return listaReportes().find((r) => r.empleado === empId && r.fecha === iso) || null;
}

const ESTADOS_REPORTE = {
    pendiente: 'Sistemas aún no lo revisa',
    confirmada: 'Sistemas confirmó la falla',
    descartada: 'Sistemas no encontró falla'
};

// =====================================================================
//  UTILIDADES COMPARTIDAS DE PANTALLA
// =====================================================================
// El admin solo tiene una sucursal: en vez de una lista desplegable (que da a entender que puede elegir)
// se muestra el nombre fijo. La lista queda oculta con su sucursal, para que los filtros sigan funcionando.
function fijarSucursalUnica(select) {
    if (puede('verTodasSucursales') || !select) return false;
    const clave = USUARIO_ACTUAL.sucursal;
    select.innerHTML = `<option value="${clave}">${escaparHtml(nombreSucursal(clave))}</option>`;
    select.value = clave;
    select.hidden = true;
    select.style.display = 'none';
    if (!select.nextElementSibling || !select.nextElementSibling.classList.contains('sucursal-fija')) {
        const etiqueta = document.createElement('span');
        etiqueta.className = 'sucursal-fija';
        etiqueta.textContent = nombreSucursal(clave);
        etiqueta.title = 'Tu sucursal';
        select.insertAdjacentElement('afterend', etiqueta);
    }
    return true;
}

function nombreSucursal(clave) {
    return `${clave} - ${SUCURSALES[clave] || 'Sin sucursal'}`;
}

// =====================================================================
//  EXCEL (exportar / plantilla)
// =====================================================================
// hojas: [{ nombre, filas: [[encabezados], [valores]...] }]
function descargarExcel(nombreArchivo, hojas) {
    if (window.XLSX) {
        const libro = XLSX.utils.book_new();
        hojas.forEach((hoja) => {
            const ws = XLSX.utils.aoa_to_sheet(hoja.filas);
            ws['!cols'] = hoja.filas[0].map((_, col) => ({
                wch: Math.min(45, Math.max(...hoja.filas.map((f) => String(f[col] ?? '').length)) + 2)
            }));
            XLSX.utils.book_append_sheet(libro, ws, hoja.nombre);
        });
        XLSX.writeFile(libro, `${nombreArchivo}.xlsx`);
        return 'xlsx';
    }

    // Sin conexión a internet no carga la librería: se descarga la primera hoja como CSV (Excel también lo abre)
    const csv = hojas[0].filas
        .map((fila) => fila.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `${nombreArchivo}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(url);
    return 'csv';
}

// =====================================================================
//  SOLICITUDES: vacaciones y faltas administrativas
//  El admin solicita; RH o el Super usuario aprueban, rechazan o (en vacaciones)
//  contraproponen otras fechas. El admin acepta, manda otra propuesta o cancela,
//  hasta que quede aprobada. Solo lo aprobado afecta vacaciones, asistencia y nómina.
// =====================================================================
const CLAVE_SOLICITUDES = 'elnevado.solicitudes.v1';

const TIPOS_SOLICITUD = {
    vacaciones: 'Vacaciones',
    permiso: 'Permiso',
    incapacidad: 'Incapacidad',
    acta: 'Falta administrativa',
    retardo: 'Retardo justificado',
    salida: 'Salida temprana'
};

const ESTADOS_SOLICITUD = {
    revision: { texto: 'En revisión de RH', clase: 'warn' },
    contrapropuesta: { texto: 'Contrapropuesta de RH', clase: 'info' },
    aprobada: { texto: 'Aprobada', clase: 'ok' },
    rechazada: { texto: 'Rechazada', clase: 'danger' },
    cancelada: { texto: 'Cancelada', clase: 'muted' }
};

function listaSolicitudes() {
    const guardadas = ALMACEN.leer(CLAVE_SOLICITUDES);
    return Array.isArray(guardadas) ? guardadas : [];
}

function guardarSolicitudes(solicitudes) {
    return ALMACEN.escribir(CLAVE_SOLICITUDES, solicitudes);
}

// Solicitudes que ve el usuario: el admin solo las de su sucursal
function solicitudesVisibles() {
    return listaSolicitudes().filter((s) => puede('verTodasSucursales') || s.suc === USUARIO_ACTUAL?.sucursal);
}

function pasoHistorial(accion, datos, comentario) {
    return {
        fecha: new Date().toISOString(),
        usuario: USUARIO_ACTUAL.usuario,
        rol: USUARIO_ACTUAL.rol,
        accion,
        datos: datos ? { ...datos } : null,
        comentario: comentario || ''
    };
}

function crearSolicitud(tipo, emp, datos, comentario) {
    const solicitudes = listaSolicitudes();
    const solicitud = {
        id: `${tipo}-${emp.id}-${Date.now()}`,
        tipo,
        empleado: emp.id,
        suc: emp.suc,
        estado: 'revision',
        ronda: 1,
        datos: { ...datos },
        creadoPor: USUARIO_ACTUAL.usuario,
        creado: new Date().toISOString(),
        historial: [pasoHistorial('Solicitó', datos, comentario)]
    };
    solicitudes.push(solicitud);
    return guardarSolicitudes(solicitudes) ? solicitud : null;
}

// Aplica un cambio a una solicitud guardada y lo deja en su historial
function cambiarSolicitud(id, cambio) {
    const solicitudes = listaSolicitudes();
    const solicitud = solicitudes.find((s) => s.id === id);
    if (!solicitud) return null;
    const estadoAntes = solicitud.estado;
    cambio(solicitud);
    // Si otra persona la aprobó o la rechazó, quien la pidió la verá marcada como nueva
    if (solicitud.estado !== estadoAntes && ['aprobada', 'rechazada'].includes(solicitud.estado)) {
        solicitud.sinVer = solicitud.creadoPor !== USUARIO_ACTUAL.usuario;
    }
    return guardarSolicitudes(solicitudes) ? solicitud : null;
}

// ---------- Vacaciones ----------
function diasDisponiblesVacaciones(emp, anio) {
    return Math.max(0, getVacationDaysForYear(antiguedadAnios(emp)) - vacacionesTomadas(emp, anio));
}

// Días que ya están pedidos en otras solicitudes de vacaciones sin resolver
function diasEnSolicitud(emp, anio, excluirId) {
    return listaSolicitudes()
        .filter((s) => s.tipo === 'vacaciones' && s.empleado === emp.id && s.id !== excluirId && ['revision', 'contrapropuesta'].includes(s.estado))
        .filter((s) => Number(s.datos.inicio.slice(0, 4)) === anio)
        .reduce((total, s) => total + diasHabiles(s.datos.inicio, s.datos.fin), 0);
}

function periodosOcupadosDe(emp) {
    return [
        ...(emp.vacaciones || []).map((v) => ({ inicio: v.inicio, fin: v.fin, nombre: 'unas vacaciones' })),
        ...(emp.permisos || []).map((p) => ({ inicio: p.inicio, fin: p.fin, nombre: 'un permiso' })),
        ...(emp.incapacidades || []).map((i) => ({ inicio: i.inicio, fin: finIncapacidad(i), nombre: 'una incapacidad' }))
    ];
}

// Devuelve el error de un periodo de vacaciones o '' si es válido
function validarPeriodoVacaciones(emp, inicio, fin, excluirId) {
    if (!inicio || !fin) return 'Elige el primer y el último día.';
    if (fin < inicio) return 'El último día no puede ser antes del primero.';
    if (inicio < emp.ingreso) return `No puede ser antes de su ingreso (${formatoFecha(emp.ingreso)}).`;
    if (inicio.slice(0, 4) !== fin.slice(0, 4)) return 'El periodo debe quedar dentro del mismo año.';
    const dias = diasHabiles(inicio, fin);
    if (dias < 1) return 'El periodo no tiene días laborables.';
    const anio = Number(inicio.slice(0, 4));
    const disponibles = diasDisponiblesVacaciones(emp, anio) - diasEnSolicitud(emp, anio, excluirId);
    if (dias > disponibles) return `Solo tiene ${Math.max(0, disponibles)} días disponibles en ${anio} y el periodo suma ${dias}.`;
    const choque = periodosOcupadosDe(emp).find((p) => p.inicio <= fin && p.fin >= inicio);
    if (choque) return `Se cruza con ${choque.nombre} (${formatoFecha(choque.inicio)} – ${formatoFecha(choque.fin)}).`;
    return '';
}

// Devuelve el error de un periodo de permiso o incapacidad, o '' si es válido
function validarPeriodoAusencia(emp, inicio, fin) {
    if (!inicio || !fin) return 'Elige el primer y el último día.';
    if (fin < inicio) return 'El último día no puede ser antes del primero.';
    if (inicio < emp.ingreso) return `No puede ser antes de su ingreso (${formatoFecha(emp.ingreso)}).`;
    const choque = periodosOcupadosDe(emp).find((p) => p.inicio <= fin && p.fin >= inicio);
    if (choque) return `Se cruza con ${choque.nombre} (${formatoFecha(choque.inicio)} – ${formatoFecha(choque.fin)}).`;
    return '';
}

// ---------- Faltas administrativas (actas) ----------
// Deja el acta en el expediente y, si cuenta como falta, marca ese día como falta
function registrarActa(emp, datos, solicitudId) {
    (emp.actas = emp.actas || []).push({ ...datos, solicitud: solicitudId, aprobadaPor: USUARIO_ACTUAL.usuario });
    if (datos.cuentaComoFalta && registroDia(emp, fechaDesdeISO(datos.fecha))?.estado !== 'falta') {
        (emp.incidencias = emp.incidencias || []).push({ fecha: datos.fecha, tipo: 'falta', detalle: `Falta administrativa: ${datos.hechos}`, acta: true });
    }
    guardarCambios();
}

// RH y Super usuario levantan el acta ya aprobada (queda también en Solicitudes, para imprimirla)
function levantarActaDirecta(emp, datos) {
    const solicitud = crearSolicitud('acta', emp, datos, '');
    if (!solicitud) return null;
    registrarActa(emp, datos, solicitud.id);
    return cambiarSolicitud(solicitud.id, (s) => {
        s.estado = 'aprobada';
        s.historial.push(pasoHistorial('Levantó el acta', null, ''));
    });
}

// Devuelve el error de los datos de un acta o '' si son válidos
function validarActa(emp, datos) {
    if (!datos.fecha || datos.fecha > HOY_ISO || datos.fecha < emp.ingreso) return 'La fecha debe estar entre su ingreso y hoy.';
    if (datos.hechos.length < 15) return 'Describe los hechos (mínimo 15 caracteres).';
    if (datos.testigos.split(',').filter((t) => t.trim()).length < 2) return 'Escribe el nombre de 2 testigos, separados por coma.';
    return '';
}

// ---------- Faltas sin justificar en los últimos 30 días (LFT art. 47, fr. X) ----------
function faltasUltimos30(emp, hastaIso = HOY_ISO) {
    const fechas = [];
    const hasta = fechaDesdeISO(hastaIso);
    for (let fecha = sumarDias(hasta, -29); fecha <= hasta; fecha = sumarDias(fecha, 1)) {
        if (registroDia(emp, fecha)?.estado === 'falta') fechas.push(aISO(fecha));
    }
    return fechas;
}

const NIVELES_FALTAS = [
    { minimo: 4, clase: 'danger', titulo: 'Causa de rescisión', texto: 'Más de 3 faltas en 30 días (LFT art. 47, fr. X). RH revisa el caso y el Super usuario decide si da la baja; se debe entregar el aviso de rescisión por escrito.' },
    { minimo: 3, clase: 'danger', titulo: 'Una falta más es causa de rescisión', texto: 'Levanta un acta y entrega advertencia por escrito.' },
    { minimo: 2, clase: 'warn', titulo: 'Lleva 2 faltas', texto: 'Puede solicitarse una falta administrativa (acta) con los hechos.' },
    { minimo: 1, clase: 'muted', titulo: '1 falta', texto: 'RH habla con el trabajador.' }
];

function nivelFaltas(cantidad) {
    return NIVELES_FALTAS.find((n) => cantidad >= n.minimo) || null;
}

// ---------- Documentos del expediente ----------
const DOCUMENTOS_BASICOS = [
    { clave: 'ine', nombre: 'INE', obligatorio: true },
    { clave: 'acta', nombre: 'Acta de nacimiento', obligatorio: true },
    { clave: 'curp', nombre: 'CURP', obligatorio: true },
    { clave: 'rfc', nombre: 'Constancia de situación fiscal (RFC)', obligatorio: true },
    { clave: 'nss', nombre: 'Número de Seguro Social (NSS)', obligatorio: true },
    { clave: 'domicilio', nombre: 'Comprobante de domicilio (máx. 3 meses)', obligatorio: true },
    { clave: 'contrato', nombre: 'Contrato firmado', obligatorio: true },
    { clave: 'antecedentes', nombre: 'Antecedentes no penales', obligatorio: true },
    { clave: 'estudios', nombre: 'Comprobante de estudios', obligatorio: false },
    { clave: 'solicitud', nombre: 'Solicitud de empleo', obligatorio: false }
];

// El admin de sucursal sube el archivo ("entregado"); RH lo aprueba ("revisado") o lo
// devuelve con un motivo ("rechazado") para que el admin lo vuelva a subir.
const ESTADOS_DOCUMENTO = {
    falta: { texto: 'Falta', clase: 'muted' },
    entregado: { texto: 'Por aprobar', clase: 'warn' },
    revisado: { texto: 'Aprobado', clase: 'ok' },
    rechazado: { texto: 'Devuelto', clase: 'danger' }
};

function estadoDocumento(emp, clave) {
    return (emp.documentos || {})[clave] || { estado: 'falta' };
}

function avanceExpediente(emp) {
    const obligatorios = DOCUMENTOS_BASICOS.filter((d) => d.obligatorio);
    const completos = obligatorios.filter((d) => ['entregado', 'revisado'].includes(estadoDocumento(emp, d.clave).estado)).length;
    return { completos, total: obligatorios.length };
}