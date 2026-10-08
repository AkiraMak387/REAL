import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

/// Trabajador activo de la bodega con su rostro registrado.
class Trabajador {
  final String id; // ID de 8 dígitos
  final String nombre;
  final String depto;
  final String rostro; // vector CIFRADO por el servidor; solo el servidor lo puede leer
  final List<Map<String, dynamic>> checadas;

  const Trabajador({
    required this.id,
    required this.nombre,
    required this.depto,
    required this.rostro,
    required this.checadas,
  });
}

/// Trae de Firestore los trabajadores de la bodega y los mantiene al día:
/// si hoy dan de alta a alguien en la página web, aparece aquí sin reiniciar la app.
/// Sin internet, Firestore entrega la última copia guardada en la tablet.
class Rostros {
  List<Trabajador> lista = const [];
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _sub;

  void escuchar(String bodega) {
    _sub?.cancel();
    _sub = FirebaseFirestore.instance
        .collection('bodegas')
        .doc(bodega)
        .collection('empleados')
        .snapshots()
        .listen((res) {
      final nueva = <Trabajador>[];
      for (final doc in res.docs) {
        final d = doc.data();
        final rostro = d['rostro'];
        if (d['baja'] != null || rostro is! String || rostro.isEmpty) continue;
        nueva.add(Trabajador(
          id: doc.id,
          nombre: '${d['nombre'] ?? ''}',
          depto: '${d['depto'] ?? ''}',
          rostro: rostro,
          checadas: [
            for (final c in (d['checadas'] as List? ?? const []))
              if (c is Map) c.cast<String, dynamic>(),
          ],
        ));
      }
      lista = nueva;
      debugPrint('Rostros de la bodega $bodega: ${lista.length} de ${res.docs.length} trabajadores');
    }, onError: (Object e) => debugPrint('No se pudieron leer los rostros: $e'));
  }

  void detener() => _sub?.cancel();

  /// Lo que se le manda al servidor para que compare.
  List<Map<String, String>> get existentes => [for (final t in lista) {'id': t.id, 'rostro': t.rostro}];

  Trabajador? porId(String id) {
    for (final t in lista) {
      if (t.id == id) return t;
    }
    return null;
  }
}
