// Sesión, roles, permisos y bitácora. Se carga en el <head> de todas las páginas, antes de datos.js.
// Mientras no exista el servidor, los usuarios y la sesión viven en el navegador:
// esto sirve para probar el flujo, pero la seguridad real se aplicará en el servidor.

// =====================================================================
//  ALMACÉN: dónde se guardan los datos
//  Pega aquí los datos de tu proyecto de Firebase (Consola de Firebase →
//  Configuración del proyecto → Tus apps → firebaseConfig). Con projectId y
//  apiKey llenos, los datos se guardan en Cloud Firestore y se ven desde
//  cualquier computadora; si los dejas vacíos, todo sigue en este navegador.
//
//  En Firestore los datos se guardan POR BODEGA (sucursal). Cada bodega es un
//  documento y adentro lleva sus propias colecciones, un documento por registro:
//      bodegas/01                      → { clave: '01', nombre: 'Colón', ... }
//      bodegas/01/empleados/{ID}       → trabajadores de esa bodega
//      bodegas/01/solicitudes/{id}     → sus solicitudes
//      bodegas/01/reportes/{fecha_ID}  → sus reportes de falla de checadora
//  Lo que es de toda la empresa queda aparte:  ajustes/configuracion
// =====================================================================
const FIREBASE = {
    projectId: '',   // ej. 'checador-el-nevado'
    apiKey: ''       // ej. 'AIzaSy...'
};
const USAR_FIREBASE = Boolean(FIREBASE.projectId && FIREBASE.apiKey);

const ALMACEN = (() => {
    // Estas claves se quedan SIEMPRE en el navegador, aunque Firebase esté activo:
    // - la sesión es de cada computadora;
    // - las cuentas guardan la contraseña tal cual y la bitácora dice quién hizo qué: mientras las
    //   reglas de Firestore estén abiertas (modo de prueba) cualquiera podría leerlas.
    // Cuando el login use Firebase Authentication, quita de esta lista usuarios y bitácora
    // (se guardarán en las colecciones "usuarios" y "bitacora", un documento por registro).
    const SOLO_NAVEGADOR = ['elnevado.sesion.v1', 'elnevado.usuarios.v1', 'elnevado.bitacora.v1'];
    const enLinea = (clave) => USAR_FIREBASE && !SOLO_NAVEGADOR.includes(clave);

    // A dónde va cada clave. Con "id", el valor es una lista y cada elemento es un documento;
    // con "documento", el valor completo es un solo documento. Con "bodega", cada elemento se
    // guarda dentro de su bodega: bodegas/{bodega}/{coleccion}/{id}.
    const DESTINOS = {
        'elnevado.bodegas.v1': { coleccion: 'bodegas', id: (b) => b.clave },
        'elnevado.empleados.v4': { coleccion: 'empleados', id: (e) => e.id, bodega: (e) => e.suc },
        'elnevado.solicitudes.v1': { coleccion: 'solicitudes', id: (s) => s.id, bodega: (s) => s.suc },
        'elnevado.reportes.v1': { coleccion: 'reportes', id: (r) => `${r.fecha}_${r.empleado}`, bodega: (r) => r.suc },
        'elnevado.usuarios.v1': { coleccion: 'usuarios', id: (u) => u.usuario },
        'elnevado.bitacora.v1': { coleccion: 'bitacora', id: (m) => `${m.fecha}_${m.usuario}` },
        'elnevado.configuracion.v1': { coleccion: 'ajustes', documento: 'configuracion' },
        'elnevado.sucursales.v1': { coleccion: 'ajustes', documento: 'sucursales' }
    };
    const destinoDe = (clave) => DESTINOS[clave] || { coleccion: 'ajustes', documento: clave };

    const RUTA = `projects/${FIREBASE.projectId}/databases/(default)/documents`;
    const URL_FIRESTORE = `https://firestore.googleapis.com/v1/${RUTA}`;
    const CON_LLAVE = `key=${FIREBASE.apiKey}`;

    // Peticiones síncronas a propósito: así las páginas siguen funcionando igual
    // que con el navegador (leen y guardan al instante) sin tener que reescribirlas.
    function peticion(metodo, url, cuerpo) {
        const xhr = new XMLHttpRequest();
        xhr.open(metodo, url, false);
        if (cuerpo !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(cuerpo === undefined ? null : JSON.stringify(cuerpo));
        if (xhr.status !== 200) {
            const error = new Error(`Firebase respondió ${xhr.status}: ${xhr.responseText.slice(0, 300)}`);
            error.status = xhr.status;
            throw error;
        }
        return JSON.parse(xhr.responseText);
    }

    // ---------- Conversión entre valores de JavaScript y campos de Firestore ----------
    function aFirestore(valor) {
        if (valor === null || valor === undefined) return { nullValue: null };
        if (typeof valor === 'boolean') return { booleanValue: valor };
        if (typeof valor === 'number') return Number.isSafeInteger(valor) ? { integerValue: String(valor) } : { doubleValue: valor };
        if (typeof valor === 'string') return { stringValue: valor };
        if (Array.isArray(valor)) {
            // Firestore no acepta una lista directamente dentro de otra: la de adentro se envuelve
            return { arrayValue: { values: valor.map((v) => (Array.isArray(v) ? { mapValue: { fields: { _lista: aFirestore(v) } } } : aFirestore(v))) } };
        }
        return { mapValue: { fields: camposDe(valor) } };
    }

    function camposDe(objeto) {
        const campos = {};
        Object.keys(objeto).forEach((nombre) => {
            if (objeto[nombre] !== undefined) campos[nombre || '_'] = aFirestore(objeto[nombre]);
        });
        return campos;
    }

    function aJs(campo) {
        if ('stringValue' in campo) return campo.stringValue;
        if ('integerValue' in campo) return Number(campo.integerValue);
        if ('doubleValue' in campo) return Number(campo.doubleValue);
        if ('booleanValue' in campo) return campo.booleanValue;
        if ('timestampValue' in campo) return campo.timestampValue;
        if ('arrayValue' in campo) return (campo.arrayValue.values || []).map(aJs);
        if ('mapValue' in campo) {
            const objeto = objetoDe(campo.mapValue.fields);
            const nombres = Object.keys(objeto);
            return nombres.length === 1 && nombres[0] === '_lista' ? objeto._lista : objeto;
        }
        return null;
    }

    function objetoDe(campos) {
        const objeto = {};
        Object.keys(campos || {}).forEach((nombre) => { objeto[nombre] = aJs(campos[nombre]); });
        return objeto;
    }

    // Texto con los campos en orden alfabético: sirve para saber si un registro cambió
    function canonico(valor) {
        if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
        if (valor && typeof valor === 'object') {
            return `{${Object.keys(valor).sort().map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`).join(',')}}`;
        }
        return JSON.stringify(valor === undefined ? null : valor);
    }

    // El nombre de un documento no puede llevar "/" ni empezar con "__"
    function idSeguro(id, siFalta) {
        const texto = String(id ?? '').replace(/[\/\s]+/g, '_').replace(/^_+/, '').replace(/^\.+$/, '');
        return texto || siFalta;
    }

    // ---------- Copia en memoria de cada colección ----------
    // coleccion → Map(ruta del documento → { texto, orden }). null = no se pudo leer.
    // La ruta es la del documento en Firestore, p. ej. "bodegas/01/empleados/01130001".
    const colecciones = {};
    const porReubicar = new Set(); // colecciones con documentos fuera de su bodega (formato anterior)
    let avisoMostrado = false;

    function avisarSinConexion() {
        if (avisoMostrado) return;
        avisoMostrado = true;
        const mostrar = () => {
            const aviso = document.createElement('div');
            aviso.setAttribute('role', 'alert');
            aviso.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;' +
                'background:#b91c1c;color:#fff;padding:10px 18px;border-radius:10px;font:600 14px system-ui,sans-serif;' +
                'box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:90vw;text-align:center';
            aviso.textContent = '⚠️ No se pudo conectar con Firebase: lo que registres NO se guardará. Revisa el internet, projectId, apiKey y las reglas de Firestore (detalle en la consola, F12).';
            document.body.appendChild(aviso);
        };
        if (document.body) mostrar();
        else document.addEventListener('DOMContentLoaded', mostrar);
    }

    const rutaDe = (destino, item, id) => (destino.bodega
        ? `bodegas/${idSeguro(destino.bodega(item), 'sin-bodega')}/${destino.coleccion}/${id}`
        : `${destino.coleccion}/${id}`);

    // Cada colección se lee una sola vez por página, la primera vez que se necesita.
    // Las que van por bodega se leen de todas las bodegas en una sola consulta.
    function cargar(destino) {
        const coleccion = destino.coleccion;
        if (coleccion in colecciones) return colecciones[coleccion];
        try {
            const mapa = new Map();
            const anotar = (doc) => {
                const ruta = doc.name.slice(RUTA.length + 1);
                const objeto = objetoDe(doc.fields);
                const orden = typeof objeto._orden === 'number' ? objeto._orden : mapa.size;
                delete objeto._orden;
                const valor = '_valor' in objeto ? objeto._valor : objeto;
                mapa.set(ruta, { texto: canonico(valor), orden });
                if (destino.bodega && ruta !== rutaDe(destino, valor, ruta.split('/').pop())) porReubicar.add(coleccion);
            };
            if (destino.bodega) {
                const respuesta = peticion('POST', `${URL_FIRESTORE}:runQuery?${CON_LLAVE}`, {
                    structuredQuery: { from: [{ collectionId: coleccion, allDescendants: true }] }
                });
                respuesta.forEach((fila) => { if (fila.document) anotar(fila.document); });
            } else {
                let pagina = '';
                do {
                    const respuesta = peticion('GET', `${URL_FIRESTORE}/${coleccion}?${CON_LLAVE}&pageSize=300${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`);
                    (respuesta.documents || []).forEach(anotar);
                    pagina = respuesta.nextPageToken || '';
                } while (pagina);
            }
            colecciones[coleccion] = mapa;
        } catch (error) {
            console.error(`No se pudo leer "${coleccion}" de Firebase:`, error);
            colecciones[coleccion] = null;
            avisarSinConexion();
        }
        return colecciones[coleccion];
    }

    // Manda los cambios juntos: o se guardan todos o no se guarda ninguno (por bloques de 400)
    function confirmar(escrituras) {
        for (let i = 0; i < escrituras.length; i += 400) {
            peticion('POST', `${URL_FIRESTORE}:commit?${CON_LLAVE}`, { writes: escrituras.slice(i, i + 400) });
        }
    }

    const nombreDoc = (ruta) => `${RUTA}/${ruta}`;

    function leerEnLinea(clave) {
        const destino = destinoDe(clave);
        const mapa = cargar(destino);
        if (!mapa) return null;
        if (destino.documento) {
            const doc = mapa.get(`${destino.coleccion}/${destino.documento}`);
            return doc ? JSON.parse(doc.texto) : null;
        }
        const lista = () => [...mapa.values()].sort((a, b) => a.orden - b.orden).map((doc) => JSON.parse(doc.texto));
        // Registros guardados antes de separar por bodega: se pasan a su bodega una sola vez
        if (porReubicar.has(destino.coleccion)) {
            porReubicar.delete(destino.coleccion);
            try {
                escribirEnLinea(clave, lista());
            } catch (error) {
                console.warn(`No se pudo pasar "${destino.coleccion}" a sus bodegas:`, error);
            }
        }
        return lista();
    }

    function escribirEnLinea(clave, valorOriginal, extras = []) {
        const destino = destinoDe(clave);
        const mapa = cargar(destino);
        if (!mapa) return false;
        const valor = JSON.parse(JSON.stringify(valorOriginal)); // sin funciones ni "undefined"
        const escrituras = [...extras];

        if (destino.documento) {
            const ruta = `${destino.coleccion}/${destino.documento}`;
            const texto = canonico(valor);
            const esObjeto = valor && typeof valor === 'object' && !Array.isArray(valor);
            const previo = mapa.get(ruta);
            if (!previo || previo.texto !== texto) {
                escrituras.push({ update: { name: nombreDoc(ruta), fields: camposDe(esObjeto ? valor : { _valor: valor }) } });
            }
            if (escrituras.length) confirmar(escrituras);
            mapa.set(ruta, { texto, orden: 0 });
            return true;
        }

        // Lista: un documento por elemento. Solo se mandan los que cambiaron, los nuevos y los que se quitaron.
        const lista = Array.isArray(valor) ? valor : [];
        const rutas = [];
        const usadas = new Set();
        lista.forEach((item, posicion) => {
            let ruta = rutaDe(destino, item, idSeguro(destino.id(item), `registro-${posicion}`));
            if (usadas.has(ruta)) ruta = `${ruta}_${posicion}`;
            usadas.add(ruta);
            rutas.push(ruta);
        });
        const nuevos = new Map();
        let ordenPrevio = null;
        lista.forEach((item, posicion) => {
            const ruta = rutas[posicion];
            const texto = canonico(item);
            const previo = mapa.get(ruta);
            // "_orden" conserva el orden de la lista; solo se calcula para los registros nuevos o movidos
            let orden = previo ? previo.orden : null;
            if (orden === null || (ordenPrevio !== null && orden <= ordenPrevio)) {
                let siguiente = null;
                for (let j = posicion + 1; j < lista.length && siguiente === null; j++) {
                    const otro = mapa.get(rutas[j]);
                    if (otro && (ordenPrevio === null || otro.orden > ordenPrevio)) siguiente = otro.orden;
                }
                if (ordenPrevio === null) orden = siguiente === null ? 0 : siguiente - 1;
                else orden = siguiente === null ? ordenPrevio + 1 : (ordenPrevio + siguiente) / 2;
            }
            if (!previo || previo.texto !== texto || previo.orden !== orden) {
                const esObjeto = item && typeof item === 'object' && !Array.isArray(item);
                escrituras.push({ update: { name: nombreDoc(ruta), fields: { ...camposDe(esObjeto ? item : { _valor: item }), _orden: aFirestore(orden) } } });
            }
            nuevos.set(ruta, { texto, orden });
            ordenPrevio = orden;
        });
        mapa.forEach((_, ruta) => {
            if (!nuevos.has(ruta)) escrituras.push({ delete: nombreDoc(ruta) });
        });
        if (escrituras.length) confirmar(escrituras);
        mapa.clear();
        nuevos.forEach((doc, ruta) => mapa.set(ruta, doc));
        return true;
    }

    function borrarEnLinea(clave) {
        const destino = destinoDe(clave);
        if (!destino.documento) return escribirEnLinea(clave, []);
        const mapa = cargar(destino);
        if (!mapa) return false;
        const ruta = `${destino.coleccion}/${destino.documento}`;
        if (mapa.has(ruta)) confirmar([{ delete: nombreDoc(ruta) }]);
        mapa.delete(ruta);
        return true;
    }

    // Lo que se guardó con la versión anterior (todo junto en "almacen/{clave}", como un solo texto)
    // se reparte en documentos independientes una sola vez, y el documento viejo se borra.
    const revisadas = new Set();
    function pasarFormatoAnterior(clave) {
        if (revisadas.has(clave)) return;
        revisadas.add(clave);
        const marca = `elnevado.migrado.${clave}`;
        try {
            if (localStorage.getItem(marca)) return;
            const actual = leerEnLinea(clave);
            if (actual === null && colecciones[destinoDe(clave).coleccion] === null) return; // sin conexión: se intenta después
            let viejo = null;
            try {
                viejo = peticion('GET', `${URL_FIRESTORE}/almacen/${encodeURIComponent(clave)}?${CON_LLAVE}`);
            } catch (error) {
                if (error.status !== 404) return; // sin permiso o sin conexión: se intenta después
            }
            if (viejo && viejo.fields && viejo.fields.json) {
                const vacio = actual === null || (Array.isArray(actual) && !actual.length);
                const borrarViejo = [{ delete: nombreDoc(`almacen/${clave}`) }];
                if (vacio) escribirEnLinea(clave, JSON.parse(viejo.fields.json.stringValue), borrarViejo);
                else confirmar(borrarViejo);
            }
            localStorage.setItem(marca, '1');
        } catch (error) {
            console.warn(`No se pudo pasar "${clave}" al formato nuevo:`, error);
        }
    }

    return {
        enFirebase: USAR_FIREBASE,
        conectado: () => !Object.values(colecciones).includes(null),
        // Devuelve una copia nueva cada vez (igual que al leer del navegador) o null si no hay nada
        leer(clave) {
            try {
                if (!enLinea(clave)) {
                    const texto = localStorage.getItem(clave);
                    return texto == null ? null : JSON.parse(texto);
                }
                pasarFormatoAnterior(clave);
                return leerEnLinea(clave);
            } catch (error) {
                return null;
            }
        },
        // Regresa true solo si quedó guardado
        escribir(clave, valor) {
            try {
                if (!enLinea(clave)) {
                    localStorage.setItem(clave, JSON.stringify(valor));
                    return true;
                }
                pasarFormatoAnterior(clave);
                return escribirEnLinea(clave, valor);
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
                return borrarEnLinea(clave);
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