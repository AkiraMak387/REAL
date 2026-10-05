// Archivos del expediente del trabajador (INE, acta de nacimiento, contrato…).
//
// Mientras no exista el servidor se guardan en este navegador (IndexedDB): solo se ven en la
// computadora donde se subieron. Cuando exista la API, solo hay que cambiar las tres funciones
// de AlmacenDocumentos por peticiones al servidor; las pantallas no cambian.
// Los datos del documento (estado, quién lo subió, etc.) viven en emp.documentos (datos.js).

const LIMITE_DOCUMENTO_MB = 2;
const TIPOS_DOCUMENTO_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png'];

const AlmacenDocumentos = (() => {
    const BASE = 'elnevado-documentos';
    const TABLA = 'archivos';

    function abrir() {
        return new Promise((resolver, rechazar) => {
            const peticion = indexedDB.open(BASE, 1);
            peticion.onupgradeneeded = () => peticion.result.createObjectStore(TABLA);
            peticion.onsuccess = () => resolver(peticion.result);
            peticion.onerror = () => rechazar(peticion.error);
        });
    }

    async function operar(modo, accion) {
        const base = await abrir();
        return new Promise((resolver, rechazar) => {
            const transaccion = base.transaction(TABLA, modo);
            const peticion = accion(transaccion.objectStore(TABLA));
            transaccion.oncomplete = () => { base.close(); resolver(peticion.result); };
            transaccion.onerror = () => { base.close(); rechazar(transaccion.error); };
        });
    }

    const clave = (empId, documento) => `${empId}|${documento}`;

    // Se guarda el contenido (ArrayBuffer) y no el archivo: Chrome no guarda archivos en
    // IndexedDB cuando la página se abre desde el disco (file://)
    return {
        async guardar(empId, documento, archivo) {
            const contenido = await archivo.arrayBuffer();
            return operar('readwrite', (tabla) => tabla.put({ contenido, tipo: archivo.type, nombre: archivo.name }, clave(empId, documento)));
        },
        async obtener(empId, documento) {
            const guardado = await operar('readonly', (tabla) => tabla.get(clave(empId, documento)));
            return guardado ? new Blob([guardado.contenido], { type: guardado.tipo }) : null;
        },
        borrar: (empId, documento) => operar('readwrite', (tabla) => tabla.delete(clave(empId, documento)))
    };
})();

// Devuelve el error del archivo o '' si se puede subir
function validarArchivoDocumento(archivo) {
    if (!archivo) return 'Elige un archivo.';
    if (!TIPOS_DOCUMENTO_PERMITIDOS.includes(archivo.type)) return 'Solo se aceptan PDF, JPG o PNG.';
    if (archivo.size > LIMITE_DOCUMENTO_MB * 1024 * 1024) return `El archivo pesa más de ${LIMITE_DOCUMENTO_MB} MB.`;
    return '';
}

function tamanoLegible(bytes) {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
