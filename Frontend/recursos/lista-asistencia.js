// =====================================================================
//  LISTA DE ASISTENCIA SEMANAL (lunes a domingo) EN PDF Y EN EXCEL
//  Es la misma hoja que las bodegas llenaban a mano (mismo formato y colores),
//  pero el sistema la arma sola con las checadas, retardos, faltas,
//  incapacidades, vacaciones y permisos. Por ahora solo la genera el admin,
//  de su sucursal. Se usa en asistencia.html (necesita datos.js y sesion.js).
//  El Excel se arma con ExcelJS, que se descarga de internet al pedirlo.
// =====================================================================
const ListaAsistencia = (function () {
    const DIAS = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO'];
    const dosDigitos = (n) => String(n).padStart(2, '0');
    const aMinutos = (hora) => { const [h, m] = hora.split(':').map(Number); return h * 60 + m; };
    const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

    const lunesDe = (fecha) => sumarDias(fecha, -((fecha.getDay() + 6) % 7));
    const diasDeLaSemana = (lunes) => DIAS.map((_, i) => sumarDias(lunes, i));
    const fechaCorta = (fecha) => `${dosDigitos(fecha.getDate())}-${MESES_CORTOS[fecha.getMonth()].toLowerCase()}-${String(fecha.getFullYear()).slice(2)}`;
    const fechaIngreso = (iso) => iso.split('-').reverse().join('/');
    // "08:30" → "8:30am" · "18:13" → "6:13pm"
    const hora12 = (hora) => { const [h, m] = hora.split(':').map(Number); return `${h % 12 || 12}:${dosDigitos(m)}${h < 12 ? 'am' : 'pm'}`; };
    // 583 minutos → "9:43 horas"
    const textoHoras = (minutos) => (minutos ? `${Math.floor(minutos / 60)}:${dosDigitos(minutos % 60)} horas` : '');

    // "LUNES 07 AL DOMINGO 13 DE SEPTIEMBRE 2026" (o con los dos meses si la semana cruza de mes)
    function textoSemana(lunes) {
        const domingo = sumarDias(lunes, 6);
        const mes = (f) => MESES[f.getMonth()].toUpperCase();
        const inicio = `LUNES ${dosDigitos(lunes.getDate())}${lunes.getMonth() === domingo.getMonth() ? '' : ` DE ${mes(lunes)}`}`;
        return `${inicio} AL DOMINGO ${dosDigitos(domingo.getDate())} DE ${mes(domingo)} ${domingo.getFullYear()}`;
    }

    // ¿Ese día el trabajador seguía sin presentar el alta del seguro de su última incapacidad?
    // (misma regla que incapacidadSinAlta() de datos.js, pero vista desde un día cualquiera)
    function sinAltaEn(emp, iso) {
        const anteriores = (emp.incapacidades || []).filter((i) => finIncapacidad(i) < iso);
        if (!anteriores.length) return false;
        const ultima = anteriores.reduce((a, b) => (finIncapacidad(b) > finIncapacidad(a) ? b : a));
        if (finIncapacidad(ultima) < ALTA_OBLIGATORIA_DESDE) return false;
        return !altaVigente(ultima) || ultima.alta.fecha > iso;
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
        if (fecha.getDay() === 0) return { tipo: 'descanso', texto: 'DESCANSO' };
        // Terminó su incapacidad y no ha presentado el alta del seguro: no puede trabajar
        const sinAlta = iso <= HOY_ISO && sinAltaEn(emp, iso);
        const reg = modo === 'blanco' || iso > HOY_ISO ? null : registroDia(emp, fecha);
        // Sin alta y sin checada no es falta (no puede trabajar), salvo que RH haya registrado la falta
        const faltaDeRH = (emp.incidencias || []).some((i) => i.fecha === iso && i.tipo === 'falta');
        if (sinAlta && !faltaDeRH && (!reg || (reg.estado === 'falta' && !reg.entrada))) {
            return { tipo: 'sinalta', texto: 'SIN ALTA', nota: 'No puede trabajar' };
        }
        if (!reg) return { tipo: 'pendiente' };
        if (reg.estado === 'falta') return { tipo: 'falta', texto: 'FALTA' };
        // "En turno": checó entrada y todavía no checa salida (misma regla que Asistencia)
        const ahora = new Date();
        const enTurno = Boolean(reg.enTurno)
            || (iso === HOY_ISO && Boolean(reg.salida) && ahora.getHours() * 60 + ahora.getMinutes() < aMinutos(reg.salida));
        const notas = [];
        if (sinAlta) notas.push('Trabajó sin alta del seguro');
        if (reg.retardoJustificado) notas.push('Retardo justificado');
        if (reg.manual) notas.push('Capturada a mano');
        if (reg.salidaAutomatica) notas.push('Salida automática');
        return {
            tipo: reg.estado, // asistencia o retardo
            // Como en la hoja a mano: entrada y salida, en rojo lo que se sale del horario
            entrada: hora12(reg.entrada),
            salida: enTurno ? 'en turno' : hora12(reg.salida),
            entradaTarde: reg.estado === 'retardo',
            salidaTemprana: !enTurno && aMinutos(reg.salida) < salidaOficial(fecha),
            minutos: enTurno ? 0 : Math.round((reg.horas || 0) * 60),
            extras: enTurno ? 0 : reg.extras,
            nota: notas.join(' · '),
            sinAlta
        };
    }

    // Todos los datos de la hoja: trabajadores por departamento, su semana y los totales
    function calcular(suc, lunes, modo) {
        const dias = diasDeLaSemana(lunes);
        const lunesIso = aISO(lunes);
        const domingoIso = aISO(dias[6]);
        const orden = DEPARTAMENTOS.map((d) => d.nombre);
        const posicion = (depto) => { const i = orden.indexOf(depto); return i < 0 ? orden.length : i; };

        const filas = TODOS_EMPLEADOS
            .filter((e) => e.suc === suc && e.ingreso <= domingoIso && (!e.baja || e.baja.fecha >= lunesIso))
            .sort((a, b) => posicion(a.depto) - posicion(b.depto) || a.id.localeCompare(b.id))
            .map((emp) => {
                const celdas = dias.map((fecha) => situacion(emp, fecha, modo));
                const cuenta = (tipo) => celdas.filter((c) => c.tipo === tipo).length;
                return {
                    emp, celdas,
                    asistencias: cuenta('asistencia') + cuenta('retardo'),
                    retardos: cuenta('retardo'),
                    faltas: cuenta('falta'),
                    extras: celdas.reduce((total, c) => total + (c.extras || 0), 0),
                    minutos: celdas.reduce((total, c) => total + (c.minutos || 0), 0) // horas trabajadas en la semana
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
            avisos: modo === 'blanco' ? [] : avisos(filas, lunesIso, domingoIso)
        };
    }

    // Lo que conviene que el admin atienda: lo detecta el sistema, nadie tiene que contarlo a mano
    function avisos(filas, lunesIso, domingoIso) {
        const lista = [];
        const hasta = domingoIso < HOY_ISO ? domingoIso : HOY_ISO;
        const enSemana = (iso) => iso >= lunesIso && iso <= domingoIso;
        filas.forEach(({ emp, retardos, celdas }) => {
            // Alta del seguro: en la semana en curso, quién no puede trabajar hoy; en las pasadas, cuántos días estuvo sin ella
            const pendiente = domingoIso >= HOY_ISO && lunesIso <= HOY_ISO ? incapacidadSinAlta(emp) : null;
            const diasSinAlta = celdas.filter((c) => c.tipo === 'sinalta' || c.sinAlta).length;
            const trabajoSinAlta = celdas.filter((c) => c.sinAlta).length;
            if (pendiente) {
                const devuelta = pendiente.alta && pendiente.alta.estado === 'rechazada' ? ' RH devolvió el alta que se subió.' : '';
                lista.push({ tipo: 'sinalta', texto: `${emp.nombre} no puede trabajar: falta su alta del seguro (su incapacidad terminó el ${formatoFecha(finIncapacidad(pendiente))}).${devuelta}` });
            } else if (diasSinAlta) {
                lista.push({ tipo: 'sinalta', texto: `${emp.nombre} estuvo ${plural(diasSinAlta, 'día', 'días')} sin alta del seguro esta semana.` });
            }
            if (trabajoSinAlta) lista.push({ tipo: 'sinalta', texto: `${emp.nombre} checó ${plural(trabajoSinAlta, 'día', 'días')} sin haber presentado su alta del seguro.` });
            if (hasta >= lunesIso && !emp.baja) {
                const faltas30 = faltasUltimos30(emp, hasta).length;
                if (faltas30 >= 3) lista.push({ tipo: 'falta', texto: `${emp.nombre} lleva ${faltas30} faltas en 30 días: avisa a Recursos Humanos.` });
            }
            if (retardos >= 2) lista.push({ tipo: 'retardo', texto: `${emp.nombre} tuvo ${retardos} retardos esta semana: habla con el trabajador.` });
            if (enSemana(emp.ingreso)) lista.push({ tipo: 'asistencia', texto: `${emp.nombre} es nuevo ingreso: entró el ${formatoFecha(emp.ingreso)}.` });
            (emp.incapacidades || []).filter((i) => enSemana(finIncapacidad(i)))
                .forEach((i) => lista.push({
                    tipo: 'incapacidad',
                    texto: `${emp.nombre} termina su incapacidad el ${formatoFecha(finIncapacidad(i))}`
                        + (finIncapacidad(i) >= ALTA_OBLIGATORIA_DESDE && !altaVigente(i) ? ': para volver debe presentar su alta del seguro.' : '.')
                }));
            (emp.vacaciones || []).filter((v) => enSemana(v.fin))
                .forEach((v) => lista.push({ tipo: 'vacaciones', texto: `${emp.nombre} termina sus vacaciones el ${formatoFecha(v.fin)}.` }));
            if (emp.baja && enSemana(emp.baja.fecha)) lista.push({ tipo: 'baja', texto: `${emp.nombre} causó baja el ${formatoFecha(emp.baja.fecha)}.` });
        });
        // Primero lo más delicado: quien no puede trabajar, faltas acumuladas, luego retardos y al final los avisos informativos
        const prioridad = ['sinalta', 'falta', 'retardo', 'baja', 'incapacidad', 'vacaciones', 'asistencia'];
        return lista.sort((a, b) => prioridad.indexOf(a.tipo) - prioridad.indexOf(b.tipo)).slice(0, 8);
    }

    function htmlCelda(c) {
        if (c.tipo === 'pendiente') return '<td class="la-dia"></td>';
        if (c.tipo === 'fuera') return `<td class="la-dia la-dia--fuera">${c.texto}</td>`;
        // Renglón 1: lo que pasó (entrada y salida, o el motivo). Renglón 2: horas extra o una nota
        const asistio = c.tipo === 'asistencia' || c.tipo === 'retardo';
        const principal = asistio
            ? `<span class="${c.entradaTarde ? 'la-hora--roja' : ''}">${c.entrada}</span> <span class="${c.salidaTemprana ? 'la-hora--roja' : ''}">${c.salida}</span>`
            : c.texto;
        const detalle = [c.extras ? `+${c.extras} h extra` : '', c.nota].filter(Boolean).join(' · ');
        return `<td class="la-dia la-dia--${c.tipo}"><strong>${principal}</strong>${detalle ? `<small>${escaparHtml(detalle)}</small>` : ''}</td>`;
    }

    function html(suc, lunes, modo = 'sistema') {
        const d = calcular(suc, lunes, modo);
        const enBlanco = modo === 'blanco';
        const columnas = 4 + DIAS.length + 1;
        let numero = 0;

        const cuerpo = d.grupos.map((grupo) => `
            <tr class="la-grupo"><td colspan="4">${escaparHtml(grupo.depto)}</td><td colspan="${DIAS.length + 1}"></td></tr>
            ${grupo.filas.map((f) => `<tr>
                <td class="la-num">${++numero}</td>
                <td class="la-nombre"><span>${escaparHtml(f.emp.nombre)}</span><small>ID ${f.emp.id}</small></td>
                <td class="la-ingreso">${fechaIngreso(f.emp.ingreso)}</td>
                <td class="la-puesto">${escaparHtml(f.emp.puesto)}</td>
                ${f.celdas.map(htmlCelda).join('')}
                <td class="la-horas">${enBlanco ? '' : textoHoras(f.minutos)}</td>
            </tr>`).join('')}`).join('');

        const ahora = new Date();
        const generada = `${formatoFecha(HOY_ISO)}, ${dosDigitos(ahora.getHours())}:${dosDigitos(ahora.getMinutes())} h`;
        return `<article class="lista-hoja">
            <header class="la-encabezado">
                <div class="la-logo"><img src="recursos/logo.png" alt="El Nevado"></div>
                <div class="la-titulo">
                    <h2>Lista de asistencia</h2>
                    <p>Semana del:</p>
                </div>
                <div class="la-semana">
                    <h2>${escaparHtml(SUCURSALES[suc] || '')}</h2>
                    <p>${textoSemana(d.lunes)}</p>
                </div>
            </header>

            <table class="la-tabla">
                <colgroup>
                    <col style="width: 2%"><col style="width: 19%"><col style="width: 6.2%"><col style="width: 8.3%">
                    ${DIAS.map(() => '<col>').join('')}
                    <col style="width: 9%">
                </colgroup>
                <thead>
                    <tr>
                        <th rowspan="2" colspan="2">Nombre del trabajador</th>
                        <th rowspan="2">Fecha de ingreso</th>
                        <th rowspan="2">Puesto</th>
                        ${DIAS.map((dia) => `<th class="la-th-dia">${dia}</th>`).join('')}
                        <th rowspan="2" class="la-th-dia">Horas trabajadas</th>
                    </tr>
                    <tr>
                        ${d.dias.map((fecha) => `<th class="la-th-fecha">${fechaCorta(fecha)}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>${cuerpo || `<tr><td colspan="${columnas}" class="la-vacia">No hay trabajadores en esta sucursal en la semana elegida.</td></tr>`}</tbody>
            </table>

            <div class="la-final">
                <div class="la-leyenda">
                    <span class="la-chip la-dia--asistencia">8:00am 6:00pm · Asistió</span>
                    <span class="la-chip la-dia--retardo"><span class="la-hora--roja">En ámbar: llegó tarde o salió antes</span></span>
                    <span class="la-chip la-dia--falta">Falta</span>
                    <span class="la-chip la-dia--incapacidad">Incapacidad</span>
                    <span class="la-chip la-dia--sinalta">Sin alta del seguro</span>
                    <span class="la-chip la-dia--vacaciones">Vacaciones</span>
                    <span class="la-chip la-dia--permiso">Permiso</span>
                    <span class="la-chip la-dia--descanso">Descanso / feriado</span>
                </div>
                ${enBlanco ? '' : `<div class="la-avisos">
                    <h3>Para atender esta semana</h3>
                    ${d.avisos.length
                        ? `<ul>${d.avisos.map((a) => `<li class="la-aviso--${a.tipo}">${escaparHtml(a.texto)}</li>`).join('')}</ul>`
                        : '<p>Sin pendientes: nadie acumula faltas ni retardos, ni le falta el alta del seguro.</p>'}
                </div>`}
            </div>

            <footer class="la-firmas">
                <div><span>${escaparHtml(USUARIO_ACTUAL.nombre)}</span><small>Elaboró · ${escaparHtml(ROLES[USUARIO_ACTUAL.rol].nombre)}</small></div>
                <div><span>&nbsp;</span><small>Revisó · Recursos Humanos</small></div>
                <p>Folio LA-${suc}-${aISO(d.lunes)} · Generada el ${generada} por ${escaparHtml(USUARIO_ACTUAL.usuario)} · Distribuidora El Nevado</p>
            </footer>
        </article>`;
    }

    // =====================================================================
    //  EXCEL: la misma hoja, con el formato de la plantilla (colores, bordes y celdas combinadas)
    // =====================================================================
    // La tabla, con los colores de la plantilla (azul marino, rojo y gris); lo que pasó cada día,
    // con los colores del sistema (los de main.css), en el formato de Excel
    const COLOR = {
        azul: 'FF1F3864', dias: 'FFC00000', fechas: 'FFD9D9D9', textoFechas: 'FF000000', grisClaro: 'FFF2F2F2',
        blanco: 'FFFFFFFF', linea: 'FF000000', nombre: 'FF000000', ingreso: 'FF0070C0',
        asistencia: 'FF15803D', retardo: 'FFB45309', fondoRetardo: 'FFFEF3C7'
    };
    // Cada motivo: color de letra y de fondo (colores del sistema)
    const ESTILO_MOTIVO = {
        falta: { letra: 'FFB91C1C', fondo: 'FFFEE2E2' },
        incapacidad: { letra: 'FFBE185D', fondo: 'FFFCE7F3' },
        sinalta: { letra: 'FF991B1B', fondo: 'FFFEE2E2' },
        vacaciones: { letra: 'FF6D28D9', fondo: 'FFEDE9FE' },
        permiso: { letra: 'FF1D4ED8', fondo: 'FFDBEAFE' },
        descanso: { letra: 'FF64748B', fondo: 'FFF1F5F9' },
        fuera: { letra: 'FF64748B', fondo: 'FFF1F5F9' }
    };

    // Arma el libro. Recibe la librería ExcelJS, los datos de calcular() y, si hay, el logo en base64 (PNG)
    function libroExcel(ExcelJS, d, logoBase64) {
        const enBlanco = d.modo === 'blanco';
        const libro = new ExcelJS.Workbook();
        libro.creator = 'Distribuidora El Nevado';
        const hoja = libro.addWorksheet('Lista de asistencia', {
            views: [{ showGridLines: false, state: 'frozen', ySplit: 5 }],
            pageSetup: { orientation: 'landscape', paperSize: 1, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:5',
                margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }
        });
        const ULTIMA = 4 + DIAS.length + 1; // columna de "Horas trabajadas"
        hoja.columns = [{ width: 4 }, { width: 36 }, { width: 11 }, { width: 13 }, ...DIAS.map(() => ({ width: 13.5 })), { width: 18 }];

        const borde = (color = COLOR.linea, estilo = 'thin') => ({ style: estilo, color: { argb: color } });
        const todosLosBordes = { top: borde(), left: borde(), bottom: borde(), right: borde() };
        const relleno = (color) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: color } });
        const centrado = { horizontal: 'center', vertical: 'middle', wrapText: true };
        // Aplica el estilo a todas las celdas de un rango (también a las combinadas, para que salgan sus bordes)
        const pintar = (fila, desde, hasta, estilo) => {
            for (let col = desde; col <= hasta; col++) Object.assign(hoja.getCell(fila, col), estilo);
        };

        // ---- Filas 1 y 2: título, sucursal y semana ----
        const titulo = { font: { name: 'Cambria', size: 13, bold: true, color: { argb: COLOR.blanco } }, fill: relleno(COLOR.azul), alignment: centrado, border: todosLosBordes };
        [1, 2].forEach((fila) => { pintar(fila, 1, ULTIMA, titulo); hoja.getRow(fila).height = 24; });
        hoja.mergeCells(1, 1, 1, 4);
        hoja.mergeCells(2, 1, 2, 4);
        hoja.mergeCells(1, 5, 1, ULTIMA);
        hoja.mergeCells(2, 5, 2, ULTIMA);
        hoja.getCell(1, 1).value = 'LISTA  DE  ASISTENCIA';
        hoja.getCell(2, 1).value = 'SEMANA DEL:';
        hoja.getCell(1, 5).value = SUCURSALES[d.suc] || '';
        hoja.getCell(2, 5).value = textoSemana(d.lunes);
        if (logoBase64) {
            const imagen = libro.addImage({ base64: logoBase64, extension: 'png' });
            hoja.addImage(imagen, { tl: { col: 0.15, row: 0.1 }, ext: { width: 62, height: 56 } });
        }
        hoja.getRow(3).height = 5;

        // ---- Filas 4 y 5: encabezados de la tabla ----
        const encabezadoAzul = { font: { name: 'Arial', size: 10, bold: true, color: { argb: COLOR.blanco } }, fill: relleno(COLOR.azul), alignment: centrado, border: todosLosBordes };
        const encabezadoRojo = { ...encabezadoAzul, fill: relleno(COLOR.dias) }; // días y "Horas trabajadas"
        const encabezadoFecha = { font: { name: 'Arial', size: 9, bold: true, color: { argb: COLOR.textoFechas } }, fill: relleno(COLOR.fechas), alignment: centrado, border: todosLosBordes };
        [4, 5].forEach((fila) => { pintar(fila, 1, 4, encabezadoAzul); hoja.getRow(fila).height = 18; });
        pintar(4, 5, ULTIMA, encabezadoRojo);
        pintar(5, 5, ULTIMA - 1, encabezadoFecha);
        pintar(5, ULTIMA, ULTIMA, encabezadoRojo);
        hoja.mergeCells(4, 1, 5, 2);
        hoja.mergeCells(4, 3, 5, 3);
        hoja.mergeCells(4, 4, 5, 4);
        hoja.mergeCells(4, ULTIMA, 5, ULTIMA);
        hoja.getCell(4, 1).value = 'NOMBRE DEL TRABAJADOR';
        hoja.getCell(4, 3).value = 'FECHA DE INGRESO';
        hoja.getCell(4, 3).font = { ...encabezadoAzul.font, size: 8 };
        hoja.getCell(4, 4).value = 'PUESTO';
        hoja.getCell(4, ULTIMA).value = 'HORAS TRABAJADAS';
        d.dias.forEach((fecha, i) => {
            hoja.getCell(4, 5 + i).value = DIAS[i];
            hoja.getCell(5, 5 + i).value = fechaCorta(fecha);
        });

        // ---- Trabajadores, agrupados por departamento ----
        const letra = (extra = {}) => ({ name: 'Arial', size: 9, ...extra });
        let fila = 6;
        let numero = 0;
        d.grupos.forEach((grupo) => {
            pintar(fila, 1, 4, { font: letra({ bold: true, color: { argb: COLOR.blanco } }), fill: relleno(COLOR.dias), alignment: centrado, border: todosLosBordes });
            pintar(fila, 5, ULTIMA, { fill: relleno(COLOR.grisClaro), border: todosLosBordes });
            hoja.mergeCells(fila, 1, fila, 4);
            hoja.getCell(fila, 1).value = grupo.depto.toUpperCase();
            hoja.getRow(fila).height = 15;
            fila++;

            grupo.filas.forEach((f) => {
                pintar(fila, 1, ULTIMA, { font: letra(), alignment: centrado, border: todosLosBordes });
                hoja.getRow(fila).height = 27;
                Object.assign(hoja.getCell(fila, 1), { value: ++numero, font: letra({ size: 7, bold: true }) });
                Object.assign(hoja.getCell(fila, 2), { value: f.emp.nombre.toUpperCase(), font: letra({ bold: true, color: { argb: COLOR.nombre } }), alignment: { horizontal: 'left', vertical: 'middle', wrapText: true } });
                Object.assign(hoja.getCell(fila, 3), { value: fechaIngreso(f.emp.ingreso), font: letra({ size: 8, bold: true, color: { argb: COLOR.ingreso } }) });
                Object.assign(hoja.getCell(fila, 4), { value: f.emp.puesto.toUpperCase(), font: letra({ size: 7, bold: true, color: { argb: COLOR.azul } }) });

                f.celdas.forEach((c, i) => {
                    const celda = hoja.getCell(fila, 5 + i);
                    if (c.tipo === 'pendiente') return;
                    if (c.tipo === 'asistencia' || c.tipo === 'retardo') {
                        // Verde: asistió. Ámbar: la hora que se sale del horario (llegó tarde o salió antes)
                        const hora = (texto, fuera) => ({ text: texto, font: letra({ size: 8, bold: true, color: { argb: fuera ? COLOR.retardo : COLOR.asistencia } }) });
                        if (c.tipo === 'retardo') celda.fill = relleno(COLOR.fondoRetardo);
                        const detalle = [c.extras ? `+${c.extras} h extra` : '', c.nota].filter(Boolean).join(' · ');
                        celda.value = { richText: [
                            hora(c.entrada, c.entradaTarde), hora('  ', false), hora(c.salida, c.salidaTemprana),
                            ...(detalle ? [{ text: `\n${detalle}`, font: letra({ size: 6, color: { argb: 'FF595959' } }) }] : [])
                        ] };
                        return;
                    }
                    const estilo = ESTILO_MOTIVO[c.tipo] || {};
                    celda.value = c.texto + (c.nota && c.tipo !== 'sinalta' ? `\n${c.nota}` : '');
                    celda.font = letra({ size: 8, bold: true, color: { argb: estilo.letra || COLOR.nombre } });
                    if (estilo.fondo) celda.fill = relleno(estilo.fondo);
                });

                Object.assign(hoja.getCell(fila, ULTIMA), { value: enBlanco ? '' : textoHoras(f.minutos), font: letra({ bold: true }) });
                fila++;
            });
        });
        if (!d.filas.length) {
            hoja.mergeCells(fila, 1, fila, ULTIMA);
            Object.assign(hoja.getCell(fila, 1), { value: 'No hay trabajadores en esta sucursal en la semana elegida.', font: letra({ italic: true }), alignment: centrado });
            fila++;
        }

        // Marco grueso alrededor de la tabla, como en la plantilla
        const grueso = borde(COLOR.linea, 'medium');
        for (let r = 4; r < fila; r++) {
            hoja.getCell(r, 1).border = { ...hoja.getCell(r, 1).border, left: grueso };
            hoja.getCell(r, ULTIMA).border = { ...hoja.getCell(r, ULTIMA).border, right: grueso };
        }
        for (let col = 1; col <= ULTIMA; col++) {
            hoja.getCell(4, col).border = { ...hoja.getCell(4, col).border, top: grueso };
            hoja.getCell(fila - 1, col).border = { ...hoja.getCell(fila - 1, col).border, bottom: grueso };
        }
        return libro;
    }

    // ExcelJS se descarga solo cuando se pide el Excel (no hace más lenta la página)
    const URL_EXCELJS = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
    function cargarExcelJS() {
        if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
        return new Promise((resolver, rechazar) => {
            const script = document.createElement('script');
            script.src = URL_EXCELJS;
            script.onload = () => (window.ExcelJS ? resolver(window.ExcelJS) : rechazar(new Error('ExcelJS no cargó')));
            script.onerror = () => { script.remove(); rechazar(new Error('Sin conexión')); };
            document.head.appendChild(script);
        });
    }

    // El logo, solo si de verdad es una imagen PNG (un archivo dañado echaría a perder el Excel)
    async function logoEnBase64() {
        try {
            const bytes = new Uint8Array(await (await fetch('recursos/logo.png')).arrayBuffer());
            const esPng = bytes.length > 200 && [0x89, 0x50, 0x4e, 0x47].every((b, i) => bytes[i] === b);
            if (!esPng) return null;
            let binario = '';
            bytes.forEach((b) => { binario += String.fromCharCode(b); });
            return btoa(binario);
        } catch (error) {
            return null;
        }
    }

    async function descargarEnExcel(suc, lunes, modo) {
        const ExcelJS = await cargarExcelJS();
        const libro = libroExcel(ExcelJS, calcular(suc, lunes, modo), await logoEnBase64());
        const contenido = await libro.xlsx.writeBuffer();
        const enlace = document.createElement('a');
        enlace.href = URL.createObjectURL(new Blob([contenido], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        enlace.download = `Lista de asistencia ${suc} ${SUCURSALES[suc] || ''} - semana ${aISO(lunes)}${modo === 'blanco' ? ' (en blanco)' : ''}.xlsx`;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        setTimeout(() => URL.revokeObjectURL(enlace.href), 60000);
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

    // ---------- Ventana para elegir la semana, ver la hoja y generar el PDF o el Excel ----------
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

        const botonExcel = document.getElementById('listaExcel');
        const avisoExcel = document.getElementById('listaAviso');
        botonExcel.addEventListener('click', async () => {
            if (botonExcel.disabled) return;
            const texto = botonExcel.textContent;
            botonExcel.disabled = true;
            botonExcel.textContent = 'Generando Excel…';
            avisoExcel.textContent = '';
            try {
                await descargarEnExcel(suc, fechaDesdeISO(semana.value), modo());
                registrarBitacora('Lista de asistencia generada', `${nombreSucursal(suc)} · semana del ${semana.value} · Excel${modo() === 'blanco' ? ' en blanco' : ''}`);
            } catch (error) {
                avisoExcel.textContent = '⚠️ No se pudo generar el Excel: se necesita conexión a internet. Mientras tanto usa "Generar PDF".';
            } finally {
                botonExcel.disabled = false;
                botonExcel.textContent = texto;
            }
        });
    }

    iniciar();
    return { html, calcular, textoSemana, lunesDe, libroExcel };
})();
