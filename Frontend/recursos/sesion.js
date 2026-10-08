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
//      bodegas/01/empleados/{ID}       → trabajadores de esa bodega (con su rostro y sus checadas)
//      bodegas/01/solicitudes/{id}     → sus solicitudes
//      bodegas/01/reportes/{fecha_ID}  → sus reportes de falla de checadora
//  Lo que es de toda la empresa queda aparte:  ajustes/configuracion
// =====================================================================
const FIREBASE = {
    apiKey: "AIzaSyBbYhn_ppZ2bQpM9XzkjYK1wHaEvhlE3hY",
    authDomain: "checador00nevado.firebaseapp.com",
    projectId: "checador00nevado",
    storageBucket: "checador00nevado.firebasestorage.app",
    messagingSenderId: "211847801101",
    appId: "1:211847801101:web:34f223210712ba37636844"
};

const USAR_FIREBASE = Boolean(FIREBASE.projectId && FIREBASE.apiKey);

// =====================================================================
//  AUTENTICACIÓN: el correo y la contraseña los valida Firebase Authentication.
//  Las contraseñas ya no están en el código ni en el navegador: Firebase las guarda cifradas.
//  En el navegador solo queda, mientras la pestaña esté abierta, la sesión que entrega Firebase
//  (el correo y sus llaves temporales). Qué puede hacer cada correo (rol y sucursal) se guarda
//  aparte, en la colección "usuarios" de Firestore.
// =====================================================================
const CLAVE_SESION = 'elnevado.sesion.v1';

const AUTENTICACION = (() => {
    const URL_CUENTAS = 'https://identitytoolkit.googleapis.com/v1/accounts';
    const URL_RENOVAR = 'https://securetoken.googleapis.com/v1/token';
    const MARGEN_MS = 5 * 60 * 1000; // la llave se renueva 5 minutos antes de vencer (dura 1 hora)

    const CREDENCIALES_MAL = 'Correo o contraseña incorrectos.';
    const ERRORES = {
        INVALID_LOGIN_CREDENTIALS: CREDENCIALES_MAL,
        EMAIL_NOT_FOUND: CREDENCIALES_MAL,
        INVALID_PASSWORD: CREDENCIALES_MAL,
        INVALID_EMAIL: 'Escribe un correo válido.',
        MISSING_PASSWORD: 'Escribe la contraseña.',
        USER_DISABLED: 'Tu cuenta está desactivada. Contacta al área de Sistemas.',
        TOO_MANY_ATTEMPTS_TRY_LATER: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
        EMAIL_EXISTS: 'Ya existe una cuenta con ese correo.',
        WEAK_PASSWORD: 'La contraseña debe tener al menos 6 caracteres.',
        OPERATION_NOT_ALLOWED: 'El inicio de sesión con correo no está habilitado en Firebase.',
        PASSWORD_LOGIN_DISABLED: 'El inicio de sesión con correo no está habilitado en Firebase.',
        ADMIN_ONLY_OPERATION: 'Este proyecto de Firebase no permite crear cuentas desde el sistema: créala en la consola de Firebase.',
        CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'Tu sesión venció. Vuelve a iniciar sesión.',
        TOKEN_EXPIRED: 'Tu sesión venció. Vuelve a iniciar sesión.',
        INVALID_ID_TOKEN: 'Tu sesión venció. Vuelve a iniciar sesión.'
    };

    // Regresa { datos } si Firebase aceptó, o { codigo, texto } con el error
    function pedir(url, cuerpo) {
        if (!USAR_FIREBASE) return { codigo: 'SIN_FIREBASE', texto: 'Falta configurar Firebase (projectId y apiKey) en sesion.js.' };
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${url}?key=${FIREBASE.apiKey}`, false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify(cuerpo));
            if (!xhr.status) throw new Error('sin respuesta');
            const datos = JSON.parse(xhr.responseText || '{}');
            if (xhr.status === 200) return { datos };
            const codigo = String((datos.error && datos.error.message) || '').split(/[ :]/)[0] || `HTTP_${xhr.status}`;
            return { codigo, texto: ERRORES[codigo] || `Firebase no aceptó la operación (${codigo}).` };
        } catch (error) {
            return { codigo: 'SIN_CONEXION', texto: 'No se pudo conectar con Firebase. Revisa tu conexión a internet.' };
        }
    }

    // Sesión de esta pestaña: { correo, idToken, refreshToken, expira }
    let sesion = null;
    try {
        sesion = JSON.parse(sessionStorage.getItem(CLAVE_SESION) || 'null');
    } catch (error) {
        sesion = null; // sesión del formato anterior (solo el nombre de usuario): ya no sirve
    }
    if (!sesion || typeof sesion !== 'object' || !sesion.correo || !sesion.refreshToken) sesion = null;

    function guardarSesion() {
        try {
            localStorage.removeItem(CLAVE_SESION); // el "recordarme" de antes ya no se usa
            if (sesion) sessionStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
            else sessionStorage.removeItem(CLAVE_SESION);
            return true;
        } catch (error) {
            return false;
        }
    }

    function anotar(correo, idToken, refreshToken, segundos) {
        sesion = { correo: String(correo).toLowerCase(), idToken, refreshToken, expira: Date.now() + (Number(segundos) || 3600) * 1000 };
        return guardarSesion();
    }

    return {
        // Correo con la sesión abierta en esta pestaña (null si no hay)
        correo: () => (sesion ? sesion.correo : null),

        // Regresa { correo } o { error }
        entrar(correo, contrasena) {
            const r = pedir(`${URL_CUENTAS}:signInWithPassword`, { email: String(correo).trim(), password: contrasena, returnSecureToken: true });
            if (!r.datos) return { error: r.texto };
            if (!anotar(r.datos.email, r.datos.idToken, r.datos.refreshToken, r.datos.expiresIn)) return { error: 'Este navegador no permite guardar la sesión.' };
            return { correo: sesion.correo };
        },

        salir() {
            sesion = null;
            guardarSesion();
        },

        // Llave vigente para pedir datos a Firestore (se renueva sola). null si ya no hay sesión.
        token() {
            if (!sesion) return null;
            if (sesion.expira - Date.now() > MARGEN_MS) return sesion.idToken;
            const r = pedir(URL_RENOVAR, { grant_type: 'refresh_token', refresh_token: sesion.refreshToken });
            if (r.datos) {
                anotar(sesion.correo, r.datos.id_token, r.datos.refresh_token, r.datos.expires_in);
                return sesion.idToken;
            }
            if (r.codigo === 'SIN_CONEXION') return sesion.idToken; // sin internet: se intenta de nuevo después
            this.salir(); // Firebase ya no reconoce la sesión (cuenta borrada o inhabilitada)
            return null;
        },

        // Da de alta el correo en Firebase. Regresa { creada: true }, { existe: true } o { error }.
        // No cambia la sesión de quien la crea.
        crearCuenta(correo, contrasena) {
            const r = pedir(`${URL_CUENTAS}:signUp`, { email: String(correo).trim(), password: contrasena, returnSecureToken: false });
            if (r.datos) return { creada: true };
            if (r.codigo === 'EMAIL_EXISTS') return { existe: true };
            return { error: r.texto };
        },

        // Cada quien cambia SU contraseña (Firebase no deja cambiar la de otra persona desde la página).
        // Regresa {} o { error }.
        cambiarMiContrasena(actual, nueva) {
            if (!sesion) return { error: 'Tu sesión venció. Vuelve a iniciar sesión.' };
            const entrada = pedir(`${URL_CUENTAS}:signInWithPassword`, { email: sesion.correo, password: actual, returnSecureToken: true });
            if (!entrada.datos) return { error: entrada.texto === CREDENCIALES_MAL ? 'La contraseña actual no es correcta.' : entrada.texto };
            const cambio = pedir(`${URL_CUENTAS}:update`, { idToken: entrada.datos.idToken, password: nueva, returnSecureToken: true });
            if (!cambio.datos) return { error: cambio.texto };
            anotar(sesion.correo, cambio.datos.idToken || entrada.datos.idToken, cambio.datos.refreshToken || entrada.datos.refreshToken, cambio.datos.expiresIn);
            return {};
        }
    };
})();

const ALMACEN = (() => {
    // Estas claves se quedan SIEMPRE en el navegador, aunque Firebase esté activo:
    // - la sesión es de cada pestaña;
    // - la bitácora dice quién hizo qué: mientras las reglas de Firestore no exijan sesión,
    //   cualquiera podría leerla. Cuando las reglas ya la protejan, quítala de esta lista
    //   (se guardará en la colección "bitacora", un documento por movimiento).
    // Los usuarios (correo, nombre, rol y sucursal; sin contraseña) ya van a Firestore.
    const SOLO_NAVEGADOR = ['elnevado.sesion.v1', 'elnevado.bitacora.v1'];
    const enLinea = (clave) => USAR_FIREBASE && !SOLO_NAVEGADOR.includes(clave);

    // A dónde va cada clave. Con "id", el valor es una lista y cada elemento es un documento;
    // con "documento", el valor completo es un solo documento. Con "bodega", cada elemento se
    // guarda dentro de su bodega: bodegas/{bodega}/{coleccion}/{id}.
    const DESTINOS = {
        'elnevado.bodegas.v1': { coleccion: 'bodegas', id: (b) => b.clave },
        // "protegidos": campos que escribe la tableta checadora (checador.html). Las demás páginas
        // nunca los pisan al guardar al trabajador, aunque tengan una copia vieja en pantalla.
        'elnevado.empleados.v4': { coleccion: 'empleados', id: (e) => e.id, bodega: (e) => e.suc, protegidos: ['checadas', 'rostro'] },
        'elnevado.solicitudes.v1': { coleccion: 'solicitudes', id: (s) => s.id, bodega: (s) => s.suc },
        'elnevado.reportes.v1': { coleccion: 'reportes', id: (r) => `${r.fecha}_${r.empleado}`, bodega: (r) => r.suc },
        // "opcional": si no se puede leer (por las reglas de Firestore) no se muestra el aviso de
        // "sin conexión": se usan los perfiles iniciales. "sinMigrar": nunca existió en el formato anterior.
        'elnevado.usuarios.v1': { coleccion: 'usuarios', id: (u) => u.usuario, opcional: true, sinMigrar: true },
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
        // Con sesión iniciada cada petición lleva la llave del usuario: así las reglas de Firestore
        // pueden exigir sesión ("request.auth != null"). Sin sesión (tableta checadora) va sin llave.
        const llave = AUTENTICACION.token();
        if (llave) xhr.setRequestHeader('Authorization', `Bearer ${llave}`);
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

    // Saca del registro los campos protegidos y los regresa aparte (el registro queda sin ellos)
    function separarProtegidos(destino, registro) {
        const extra = {};
        if (!registro || typeof registro !== 'object' || Array.isArray(registro)) return extra;
        (destino.protegidos || []).forEach((campo) => {
            if (campo in registro) {
                extra[campo] = registro[campo];
                delete registro[campo];
            }
        });
        return extra;
    }

    // Nombre de un campo para "updateMask": los que no son un identificador simple van entre acentos graves
    const campoMascara = (nombre) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(nombre) ? nombre : '`' + nombre.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`');

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
                const extra = separarProtegidos(destino, valor);
                mapa.set(ruta, { texto: canonico(valor), orden, extra });
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
            if (!destino.opcional) avisarSinConexion();
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
        const lista = () => [...mapa.values()].sort((a, b) => a.orden - b.orden)
            .map((doc) => Object.assign(JSON.parse(doc.texto), JSON.parse(JSON.stringify(doc.extra || {}))));
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
            const extraNuevo = separarProtegidos(destino, item); // "item" queda sin los campos de la tableta
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
                const escritura = { update: { name: nombreDoc(ruta), fields: { ...camposDe(esObjeto ? item : { _valor: item }), _orden: aFirestore(orden) } } };
                if (previo && esObjeto && (destino.protegidos || []).length) {
                    // El documento ya existe: se cambian solo los campos de esta página (los que trae y los que
                    // se quitaron). Los protegidos no van en la lista, así que Firestore los deja como están.
                    const campos = new Set([...Object.keys(item), ...Object.keys(JSON.parse(previo.texto)), '_orden']);
                    escritura.updateMask = { fieldPaths: [...campos].map(campoMascara) };
                } else if (!previo && esObjeto) {
                    // Documento nuevo (alta, o cambio de bodega): se lleva lo que traiga de la tableta
                    Object.assign(escritura.update.fields, camposDe(extraNuevo));
                }
                escrituras.push(escritura);
            }
            nuevos.set(ruta, { texto, orden, extra: previo ? previo.extra : extraNuevo });
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

    // ---------- Cambios puntuales a un registro (los usa la tableta checadora) ----------
    function rutaDeRegistro(clave, item) {
        const destino = destinoDe(clave);
        if (destino.documento) return null;
        const mapa = cargar(destino);
        if (!mapa) return null;
        const ruta = rutaDe(destino, item, idSeguro(destino.id(item), ''));
        return mapa.has(ruta) ? { destino, mapa, ruta } : null;
    }

    // Cambia solo los campos indicados (undefined = quitar el campo); el resto del documento no se toca
    function actualizarCamposEnLinea(clave, item, cambios) {
        const lugar = rutaDeRegistro(clave, item);
        if (!lugar) return false;
        const limpio = JSON.parse(JSON.stringify(cambios));
        confirmar([{
            update: { name: nombreDoc(lugar.ruta), fields: camposDe(limpio) },
            updateMask: { fieldPaths: Object.keys(cambios).map(campoMascara) },
            currentDocument: { exists: true }
        }]);
        const doc = lugar.mapa.get(lugar.ruta);
        const registro = JSON.parse(doc.texto);
        Object.keys(cambios).forEach((campo) => {
            const destinoCampo = (lugar.destino.protegidos || []).includes(campo) ? doc.extra : registro;
            if (campo in limpio) destinoCampo[campo] = limpio[campo];
            else delete destinoCampo[campo];
        });
        doc.texto = canonico(registro);
        return true;
    }

    // Agrega un elemento a una lista del registro sin leerla antes (no pisa lo que agregó otra tableta)
    function agregarAListaEnLinea(clave, item, campo, valor) {
        const lugar = rutaDeRegistro(clave, item);
        if (!lugar) return false;
        const limpio = JSON.parse(JSON.stringify(valor));
        confirmar([{
            transform: { document: nombreDoc(lugar.ruta), fieldTransforms: [{ fieldPath: campoMascara(campo), appendMissingElements: { values: [aFirestore(limpio)] } }] },
            currentDocument: { exists: true }
        }]);
        const doc = lugar.mapa.get(lugar.ruta);
        const dondeVa = (lugar.destino.protegidos || []).includes(campo) ? doc.extra : null;
        if (dondeVa) (dondeVa[campo] = dondeVa[campo] || []).push(limpio);
        else {
            const registro = JSON.parse(doc.texto);
            (registro[campo] = registro[campo] || []).push(limpio);
            doc.texto = canonico(registro);
        }
        return true;
    }

    // Lo que se guardó con la versión anterior (todo junto en "almacen/{clave}", como un solo texto)
    // se reparte en documentos independientes una sola vez, y el documento viejo se borra.
    const revisadas = new Set();
    function pasarFormatoAnterior(clave) {
        if (revisadas.has(clave) || destinoDe(clave).sinMigrar) return;
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
        },
        // --- Para la tableta checadora (checador.html) ---
        // Cambia solo algunos campos de un registro de una lista. Regresa true si quedó guardado.
        actualizarCampos(clave, item, cambios) {
            try {
                if (enLinea(clave)) return actualizarCamposEnLinea(clave, item, cambios);
                const destino = destinoDe(clave);
                const lista = JSON.parse(localStorage.getItem(clave) || '[]');
                const registro = lista.find((r) => destino.id(r) === destino.id(item));
                if (!registro) return false;
                Object.keys(cambios).forEach((campo) => {
                    if (cambios[campo] === undefined) delete registro[campo];
                    else registro[campo] = cambios[campo];
                });
                localStorage.setItem(clave, JSON.stringify(lista));
                return true;
            } catch (error) {
                console.error(`No se pudo actualizar "${clave}":`, error);
                return false;
            }
        },
        // Agrega un elemento a una lista dentro de un registro (p. ej. una checada al trabajador)
        agregarALista(clave, item, campo, valor) {
            try {
                if (enLinea(clave)) return agregarAListaEnLinea(clave, item, campo, valor);
                const destino = destinoDe(clave);
                const lista = JSON.parse(localStorage.getItem(clave) || '[]');
                const registro = lista.find((r) => destino.id(r) === destino.id(item));
                if (!registro) return false;
                (registro[campo] = registro[campo] || []).push(valor);
                localStorage.setItem(clave, JSON.stringify(lista));
                return true;
            } catch (error) {
                console.error(`No se pudo agregar a "${clave}":`, error);
                return false;
            }
        },
        // Olvida la copia en memoria: la siguiente lectura vuelve a traer los datos de Firebase
        refrescar(clave) {
            if (enLinea(clave)) delete colecciones[destinoDe(clave).coleccion];
        },
        // Hora del servidor de Firebase en milisegundos (null si no se pudo). Sirve para que la
        // checada no dependa del reloj de la tableta.
        horaServidor() {
            if (!USAR_FIREBASE) return null;
            try {
                const respuesta = peticion('POST', `${URL_FIRESTORE}:commit?${CON_LLAVE}`, { writes: [] });
                const hora = Date.parse(respuesta.commitTime);
                return Number.isFinite(hora) ? hora : null;
            } catch (error) {
                return null;
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
    subirDocumentos: ['rh', 'admin'],           // el admin, solo de su sucursal; el super usuario no sube
    revisarDocumentos: ['super', 'rh'],         // aprobar o devolver lo que subió el admin
    descargarDocumentos: ['super', 'rh'],       // el admin solo los ve; cada descarga queda en la bitácora
    eliminarDocumentos: ['super', 'rh'],        // borra el archivo y el documento vuelve a "Falta"
    eliminarIncapacidades: ['super', 'rh'],     // para corregir una captura equivocada; pide motivo y queda en la bitácora
    registrarAlta: ['super', 'rh', 'admin'],    // alta del seguro al terminar la incapacidad; el admin, solo de su sucursal
    aprobarAlta: ['super', 'rh'],               // aprobar o devolver el alta que subió el admin
    editarSucursales: ['super', 'rh'],          // agregar sucursales
    renombrarSucursales: ['super'],             // cambiarle el nombre a una sucursal que ya existe
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
//  USUARIOS: qué puede hacer cada correo (se administran en usuarios.html)
//  "usuario" es el correo con el que la persona entra. Aquí NO hay contraseñas:
//  esas las guarda Firebase Authentication.
// =====================================================================
const CLAVE_USUARIOS = 'elnevado.usuarios.v1';
const CLAVE_BITACORA = 'elnevado.bitacora.v1';

// Perfiles de arranque: se usan mientras la colección "usuarios" de Firestore esté vacía
// (o no se pueda leer). En cuanto se guarda un cambio en usuarios.html, mandan los de Firestore.
// Para que alguien pueda entrar, su correo también debe existir en Firebase Authentication.
const USUARIOS_INICIALES = [
    { usuario: 'erick.villa@delnevado.com', nombre: 'Director General', rol: 'super', sucursal: '00', activo: true },
    { usuario: 'recursoshumanos@delnevado.com', nombre: 'RH', rol: 'rh', sucursal: '00', activo: true },
    { usuario: 'sistemas@delnevado.com', nombre: 'Edgar Job Salas Lara', rol: 'sistemas', sucursal: '00', activo: true },
    { usuario: 'colon.01@delnevado.com', nombre: 'Admin', rol: 'admin', sucursal: '01', activo: true }
];

function listaUsuarios() {
    const guardados = ALMACEN.leer(CLAVE_USUARIOS);
    if (Array.isArray(guardados) && guardados.length) return guardados;
    return USUARIOS_INICIALES.map((u) => ({ ...u }));
}

function guardarUsuarios(usuarios) {
    // Por si acaso: una contraseña nunca se guarda en la base de datos
    return ALMACEN.escribir(CLAVE_USUARIOS, usuarios.map(({ contrasena, ...perfil }) => perfil));
}

function buscarUsuario(correo) {
    const buscado = String(correo || '').trim().toLowerCase();
    if (!buscado) return null;
    return listaUsuarios().find((u) => String(u.usuario).toLowerCase() === buscado) || null;
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
// Firebase valida el correo y la contraseña; después se busca el perfil (rol y sucursal) de ese correo.
// Devuelve { usuario } si puede entrar; si no, { error } con el mensaje.
function iniciarSesion(correo, contrasena) {
    const entrada = AUTENTICACION.entrar(correo, contrasena);
    if (entrada.error) return { error: entrada.error };

    ALMACEN.refrescar(CLAVE_USUARIOS); // ya con sesión, se leen los perfiles de Firestore
    const usuario = buscarUsuario(entrada.correo);
    let error = '';
    if (!usuario || !ROLES[usuario.rol]) error = 'Tu correo todavía no tiene acceso asignado en el sistema. Contacta al área de Sistemas.';
    else if (!usuario.activo) error = 'Tu cuenta está desactivada. Contacta al área de Sistemas.';
    if (error) {
        AUTENTICACION.salir();
        return { error };
    }
    registrarBitacora('Inicio de sesión', '', usuario);
    return { usuario };
}

function cerrarSesion() {
    registrarBitacora('Cierre de sesión');
    AUTENTICACION.salir();
    location.href = 'index.html';
}

// Usuario con la sesión abierta (null si no hay sesión, si Firebase ya no la reconoce o si la cuenta se desactivó)
const USUARIO_ACTUAL = (() => {
    if (!AUTENTICACION.correo() || !AUTENTICACION.token()) return null;
    const usuario = buscarUsuario(AUTENTICACION.correo());
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
    // La tableta checadora (checador.html) funciona sin sesión: solo registra entradas y salidas
    if (PAGINA_ACTUAL === 'index.html' || PAGINA_ACTUAL === 'checador.html') return;
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
    if (!nav || !USUARIO_ACTUAL || prepararMenu.listo) return;
    prepararMenu.listo = true;

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

    // Aviso del servidor debajo del menú y arriba de los datos del usuario, con el último estado conocido
    // (lo actualiza estado-servidor.js)
    const cajaUsuario = document.querySelector('.sidebar .sidebar__user');
    if (cajaUsuario && !document.querySelector('.sidebar .server-status')) {
        let estado = null;
        try { estado = sessionStorage.getItem('elnevado.servidor'); } catch (error) { /* sin almacenamiento */ }
        const texto = estado === 'ok' ? 'En línea' : estado === 'error' ? 'Sin conexión' : 'Revisando…';
        cajaUsuario.insertAdjacentHTML('beforebegin',
            `<button type="button" class="server-status ${estado ? `server-status--${estado}` : ''}" role="status" aria-live="polite"><span class="server-status__dot"></span><span class="server-status__text">${texto}</span></button>`);
    }

    const salir = document.querySelector('.sidebar__user .btn-logout');
    if (salir) {
        // RH y los admin de sucursal no cambian su contraseña desde aquí: se la cambia quien administra
        // las cuentas (Super usuario y Sistemas) en "Usuarios y sistema" → Editar.
        salir.addEventListener('click', (evento) => {
            evento.preventDefault();
            cerrarSesion();
        });
    }
}

// Ventana para que el usuario cambie SU contraseña. Se arma aquí para que exista en todas las páginas.
function abrirCambioContrasena() {
    if (document.getElementById('claveModal')) return;
    const campo = 'width:100%;box-sizing:border-box;margin-top:4px;padding:10px 12px;border:1px solid #d5dae1;border-radius:8px;font:inherit;font-size:14px';
    const etiqueta = 'display:block;margin-bottom:12px;font-size:13px;font-weight:600;color:#2c3545';
    document.body.insertAdjacentHTML('beforeend', `
        <div id="claveModal" role="dialog" aria-modal="true" aria-labelledby="claveTitulo"
            style="position:fixed;inset:0;z-index:5000;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.55)">
            <form style="width:min(400px,100%);background:#fff;border-radius:14px;padding:24px;box-shadow:0 24px 60px rgba(15,23,42,.3);color:#111827" novalidate>
                <h3 id="claveTitulo" style="margin:0 0 4px;font-size:19px;color:#12213f">Cambiar contraseña</h3>
                <p style="margin:0 0 16px;font-size:13px;color:#5b6472">${USUARIO_ACTUAL.usuario}</p>
                <label style="${etiqueta}">Contraseña actual<input type="password" id="claveActual" autocomplete="current-password" style="${campo}"></label>
                <label style="${etiqueta}">Contraseña nueva<input type="password" id="claveNueva" autocomplete="new-password" style="${campo}"></label>
                <label style="${etiqueta}">Repite la contraseña nueva<input type="password" id="claveRepite" autocomplete="new-password" style="${campo}"></label>
                <p id="claveError" role="alert" style="display:none;margin:0 0 12px;padding:10px 12px;border-radius:8px;background:#fdf3f4;border:1px solid #f1c4c8;color:#8f1622;font-size:13px"></p>
                <div style="display:flex;justify-content:flex-end;gap:10px">
                    <button type="button" id="claveCancelar" style="padding:10px 16px;border:1px solid #d5dae1;border-radius:8px;background:#fff;font:inherit;font-weight:600;cursor:pointer">Cancelar</button>
                    <button type="submit" style="padding:10px 16px;border:0;border-radius:8px;background:#12213f;color:#fff;font:inherit;font-weight:600;cursor:pointer">Guardar</button>
                </div>
            </form>
        </div>`);
    const modal = document.getElementById('claveModal');
    const valor = (id) => document.getElementById(id).value;
    const cerrar = () => modal.remove();
    const mostrarError = (texto) => {
        const caja = document.getElementById('claveError');
        caja.textContent = texto;
        caja.style.display = 'block';
    };

    document.getElementById('claveCancelar').addEventListener('click', cerrar);
    modal.addEventListener('click', (evento) => { if (evento.target === modal) cerrar(); });
    modal.addEventListener('keydown', (evento) => { if (evento.key === 'Escape') cerrar(); });
    modal.querySelector('form').addEventListener('submit', (evento) => {
        evento.preventDefault();
        const [actual, nueva, repite] = [valor('claveActual'), valor('claveNueva'), valor('claveRepite')];
        if (!actual) return mostrarError('Escribe tu contraseña actual.');
        if (nueva.length < 6) return mostrarError('La contraseña nueva debe tener al menos 6 caracteres.');
        if (nueva !== repite) return mostrarError('Las dos contraseñas nuevas no coinciden.');
        if (nueva === actual) return mostrarError('La contraseña nueva debe ser distinta a la actual.');
        const resultado = AUTENTICACION.cambiarMiContrasena(actual, nueva);
        if (resultado.error) return mostrarError(resultado.error);
        registrarBitacora('Contraseña cambiada');
        cerrar();
        alert('Tu contraseña se cambió. Úsala la próxima vez que inicies sesión.');
    });
    document.getElementById('claveActual').focus();
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
    if (!campana || !USUARIO_ACTUAL) return;
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

// Menú: contador junto a "Empleados" con los trabajadores cuyos documentos esperan a este usuario
// (RH y Super usuario: los que hay que aprobar; el admin: los que RH le devolvió)
function pintarContadorDocumentos() {
    const enlace = document.querySelector('.sidebar__nav a[href="empleados.html"]');
    if (!enlace || !USUARIO_ACTUAL || typeof EMPLEADOS === 'undefined') return;
    const estado = puede('revisarDocumentos') ? 'entregado' : puede('subirDocumentos') ? 'rechazado' : '';
    const pendientes = estado
        ? EMPLEADOS.filter((e) => !e.baja && Object.values(e.documentos || {}).some((d) => d && d.estado === estado)).length
        : 0;
    const anterior = enlace.querySelector('.nav-contador');
    if (anterior) anterior.remove();
    enlace.title = pendientes
        ? `${pendientes} trabajador${pendientes === 1 ? '' : 'es'} con documentos ${estado === 'entregado' ? 'por aprobar' : 'devueltos por RH'}`
        : '';
    if (pendientes) enlace.insertAdjacentHTML('beforeend', `<span class="nav-contador">${pendientes > 9 ? '9+' : pendientes}</span>`);
    pintarContadorSinAlta();
}

// Menú: contador junto a "Incapacidades" con los trabajadores que no pueden trabajar
// porque ya terminó su incapacidad y no han presentado el alta del seguro
function pintarContadorSinAlta() {
    const enlace = document.querySelector('.sidebar__nav a[href="incapacidades.html"]');
    if (!enlace || typeof trabajadoresSinAlta !== 'function') return;
    const sinAlta = trabajadoresSinAlta().length;
    const porAprobar = puede('aprobarAlta') ? altasPorAprobar().length : 0; // a RH también le cuentan las que debe revisar
    const pendientes = sinAlta + porAprobar;
    const anterior = enlace.querySelector('.nav-contador');
    if (anterior) anterior.remove();
    enlace.title = [
        sinAlta ? `${sinAlta} trabajador${sinAlta === 1 ? '' : 'es'} sin alta del seguro` : '',
        porAprobar ? `${porAprobar} alta${porAprobar === 1 ? '' : 's'} por aprobar` : ''
    ].filter(Boolean).join(' · ');
    if (pendientes) enlace.insertAdjacentHTML('beforeend', `<span class="nav-contador">${pendientes > 9 ? '9+' : pendientes}</span>`);
}

// Aviso de "sin alta del seguro" para Inicio y Empleados: cada nombre lleva a su expediente de incapacidades.
// Regresa '' si no hay nadie pendiente.
function htmlAvisoSinAlta() {
    if (typeof trabajadoresSinAlta !== 'function') return '';
    const enlace = (emp) => `<a href="incapacidades.html?expediente=${encodeURIComponent(emp.id)}">${escaparHtml(emp.nombre)}</a>`;
    let html = '';
    const sinAlta = trabajadoresSinAlta();
    if (sinAlta.length) {
        html += `<strong>⛔ ${sinAlta.length === 1 ? '1 trabajador no puede trabajar' : `${sinAlta.length} trabajadores no pueden trabajar`}: falta su alta del seguro</strong>`
            + `<span>Regrésalos hasta que la presenten y súbela en Incapacidades: ${sinAlta.map((emp) => {
                const alta = incapacidadSinAlta(emp).alta;
                const notas = [];
                if (alta && alta.estado === 'rechazada') notas.push(`RH devolvió el alta: ${escaparHtml(alta.motivo)}`);
                if (alta && alta.estado === 'revision') notas.push('alta en revisión de RH');
                if (checadaDelDia(emp, HOY_ISO)) notas.push('⚠️ checó hoy');
                return enlace(emp) + (notas.length ? ` (${notas.join(' · ')})` : '');
            }).join(' · ')}</span>`;
    }
    // A quien aprueba (RH y Super usuario): las altas que subió el admin y aún no revisa
    const porAprobar = puede('aprobarAlta') ? altasPorAprobar() : [];
    if (porAprobar.length) {
        const empleados = [...new Set(porAprobar.map((r) => r.emp))];
        html += `<strong>📄 ${porAprobar.length === 1 ? 'Hay 1 alta del seguro por aprobar' : `Hay ${porAprobar.length} altas del seguro por aprobar`}: revísala${porAprobar.length === 1 ? '' : 's'} en Incapacidades</strong>`
            + `<span>${empleados.map(enlace).join(' · ')}</span>`;
    }
    return html;
}

if (PAGINA_ACTUAL !== 'index.html') {
    // El menú se arma en cuanto termina de leerse el <aside>, antes de que la página se pinte
    const vigia = new MutationObserver(() => {
        if (!document.querySelector('.sidebar ~ *')) return;
        vigia.disconnect();
        prepararMenu();
    });
    vigia.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => {
        vigia.disconnect();
        prepararMenu();
        prepararCampana();
        pintarContadorDocumentos();
    });
}
