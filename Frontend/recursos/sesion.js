// Sesión, roles, permisos y bitácora. Se carga en el <head> de todas las páginas, antes de datos.js.
// Mientras no exista el servidor, los usuarios y la sesión viven en el navegador:
// esto sirve para probar el flujo, pero la seguridad real se aplicará en el servidor.

// =====================================================================

const FIREBASE = {
     projectId: 'checador00nevado',  
    apiKey: 'AIzaSyBbYhn_ppZ2bQpM9XzkjYK1wHaEvhlE3hY',      
    coleccion: 'almacen'
};
const USAR_FIREBASE = Boolean(FIREBASE.projectId && FIREBASE.apiKey);

const ALMACEN = (() => {
    
    const SOLO_NAVEGADOR = ['elnevado.sesion.v1', 'elnevado.usuarios.v1', 'elnevado.bitacora.v1'];
    const enLinea = (clave) => USAR_FIREBASE && !SOLO_NAVEGADOR.includes(clave);

    const URL_FIRESTORE = `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents/${FIREBASE.coleccion}`;
    const urlDocumento = (clave) => `${URL_FIRESTORE}/${encodeURIComponent(clave)}?key=${FIREBASE.apiKey}`;

    // Peticiones síncronas a propósito: así las páginas siguen funcionando igual
    // que con el navegador (leen y guardan al instante) sin tener que reescribirlas.
    function peticion(metodo, url, cuerpo) {
        const xhr = new XMLHttpRequest();
        xhr.open(metodo, url, false);
        if (cuerpo !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(cuerpo === undefined ? null : JSON.stringify(cuerpo));
        if (xhr.status !== 200) throw new Error(`Firebase respondió ${xhr.status}: ${xhr.responseText.slice(0, 300)}`);
        return JSON.parse(xhr.responseText);
    }

    // Copia de lo que hay en Firestore: { clave: texto JSON }. null = no se pudo conectar.
    let nube = null;
    if (USAR_FIREBASE) {
        try {
            const todo = {};
            let pagina = '';
            do {
                const respuesta = peticion('GET', `${URL_FIRESTORE}?key=${FIREBASE.apiKey}&pageSize=100${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`);
                (respuesta.documents || []).forEach((doc) => {
                    if (doc.fields && doc.fields.json) todo[doc.name.split('/').pop()] = doc.fields.json.stringValue;
                });
                pagina = respuesta.nextPageToken || '';
            } while (pagina);
            nube = todo;
        } catch (error) {
            console.error('No se pudo leer Firebase:', error);
            // Aviso visible: sin conexión, los cambios NO se guardarían
            document.addEventListener('DOMContentLoaded', () => {
                const aviso = document.createElement('div');
                aviso.setAttribute('role', 'alert');
                aviso.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;' +
                    'background:#b91c1c;color:#fff;padding:10px 18px;border-radius:10px;font:600 14px system-ui,sans-serif;' +
                    'box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:90vw;text-align:center';
                aviso.textContent = '⚠️ No se pudo conectar con Firebase: lo que registres NO se guardará. Revisa el internet, projectId, apiKey y las reglas de Firestore (detalle en la consola, F12).';
                document.body.appendChild(aviso);
            });
        }
    }

    return {
        enFirebase: USAR_FIREBASE,
        conectado: () => !USAR_FIREBASE || nube !== null,
        // Devuelve una copia nueva cada vez (igual que al leer del navegador) o null si no hay nada
        leer(clave) {
            try {
                const texto = enLinea(clave) ? (nube ? nube[clave] : null) : localStorage.getItem(clave);
                return texto == null ? null : JSON.parse(texto);
            } catch (error) {
                return null;
            }
        },
        // Regresa true solo si quedó guardado
        escribir(clave, valor) {
            const texto = JSON.stringify(valor);
            try {
                if (!enLinea(clave)) {
                    localStorage.setItem(clave, texto);
                    return true;
                }
                if (!nube) return false;
                peticion('PATCH', urlDocumento(clave), {
                    fields: { json: { stringValue: texto }, actualizado: { timestampValue: new Date().toISOString() } }
                });
                nube[clave] = texto;
                return true;
            } catch (error) {
                console.error(`No se pudo guardar "${clave}":`, error);
                return false;
            }
        },
        borrar(clave) {
            try {
                if (!enLinea(clave)) {
                    localStorage.removeItem(clave);
                    return true;
                }
                if (!nube) return false;
                peticion('DELETE', urlDocumento(clave));
                delete nube[clave];
                return true;
            } catch (error) {
                console.error(`No se pudo borrar "${clave}":`, error);
                return false;
            }
        }
    };
})();

// =====================================================================
//  ROLES
// =====================================================================
const ROLES = {
    super: { nombre: 'Super usuario', inicio: 'inicio.html' },
    rh: { nombre: 'Recursos Humanos', inicio: 'inicio.html' },
    admin: { nombre: 'Admin de sucursal', inicio: 'inicio.html' },
    sistemas: { nombre: 'Sistemas', inicio: 'usuarios.html' }
};

// Páginas que puede abrir cada rol (las demás se ocultan del menú y redirigen)
const PAGINAS_POR_ROL = {
    super: ['inicio.html', 'empleados.html', 'asistencia.html', 'incapacidades.html', 'vacaciones.html', 'solicitudes.html', 'nomina.html', 'informacion.html', 'configuracion.html', 'usuarios.html'],
    rh: ['inicio.html', 'empleados.html', 'asistencia.html', 'incapacidades.html', 'vacaciones.html', 'solicitudes.html', 'nomina.html', 'informacion.html', 'configuracion.html'],
    admin: ['inicio.html', 'empleados.html', 'asistencia.html', 'incapacidades.html', 'vacaciones.html', 'solicitudes.html', 'informacion.html'],
    // Sistemas da mantenimiento: no ve datos personales ni sueldos
    sistemas: ['usuarios.html']
};

// Acciones y los roles que pueden hacerlas
const PERMISOS = {
    verTodasSucursales: ['super', 'rh'],        // el admin solo ve su sucursal
    verSueldos: ['super', 'rh'],                // incluye capturarlos en el alta
    darAlta: ['super', 'rh', 'admin'],          // el admin, solo en su sucursal
    elegirSucursalAlta: ['super', 'rh'],
    registrarIncidencias: ['super', 'rh'],      // el admin las solicitará a RH
    aprobarSolicitudes: ['super', 'rh'],        // aprobar, rechazar o contraproponer
    resolverContrapropuesta: ['super'],         // cerrar una contrapropuesta sin esperar al admin de sucursal
    solicitarVacaciones: ['admin'],             // RH y Super usuario las registran directo en Empleados
    solicitarActa: ['admin'],                   // falta administrativa: el admin la pide a RH
    levantarActa: ['super', 'rh'],              // RH y Super usuario la levantan ya aprobada
    darBaja: ['super'],
    editarTrabajador: ['super', 'rh'],          // corregir sus datos desde la ficha
    borrarTrabajador: ['super', 'rh'],          // quitar el registro completo (no es lo mismo que la baja)
    subirDocumentos: ['super', 'rh', 'admin'],  // el admin, solo de su sucursal
    revisarDocumentos: ['super', 'rh'],
    editarSucursales: ['super', 'rh'],
    editarConfiguracion: ['super'],             // RH la ve en solo lectura
    otorgarBono: ['super'],
    generarRecibos: ['super', 'rh'],
    generarListaAsistencia: ['admin'],          // lista semanal de su sucursal en PDF (por ahora solo el admin)
    reportarFallaChecadora: ['admin'],          // el admin no captura asistencias, solo las reporta
    registrarAsistenciaManual: ['super', 'rh'], // cuando no hubo checada
    corregirChecada: ['super'],                 // cambiar una checada que sí existe (corrige horas extra)
    confirmarFallaChecadora: ['super', 'sistemas'],
    administrarUsuarios: ['super', 'sistemas'],
    crearSuperUsuario: ['super'],
    verMonitoreo: ['super', 'sistemas'],
    verBitacora: ['super']
};

// =====================================================================
//  USUARIOS (de prueba; se administran en usuarios.html)
// =====================================================================
const CLAVE_USUARIOS = 'elnevado.usuarios.v1';
const CLAVE_SESION = 'elnevado.sesion.v1';
const CLAVE_BITACORA = 'elnevado.bitacora.v1';

const USUARIOS_INICIALES = [
    { usuario: 'super', contrasena: 'super123', nombre: 'Juan Pérez López', rol: 'super', sucursal: '00', activo: true },
    { usuario: 'rh', contrasena: 'rh123', nombre: 'Eduardo Gómez Salinas', rol: 'rh', sucursal: '00', activo: true },
    { usuario: 'sistemas', contrasena: 'sistemas123', nombre: 'Daniel Rojas Pineda', rol: 'sistemas', sucursal: '00', activo: true },
    { usuario: 'admin01', contrasena: 'admin123', nombre: 'Verónica Silva Guzmán', rol: 'admin', sucursal: '01', activo: true },
    { usuario: 'admin05', contrasena: 'admin123', nombre: 'Karla Medina Bautista', rol: 'admin', sucursal: '05', activo: true }
];

function listaUsuarios() {
    const guardados = ALMACEN.leer(CLAVE_USUARIOS);
    if (Array.isArray(guardados) && guardados.length) return guardados;
    return USUARIOS_INICIALES.map((u) => ({ ...u }));
}

function guardarUsuarios(usuarios) {
    return ALMACEN.escribir(CLAVE_USUARIOS, usuarios);
}

function buscarUsuario(nombreUsuario) {
    const buscado = String(nombreUsuario || '').trim().toLowerCase();
    return listaUsuarios().find((u) => u.usuario.toLowerCase() === buscado) || null;
}

// =====================================================================
//  BITÁCORA: quién hizo qué y cuándo (se guardan los últimos 300 movimientos)
// =====================================================================
function leerBitacora() {
    const guardada = ALMACEN.leer(CLAVE_BITACORA);
    return Array.isArray(guardada) ? guardada : [];
}

function registrarBitacora(accion, detalle = '', usuario = USUARIO_ACTUAL) {
    try {
        const bitacora = leerBitacora();
        bitacora.unshift({
            fecha: new Date().toISOString(),
            usuario: usuario ? usuario.usuario : '—',
            rol: usuario ? usuario.rol : '',
            accion,
            detalle
        });
        ALMACEN.escribir(CLAVE_BITACORA, bitacora.slice(0, 300));
    } catch (error) {
        // Sin almacenamiento disponible: no se registra
    }
}

// =====================================================================
//  SESIÓN
// =====================================================================
function leerSesion() {
    try {
        return sessionStorage.getItem(CLAVE_SESION) || localStorage.getItem(CLAVE_SESION);
    } catch (error) {
        return null;
    }
}

// Devuelve el usuario si las credenciales son válidas; si no, un mensaje de error
function iniciarSesion(nombreUsuario, contrasena, recordar) {
    const usuario = buscarUsuario(nombreUsuario);
    if (!usuario || usuario.contrasena !== contrasena) return { error: 'Usuario o contraseña incorrectos.' };
    if (!usuario.activo) return { error: 'Tu cuenta está desactivada. Contacta al área de Sistemas.' };
    try {
        sessionStorage.removeItem(CLAVE_SESION);
        localStorage.removeItem(CLAVE_SESION);
        (recordar ? localStorage : sessionStorage).setItem(CLAVE_SESION, usuario.usuario);
    } catch (error) {
        return { error: 'Este navegador no permite guardar la sesión.' };
    }
    registrarBitacora('Inicio de sesión', '', usuario);
    return { usuario };
}

function cerrarSesion() {
    registrarBitacora('Cierre de sesión');
    try {
        sessionStorage.removeItem(CLAVE_SESION);
        localStorage.removeItem(CLAVE_SESION);
    } catch (error) {
        // nada que borrar
    }
    location.href = 'index.html';
}

// Usuario con la sesión abierta (null si no hay sesión o la cuenta se desactivó)
const USUARIO_ACTUAL = (() => {
    const usuario = buscarUsuario(leerSesion());
    if (!usuario || !usuario.activo || !ROLES[usuario.rol]) return null;
    return { usuario: usuario.usuario, nombre: usuario.nombre, rol: usuario.rol, sucursal: usuario.sucursal };
})();

function puede(accion) {
    return Boolean(USUARIO_ACTUAL && (PERMISOS[accion] || []).includes(USUARIO_ACTUAL.rol));
}

function puedeAbrir(pagina) {
    return Boolean(USUARIO_ACTUAL && PAGINAS_POR_ROL[USUARIO_ACTUAL.rol].includes(pagina));
}

// =====================================================================
//  PROTECCIÓN DE PÁGINAS
// =====================================================================
const PAGINA_ACTUAL = location.pathname.split('/').pop() || 'index.html';

(function protegerPagina() {
    if (PAGINA_ACTUAL === 'index.html') return;
    if (!USUARIO_ACTUAL) {
        document.documentElement.style.visibility = 'hidden';
        location.replace('index.html');
    } else if (!puedeAbrir(PAGINA_ACTUAL)) {
        document.documentElement.style.visibility = 'hidden';
        location.replace(ROLES[USUARIO_ACTUAL.rol].inicio);
    }
})();

// Menú lateral: solo las páginas del rol, más los datos del usuario
function prepararMenu() {
    const nav = document.querySelector('.sidebar__nav');
    if (!nav || !USUARIO_ACTUAL) return;

    const vacaciones = nav.querySelector('a[href="vacaciones.html"]');
    if (puedeAbrir('solicitudes.html') && vacaciones && !nav.querySelector('a[href="solicitudes.html"]')) {
        vacaciones.insertAdjacentHTML('afterend', '<a href="solicitudes.html" class="nav-item"><span class="nav-icon">📨</span> Solicitudes</a>');
    }
    if (puedeAbrir('usuarios.html') && !nav.querySelector('a[href="usuarios.html"]')) {
        nav.insertAdjacentHTML('beforeend', '<a href="usuarios.html" class="nav-item"><span class="nav-icon">🔐</span> Usuarios y sistema</a>');
    }
    nav.querySelectorAll('a.nav-item').forEach((enlace) => {
        const pagina = enlace.getAttribute('href');
        if (!puedeAbrir(pagina)) enlace.remove();
        else enlace.classList.toggle('active', pagina === PAGINA_ACTUAL);
    });

    const partes = USUARIO_ACTUAL.nombre.split(/\s+/);
    const avatar = document.querySelector('.sidebar__user .user-avatar');
    const nombre = document.querySelector('.sidebar__user .user-info strong');
    const etiqueta = document.querySelector('.sidebar__user .user-info span');
    if (avatar) avatar.textContent = partes.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    if (nombre) nombre.textContent = partes.slice(0, 2).join(' ');
    if (etiqueta) etiqueta.textContent = ROLES[USUARIO_ACTUAL.rol].nombre + (USUARIO_ACTUAL.rol === 'admin' ? ` · Suc. ${USUARIO_ACTUAL.sucursal}` : '');

    prepararCampana();

    const salir = document.querySelector('.sidebar__user .btn-logout');
    if (salir) {
        salir.addEventListener('click', (evento) => {
            evento.preventDefault();
            cerrarSesion();
        });
    }
}

// Campana: solicitudes que esperan respuesta de este usuario
function solicitudesPorAtender() {
    const solicitudes = ALMACEN.leer('elnevado.solicitudes.v1') || [];
    // Además de lo que le toca resolver, cuentan las solicitudes suyas que alguien más ya aprobó o rechazó y aún no ve
    const resueltasSinVer = solicitudes.filter((s) => s.sinVer && s.creadoPor === USUARIO_ACTUAL.usuario).length;
    if (puede('aprobarSolicitudes')) return solicitudes.filter((s) => s.estado === 'revision').length + resueltasSinVer;
    if (puede('solicitarVacaciones')) return solicitudes.filter((s) => s.estado === 'contrapropuesta' && s.suc === USUARIO_ACTUAL.sucursal).length + resueltasSinVer;
    return 0;
}

function prepararCampana() {
    const campana = document.querySelector('.btn-notification');
    if (!campana) return;
    if (!puedeAbrir('solicitudes.html')) {
        campana.remove();
        return;
    }
    const pendientes = solicitudesPorAtender();
    campana.classList.add('btn-notification--con-contador');
    campana.title = pendientes ? `${pendientes} solicitud${pendientes === 1 ? '' : 'es'} por atender o con respuesta nueva` : 'Sin solicitudes por atender';
    campana.setAttribute('aria-label', campana.title);
    if (pendientes) campana.insertAdjacentHTML('beforeend', `<span class="contador-campana">${pendientes > 9 ? '9+' : pendientes}</span>`);
    campana.addEventListener('click', () => { location.href = 'solicitudes.html'; });
}

if (PAGINA_ACTUAL !== 'index.html') document.addEventListener('DOMContentLoaded', prepararMenu);