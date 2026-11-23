// DELTA Mac: app de la barra de arriba que conecta la Mac con DELTA.
// - Oye el doble chasquido (el sonido se analiza aquí mismo, nunca sale de la Mac) y abre DELTA escuchando.
// - Recoge las órdenes de DELTA (abrir apps, archivos, escribir…) y las hace. Lo delicado lo pregunta antes.
import AppKit
import AVFoundation
import ServiceManagement

let VERSION = "1.2"
let URL_POR_DEFECTO = "https://delta-studio-production.up.railway.app"

// MARK: - Preferencias

enum Pref {
    static let d = UserDefaults.standard
    static var url: String {
        get { d.string(forKey: "url") ?? URL_POR_DEFECTO }
        set { d.set(newValue, forKey: "url") }
    }
    static var chasquido: Bool {
        get { d.object(forKey: "chasquido") as? Bool ?? true }
        set { d.set(newValue, forKey: "chasquido") }
    }
    static var control: Bool {
        get { d.object(forKey: "control") as? Bool ?? true }
        set { d.set(newValue, forKey: "control") }
    }
    static var preguntarTodo: Bool {
        get { d.object(forKey: "preguntarTodo") as? Bool ?? false }
        set { d.set(newValue, forKey: "preguntarTodo") }
    }
    static var unChasquido: Bool {
        get { d.object(forKey: "unChasquido") as? Bool ?? false }
        set { d.set(newValue, forKey: "unChasquido") }
    }
    /// 0 baja, 1 media, 2 alta
    static var sensibilidad: Int {
        get { d.object(forKey: "sensibilidad") as? Int ?? 1 }
        set { d.set(newValue, forKey: "sensibilidad") }
    }
}

// MARK: - App

@MainActor
final class Delegado: NSObject, NSApplicationDelegate, NSMenuDelegate {
    enum Estado { case sinVincular, conectando, conectada, sinConexion }

    var item: NSStatusItem!
    let menu = NSMenu()
    var estado: Estado = .conectando { didSet { pintar() } }
    let chasquidos = Chasquidos()
    let conexion = Conexion()
    var avisoMicro = false
    lazy var ventana = VentanaEstado(app: self)

    func applicationDidFinishLaunching(_ n: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        menu.delegate = self
        item.menu = menu
        pintar()

        chasquidos.alDetectar = { [weak self] in self?.alChasquear() }
        prepararMicro()

        conexion.alCambiar = { [weak self] e in self?.estado = e }
        conexion.empezar()

        Registro.anotar("DELTA Mac \(VERSION) abierta")
        // Si la abrió usted (no al prender la Mac), se muestra la ventanita de estado.
        if ProcessInfo.processInfo.systemUptime > 180 || !Llave.hay() {
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 600_000_000)
                self?.ventana.mostrar()
                if !Llave.hay() { self?.vincular() }
            }
        }
    }

    /// Al abrirla otra vez desde Aplicaciones o el Dock, aparece la ventanita.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        ventana.mostrar()
        return false
    }

    // MARK: Icono y menú

    func pintar() {
        guard let boton = item?.button else { return }
        let color: NSColor
        switch estado {
        case .conectada: color = .labelColor
        case .conectando: color = .secondaryLabelColor
        case .sinConexion, .sinVincular: color = .tertiaryLabelColor
        }
        boton.attributedTitle = NSAttributedString(string: "Δ", attributes: [
            .font: NSFont.systemFont(ofSize: 15, weight: .semibold),
            .foregroundColor: color,
        ])
        boton.toolTip = "DELTA Mac — \(textoEstado())"
    }

    func destello() {
        guard let boton = item?.button else { return }
        boton.attributedTitle = NSAttributedString(string: "Δ ✦", attributes: [
            .font: NSFont.systemFont(ofSize: 15, weight: .semibold),
            .foregroundColor: NSColor.systemPurple,
        ])
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            self?.pintar()
        }
    }

    func textoEstado() -> String {
        switch estado {
        case .sinVincular: return "Sin vincular con DELTA"
        case .conectando: return "Conectando…"
        case .conectada: return "Conectada con DELTA"
        case .sinConexion: return "Sin conexión (reintentando)"
        }
    }

    func menuNeedsUpdate(_ m: NSMenu) {
        m.removeAllItems()
        let titulo = NSMenuItem(title: "DELTA · \(textoEstado())", action: nil, keyEquivalent: "")
        titulo.isEnabled = false
        m.addItem(titulo)
        if avisoMicro {
            m.addItem(opcion("⚠︎ Permitir el micrófono…", #selector(abrirPermisoMicro)))
        }
        if !Permisos.accesibilidad(preguntar: false) {
            m.addItem(opcion("⚠︎ Permitir escribir y atajos (Accesibilidad)…", #selector(abrirPermisoAccesibilidad)))
        }
        m.addItem(.separator())
        m.addItem(opcion("Abrir DELTA", #selector(abrirDelta)))
        m.addItem(opcion("Ver estado y probar el chasquido…", #selector(verEstado)))
        m.addItem(.separator())

        let ch = opcion("Encender con dos chasquidos", #selector(alternarChasquido))
        ch.state = Pref.chasquido ? .on : .off
        m.addItem(ch)
        let sens = NSMenuItem(title: "Sensibilidad del chasquido", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for (i, nombre) in ["Baja (menos sustos)", "Media", "Alta (lo oye más lejos)"].enumerated() {
            let o = opcion(nombre, #selector(cambiarSensibilidad(_:)))
            o.tag = i
            o.state = Pref.sensibilidad == i ? .on : .off
            sub.addItem(o)
        }
        sens.submenu = sub
        m.addItem(sens)
        m.addItem(.separator())

        let ctl = opcion("Dejar que DELTA maneje esta Mac", #selector(alternarControl))
        ctl.state = Pref.control ? .on : .off
        m.addItem(ctl)
        let todo = opcion("Preguntarme antes de cualquier cosa", #selector(alternarPreguntar))
        todo.state = Pref.preguntarTodo ? .on : .off
        m.addItem(todo)
        m.addItem(.separator())

        m.addItem(opcion(Llave.hay() ? "Vincular de nuevo con DELTA…" : "Vincular con DELTA…", #selector(vincular)))
        if Llave.hay() { m.addItem(opcion("Desvincular esta Mac", #selector(desvincular))) }
        let inicio = opcion("Abrir al prender la Mac", #selector(alternarInicio))
        inicio.state = SMAppService.mainApp.status == .enabled ? .on : .off
        m.addItem(inicio)
        m.addItem(.separator())
        let v = NSMenuItem(title: "Versión \(VERSION)", action: nil, keyEquivalent: "")
        v.isEnabled = false
        m.addItem(v)
        m.addItem(opcion("Salir de DELTA Mac", #selector(salir)))
    }

    func opcion(_ t: String, _ s: Selector) -> NSMenuItem {
        let o = NSMenuItem(title: t, action: s, keyEquivalent: "")
        o.target = self
        return o
    }

    // MARK: Chasquido

    func prepararMicro() {
        guard Pref.chasquido else { chasquidos.detener(); return }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            avisoMicro = false
            do { try chasquidos.iniciar() } catch { Registro.anotar("No pude usar el micrófono: \(error)") }
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { _ in
                Task { @MainActor in delegado.prepararMicro() }
            }
        default:
            avisoMicro = true
        }
    }

    func alChasquear() {
        guard Pref.chasquido else { return }
        destello()
        NSSound(named: "Tink")?.play()
        conexion.despertar()
        Acciones.abrirDelta()
        Acciones.darToqueADelta()
    }

    // MARK: Acciones del menú

    @objc func abrirDelta() { Acciones.abrirDelta() }
    @objc func verEstado() { ventana.mostrar() }
    @objc func alternarChasquido() { Pref.chasquido.toggle(); prepararMicro() }
    @objc func cambiarSensibilidad(_ o: NSMenuItem) { Pref.sensibilidad = o.tag; chasquidos.sensibilidad = o.tag }
    @objc func alternarControl() { Pref.control.toggle() }
    @objc func alternarPreguntar() { Pref.preguntarTodo.toggle() }
    @objc func abrirPermisoMicro() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")!)
    }
    @objc func abrirPermisoAccesibilidad() {
        _ = Permisos.accesibilidad(preguntar: true)
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
    }
    @objc func alternarInicio() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
        } catch {
            Dialogo.aviso("No se pudo cambiar", "Mueva DELTA Mac a la carpeta Aplicaciones e intente de nuevo.")
        }
    }
    @objc func desvincular() {
        Llave.borrar()
        estado = .sinVincular
    }
    @objc func salir() { NSApp.terminate(nil) }

    @objc func vincular() {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = "Vincular esta Mac con DELTA"
        a.informativeText = "En DELTA abra ⚙ Ajustes → Mi Mac → «Vincular mi Mac» y escriba aquí el código de 6 números."
        let caja = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 58))
        let codigo = NSTextField(frame: NSRect(x: 0, y: 30, width: 300, height: 26))
        codigo.placeholderString = "Código (ej. 123 456)"
        codigo.font = NSFont.monospacedDigitSystemFont(ofSize: 16, weight: .medium)
        let url = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 22))
        url.stringValue = Pref.url
        url.font = NSFont.systemFont(ofSize: 11)
        url.textColor = .secondaryLabelColor
        caja.addSubview(codigo)
        caja.addSubview(url)
        a.accessoryView = caja
        a.window.initialFirstResponder = codigo
        a.addButton(withTitle: "Vincular")
        a.addButton(withTitle: "Cancelar")
        guard a.runModal() == .alertFirstButtonReturn else { return }
        let direccion = url.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard direccion.hasPrefix("https://") || direccion.hasPrefix("http://localhost") else {
            Dialogo.aviso("Dirección no válida", "La dirección de DELTA debe empezar con https://")
            return
        }
        Pref.url = direccion
        let nombre = Host.current().localizedName ?? "Mi Mac"
        Task { @MainActor in
            do {
                try await conexion.vincular(codigo: codigo.stringValue, nombre: nombre)
                Dialogo.aviso("¡Listo!", "Esta Mac quedó vinculada con DELTA. Truene los dedos dos veces para llamarla.")
                if !Permisos.accesibilidad(preguntar: false) {
                    Dialogo.aviso("Un permiso más", "Para que DELTA pueda escribir y usar atajos, active «DELTA Mac» en Ajustes del Sistema → Privacidad y seguridad → Accesibilidad. Le abro esa pantalla.")
                    abrirPermisoAccesibilidad()
                }
            } catch {
                Dialogo.aviso("No se pudo vincular", error.localizedDescription)
            }
        }
    }
}

@MainActor
enum Dialogo {
    static func aviso(_ titulo: String, _ texto: String) {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = titulo
        a.informativeText = texto
        a.addButton(withTitle: "Aceptar")
        a.runModal()
    }
}

enum Permisos {
    static func accesibilidad(preguntar: Bool) -> Bool {
        let opciones = ["AXTrustedCheckOptionPrompt": preguntar] as CFDictionary
        return AXIsProcessTrustedWithOptions(opciones)
    }
}

@MainActor var delegado: Delegado!

@main
enum Principal {
    @MainActor static func main() {
        let app = NSApplication.shared
        delegado = Delegado()
        app.delegate = delegado
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
