// Detector de chasquidos. Todo el sonido se analiza aquí, en la Mac: nada se graba ni se envía.
//
// Cómo distingue un chasquido:
// - Es un golpe corto (menos de ~60 ms) con bastante sonido agudo (arriba de 2 kHz).
//   La voz, una "sss" o la música duran más; un golpe en la mesa es grave.
// - Por defecto se piden DOS seguidos (entre 0.12 y 1 s de separación), con un poco de silencio
//   antes y después, para que no se dispare al teclear. Se puede pedir uno solo.
import AVFoundation

final class Chasquidos: @unchecked Sendable {
    var alDetectar: (@MainActor () -> Void)?
    var sensibilidad: Int = Pref.sensibilidad
    var unoSolo: Bool = Pref.unChasquido

    // Para la ventana de prueba (se leen desde la pantalla)
    private(set) var activo = false
    private(set) var nivel: Float = 0 // 0…1: qué tan cerca está el sonido de contar como chasquido
    private(set) var golpesOidos = 0
    private(set) var llamados = 0
    private(set) var ultimoDescarte = ""
    private(set) var errorMicro = ""

    private let motor = AVAudioEngine()
    private var observador: NSObjectProtocol?

    // Filtro y bloques de ~5 ms
    private var tasa: Double = 48000
    private var alfa: Float = 0
    private var hpPrev: Float = 0
    private var xPrev: Float = 0
    private var tamBloque = 240
    private var sumaAgudos: Float = 0
    private var sumaTodo: Float = 0
    private var n = 0
    private var t: Double = 0 // segundos de audio analizados

    // Ruido de fondo
    private var piso: Float = 0.001

    // Golpe en curso
    private var enGolpe = false
    private var inicioGolpe: Double = 0
    private var pico: Float = 0
    private var bloquesAltos = 0

    // Secuencia
    private var golpes: [Double] = []
    private var silencioAntesDelPrimero: Double = 0
    private var ultimoSonido: Double = -10
    private var pendiente: Double?
    private var enfriarHasta: Double = 0

    func iniciar() throws {
        guard !activo else { return }
        errorMicro = ""
        let entrada = motor.inputNode
        let formato = entrada.outputFormat(forBus: 0)
        guard formato.sampleRate > 0, formato.channelCount > 0 else {
            errorMicro = "No encontré un micrófono."
            throw ErrorDelta(mensaje: errorMicro)
        }
        tasa = formato.sampleRate
        tamBloque = max(64, Int(tasa / 200))
        let rc: Float = 1 / (2 * Float.pi * 2000)
        let dt: Float = 1 / Float(tasa)
        alfa = rc / (rc + dt)
        entrada.installTap(onBus: 0, bufferSize: 1024, format: formato) { [weak self] buffer, _ in
            self?.procesar(buffer)
        }
        motor.prepare()
        do { try motor.start() } catch {
            entrada.removeTap(onBus: 0)
            errorMicro = "El micrófono no arrancó: \(error.localizedDescription)"
            Registro.anotar(errorMicro)
            throw error
        }
        activo = true
        Registro.anotar("Micrófono encendido (\(Int(tasa)) Hz, \(formato.channelCount) canal/es)")
        observador = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: motor, queue: .main) { [weak self] _ in
            // Cambió el micrófono (audífonos, otra entrada): se vuelve a empezar.
            guard let self, self.activo else { return }
            self.detener()
            try? self.iniciar()
        }
    }

    func detener() {
        guard activo else { return }
        if let o = observador { NotificationCenter.default.removeObserver(o) }
        observador = nil
        motor.inputNode.removeTap(onBus: 0)
        motor.stop()
        activo = false
        nivel = 0
    }

    /// Cuántas veces más fuerte que el ruido de fondo, y un mínimo absoluto.
    private func umbrales() -> (Float, Float) {
        switch sensibilidad {
        case 0: return (10, 0.015)
        case 2: return (4, 0.003)
        default: return (6, 0.007)
        }
    }

    private func procesar(_ buffer: AVAudioPCMBuffer) {
        guard let canales = buffer.floatChannelData else { return }
        let cuantos = Int(buffer.frameLength)
        let numCanales = Int(buffer.format.channelCount)
        for i in 0..<cuantos {
            var x: Float = 0
            for c in 0..<numCanales { x += canales[c][i] }
            x /= Float(numCanales)
            let y = alfa * (hpPrev + x - xPrev) // filtro de agudos
            hpPrev = y
            xPrev = x
            sumaAgudos += y * y
            sumaTodo += x * x
            n += 1
            if n >= tamBloque {
                analizar(agudos: (sumaAgudos / Float(n)).squareRoot(), todo: (sumaTodo / Float(n)).squareRoot())
                sumaAgudos = 0
                sumaTodo = 0
                n = 0
                t += Double(tamBloque) / tasa
            }
        }
    }

    private func analizar(agudos: Float, todo: Float) {
        let (veces, minimo) = umbrales()
        let umbral = max(piso * veces, minimo)
        nivel = max(nivel * 0.85, min(1, agudos / umbral))

        if !enGolpe {
            if agudos > umbral && agudos > todo * 0.25 {
                enGolpe = true
                inicioGolpe = t
                pico = agudos
                bloquesAltos = 1
            } else {
                piso = max(0.0002, piso * 0.995 + agudos * 0.005)
            }
        } else {
            if agudos > pico { pico = agudos }
            if agudos > pico * 0.35 { bloquesAltos += 1 }
            if t - inicioGolpe >= 0.1 {
                enGolpe = false
                let corto = bloquesAltos <= 12 && agudos < pico * 0.4
                if corto {
                    golpesOidos += 1
                    golpe(en: inicioGolpe)
                } else {
                    ultimoDescarte = "Oí un sonido largo (voz o ruido), no un chasquido."
                    ruido(en: inicioGolpe)
                }
                Registro.anotar(String(format: "%@ pico=%.4f piso=%.4f altos=%d", corto ? "golpe" : "largo", pico, piso, bloquesAltos))
            }
        }

        // ¿Ya pasó el silencio después del último chasquido?
        if let p = pendiente, t - p > 0.35 {
            pendiente = nil
            golpes.removeAll()
            if ultimoSonido <= p + 0.001 { disparar() }
        }
    }

    private func disparar() {
        enfriarHasta = t + 2.5
        llamados += 1
        ultimoDescarte = ""
        Registro.anotar("¡Llamado a DELTA!")
        if let aviso = alDetectar {
            Task { @MainActor in aviso() }
        }
    }

    private func ruido(en tg: Double) {
        ultimoSonido = tg
        pendiente = nil
        golpes.removeAll()
    }

    private func golpe(en tg: Double) {
        if tg < enfriarHasta { ultimoSonido = tg; return }
        golpes = golpes.filter { tg - $0 < 1.2 }
        if golpes.isEmpty { silencioAntesDelPrimero = tg - ultimoSonido }
        ultimoSonido = tg
        golpes.append(tg)
        if unoSolo {
            if golpes.count == 1 && silencioAntesDelPrimero > 0.25 { pendiente = tg } else { pendiente = nil }
            return
        }
        if golpes.count == 1 {
            ultimoDescarte = "Oí un chasquido. Falta el segundo."
        } else if golpes.count == 2 {
            let separacion = golpes[1] - golpes[0]
            if separacion >= 0.12 && separacion <= 1.0 && silencioAntesDelPrimero > 0.25 {
                pendiente = tg
            } else {
                ultimoDescarte = separacion < 0.12 ? "Los dos chasquidos fueron demasiado rápidos." : "Hubo ruido justo antes del primer chasquido."
                golpes = [tg]
                silencioAntesDelPrimero = separacion
            }
        } else {
            // Muchos golpes seguidos: teclado, aplausos… no es el llamado.
            ultimoDescarte = "Oí muchos golpes seguidos (¿teclado?)."
            pendiente = nil
        }
    }
}

/// Bitácora corta en ~/Library/Logs/DELTA Mac.log para revisar qué pasó (sin audio, solo números).
enum Registro {
    private static let cola = DispatchQueue(label: "delta.registro")
    private static let archivo = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/DELTA Mac.log")
    private static let formato: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()

    static func anotar(_ texto: String) {
        let linea = "\(formato.string(from: Date())) \(texto)\n"
        cola.async {
            let fm = FileManager.default
            if let tam = (try? fm.attributesOfItem(atPath: archivo.path)[.size] as? Int), tam > 500_000 {
                try? fm.removeItem(at: archivo)
            }
            if let h = try? FileHandle(forWritingTo: archivo) {
                h.seekToEndOfFile()
                h.write(Data(linea.utf8))
                try? h.close()
            } else {
                fm.createFile(atPath: archivo.path, contents: Data(linea.utf8))
            }
        }
    }
}
