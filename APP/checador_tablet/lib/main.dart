import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'colores.dart';
import 'firebase_options.dart';
import 'pantalla_checador.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform); // conexión con Firestore
  await initializeDateFormatting('es_MX');                          // fechas en español
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]); // tablet vertical
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);     // pantalla completa
  await WakelockPlus.enable();                                      // la pantalla no se apaga

  runApp(const AppChecador());
}

class AppChecador extends StatelessWidget {
  const AppChecador({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Checador El Nevado',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: Colores.fondo,
        colorScheme: ColorScheme.fromSeed(seedColor: Colores.azul),
        textTheme: GoogleFonts.manropeTextTheme(),
      ),
      home: const PantallaChecador(),
    );
  }
}