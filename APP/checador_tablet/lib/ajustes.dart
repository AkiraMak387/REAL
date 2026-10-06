import 'package:shared_preferences/shared_preferences.dart';

/// Ajustes de la tablet. La dirección del servidor se cambia desde la app
/// (mantén presionado el logo 3 segundos y escribe el PIN).
class Ajustes {
  // ---------- Valores fijos ----------
  static const pinAjustes = '2580'; // PIN para entrar a Ajustes (cámbialo)
  static const servidorPorDefecto = 'http://192.168.1.50:8000';
  static const dispositivoPorDefecto = 'tablet-recepcion-01';
  static const bodegaPorDefecto = '01'; // clave de la bodega, igual que en el sistema web

  static const intervaloCaptura = Duration(milliseconds: 1500); // cada cuánto se envía una foto
  static const duracionExito = Duration(milliseconds: 4500);    // tiempo del mensaje verde
  static const duracionError = Duration(milliseconds: 4000);    // tiempo del mensaje rojo
  static const intentosAntesDeError = 2;                        // fallos seguidos antes de "No reconocido"
  static const timeoutApi = Duration(seconds: 8);               // espera máxima al servidor
  static const regresoAutomatico = Duration(seconds: 30);       // si se permite cambio manual

  // ---------- Valores guardados en la tablet ----------
  static const _kServidor = 'servidor';
  static const _kDispositivo = 'dispositivo';
  static const _kBodega = 'bodega';

  String servidor;
  String dispositivo;
  String bodega;

  Ajustes({required this.servidor, required this.dispositivo, required this.bodega});

  static Future<Ajustes> cargar() async {
    final prefs = await SharedPreferences.getInstance();
    return Ajustes(
      servidor: prefs.getString(_kServidor) ?? servidorPorDefecto,
      dispositivo: prefs.getString(_kDispositivo) ?? dispositivoPorDefecto,
      bodega: prefs.getString(_kBodega) ?? bodegaPorDefecto,
    );
  }

  Future<void> guardar() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kServidor, servidor);
    await prefs.setString(_kDispositivo, dispositivo);
    await prefs.setString(_kBodega, bodega);
  }
}