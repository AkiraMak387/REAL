// Aviso en la barra lateral: "En línea" si el servidor responde, "Sin conexión" si no.
//
// Mientras no exista la base de datos en línea se revisa el servidor que entrega estas páginas.
// Cuando exista la API, escribe aquí la dirección de su chequeo de salud, por ejemplo:
//   const URL_SALUD_SERVIDOR = 'https://api.elnevado.com.mx/salud';
const URL_SALUD_SERVIDOR = null;
const REVISAR_CADA_MS = 30000;

(function () {
    // Va debajo del menú y arriba de los datos del usuario. Lo pone sesion.js al armar el menú; si no está, se crea aquí
    const cajaUsuario = document.querySelector('.sidebar .sidebar__user');
    if (!cajaUsuario) return;

    let aviso = document.querySelector('.sidebar .server-status');
    if (!aviso) {
        aviso = document.createElement('button');
        aviso.type = 'button';
        aviso.className = 'server-status';
        aviso.setAttribute('role', 'status');
        aviso.setAttribute('aria-live', 'polite');
        aviso.innerHTML = '<span class="server-status__dot"></span><span class="server-status__text">Revisando…</span>';
        cajaUsuario.before(aviso);
    }


    const texto = aviso.querySelector('.server-status__text');
    let revisando = false;
    const hora = () => new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    function mostrar(enLinea, detalle) {
        try { sessionStorage.setItem('elnevado.servidor', enLinea ? 'ok' : 'error'); } catch (error) { /* sin almacenamiento */ }

        aviso.className = `server-status ${enLinea ? 'server-status--ok' : 'server-status--error'}`;
        texto.textContent = enLinea ? 'En línea' : 'Sin conexión';
        aviso.title = `${detalle} (clic para revisar de nuevo)`;
    }

    async function revisar() {
        if (revisando) return;
        revisando = true;

        if (!navigator.onLine) {
            mostrar(false, 'Sin conexión a internet');
        } else if (!URL_SALUD_SERVIDOR && location.protocol === 'file:') {
            mostrar(false, 'Página abierta como archivo, sin servidor');
        } else {
            const controlador = new AbortController();
            const limite = setTimeout(() => controlador.abort(), 8000);
            try {
                const respuesta = await fetch(URL_SALUD_SERVIDOR || location.href, {
                    method: URL_SALUD_SERVIDOR ? 'GET' : 'HEAD',
                    cache: 'no-store',
                    signal: controlador.signal
                });
                if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
                mostrar(true, `Servidor funcionando · última revisión ${hora()}`);
            } catch (error) {
                mostrar(false, `El servidor no responde desde las ${hora()}`);
            } finally {
                clearTimeout(limite);
            }
        }
        revisando = false;
    }

    aviso.addEventListener('click', revisar);
    window.addEventListener('online', revisar);
    window.addEventListener('offline', revisar);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) revisar();
    });

    revisar();
    setInterval(revisar, REVISAR_CADA_MS);
})();
