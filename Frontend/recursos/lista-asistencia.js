// =====================================================================
//  LISTA DE ASISTENCIA SEMANAL (lunes a sábado) EN PDF
//  Es la misma hoja que las bodegas llenaban a mano, pero el sistema la
//  arma sola con las checadas, retardos, faltas, incapacidades, vacaciones
//  y permisos. Por ahora solo la genera el admin, de su sucursal.
//  Se usa en asistencia.html (necesita datos.js y sesion.js).
// =====================================================================
const ListaAsistencia = (function () {
    const DIAS = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
    const dosDigitos = (n) => String(n).padStart(2, '0');
    const aMinutos = (hora) => { const [h, m] = hora.split(':').map(Number); return h * 60 + m; };
    const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

    const lunesDe = (fecha) => sumarDias(fecha, -((fecha.getDay() + 6) % 7));
    const diasDeLaSemana = (lunes) => DIAS.map((_, i) => sumarDias(lunes, i));
    const fechaCorta = (fecha) => `${dosDigitos(fecha.getDate())}-${MESES_CORTOS[fecha.getMonth()].toLowerCase()}-${String(fecha.getFullYear()).slice(2)}`;
    const fechaIngreso = (iso) => iso.split('-').reverse().join('/');

    // "LUNES 07 AL SÁBADO 12 DE SEPTIEMBRE 2026" (o con los dos meses si la semana cruza de mes)
    function textoSemana(lunes) {
        const sabado = sumarDias(lunes, 5);
        const mes = (f) => MESES[f.getMonth()].toUpperCase();
        const inicio = `LUNES ${dosDigitos(lunes.getDate())}${lunes.getMonth() === sabado.getMonth() ? '' : ` DE ${mes(lunes)}`}`;
        return `${inicio} AL SÁBADO ${dosDigitos(sabado.getDate())} DE ${mes(sabado)} ${sabado.getFullYear()}`;
    }

    // Qué pasó (o qué está programado) con un trabajador en un día.
    // Las ausencias justificadas se marcan aunque el día no haya llegado: así la hoja ya sale con ellas.
    function situacion(emp, fecha, modo) {
        const iso = aISO(fecha);
        if (iso < emp.ingreso) return { tipo: 'fuera', texto: 'Aún no ingresa' };
        if (emp.baja && iso > emp.baja.fecha) return { tipo: 'fuera', texto: 'Baja' };
        const feriado = feriadoEn(iso);
        if (feriado) return { tipo: 'descanso', texto: 'FERIADO', nota: feriado.nombre };
        if (incapacidadEn(emp, iso)) return { tipo: 'incapacidad', texto: 'INCAPACIDAD' };
        if (vacacionEn(emp, iso)) return { tipo: 'vacaciones', texto: 'VACACIONES' };
        const permiso = permisoEn(emp, iso);
        if (permiso) return { tipo: 'permiso', texto: 'PERMISO', nota: permiso.goce ? 'Con goce' : 'Sin goce' };
        if (modo === 'blanco' || iso > HOY_ISO) return { tipo: 'pendiente' };

        const reg = registroDia(emp, fecha);
        if (!reg) return { tipo: 'pendiente' };
        if (reg.estado === 'falta') return { tipo: 'falta', texto: 'FALTA' };
        const ahora = new Date();
        const enTurno = iso === HOY_ISO && ahora.getHours() * 60 + ahora.getMinutes() < aMinutos(reg.salida);
        return {
            tipo: reg.estado, // asistencia o retardo
            texto: reg.estado === 'retardo' ? 'RETARDO' : '',
            horas: `${reg.entrada}–${enTurno ? 'en turno' : reg.salida}`,
            extras: enTurno ? 0 : reg.extras,
            nota: reg.retardoJustificado ? 'Retardo justificado' : reg.manual ? 'Capturada a mano' : ''
        };
    }

    // Todos los datos de la hoja: trabajadores por departamento, su semana y los totales
    function calcular(suc, lunes, modo) {
        const dias = diasDeLaSemana(lunes);
        const lunesIso = aISO(lunes);
        const sabadoIso = aISO(dias[5]);
        const orden = DEPARTAMENTOS.map((d) => d.nombre);
        const posicion = (depto) => { const i = orden.indexOf(depto); return i < 0 ? orden.length : i; };

        const filas = TODOS_EMPLEADOS
            .filter((e) => e.suc === suc && e.ingreso <= sabadoIso && (!e.baja || e.baja.fecha >= lunesIso))
            .sort((a, b) => posicion(a.depto) - posicion(b.depto) || a.id.localeCompare(b.id))
            .map((emp) => {
                const celdas = dias.map((fecha) => situacion(emp, fecha, modo));
                const cuenta = (tipo) => celdas.filter((c) => c.tipo === tipo).length;
                return {
                    emp, celdas,
                    asistencias: cuenta('asistencia') + cuenta('retardo'),
                    retardos: cuenta('retardo'),
                    faltas: cuenta('falta'),
                    extras: celdas.reduce((total, c) => total + (c.extras || 0), 0)
                };
            });

        const grupos = [];
        filas.forEach((fila) => {
            const ultimo = grupos[grupos.length - 1];
            if (ultimo && ultimo.depto === fila.emp.depto) ultimo.filas.push(fila);
            else grupos.push({ depto: fila.emp.depto, filas: [fila] });
        });

        const suma = (clave) => filas.reduce((total, f) => total + f[clave], 0);
        const personasCon = (tipo) => filas.filter((f) => f.celdas.some((c) => c.tipo === tipo)).length;
        const asistencias = suma('asistencias');
        const faltas = suma('faltas');
        const porDia = dias.map((_, i) => {
            const esperados = filas.filter((f) => ['asistencia', 'retardo', 'falta'].includes(f.celdas[i].tipo)).length;
            const asistieron = filas.filter((f) => ['asistencia', 'retardo'].includes(f.celdas[i].tipo)).length;
            return { esperados, asistieron };
        });

        return {
            suc, lunes, dias, modo, filas, grupos, porDia,
            resumen: {
                trabajadores: filas.length,
                asistencias, faltas,
                retardos: suma('retardos'),
                extras: suma('extras'),
                porcentaje: asistencias + faltas ? Math.round(asistencias / (asistencias + faltas) * 100) : null,
                incapacidad: personasCon('incapacidad'),
                vacaciones: personasCon('vacaciones'),
                permiso: personasCon('permiso')
            },
            avisos: modo === 'blanco' ? [] : avisos(filas, lunesIso, sabadoIso)
        };
    }

    // Lo que conviene que el admin atienda: lo detecta el sistema, nadie tiene que contarlo a mano
    function avisos(filas, lunesIso, sabadoIso) {
        const lista = [];
        const hasta = sabadoIso < HOY_ISO ? sabadoIso : HOY_ISO;
        const enSemana = (iso) => iso >= lunesIso && iso <= sabadoIso;
        filas.forEach(({ emp, retardos }) => {
            if (hasta >= lunesIso && !emp.baja) {
                const faltas30 = faltasUltimos30(emp, hasta).length;
                if (faltas30 >= 3) lista.push({ tipo: 'falta', texto: `${emp.nombre} lleva ${faltas30} faltas en 30 días: avisa a Recursos Humanos.` });
            }
            if (retardos >= 2) lista.push({ tipo: 'retardo', texto: `${emp.nombre} tuvo ${retardos} retardos esta semana: habla con el trabajador.` });
            if (enSemana(emp.ingreso)) lista.push({ tipo: 'asistencia', texto: `${emp.nombre} es nuevo ingreso: entró el ${formatoFecha(emp.ingreso)}.` });
            (emp.incapacidades || []).filter((i) => enSemana(finIncapacidad(i)))
                .forEach((i) => lista.push({ tipo: 'incapacidad', texto: `${emp.nombre} termina su incapacidad el ${formatoFecha(finIncapacidad(i))}.` }));
            (emp.vacaciones || []).filter((v) => enSemana(v.fin))
                .forEach((v) => lista.push({ tipo: 'vacaciones', texto: `${emp.nombre} termina sus vacaciones el ${formatoFecha(v.fin)}.` }));
            if (emp.baja && enSemana(emp.baja.fecha)) lista.push({ tipo: 'baja', texto: `${emp.nombre} causó baja el ${formatoFecha(emp.baja.fecha)}.` });
        });
        // Primero lo más delicado: faltas acumuladas, luego retardos y al final los avisos informativos
        const prioridad = ['falta', 'retardo', 'baja', 'incapacidad', 'vacaciones', 'asistencia'];
        return lista.sort((a, b) => prioridad.indexOf(a.tipo) - prioridad.indexOf(b.tipo)).slice(0, 8);
    }

    function htmlCelda(c) {
        if (c.tipo === 'pendiente') return '<td class="la-dia"></td>';
        if (c.tipo === 'fuera') return `<td class="la-dia la-dia--fuera">${c.texto}</td>`;
        // Renglón 1: lo que pasó. Renglón 2: horas extra o una nota. Así la hoja queda compacta
        const principal = c.tipo === 'asistencia' ? `✓ ${c.horas}` : c.texto;
        const detalle = [c.tipo === 'retardo' ? c.horas : '', c.extras ? `+${c.extras} h extra` : '', c.nota].filter(Boolean).join(' · ');
        return `<td class="la-dia la-dia--${c.tipo}"><strong>${principal}</strong>${detalle ? `<small>${escaparHtml(detalle)}</small>` : ''}</td>`;
    }

    function html(suc, lunes, modo = 'sistema') {
        const d = calcular(suc, lunes, modo);
        const enBlanco = modo === 'blanco';
        const columnas = 4 + 6 + (enBlanco ? 1 : 4);
        const r = d.resumen;
        let numero = 0;

        const cuerpo = d.grupos.map((grupo) => `
            <tr class="la-grupo"><td colspan="${columnas}">${escaparHtml(grupo.depto)} · ${plural(grupo.filas.length, 'trabajador', 'trabajadores')}</td></tr>
            ${grupo.filas.map((f) => `<tr>
                <td class="la-num">${++numero}</td>
                <td class="la-nombre"><span>${escaparHtml(f.emp.nombre)}</span><small>ID ${f.emp.id}</small></td>
                <td class="la-ingreso">${fechaIngreso(f.emp.ingreso)}</td>
                <td class="la-puesto">${escaparHtml(f.emp.puesto)}</td>
                ${f.celdas.map(htmlCelda).join('')}
                ${enBlanco
                    ? '<td class="la-observaciones"></td>'
                    : `<td class="la-total">${f.asistencias}</td>
                       <td class="la-total ${f.retardos ? 'la-total--retardo' : ''}">${f.retardos || '—'}</td>
                       <td class="la-total ${f.faltas ? 'la-total--falta' : ''}">${f.faltas || '—'}</td>
                       <td class="la-total">${f.extras || '—'}</td>`}
            </tr>`).join('')}`).join('');

        const pie = enBlanco ? '' : `<tr class="la-pie">
            <td colspan="4">Asistieron / se esperaban</td>
            ${d.porDia.map((p) => `<td>${p.esperados ? `${p.asistieron} / ${p.esperados}` : '—'}</td>`).join('')}
            <td>${r.asistencias}</td><td>${r.retardos}</td><td>${r.faltas}</td><td>${r.extras}</td>
        </tr>`;

        const tarjeta = (valor, texto, concepto = '') => `<div class="la-tarjeta ${concepto ? `la-tarjeta--${concepto}` : ''}"><strong>${valor}</strong><span>${texto}</span></div>`;
        const resumen = enBlanco
            ? `<div class="la-tarjetas">${tarjeta(r.trabajadores, 'Trabajadores')}${tarjeta(r.incapacidad, 'Con incapacidad', 'incapacidad')}${tarjeta(r.vacaciones, 'De vacaciones', 'vacaciones')}${tarjeta(r.permiso, 'Con permiso', 'permiso')}</div>`
            : `<div class="la-tarjetas">
                ${tarjeta(r.trabajadores, 'Trabajadores')}
                ${tarjeta(r.porcentaje === null ? '—' : `${r.porcentaje}%`, 'Asistencia de la semana', 'asistencia')}
                ${tarjeta(r.retardos, 'Retardos', 'retardo')}
                ${tarjeta(r.faltas, 'Faltas', 'falta')}
                ${tarjeta(r.incapacidad, 'Con incapacidad', 'incapacidad')}
                ${tarjeta(r.vacaciones, 'De vacaciones', 'vacaciones')}
                ${tarjeta(r.permiso, 'Con permiso', 'permiso')}
                ${tarjeta(`${r.extras} h`, 'Horas extra')}
            </div>`;

        const ahora = new Date();
        const generada = `${formatoFecha(HOY_ISO)}, ${dosDigitos(ahora.getHours())}:${dosDigitos(ahora.getMinutes())} h`;
        return `<article class="lista-hoja">
            <header class="la-encabezado">
                <img src="recursos/logo.png" alt="El Nevado">
                <div class="la-titulo">
                    <h2>Lista de asistencia</h2>
                    <p>${enBlanco ? 'Para llenar a mano' : 'Llenada con los registros de la checadora'}</p>
                </div>
                <div class="la-semana">
                    <h2>${escaparHtml((SUCURSALES[suc] || '').toUpperCase())}</h2>
                    <p>Sucursal ${suc} · ${textoSemana(d.lunes)}</p>
                </div>
            </header>

            ${resumen}

            <table class="la-tabla">
                <colgroup>
                    <col style="width: 2%"><col style="width: 21.5%"><col style="width: 6.2%"><col style="width: 8.3%">
                    ${DIAS.map(() => '<col>').join('')}
                    ${enBlanco ? '<col style="width: 13%">' : '<col style="width: 3.2%">'.repeat(4)}
                </colgroup>
                <thead>
                    <tr>
                        <th rowspan="2" class="la-num">#</th>
                        <th rowspan="2">Nombre del trabajador</th>
                        <th rowspan="2">Fecha de ingreso</th>
                        <th rowspan="2">Puesto</th>
                        ${DIAS.map((dia) => `<th class="la-th-dia">${dia}</th>`).join('')}
                        ${enBlanco ? '<th rowspan="2">Observaciones</th>' : '<th colspan="4">Totales</th>'}
                    </tr>
                    <tr>
                        ${d.dias.map((fecha) => `<th class="la-th-fecha ${aISO(fecha) === HOY_ISO ? 'la-th-hoy' : ''}">${fechaCorta(fecha)}</th>`).join('')}
                        ${enBlanco ? '' : '<th class="la-th-total">Asist.</th><th class="la-th-total">Ret.</th><th class="la-th-total">Faltas</th><th class="la-th-total">H. extra</th>'}
                    </tr>
                </thead>
                <tbody>${cuerpo || `<tr><td colspan="${columnas}" class="la-vacia">No hay trabajadores en esta sucursal en la semana elegida.</td></tr>`}</tbody>
                ${pie ? `<tfoot>${pie}</tfoot>` : ''}
            </table>

            <div class="la-final">
                <div class="la-leyenda">
                    <span class="la-chip la-dia--asistencia">✓ Asistió (entrada – salida)</span>
                    <span class="la-chip la-dia--retardo">Retardo</span>
                    <span class="la-chip la-dia--falta">Falta</span>
                    <span class="la-chip la-dia--incapacidad">Incapacidad</span>
                    <span class="la-chip la-dia--vacaciones">Vacaciones</span>
                    <span class="la-chip la-dia--permiso">Permiso</span>
                    <span class="la-chip la-dia--descanso">Feriado</span>
                </div>
                ${enBlanco ? '' : `<div class="la-avisos">
                    <h3>Para atender esta semana</h3>
                    ${d.avisos.length
                        ? `<ul>${d.avisos.map((a) => `<li class="la-aviso--${a.tipo}">${escaparHtml(a.texto)}</li>`).join('')}</ul>`
                        : '<p>Sin pendientes: nadie acumula faltas ni retardos esta semana.</p>'}
                </div>`}
            </div>

            <footer class="la-firmas">
                <div><span>${escaparHtml(USUARIO_ACTUAL.nombre)}</span><small>Elaboró · ${escaparHtml(ROLES[USUARIO_ACTUAL.rol].nombre)}</small></div>
                <div><span>&nbsp;</span><small>Revisó · Recursos Humanos</small></div>
                <p>Folio LA-${suc}-${aISO(d.lunes)} · Generada el ${generada} por ${escaparHtml(USUARIO_ACTUAL.usuario)} · Distribuidora El Nevado</p>
            </footer>
        </article>`;
    }

    // Si la lista se pasa por poco de una hoja carta horizontal, se reduce lo justo para que quepa completa.
    // Las listas largas se dejan en su tamaño y ocupan varias hojas con el encabezado repetido.
    const HOJA = { ancho: 990, alto: 735 }; // área útil en pixeles con márgenes de 9 mm (con un poco de holgura)
    const ESCALA_MINIMA = 0.76;             // más chico ya cuesta leerlo

    function ajustarAUnaHoja(zona) {
        const hoja = zona.querySelector('.lista-hoja');
        let elegida = null;
        Object.assign(zona.style, { display: 'block', position: 'absolute', left: '-9999px', top: '0' });
        Object.assign(hoja.style, { width: '100%', padding: '0' });
        // Al reducir la hoja, cabe más a lo ancho: se mide el alto con el ancho que tendrá a esa escala
        for (let escala = 1; escala >= ESCALA_MINIMA - 0.001; escala -= 0.02) {
            zona.style.width = `${HOJA.ancho / escala}px`;
            if (hoja.offsetHeight * escala <= HOJA.alto) {
                elegida = escala;
                break;
            }
        }
        zona.removeAttribute('style');
        hoja.removeAttribute('style');
        if (elegida && elegida < 1) hoja.style.zoom = elegida.toFixed(2);
    }

    // ---------- Ventana para elegir la semana, ver la hoja y generar el PDF ----------
    function iniciar() {
        const boton = document.getElementById('listaAsistenciaBtn');
        if (!boton || !puede('generarListaAsistencia')) return;
        boton.classList.remove('hidden');

        const ventana = document.getElementById('listaModal');
        const semana = document.getElementById('listaSemana');
        const vista = document.getElementById('listaVista');
        const suc = USUARIO_ACTUAL.sucursal;
        const modo = () => document.querySelector('input[name="listaModo"]:checked').value;

        // Semana en curso y las 8 anteriores
        const actual = lunesDe(HOY);
        semana.innerHTML = Array.from({ length: 9 }, (_, i) => {
            const lunes = sumarDias(actual, -7 * i);
            const texto = textoSemana(lunes).toLowerCase();
            return `<option value="${aISO(lunes)}">${texto[0].toUpperCase()}${texto.slice(1)}${i === 0 ? ' (en curso)' : ''}</option>`;
        }).join('');

        const pintar = () => {
            vista.innerHTML = html(suc, fechaDesdeISO(semana.value), modo());
            const r = calcular(suc, fechaDesdeISO(semana.value), modo()).resumen;
            document.getElementById('listaInfo').textContent = `${nombreSucursal(suc)} · ${plural(r.trabajadores, 'trabajador', 'trabajadores')}`;
        };

        function generarPdf() {
            const lunes = fechaDesdeISO(semana.value);
            const zona = document.getElementById('zonaLista');
            const tituloPagina = document.title;
            zona.innerHTML = html(suc, lunes, modo());
            // El nombre de la página es el nombre que el navegador propone para el archivo PDF
            document.title = `Lista de asistencia ${suc} ${SUCURSALES[suc]} - semana ${semana.value}`;
            document.body.classList.add('imprimiendo-lista');
            ajustarAUnaHoja(zona);
            // Dar tiempo a que cargue el logo antes de abrir el diálogo de impresión
            setTimeout(() => {
                window.print();
                document.body.classList.remove('imprimiendo-lista');
                document.title = tituloPagina;
            }, 300);
            registrarBitacora('Lista de asistencia generada', `${nombreSucursal(suc)} · semana del ${semana.value} · ${modo() === 'blanco' ? 'en blanco' : 'con registros'}`);
        }

        boton.addEventListener('click', () => {
            pintar();
            ventana.classList.remove('hidden');
        });
        semana.addEventListener('change', pintar);
        document.querySelectorAll('input[name="listaModo"]').forEach((radio) => radio.addEventListener('change', pintar));
        document.getElementById('listaCerrar').addEventListener('click', () => ventana.classList.add('hidden'));
        ventana.addEventListener('click', (evento) => { if (evento.target === ventana) ventana.classList.add('hidden'); });
        document.getElementById('listaPdf').addEventListener('click', generarPdf);
    }

    iniciar();
    return { html, calcular, textoSemana, lunesDe };
})();
