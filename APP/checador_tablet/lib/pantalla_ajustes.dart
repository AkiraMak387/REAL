import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'ajustes.dart';
import 'api.dart';
import 'colores.dart';

/// Pantalla para configurar la dirección del servidor de Python.
/// Se abre manteniendo presionado el logo y escribiendo el PIN.
class PantallaAjustes extends StatefulWidget {
  final Ajustes ajustes;
  const PantallaAjustes({super.key, required this.ajustes});

  @override
  State<PantallaAjustes> createState() => _PantallaAjustesState();
}

class _PantallaAjustesState extends State<PantallaAjustes> {
  late final TextEditingController _servidor;
  late final TextEditingController _dispositivo;
  late final TextEditingController _bodega;
  final _correo = TextEditingController(text: FirebaseAuth.instance.currentUser?.email ?? '');
  final _contrasena = TextEditingController();
  String? _resultado;
  bool _resultadoOk = false;
  bool _probando = false;

  @override
  void initState() {
    super.initState();
    _servidor = TextEditingController(text: widget.ajustes.servidor);
    _dispositivo = TextEditingController(text: widget.ajustes.dispositivo);
    _bodega = TextEditingController(text: widget.ajustes.bodega);
  }

  @override
  void dispose() {
    _servidor.dispose();
    _dispositivo.dispose();
    _bodega.dispose();
    _correo.dispose();
    _contrasena.dispose();
    super.dispose();
  }

  Future<void> _probar() async {
    setState(() {
      _probando = true;
      _resultado = null;
    });
    try {
      final cfg = await ApiCliente(_servidor.text).obtenerConfig();
      setState(() {
        _resultadoOk = true;
        _resultado = 'Conexión correcta ✔\n'
            'Modo demo: ${cfg.modoDemo ? 'sí' : 'no'} · '
            'Entrada ${cfg.horario.entrada} · Cambio a salida ${cfg.horario.cambioASalida}';
      });
    } catch (e) {
      setState(() {
        _resultadoOk = false;
        _resultado = 'No se pudo conectar.\n$e\n\n'
            'Revisa que el servidor esté encendido, la IP sea correcta y la tablet esté en la misma red.';
      });
    } finally {
      if (mounted) setState(() => _probando = false);
    }
  }

  Future<void> _guardar() async {
    // La clave de bodega son 2 dígitos (01, 02…): con otra cosa las checadas no llegarían a ningún trabajador
    if (!RegExp(r'^\d{2}$').hasMatch(_bodega.text.trim())) {
      setState(() {
        _resultadoOk = false;
        _resultado = 'La clave de bodega debe tener 2 dígitos, por ejemplo 01.';
      });
      return;
    }
    // La cuenta de la tableta (la da de alta Sistemas en Firebase); Firebase guarda la sesión, no la contraseña
    if (_contrasena.text.isNotEmpty) {
      try {
        await FirebaseAuth.instance.signInWithEmailAndPassword(email: _correo.text.trim(), password: _contrasena.text);
      } on FirebaseAuthException catch (e) {
        setState(() {
          _resultadoOk = false;
          _resultado = 'No se pudo iniciar sesión con la cuenta de la tablet (${e.code}).';
        });
        return;
      }
    }
    widget.ajustes.bodega = _bodega.text.trim();
    widget.ajustes.servidor = _servidor.text.trim();
    widget.ajustes.dispositivo = _dispositivo.text.trim().isEmpty
        ? Ajustes.dispositivoPorDefecto
        : _dispositivo.text.trim();
    await widget.ajustes.guardar();
    if (mounted) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ajustes del checador')),
      body: ListView(
        padding: const EdgeInsets.all(32),
        children: [
          const Text('Dirección del servidor (PC con Python)',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          TextField(
            controller: _servidor,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'http://192.168.1.50:8000',
              helperText: 'Usa http:// , la IP de la PC y el puerto 8000',
            ),
          ),
          const SizedBox(height: 24),
          const Text('Nombre de esta tablet', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          TextField(
            controller: _dispositivo,
            autocorrect: false,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'tablet-recepcion-01',
            ),
          ),
          const SizedBox(height: 24),
          const Text('Clave de la bodega', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          TextField(
            controller: _bodega,
            keyboardType: TextInputType.number,
            maxLength: 2,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: '01',
              helperText: 'La misma clave que tiene la bodega en el sistema web',
            ),
          ),
          const SizedBox(height: 24),
          const Text('Cuenta de esta tablet', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          TextField(
            controller: _correo,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'tablet.colon01@delnevado.com'),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _contrasena,
            obscureText: true,
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              hintText: 'Contraseña',
              helperText: FirebaseAuth.instance.currentUser == null
                  ? 'Sin sesión: la tablet no puede leer ni guardar checadas'
                  : 'Sesión activa. Escribe la contraseña solo para cambiar de cuenta.',
            ),
          ),
          const SizedBox(height: 32),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, 52)),
                  onPressed: _probando ? null : _probar,
                  child: Text(_probando ? 'Probando…' : 'Probar conexión'),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 52), backgroundColor: Colores.azul),
                  onPressed: _guardar,
                  child: const Text('Guardar'),
                ),
              ),
            ],
          ),
          if (_resultado != null) ...[
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: _resultadoOk ? Colores.verdeSuave : Colores.rojoSuave,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: _resultadoOk ? Colores.verdeBorde : Colores.rojoBorde),
              ),
              child: Text(_resultado!,
                  style: TextStyle(fontSize: 15, color: _resultadoOk ? Colores.verdeTexto : Colores.rojoTexto)),
            ),
          ],
        ],
      ),
    );
  }
}