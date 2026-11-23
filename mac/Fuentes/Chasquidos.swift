// Detector de doble chasquido. Todo el sonido se analiza aquí, en la Mac: nada se graba ni se envía.
//
// Cómo distingue un chasquido:
// - Es un golpe muy corto (dura menos de ~40 ms) y con mucho sonido agudo (arriba de 2 kHz).
//   La voz, una "sss" o la música duran más; un golpe en la mesa es grave.
// - Se piden DOS seguidos (entre 0.15 y 0.9 s de separación), con silencio antes y después.
//   Así no se dispara al teclear, con aplausos largos ni con un ruido suelto.
import AVFoundation

final class Chasquidos: @unchecked Sendable {
    var alDetectar: (@MainActor () -> Void)?
    var sensibilidad: Int = Pref.sensibilidad

    private let motor = AVAudioEngine()
    private var activo = false
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
    private var piso: Float = 0.002

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
        let entrada = motor.inputNode
        let formato = entrada.outputFormat(forBus: 0)
        guard formato.sampleRate > 0, formato.channelCount > 0 else { throw ErrorDelta(mensaje: "Sin micrófono") }
        tasa = formato.sampleRate
        tamBloque = max(64, Int(tasa / 200))
        let rc: Float = 1 / (2 * Float.pi * 2000)
        let dt: Float = 1 / Float(tasa)
        alfa = rc / (rc + dt)
        entrada.installTap(onBus: 0, bufferSize: 1024, format: formato) { [weak self] buffer, _ in
            self?.procesar(buffer)
        }
        motor.prepare()
        try motor.start()
        activo = true
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
    }

    /// Cuántas veces más fuerte que el ruido de fondo, y un mínimo absoluto.
    private func umbrales() -> (Float, Float) {
        switch sensibilidad {
        case 0: return (16, 0.035)
        case 2: return (6, 0.008)
        default: return (10, 0.018)
        }
    }

    private func procesar(_ buffer: AVAudioPCMBuffer) {
        guard let canal = buffer.floatChannelData?[0] else { return }
        let cuantos = Int(buffer.frameLength)
        for i in 0..<cuantos {
            let x = canal[i]
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

        if !enGolpe {
            if agudos > max(piso * veces, minimo) && agudos > todo * 0.35 {
                enGolpe = true
                inicioGolpe = t
                pico = agudos
                bloquesAltos = 1
            } else {
                piso = max(0.0003, piso * 0.995 + agudos * 0.005)
            }
        } else {
            if agudos > pico { pico = agudos }
            if agudos > pico * 0.35 { bloquesAltos += 1 }
            if t - inicioGolpe >= 0.08 {
                enGolpe = false
                let corto = bloquesAltos <= 8 && agudos < pico * 0.3
                if corto { golpe(en: inicioGolpe) } else { ruido(en: inicioGolpe) }
            }
        }

        // ¿Ya pasó el silencio después del segundo chasquido?
        if let p = pendiente, t - p > 0.45 {
            pendiente = nil
            golpes.removeAll()
            if ultimoSonido <= p + 0.001 {
                enfriarHasta = t + 2.5
                if let aviso = alDetectar {
                    Task { @MainActor in aviso() }
                }
            }
        }
    }

    private func ruido(en tg: Double) {
        ultimoSonido = tg
        pendiente = nil
        golpes.removeAll()
    }

    private func golpe(en tg: Double) {
        if tg < enfriarHasta { ultimoSonido = tg; return }
        golpes = golpes.filter { tg - $0 < 1.0 }
        if golpes.isEmpty { silencioAntesDelPrimero = tg - ultimoSonido }
        ultimoSonido = tg
        golpes.append(tg)
        if golpes.count == 2 {
            let separacion = golpes[1] - golpes[0]
            if separacion >= 0.15 && separacion <= 0.9 && silencioAntesDelPrimero > 0.35 {
                pendiente = tg
            } else {
                golpes = [tg]
                silencioAntesDelPrimero = separacion
            }
        } else if golpes.count > 2 {
            // Muchos golpes seguidos: teclado, aplausos… no es el llamado.
            pendiente = nil
        }
    }
}
