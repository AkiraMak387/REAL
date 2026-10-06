// =====================================================================
//  CAMPOS DE FECHA EN FORMATO dd/mm/aaaa
//  El navegador muestra <input type="date"> según su idioma (en inglés sale
//  mm/dd/aaaa). Aquí cada campo de fecha se cambia por uno de texto que SIEMPRE
//  muestra día/mes/año, con un botón 📅 que abre el calendario.
//
//  El campo original se queda oculto y sigue guardando la fecha como
//  "2026-10-05", así que el resto del sistema (validaciones, guardado,
//  filtros, Firebase) funciona igual que antes sin cambiarle nada.
// =====================================================================
(function () {
    const valorNativo = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const leer = (input) => valorNativo.get.call(input);
    const escribir = (input, valor) => valorNativo.set.call(input, valor);

    // "2026-10-05" → "05/10/2026"
    function isoATexto(iso) {
        return /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
    }

    // "05/10/2026" → "2026-10-05" (null si la fecha no existe, p. ej. 31/02/2026)
    function textoAIso(texto) {
        const m = (texto || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (!m) return null;
        const [, dia, mes, anio] = m.map(Number);
        const fecha = new Date(anio, mes - 1, dia);
        if (anio < 1900 || fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) return null;
        return `${m[3]}-${m[2]}-${m[1]}`;
    }

    // Mientras se escribe pone las diagonales solo: 05102026 → 05/10/2026
    function conDiagonales(texto) {
        const d = texto.replace(/\D/g, '').slice(0, 8);
        if (d.length <= 2) return d;
        if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
        return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
    }

    function avisar(input) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function mejorar(nativo) {
        if (nativo.dataset.fechaMx) return;
        nativo.dataset.fechaMx = '1';

        const caja = document.createElement('span');
        caja.className = 'fecha-mx';
        const texto = document.createElement('input');
        texto.type = 'text';
        texto.inputMode = 'numeric';
        texto.autocomplete = 'off';
        texto.maxLength = 10;
        texto.placeholder = 'dd/mm/aaaa';
        texto.className = nativo.className;
        texto.style.cssText = nativo.getAttribute('style') || '';
        texto.classList.add('fecha-mx__texto');
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.className = 'fecha-mx__boton';
        boton.textContent = '📅';
        boton.title = 'Abrir calendario';
        boton.setAttribute('aria-label', 'Abrir calendario');
        boton.tabIndex = -1;

        nativo.parentNode.insertBefore(caja, nativo);
        caja.append(texto, nativo, boton);
        nativo.classList.add('fecha-mx__nativo');
        nativo.tabIndex = -1;
        nativo.setAttribute('aria-hidden', 'true');

        const mostrar = () => {
            texto.value = isoATexto(leer(nativo));
            texto.classList.remove('fecha-mx--error');
        };

        // Cuando el sistema pone una fecha por código (input.value = '2026-10-05'), también se ve aquí
        Object.defineProperty(nativo, 'value', {
            configurable: true,
            get() { return leer(this); },
            set(valor) { escribir(this, valor); mostrar(); }
        });

        // Si el sistema le pide el foco al campo original (o se da clic en su etiqueta), lo recibe el visible
        nativo.addEventListener('focus', () => texto.focus());
        // Fecha elegida en el calendario
        nativo.addEventListener('change', mostrar);

        texto.addEventListener('input', () => {
            const borrando = texto.value.length < (texto.dataset.antes || '').length;
            if (!borrando) texto.value = conDiagonales(texto.value);
            texto.dataset.antes = texto.value;
            const iso = textoAIso(texto.value);
            if (iso && iso !== leer(nativo)) {
                escribir(nativo, iso);
                texto.classList.remove('fecha-mx--error');
                avisar(nativo);
            } else if (!texto.value && leer(nativo)) {
                escribir(nativo, '');
                avisar(nativo);
            }
        });

        texto.addEventListener('blur', () => {
            if (!texto.value) return;
            const iso = textoAIso(texto.value);
            if (iso) { texto.value = isoATexto(iso); return; }
            // Fecha incompleta o que no existe: se marca en rojo y no se guarda
            texto.classList.add('fecha-mx--error');
            texto.title = 'Escribe la fecha como día/mes/año, por ejemplo 05/10/2026';
            if (leer(nativo)) { escribir(nativo, ''); avisar(nativo); }
        });

        boton.addEventListener('click', () => {
            if (nativo.disabled || nativo.readOnly) return;
            try {
                nativo.showPicker();
            } catch (error) {
                texto.focus();
            }
        });

        // Si el sistema deshabilita, oculta o marca con error el campo original, el visible hace lo mismo
        const copiarEstado = () => {
            texto.disabled = nativo.disabled;
            texto.readOnly = nativo.readOnly;
            texto.required = nativo.required;
            boton.disabled = nativo.disabled || nativo.readOnly;
            const clases = [...nativo.classList].filter((c) => c !== 'fecha-mx__nativo');
            const error = texto.classList.contains('fecha-mx--error');
            texto.className = ['fecha-mx__texto', ...clases, error ? 'fecha-mx--error' : ''].join(' ').trim();
            caja.classList.toggle('hidden', nativo.classList.contains('hidden') || nativo.hidden);
        };
        new MutationObserver(copiarEstado).observe(nativo, { attributes: true, attributeFilter: ['class', 'disabled', 'readonly', 'required', 'hidden'] });
        copiarEstado();

        const formulario = nativo.form;
        if (formulario) formulario.addEventListener('reset', () => setTimeout(mostrar));

        mostrar();
    }

    function mejorarTodos(raiz) {
        if (raiz.matches && raiz.matches('input[type="date"]')) mejorar(raiz);
        if (raiz.querySelectorAll) raiz.querySelectorAll('input[type="date"]').forEach(mejorar);
    }

    const estilos = document.createElement('style');
    estilos.textContent = `
        .fecha-mx { position: relative; display: inline-block; vertical-align: middle; min-width: 150px; }
        .fecha-mx.hidden { display: none !important; }
        .fecha-mx > .fecha-mx__texto { width: 100% !important; box-sizing: border-box; padding-right: 36px !important; }
        .fecha-mx > .fecha-mx__texto.fecha-mx--error { border-color: #dc2626 !important; box-shadow: 0 0 0 3px rgba(220, 38, 38, .12); }
        .fecha-mx > .fecha-mx__nativo {
            position: absolute !important; left: 0 !important; bottom: 0 !important;
            width: 100% !important; height: 1px !important; min-height: 0 !important;
            padding: 0 !important; margin: 0 !important; border: 0 !important;
            opacity: 0 !important; pointer-events: none !important;
        }
        .fecha-mx > .fecha-mx__boton {
            position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
            width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px;
            background: transparent; cursor: pointer; font-size: 15px; line-height: 1;
        }
        .fecha-mx > .fecha-mx__boton:hover:not(:disabled) { background: rgba(15, 23, 42, .06); }
        .fecha-mx > .fecha-mx__boton:disabled { cursor: default; opacity: .4; }
    `;
    document.head.appendChild(estilos);

    document.addEventListener('DOMContentLoaded', () => {
        mejorarTodos(document.body);
        // Campos de fecha que aparecen después (ventanas, tarjetas de solicitudes, etc.)
        new MutationObserver((cambios) => {
            cambios.forEach((c) => c.addedNodes.forEach((nodo) => { if (nodo.nodeType === 1) mejorarTodos(nodo); }));
        }).observe(document.body, { childList: true, subtree: true });
    });
})();
