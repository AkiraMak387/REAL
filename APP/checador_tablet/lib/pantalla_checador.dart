import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:camera/camera.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import 'ajustes.dart';
import 'api.dart';
import 'colores.dart';
import 'pantalla_ajustes.dart';
import 'rostros.dart';


/// Estados de la pantalla:
///   esperando  → cámara activa, buscando un rostro
///   procesando → se envió una foto al servidor y se espera respuesta
///   exito      → empleado reconocido y registro guardado
///   error      → no reconocido / no es persona real / duplicado / sin conexión
enum Pantalla { esperando, procesando, exito, error }

class PantallaChecador extends StatefulWidget {
  const PantallaChecador({super.key});

  @override
  State<PantallaChecador> createState() => _PantallaChecadorState();
}

class _PantallaChecadorState extends State<PantallaChecador>
    with WidgetsBindingObserver, SingleTickerProviderStateMixin {
  Ajustes? _ajustes;
  ApiCliente? _api;
  ConfigServidor _cfg = const ConfigServidor();
  final _rostros = Rostros(); // vectores de rostro de la bodega, leídos de Firestore

  // Cámara
  CameraController? _camara;
  String? _errorCamara;
  bool _iniciandoCamara = false;

  // Estado del checador
  Pantalla _pantalla = Pantalla.esperando;
  String _tipo = 'entrada';
  bool _tipoManual = false;
  Timer? _temporizadorManual;
  bool _enviando = false;
  int _fallosSeguidos = 0;

  // Textos variables
  String? _pastillaExtra;
  String? _tituloEspera;
  String? _detalleEspera;
  Map<String, dynamic>? _respuestaExito;
  String _errorTitulo = '';
  String _errorDetalle = '';

  // Reloj y temporizadores
  DateTime _ahora = DateTime.now();
  Timer? _reloj;
  Timer? _ciclo;
  Timer? _temporizadorPantalla;
  late final AnimationController _escaneo;

  // =========================================================
  // Ciclo de vida
  // =========================================================
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _escaneo = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200));
    _iniciar();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _reloj?.cancel();
    _ciclo?.cancel();
    _temporizadorPantalla?.cancel();
    _temporizadorManual?.cancel();
    _escaneo.dispose();
    _camara?.dispose();
    _rostros.detener();
    super.dispose();
  }

  /// Si la tablet se bloquea o cambia de app, se libera la cámara y se reabre al volver.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      final c = _camara;
      if (c != null) {
        setState(() => _camara = null);
        c.dispose();
      }
    } else if (state == AppLifecycleState.resumed) {
      if (_camara == null) _iniciarCamara();
      _cargarConfig();
    }
  }

  Future<void> _iniciar() async {
    _ajustes = await Ajustes.cargar();
    _rostros.escuchar(_ajustes!.bodega);
    _api = ApiCliente(_ajustes!.servidor);
    await _cargarConfig();
    _reloj = Timer.periodic(const Duration(seconds: 1), (_) => _tic());
    _tic();
    await _iniciarCamara();
    _ciclo = Timer.periodic(Ajustes.intervaloCaptura, (_) => _cicloCaptura());
  }

  Future<void> _cargarConfig() async {
    final api = _api;
    if (api == null) return;
    try {
      final cfg = await api.obtenerConfig();
      if (mounted) setState(() => _cfg = cfg);
    } catch (e) {
      debugPrint('No se pudo leer la configuración del servidor: $e');
    }
  }

  // =========================================================
  // Reloj y Entrada / Salida automática
  // =========================================================
  void _tic() {
    if (!mounted) return;
    setState(() {
      _ahora = DateTime.now();
      if (!_tipoManual) _tipo = _cfg.horario.tipoAutomatico(_ahora);
    });
  }

  void _elegirTipoManual(String tipo) {
    if (!_cfg.permitirCambioManual) return;
    _temporizadorManual?.cancel();
    setState(() {
      _tipoManual = true;
      _tipo = tipo;
    });
    _temporizadorManual = Timer(Ajustes.regresoAutomatico, _volverTipoAutomatico);
    if (_pantalla == Pantalla.exito || _pantalla == Pantalla.error) _mostrar(Pantalla.esperando);
  }

  void _volverTipoAutomatico() {
    _temporizadorManual?.cancel();
    _tipoManual = false;
    _tic();
  }

  // =========================================================
  // Cámara
  // =========================================================
  Future<void> _iniciarCamara() async {
    if (_iniciandoCamara) return;
    _iniciandoCamara = true;
    if (mounted) setState(() => _errorCamara = null);
    try {
      final camaras = await availableCameras();
      if (camaras.isEmpty) {
        throw CameraException('NoCamera', 'No se encontró ninguna cámara.');
      }
      final frontal = camaras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => camaras.first,
      );
      final controlador = CameraController(
        frontal,
        ResolutionPreset.medium, // 480p: suficiente para reconocer; se envía y se procesa más rápido
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.jpeg,
      );
      await controlador.initialize();
      try {
        await controlador.setFlashMode(FlashMode.off);
      } catch (_) {/* la cámara frontal puede no tener flash */}

      if (!mounted) {
        await controlador.dispose();
        return;
      }
      setState(() => _camara = controlador);
    } on CameraException catch (e) {
      if (mounted) setState(() => _errorCamara = _mensajeErrorCamara(e));
    } catch (e) {
      if (mounted) setState(() => _errorCamara = 'No se pudo abrir la cámara.\n$e');
    } finally {
      _iniciandoCamara = false;
    }
  }

  String _mensajeErrorCamara(CameraException e) {
    switch (e.code) {
      case 'CameraAccessDenied':
      case 'CameraAccessDeniedWithoutPrompt':
      case 'CameraAccessRestricted':
        return 'Se negó el permiso de la cámara.\nActívalo en Ajustes → Aplicaciones → Checador → Permisos.';
      case 'NoCamera':
        return 'No se encontró ninguna cámara.';
      default:
        return e.description ?? 'No se pudo abrir la cámara (${e.code}).';
    }
  }

  /// Toma una foto y la devuelve en base64 (o null si falló).
  Future<String?> _capturar(CameraController c) async {
    try {
      final foto = await c.takePicture();
      final bytes = await foto.readAsBytes();
      File(foto.path).delete().ignore(); // no guardar fotos en la tablet
      return base64Encode(bytes);
    } catch (e) {
      debugPrint('Error al tomar la foto: $e');
      return null;
    }
  }

  // =========================================================
  // Ciclo de captura y reconocimiento
  // =========================================================
  Future<void> _cicloCaptura() async {
    final c = _camara;
    final api = _api;
    final ajustes = _ajustes;
    if (_pantalla != Pantalla.esperando ||
        _enviando ||
        api == null ||
        ajustes == null ||
        c == null ||
        !c.value.isInitialized ||
        c.value.isTakingPicture) {
      return;
    }

    _enviando = true;
    // Solo mostramos "Verificando…" si el servidor tarda; así no parpadea cuando no hay nadie
    final avisoLento = Timer(const Duration(milliseconds: 400), () {
      if (_enviando && _pantalla == Pantalla.esperando) _mostrar(Pantalla.procesando);
    });

    try {
      final imagen = await _capturar(c);
      if (imagen == null) {
        if (_pantalla == Pantalla.procesando) _mostrar(Pantalla.esperando);
        return;
      }
      final resp = await api.identificar(imagenBase64: imagen, existentes: _rostros.existentes);
      if (mounted) _procesarRespuesta(_armarChecada(resp));
    } catch (e) {
      debugPrint('Error de conexión: $e');
      _mostrarError(
        'Sin conexión con el servidor',
        'No se pudo registrar: $e',
        pastilla: 'Error de conexión',
      );
    } finally {
      avisoLento.cancel();
      _enviando = false;
    }
  }

  /// El servidor solo dice de quién es el rostro; aquí se arma la checada con los datos
  /// del trabajador que ya se leyeron de Firestore.
  Map<String, dynamic> _armarChecada(Map<String, dynamic> resp) {
    if (resp['resultado'] != 'reconocido') return resp;
    final t = _rostros.porId('${resp['id']}');
    if (t == null) return {'resultado': 'no_reconocido'};

    final ahora = DateTime.now();
    final hoy = '${ahora.year}-${_dos(ahora.month)}-${_dos(ahora.day)}';
    // Puede haber varias entradas y salidas el mismo día (permisos para salir y regresar).
    // Lo que no se permite es repetir el mismo tipo dos veces seguidas.
    final deHoy = t.checadas.where((c) => c['fecha'] == hoy).toList()
      ..sort((a, b) => '${a['momento']}'.compareTo('${b['momento']}'));
    if (deHoy.isNotEmpty && deHoy.last['tipo'] == _tipo) {
      return {
        'resultado': 'duplicado',
        'mensaje': '${t.nombre.split(' ').first}, tu último registro de hoy ya es una $_tipo (${deHoy.last['hora']}). '
            'Toca "${_tipo == 'entrada' ? 'Salida' : 'Entrada'}" si es lo que quieres registrar.',
      };
    }

    // ponytail: la insignia usa el horario fijo de api.dart (no distingue la salida del sábado);
    // el sistema web calcula retardos y horas por su cuenta con la hora guardada.
    final h = _cfg.horario;
    final minutos = ahora.hour * 60 + ahora.minute;
    var estatus = 'a_tiempo';
    var retardo = 0;
    if (_tipo == 'entrada') {
      retardo = minutos - Horario.aMinutos(h.entrada);
      if (retardo > h.toleranciaMin) estatus = 'retardo';
    } else if (minutos < Horario.aMinutos(h.salida)) {
      estatus = 'salida_anticipada';
    }
    return {
      'resultado': 'registrado',
      'empleado': {'nombre': t.nombre, 'numero_empleado': t.id, 'departamento': t.depto},
      'registro': {
        'tipo': _tipo,
        'fecha_hora': ahora.toIso8601String(),
        'estatus': estatus,
        'minutos_retardo': estatus == 'retardo' ? retardo : 0,
      },
    };
  }

  void _procesarRespuesta(Map<String, dynamic> resp) {
    final mensaje = resp['mensaje'] as String?;
    switch (resp['resultado']) {
      case 'registrado':
        _fallosSeguidos = 0;
        _respuestaExito = resp;
        _guardarEnFirestore(resp);
        _mostrar(Pantalla.exito);
        SystemSound.play(SystemSoundType.click);
        HapticFeedback.mediumImpact();

      case 'sin_rostro':
        _mostrar(Pantalla.esperando);

      case 'no_reconocido':
        _fallosSeguidos++;
        if (_fallosSeguidos >= Ajustes.intentosAntesDeError) {
          _fallosSeguidos = 0;
          _mostrarError('Rostro no reconocido', mensaje ?? 'Ajusta la iluminación o vuelve a intentarlo.');
        } else {
          _mostrar(Pantalla.esperando,
              titulo: 'Casi listo…', detalle: 'Mira de frente a la cámara, sin moverte.');
        }

      case 'no_vivo':
        _fallosSeguidos = 0;
        _mostrarError('Verificación fallida', mensaje ?? 'Debes estar frente a la cámara en persona.',
            pastilla: 'No válido');

      case 'duplicado':
        _fallosSeguidos = 0;
        _mostrarError('Registro duplicado', mensaje ?? 'Ya registraste tu $_tipo hace unos minutos.',
            pastilla: 'Ya registrado');

      default:
        _mostrarError('Error inesperado', mensaje ?? 'Vuelve a intentarlo.');
    }
  }

  // =========================================================
  // Firestore: la checada se agrega al trabajador, en el formato que lee el sistema web
  //   bodegas/{bodega}/empleados/{id de 8 dígitos} → campo "checadas"
  // =========================================================
  void _guardarEnFirestore(Map<String, dynamic> resp) {
    final empleado = (resp['empleado'] as Map?) ?? const {};
    final registro = (resp['registro'] as Map?) ?? const {};
    final id = '${empleado['numero_empleado'] ?? ''}';
    final bodega = _ajustes?.bodega ?? Ajustes.bodegaPorDefecto;
    final t = DateTime.tryParse('${registro['fecha_hora'] ?? ''}')?.toLocal() ?? DateTime.now();

    if (id.isEmpty) {
      _mostrarError('No se guardó la checada', 'El servidor no envió el número de empleado.');
      return;
    }
    // Sin "await": sin internet, Firestore la guarda en la tablet y la envía sola al volver la conexión
    FirebaseFirestore.instance.collection('bodegas').doc(bodega).collection('empleados').doc(id).update({
      'checadas': FieldValue.arrayUnion([
        {
          'fecha': '${t.year}-${_dos(t.month)}-${_dos(t.day)}',
          'tipo': '${registro['tipo'] ?? _tipo}',
          'hora': '${_dos(t.hour)}:${_dos(t.minute)}',
          'momento': t.toUtc().toIso8601String(),
          'origen': 'tableta',
          'bodega': bodega,
        }
      ]),
    }).catchError((Object e) {
      // Lo más común: no existe el trabajador con ese ID en esa bodega, o las reglas no dan permiso
      debugPrint('No se guardó en Firestore: $e');
      _mostrarError('No se guardó la checada', 'No existe el empleado $id en la bodega $bodega. Avisa al administrador.');
    });
  }

  // =========================================================
  // Cambio de pantalla
  // =========================================================
  void _mostrar(Pantalla p, {String? pastilla, String? titulo, String? detalle}) {
    if (!mounted) return;
    _temporizadorPantalla?.cancel();
    setState(() {
      _pantalla = p;
      _pastillaExtra = pastilla;
      _tituloEspera = titulo;
      _detalleEspera = detalle;
    });

    if (p == Pantalla.procesando) {
      _escaneo.repeat(reverse: true);
    } else {
      _escaneo.stop();
    }

    if (p == Pantalla.exito) {
      _temporizadorPantalla = Timer(Ajustes.duracionExito, () {
        _volverTipoAutomatico();
        _mostrar(Pantalla.esperando);
      });
    } else if (p == Pantalla.error) {
      _temporizadorPantalla = Timer(Ajustes.duracionError, () => _mostrar(Pantalla.esperando));
    }
  }

  void _mostrarError(String titulo, String detalle, {String? pastilla}) {
    _errorTitulo = titulo;
    _errorDetalle = detalle;
    _mostrar(Pantalla.error, pastilla: pastilla);
    HapticFeedback.heavyImpact();
  }

  // =========================================================
  // Ajustes (mantener presionado el logo)
  // =========================================================
  Future<void> _abrirAjustes() async {
    final ajustes = _ajustes;
    if (ajustes == null) return;
    final pinCorrecto = await _pedirPin();
    if (pinCorrecto != true || !mounted) return;

    final cambio = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => PantallaAjustes(ajustes: ajustes)),
    );
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    if (cambio == true) {
      _api = ApiCliente(ajustes.servidor);
      _rostros.escuchar(ajustes.bodega); // por si cambió la bodega
      await _cargarConfig();
      _tic();
      _mostrar(Pantalla.esperando);
    }
  }

  Future<bool?> _pedirPin() {
    final controlador = TextEditingController();
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Ajustes'),
        content: TextField(
          controller: controlador,
          autofocus: true,
          obscureText: true,
          keyboardType: TextInputType.number,
          maxLength: 8,
          decoration: const InputDecoration(labelText: 'PIN de administrador'),
          onSubmitted: (v) => Navigator.pop(ctx, v == Ajustes.pinAjustes),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controlador.text == Ajustes.pinAjustes),
            child: const Text('Entrar'),
          ),
        ],
      ),
    );
  }

  // =========================================================
  // Formato de textos
  // =========================================================
  static String _dos(int n) => n.toString().padLeft(2, '0');

  String get _horaTexto {
    final h = _ahora.hour;
    final h12 = h % 12 == 0 ? 12 : h % 12;
    return '${_dos(h12)}:${_dos(_ahora.minute)} ${h >= 12 ? 'PM' : 'AM'}';
  }

  String get _fechaTexto {
    final f = DateFormat("EEEE, d 'de' MMMM 'de' y", 'es_MX').format(_ahora);
    return f[0].toUpperCase() + f.substring(1);
  }

  static String _duracion(int min) {
    if (min < 60) return '$min min';
    final h = min ~/ 60;
    final m = min % 60;
    return m == 0 ? '$h h' : '$h h $m min';
  }

  String get _textoPastilla {
    if (_pastillaExtra != null) return _pastillaExtra!;
    switch (_pantalla) {
      case Pantalla.esperando:
        return 'Buscando rostro…';
      case Pantalla.procesando:
        return 'Verificando identidad…';
      case Pantalla.exito:
        return 'Rostro validado';
      case Pantalla.error:
        return 'No reconocido';
    }
  }

  Color get _colorMarco {
    switch (_pantalla) {
      case Pantalla.esperando:
        return Colors.white;
      case Pantalla.procesando:
        return Colores.azulEscaneo;
      case Pantalla.exito:
        return Colores.verde;
      case Pantalla.error:
        return Colores.rojo;
    }
  }

  // =========================================================
  // Interfaz
  // =========================================================
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(40, 32, 40, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_cfg.modoDemo) _etiquetaDemo(),
              _encabezado(),
              const SizedBox(height: 24),
              _selector(),
              const SizedBox(height: 24),
              Expanded(child: _tarjetaCamara()),
              const SizedBox(height: 20),
              _relojWidget(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _etiquetaDemo() => Align(
        child: Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(color: const Color(0xFFFEF3C7), borderRadius: BorderRadius.circular(999)),
          child: const Text('MODO DEMO · reconocimiento simulado',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF92400E), letterSpacing: .6)),
        ),
      );

  Widget _encabezado() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('RECONOCIMIENTO FACIAL',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: 1.5, color: Colores.texto3)),
              SizedBox(height: 10),
              Text('Registra tu asistencia',
                  style: TextStyle(fontSize: 40, height: 1.1, fontWeight: FontWeight.w800, letterSpacing: -0.8, color: Colores.texto)),
              SizedBox(height: 10),
              Text('Mira al frente y mantén tu rostro dentro del marco. El sistema detectará tu identidad automáticamente.',
                  style: TextStyle(fontSize: 18, height: 1.45, color: Colores.texto2)),
            ],
          ),
        ),
        const SizedBox(width: 24),
        // Mantener presionado el logo → Ajustes (con PIN)
        GestureDetector(
          onLongPress: _abrirAjustes,
          child: Image.asset('assets/logo.png', width: 132, fit: BoxFit.contain),
        ),
      ],
    );
  }

  Widget _selector() {
    final h = _cfg.horario;
    return Row(
      children: [
        Expanded(child: _botonTipo('Entrada', h.textoEntrada, _tipo == 'entrada', () => _elegirTipoManual('entrada'))),
        const SizedBox(width: 16),
        Expanded(child: _botonTipo('Salida', h.textoSalida, _tipo == 'salida', () => _elegirTipoManual('salida'))),
      ],
    );
  }

  Widget _botonTipo(String titulo, String detalle, bool activo, VoidCallback alTocar) {
    return Material(
      color: activo ? Colores.verdeSuave : Colores.superficie,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: activo ? Colores.verde : Colores.borde, width: 2),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: _cfg.permitirCambioManual ? alTocar : null,
        child: SizedBox(
          height: 100,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(titulo,
                  style: TextStyle(
                      fontSize: 26, fontWeight: FontWeight.w800, color: activo ? Colores.verdeOscuro : Colores.botonInactivo)),
              const SizedBox(height: 6),
              Text(detalle,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: Colores.texto2)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _tarjetaCamara() {
    final enVivo = _camara != null && _camara!.value.isInitialized;
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colores.superficie,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colores.borde),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Vista de cámara', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Colores.texto)),
                    SizedBox(height: 2),
                    Text('Posiciona tu rostro dentro del marco', style: TextStyle(fontSize: 15, color: Colores.texto3)),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(color: const Color(0xFFF0F2F6), borderRadius: BorderRadius.circular(999)),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(
                          shape: BoxShape.circle, color: enVivo ? const Color(0xFFD92D3A) : const Color(0xFF9AA1B2)),
                    ),
                    const SizedBox(width: 8),
                    Text(enVivo ? 'En vivo' : (_errorCamara != null ? 'Sin cámara' : 'Conectando…'),
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Colores.botonInactivo)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Expanded(child: _vistaCamara()),
          const SizedBox(height: 16),
          _aviso(),
        ],
      ),
    );
  }

  Widget _vistaCamara() {
    final c = _camara;
    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: Stack(
        fit: StackFit.expand,
        children: [
          const ColoredBox(color: Colores.camaraFondo),
          if (c != null && c.value.isInitialized)
            FittedBox(
              fit: BoxFit.cover,
              child: SizedBox(
                // previewSize viene en horizontal; en vertical se invierte
                width: c.value.previewSize!.height,
                height: c.value.previewSize!.width,
                child: CameraPreview(c),
              ),
            ),
          AnimatedBuilder(
            animation: _escaneo,
            builder: (_, __) => CustomPaint(
              painter: _MarcoPainter(
                color: _colorMarco,
                escaneo: _pantalla == Pantalla.procesando ? _escaneo.value : null,
              ),
            ),
          ),
          Positioned(
            left: 20,
            bottom: 20,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 12,
                    height: 12,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: _colorMarco,
                      border: _pantalla == Pantalla.esperando ? Border.all(color: const Color(0xFFC9CEDA)) : null,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(_textoPastilla,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Colores.texto)),
                ],
              ),
            ),
          ),
          if (_errorCamara != null)
            Container(
              color: Colores.camaraFondo,
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('No se pudo abrir la cámara.',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Color(0xFFE7EAF1))),
                  const SizedBox(height: 6),
                  Text(_errorCamara!,
                      textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: Color(0xFFE7EAF1))),
                  const SizedBox(height: 16),
                  FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Colores.texto),
                    onPressed: _iniciarCamara,
                    child: const Text('Reintentar'),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _aviso() {
    switch (_pantalla) {
      case Pantalla.esperando:
      case Pantalla.procesando:
        final procesando = _pantalla == Pantalla.procesando;
        return _cajaAviso(
          fondo: Colores.azulSuave,
          borde: Colores.azulBorde,
          icono: Icons.center_focus_weak_rounded,
          colorIcono: Colores.azul,
          etiqueta: null,
          titulo: _tituloEspera ?? (procesando ? 'Verificando identidad…' : 'Buscando rostro…'),
          colorTitulo: Colores.azul,
          detalle: _detalleEspera ??
              (procesando ? 'Un momento, por favor.' : 'Acércate a la cámara y mantente quieto un momento.'),
          colorDetalle: Colores.texto2,
        );

      case Pantalla.exito:
        return _avisoExito();

      case Pantalla.error:
        return _cajaAviso(
          fondo: Colores.rojoSuave,
          borde: Colores.rojoBorde,
          icono: Icons.error_outline_rounded,
          colorIcono: Colores.rojoOscuro,
          etiqueta: 'ERROR',
          titulo: _errorTitulo,
          colorTitulo: Colores.rojoTexto,
          detalle: _errorDetalle,
          colorDetalle: Colores.rojoDetalle,
          lado: FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Colores.rojoOscuro,
              minimumSize: const Size(0, 48),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: () {
              _fallosSeguidos = 0;
              _mostrar(Pantalla.esperando);
            },
            child: const Text('Reintentar', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          ),
        );
    }
  }

  Widget _avisoExito() {
    final resp = _respuestaExito ?? const <String, dynamic>{};
    final empleado = (resp['empleado'] as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
    final registro = (resp['registro'] as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};

    final esEntrada = registro['tipo'] == 'entrada';
    final nombre = (empleado['nombre'] ?? '') as String;
    final primerNombre = nombre.split(' ').first;
    final fecha = DateTime.tryParse((registro['fecha_hora'] ?? '') as String)?.toLocal() ?? DateTime.now();

    final detalle = [
      if (empleado['numero_empleado'] != null) 'No. empleado ${empleado['numero_empleado']}',
      if (empleado['departamento'] != null) empleado['departamento'] as String,
    ].join(' · ');

    final minutosRetardo = (registro['minutos_retardo'] ?? 0) as int;
    String insignia;
    Color colorInsignia = Colores.verdeOscuro;
    switch (registro['estatus']) {
      case 'a_tiempo':
        insignia = 'A tiempo';
      case 'retardo':
        insignia = minutosRetardo > 0 ? 'Retardo ${_duracion(minutosRetardo)}' : 'Retardo';
        colorInsignia = Colores.naranja;
      case 'salida_anticipada':
        insignia = 'Salida anticipada';
        colorInsignia = Colores.naranja;
      default:
        insignia = esEntrada ? 'Registrado' : 'Buen día';
    }

    return _cajaAviso(
      fondo: Colores.verdeSuave,
      borde: Colores.verdeBorde,
      icono: Icons.check_circle_outline_rounded,
      colorIcono: Colores.verdeOscuro,
      etiqueta: esEntrada ? 'ENTRADA REGISTRADA' : 'SALIDA REGISTRADA',
      titulo: esEntrada ? '¡Hola, $nombre!' : '¡Hasta luego, $primerNombre!',
      colorTitulo: Colores.verdeTexto,
      detalle: detalle,
      colorDetalle: Colores.verdeDetalle,
      lado: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text('${_dos(fecha.hour)}:${_dos(fecha.minute)}',
              style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: Colores.verdeTexto)),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(color: colorInsignia, borderRadius: BorderRadius.circular(999)),
            child: Text(insignia, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Colors.white)),
          ),
        ],
      ),
    );
  }

  Widget _cajaAviso({
    required Color fondo,
    required Color borde,
    required IconData icono,
    required Color colorIcono,
    required String? etiqueta,
    required String titulo,
    required Color colorTitulo,
    required String detalle,
    required Color colorDetalle,
    Widget? lado,
  }) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 250),
      child: Container(
        key: ValueKey('$etiqueta$titulo'),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
        decoration: BoxDecoration(
          color: fondo,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: borde),
        ),
        child: Row(
          children: [
            Icon(icono, size: 34, color: colorIcono),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (etiqueta != null)
                    Text(etiqueta,
                        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: 1.3, color: colorIcono)),
                  Text(titulo, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: colorTitulo)),
                  if (detalle.isNotEmpty) Text(detalle, style: TextStyle(fontSize: 15, color: colorDetalle)),
                ],
              ),
            ),
            if (lado != null) ...[const SizedBox(width: 12), lado],
          ],
        ),
      ),
    );
  }

  Widget _relojWidget() {
    return Column(
      children: [
        Text(
          _horaTexto,
          style: const TextStyle(
            fontSize: 76,
            height: 1,
            fontWeight: FontWeight.w800,
            letterSpacing: -1.5,
            color: Colores.azul,
            fontFeatures: [FontFeature.tabularFigures()],
          ),
        ),
        const SizedBox(height: 4),
        Text(_fechaTexto, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: Colores.texto2)),
      ],
    );
  }
}

/// Dibuja el marco del rostro, oscurece lo de afuera y la línea de escaneo.
class _MarcoPainter extends CustomPainter {
  final Color color;
  final double? escaneo; // 0..1 mientras se verifica; null = sin línea

  _MarcoPainter({required this.color, this.escaneo});

  @override
  void paint(Canvas canvas, Size size) {
    var ancho = math.min(300.0, size.width * 0.44);
    var alto = ancho * 340 / 300;
    if (alto > size.height * 0.8) {
      alto = size.height * 0.8;
      ancho = alto * 300 / 340;
    }
    final centro = Offset(size.width / 2, size.height / 2 - size.height * 0.04);
    final marco = RRect.fromRectAndRadius(
      Rect.fromCenter(center: centro, width: ancho, height: alto),
      const Radius.circular(28),
    );

    // Oscurecer fuera del marco
    final fuera = Path.combine(
      PathOperation.difference,
      Path()..addRect(Offset.zero & size),
      Path()..addRRect(marco),
    );
    canvas.drawPath(fuera, Paint()..color = const Color(0x470A0E18));

    // Borde del marco
    canvas.drawRRect(
      marco,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..color = color,
    );

    // Línea de escaneo
    final e = escaneo;
    if (e != null) {
      final y = marco.top + 12 + (marco.height - 24) * e;
      final linea = Paint()
        ..color = Colores.azulEscaneo
        ..strokeWidth = 3
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3);
      canvas.drawLine(Offset(marco.left + 8, y), Offset(marco.right - 8, y), linea);
    }
  }

  @override
  bool shouldRepaint(_MarcoPainter old) => old.color != color || old.escaneo != escaneo;
}