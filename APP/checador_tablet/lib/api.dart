import 'dart:convert';

import 'package:http/http.dart' as http;

import 'ajustes.dart';

/// Horario que envía el servidor de Python (backend/app/config.py).
/// Horario que envía el servidor de Python (backend/app/config.py).
class Horario {
  final String entrada;
  final int toleranciaMin;
  final String salida;
  final String inicioEntrada;
  final String cambioASalida;

  const Horario({
    this.entrada = '08:00',
    this.toleranciaMin = 15,
    this.salida = '18:00',
    this.inicioEntrada = '03:00',
    this.cambioASalida = '16:00',
  });

  factory Horario.fromJson(Map<String, dynamic> j) => Horario(
        entrada: (j['entrada'] ?? '08:00') as String,
        toleranciaMin: (j['tolerancia_min'] ?? 15) as int,
        salida: (j['salida'] ?? '18:00') as String,
        inicioEntrada: (j['inicio_entrada'] ?? '03:00') as String,
        cambioASalida: (j['cambio_a_salida'] ?? '16:00') as String,
      );

  static int aMinutos(String hhmm) {
    final partes = hhmm.split(':');
    return int.parse(partes[0]) * 60 + int.parse(partes[1]);
  }

  static String formato12h(String hhmm) {
    final total = aMinutos(hhmm);
    final h = total ~/ 60;
    final m = total % 60;
    final h12 = h % 12 == 0 ? 12 : h % 12;
    return '$h12:${m.toString().padLeft(2, '0')} ${h >= 12 ? 'pm' : 'am'}';
  }

  /// Tipo que se preselecciona según la hora:
  ///   03:00 a 15:59 → entrada
  ///   16:00 a 02:59 → salida
  String tipoAutomatico(DateTime t) {
    final minutos = t.hour * 60 + t.minute;
    final esEntrada = minutos >= aMinutos(inicioEntrada) && minutos < aMinutos(cambioASalida);
    return esEntrada ? 'entrada' : 'salida';
  }

  String get textoEntrada {
    final r = aMinutos(entrada) + toleranciaMin + 1;
    return 'Inicio de turno ${formato12h(entrada)} · retardo ${r ~/ 60}:${(r % 60).toString().padLeft(2, '0')}';
  }

  String get textoSalida => 'Fin de labores ${formato12h(salida)}';
}

class ConfigServidor {
  final bool modoDemo;
  final bool permitirCambioManual;
  final Horario horario;

  const ConfigServidor({
    this.modoDemo = false,
    this.permitirCambioManual = false,
    this.horario = const Horario(),
  });

  factory ConfigServidor.fromJson(Map<String, dynamic> j) => ConfigServidor(
        modoDemo: (j['modo_demo'] ?? false) as bool,
        permitirCambioManual: (j['permitir_cambio_manual'] ?? false) as bool,
        horario: Horario.fromJson((j['horario'] ?? <String, dynamic>{}) as Map<String, dynamic>),
      );
}

/// Comunicación con el servidor de Python (FastAPI).
class ApiCliente {
  final String base;

  ApiCliente(String servidor)
      : base = servidor.trim().endsWith('/')
            ? servidor.trim().substring(0, servidor.trim().length - 1)
            : servidor.trim();

  Future<ConfigServidor> obtenerConfig() async {
    final resp = await http.get(Uri.parse('$base/api/config')).timeout(Ajustes.timeoutApi);
    return ConfigServidor.fromJson(_leer(resp));
  }

  Future<Map<String, dynamic>> registrar({
    required String imagenBase64,
    required String tipo,
    required String dispositivo,
  }) async {
    final resp = await http
        .post(
          Uri.parse('$base/api/checador/registrar'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'imagen': imagenBase64, 'tipo': tipo, 'dispositivo': dispositivo}),
        )
        .timeout(Ajustes.timeoutApi);
    return _leer(resp);
  }

  Map<String, dynamic> _leer(http.Response resp) {
    if (resp.statusCode != 200) {
      throw Exception('Error del servidor (${resp.statusCode})');
    }
    // utf8 para que los acentos (María, Almacén) se vean bien
    return jsonDecode(utf8.decode(resp.bodyBytes)) as Map<String, dynamic>;
  }
}