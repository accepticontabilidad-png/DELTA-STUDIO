// Ventanita de estado y prueba: se abre al abrir DELTA Mac desde Aplicaciones (aunque la Δ de arriba
// esté escondida). Muestra si está vinculada, el permiso del micrófono, una barra que se mueve con el
// sonido y cuántos chasquidos oyó.
import AppKit
import AVFoundation

@MainActor
final class VentanaEstado: NSObject, NSWindowDelegate {
    private var ventana: NSWindow?
    private var reloj: Timer?
    private weak var app: Delegado?

    private let conexionTxt = NSTextField(labelWithString: "")
    private let microTxt = NSTextField(labelWithString: "")
    private let barra = NSLevelIndicator()
    private let golpesTxt = NSTextField(labelWithString: "")
    private let detalleTxt = NSTextField(wrappingLabelWithString: "")
    private let sensibilidad = NSPopUpButton()
    private let unoSolo = NSButton(checkboxWithTitle: "Con un solo chasquido (más fácil, pero se puede activar sola)", target: nil, action: nil)
    private let botonMicro = NSButton(title: "Dar permiso al micrófono", target: nil, action: nil)

    init(app: Delegado) {
        self.app = app
        super.init()
    }

    func mostrar() {
        if ventana == nil { armar() }
        NSApp.activate(ignoringOtherApps: true)
        ventana?.center()
        ventana?.makeKeyAndOrderFront(nil)
        refrescar()
        reloj?.invalidate()
        reloj = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refrescar() }
        }
    }

    func windowWillClose(_ n: Notification) {
        reloj?.invalidate()
        reloj = nil
    }

    private func armar() {
        let v = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 420), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        v.title = "DELTA Mac"
        v.isReleasedWhenClosed = false
        v.delegate = self

        let titulo = NSTextField(labelWithString: "Δ  DELTA Mac")
        titulo.font = NSFont.systemFont(ofSize: 20, weight: .semibold)
        let ayuda = NSTextField(wrappingLabelWithString: "Truene los dedos dos veces, firme y cerca de la Mac. La barra se debe llenar y el contador subir. El sonido se analiza aquí mismo y nunca sale de su Mac.")
        ayuda.textColor = .secondaryLabelColor

        barra.levelIndicatorStyle = .continuousCapacity
        barra.minValue = 0
        barra.maxValue = 1
        barra.warningValue = 0.99
        barra.criticalValue = 1.01
        barra.translatesAutoresizingMaskIntoConstraints = false
        barra.widthAnchor.constraint(equalToConstant: 400).isActive = true

        golpesTxt.font = NSFont.monospacedDigitSystemFont(ofSize: 15, weight: .medium)
        detalleTxt.textColor = .secondaryLabelColor
        detalleTxt.preferredMaxLayoutWidth = 400

        sensibilidad.addItems(withTitles: ["Sensibilidad baja", "Sensibilidad media", "Sensibilidad alta"])
        sensibilidad.selectItem(at: Pref.sensibilidad)
        sensibilidad.target = self
        sensibilidad.action = #selector(cambiarSensibilidad)
        unoSolo.state = Pref.unChasquido ? .on : .off
        unoSolo.target = self
        unoSolo.action = #selector(cambiarUnoSolo)
        botonMicro.target = self
        botonMicro.action = #selector(pedirMicro)

        let vincular = NSButton(title: Llave.hay() ? "Vincular de nuevo" : "Vincular con DELTA", target: self, action: #selector(vincular))
        let abrir = NSButton(title: "Abrir DELTA", target: self, action: #selector(abrirDelta))
        let acceso = NSButton(title: "Permiso para escribir", target: self, action: #selector(accesibilidad))
        let botones = NSStackView(views: [vincular, abrir, acceso])
        botones.spacing = 8

        let pila = NSStackView(views: [titulo, ayuda, conexionTxt, microTxt, botonMicro, barra, golpesTxt, detalleTxt, sensibilidad, unoSolo, botones])
        pila.orientation = .vertical
        pila.alignment = .leading
        pila.spacing = 10
        pila.edgeInsets = NSEdgeInsets(top: 20, left: 24, bottom: 20, right: 24)
        pila.translatesAutoresizingMaskIntoConstraints = false
        ayuda.preferredMaxLayoutWidth = 400
        let contenido = NSView()
        contenido.addSubview(pila)
        NSLayoutConstraint.activate([
            pila.leadingAnchor.constraint(equalTo: contenido.leadingAnchor),
            pila.trailingAnchor.constraint(equalTo: contenido.trailingAnchor),
            pila.topAnchor.constraint(equalTo: contenido.topAnchor),
            pila.bottomAnchor.constraint(equalTo: contenido.bottomAnchor),
        ])
        v.contentView = contenido
        ventana = v
    }

    private func refrescar() {
        guard let app else { return }
        conexionTxt.stringValue = "DELTA: " + app.textoEstado()
        let permiso = AVCaptureDevice.authorizationStatus(for: .audio)
        let ch = app.chasquidos
        switch permiso {
        case .authorized:
            microTxt.stringValue = ch.activo ? "Micrófono: escuchando ✓" : (Pref.chasquido ? "Micrófono: con permiso, pero no arrancó. \(ch.errorMicro)" : "Micrófono: apagado en el menú Δ")
            botonMicro.isHidden = true
        case .notDetermined:
            microTxt.stringValue = "Micrófono: falta dar permiso"
            botonMicro.isHidden = false
        default:
            microTxt.stringValue = "Micrófono: SIN PERMISO. Actívelo en Ajustes del Sistema → Privacidad y seguridad → Micrófono → DELTA Mac."
            botonMicro.isHidden = false
        }
        microTxt.textColor = permiso == .authorized && ch.activo ? .labelColor : .systemRed
        barra.doubleValue = Double(ch.nivel)
        golpesTxt.stringValue = "Chasquidos oídos: \(ch.golpesOidos)    Llamados a DELTA: \(ch.llamados)"
        detalleTxt.stringValue = ch.ultimoDescarte
    }

    @objc private func cambiarSensibilidad() {
        Pref.sensibilidad = sensibilidad.indexOfSelectedItem
        app?.chasquidos.sensibilidad = Pref.sensibilidad
    }
    @objc private func cambiarUnoSolo() {
        Pref.unChasquido = unoSolo.state == .on
        app?.chasquidos.unoSolo = Pref.unChasquido
    }
    @objc private func pedirMicro() {
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined { app?.prepararMicro() } else { app?.abrirPermisoMicro() }
    }
    @objc private func vincular() { app?.vincular() }
    @objc private func abrirDelta() { Acciones.abrirDelta() }
    @objc private func accesibilidad() { app?.abrirPermisoAccesibilidad() }
}
