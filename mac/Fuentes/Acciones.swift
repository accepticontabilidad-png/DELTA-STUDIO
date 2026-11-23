// Lo que DELTA puede hacer en la Mac. Aquí se decide qué es delicado y se pregunta antes,
// sin importar lo que diga el servidor (la Mac es la que manda).
import AppKit
import Carbon.HIToolbox

struct Resultado {
    var ok: Bool
    var valor: Any?
    var error: String?
    static func bien(_ v: Any) -> Resultado { Resultado(ok: true, valor: v, error: nil) }
    static func mal(_ e: String) -> Resultado { Resultado(ok: false, valor: nil, error: e) }
}

@MainActor
enum Acciones {
    /// Siempre se preguntan, diga lo que diga el servidor.
    static let delicadas: Set<String> = ["cerrar_app", "escribir_texto", "atajo_teclado", "mover_a_papelera"]
    /// Solo leen: no se preguntan ni con "preguntarme antes de cualquier cosa".
    static let soloLeen: Set<String> = ["apps_abiertas", "buscar_archivos"]

    static var casa: String { FileManager.default.homeDirectoryForCurrentUser.resolvingSymlinksInPath().path }

    static func hacer(_ accion: String, _ d: [String: Any], riesgo: Bool) async -> Resultado {
        guard Pref.control else { return .mal("El control está apagado en la Mac (menú Δ → «Dejar que DELTA maneje esta Mac»).") }
        let txt = { (k: String) in (d[k] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
        let preguntar = (riesgo || delicadas.contains(accion) || Pref.preguntarTodo) && !soloLeen.contains(accion)

        switch accion {
        case "abrir_app":
            guard let app = buscarApp(txt("app")) else { return .mal("No encontré la aplicación «\(txt("app"))» en esta Mac.") }
            let nombre = FileManager.default.displayName(atPath: app.path).replacingOccurrences(of: ".app", with: "")
            if preguntar, !(await confirmar("DELTA quiere abrir \(nombre)", "")) { return .mal("El dueño dijo que no.") }
            do {
                _ = try await NSWorkspace.shared.openApplication(at: app, configuration: NSWorkspace.OpenConfiguration())
                return .bien("Abrí \(nombre).")
            } catch { return .mal("No se pudo abrir \(nombre): \(error.localizedDescription)") }

        case "cerrar_app":
            let buscado = normalizar(txt("app"))
            guard !buscado.isEmpty else { return .mal("Falta el nombre de la aplicación.") }
            let apps = NSWorkspace.shared.runningApplications.filter {
                $0.activationPolicy == .regular && $0.processIdentifier != ProcessInfo.processInfo.processIdentifier
                    && normalizar($0.localizedName ?? "").contains(buscado)
            }
            guard let app = apps.first, let nombre = app.localizedName else { return .mal("«\(txt("app"))» no está abierta.") }
            if !(await confirmar("DELTA quiere cerrar \(nombre)", "Si tiene algo sin guardar, la app le preguntará antes de cerrar.")) { return .mal("El dueño dijo que no.") }
            return app.terminate() ? .bien("Cerré \(nombre).") : .mal("\(nombre) no quiso cerrarse.")

        case "apps_abiertas":
            let nombres = NSWorkspace.shared.runningApplications
                .filter { $0.activationPolicy == .regular }
                .compactMap { $0.localizedName }
            return .bien(nombres)

        case "abrir_url":
            guard let u = URL(string: txt("url")), let esquema = u.scheme?.lowercased(), ["https", "http"].contains(esquema), u.host != nil else {
                return .mal("Solo abro direcciones web que empiecen con https://")
            }
            if preguntar, !(await confirmar("DELTA quiere abrir una página", u.absoluteString)) { return .mal("El dueño dijo que no.") }
            NSWorkspace.shared.open(u)
            return .bien("Abrí \(u.host ?? "la página").")

        case "buscar_archivos":
            let q = txt("consulta")
            guard q.count >= 2 else { return .mal("Dime qué buscar.") }
            let encontrados = await Task.detached { Acciones.spotlight(q, casa: FileManager.default.homeDirectoryForCurrentUser.path) }.value
            return .bien(encontrados.isEmpty ? ["nada": "No encontré archivos con «\(q)»."] as [String: Any] : ["archivos": encontrados] as [String: Any])

        case "abrir_archivo", "mostrar_en_finder":
            guard let u = rutaPermitida(txt("ruta")) else { return .mal("Ese archivo no existe o está fuera de su carpeta personal.") }
            let nombre = u.lastPathComponent
            if accion == "mostrar_en_finder" {
                NSWorkspace.shared.activateFileViewerSelecting([u])
                return .bien("Te lo mostré en el Finder: \(nombre).")
            }
            let ejecutable = esEjecutable(u)
            if preguntar || ejecutable {
                let extra = ejecutable ? "Ojo: es un programa o script; abrirlo lo ejecuta." : u.path
                if !(await confirmar("DELTA quiere abrir «\(nombre)»", extra)) { return .mal("El dueño dijo que no.") }
            }
            return NSWorkspace.shared.open(u) ? .bien("Abrí \(nombre).") : .mal("No se pudo abrir \(nombre).")

        case "mover_a_papelera":
            guard let u = rutaPermitida(txt("ruta")), u.path != casa else { return .mal("Ese archivo no existe o está fuera de su carpeta personal.") }
            if !(await confirmar("DELTA quiere mandar a la Papelera «\(u.lastPathComponent)»", u.path + "\n\nPodrá sacarlo de la Papelera si se arrepiente.")) { return .mal("El dueño dijo que no.") }
            do {
                try FileManager.default.trashItem(at: u, resultingItemURL: nil)
                return .bien("Mandé \(u.lastPathComponent) a la Papelera.")
            } catch { return .mal("No se pudo: \(error.localizedDescription)") }

        case "escribir_texto":
            let texto = (d["texto"] as? String) ?? ""
            guard !texto.isEmpty, texto.count <= 5000 else { return .mal("El texto está vacío o es demasiado largo.") }
            guard Permisos.accesibilidad(preguntar: true) else { return .mal(sinAccesibilidad) }
            let destino = appDelFrente()
            let muestra = texto.count > 300 ? String(texto.prefix(300)) + "…" : texto
            if !(await confirmar("DELTA quiere escribir en \(destino?.localizedName ?? "la ventana de enfrente")", muestra)) { return .mal("El dueño dijo que no.") }
            await volverA(destino)
            Teclado.escribir(texto)
            return .bien("Escribí el texto en \(destino?.localizedName ?? "la ventana de enfrente").")

        case "atajo_teclado":
            guard let atajo = Teclado.interpretar(txt("teclas")) else { return .mal("No entendí el atajo «\(txt("teclas"))». Ejemplos: cmd+s, cmd+shift+4, enter.") }
            guard Permisos.accesibilidad(preguntar: true) else { return .mal(sinAccesibilidad) }
            let destino = appDelFrente()
            if !(await confirmar("DELTA quiere presionar \(txt("teclas"))", "En \(destino?.localizedName ?? "la ventana de enfrente").")) { return .mal("El dueño dijo que no.") }
            await volverA(destino)
            Teclado.presionar(atajo)
            return .bien("Presioné \(txt("teclas")).")

        case "volumen":
            let nivel = max(0, min(100, (d["nivel"] as? NSNumber)?.intValue ?? -1))
            guard d["nivel"] != nil else { return .mal("Falta el nivel de volumen (0 a 100).") }
            if preguntar, !(await confirmar("DELTA quiere poner el volumen en \(nivel)", "")) { return .mal("El dueño dijo que no.") }
            let script = nivel == 0 ? "set volume output muted true" : "set volume output muted false\nset volume output volume \(nivel)"
            var err: NSDictionary?
            NSAppleScript(source: script)?.executeAndReturnError(&err)
            return err == nil ? .bien(nivel == 0 ? "Silencié la Mac." : "Volumen en \(nivel).") : .mal("No pude cambiar el volumen.")

        case "crear_nota":
            let texto = (d["texto"] as? String) ?? ""
            guard !texto.isEmpty, texto.count <= 50000 else { return .mal("La nota está vacía o es demasiado larga.") }
            var titulo = txt("titulo").components(separatedBy: CharacterSet(charactersIn: "/:\\\0")).joined(separator: "-")
            if titulo.isEmpty { titulo = "Nota de DELTA" }
            titulo = String(titulo.prefix(80))
            let escritorio = FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask)[0]
            var destino = escritorio.appendingPathComponent("\(titulo).txt")
            var i = 2
            while FileManager.default.fileExists(atPath: destino.path) {
                destino = escritorio.appendingPathComponent("\(titulo) \(i).txt")
                i += 1
            }
            if preguntar, !(await confirmar("DELTA quiere crear «\(destino.lastPathComponent)» en el Escritorio", "")) { return .mal("El dueño dijo que no.") }
            do {
                try texto.write(to: destino, atomically: true, encoding: .utf8)
                return .bien(["creada": destino.path])
            } catch { return .mal("No se pudo crear la nota: \(error.localizedDescription)") }

        default:
            return .mal("Esta versión de DELTA Mac no sabe hacer «\(accion)». Descargue la más nueva desde Ajustes → Mi Mac.")
        }
    }

    static let sinAccesibilidad = "Falta el permiso de Accesibilidad: en Ajustes del Sistema → Privacidad y seguridad → Accesibilidad, active «DELTA Mac»."

    // MARK: Confirmación (en la Mac, con "No" como botón por defecto)

    static func confirmar(_ titulo: String, _ detalle: String) async -> Bool {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = titulo
        a.informativeText = detalle.isEmpty ? "Lo pidió DELTA." : detalle
        a.alertStyle = .warning
        a.addButton(withTitle: "No")
        a.addButton(withTitle: "Permitir")
        // Si nadie contesta en 80 s, se toma como "No".
        let reloj = Timer(timeInterval: 80, repeats: false) { _ in MainActor.assumeIsolated { NSApp.abortModal() } }
        RunLoop.main.add(reloj, forMode: .modalPanel)
        let r = a.runModal()
        reloj.invalidate()
        return r == .alertSecondButtonReturn
    }

    static func appDelFrente() -> NSRunningApplication? {
        let yo = ProcessInfo.processInfo.processIdentifier
        guard let f = NSWorkspace.shared.frontmostApplication, f.processIdentifier != yo else { return nil }
        return f
    }

    static func volverA(_ app: NSRunningApplication?) async {
        app?.activate(options: [])
        try? await Task.sleep(nanoseconds: 450_000_000)
    }

    // MARK: DELTA

    static func abrirDelta() {
        // Si DELTA está instalada como app de Chrome, se abre esa; si no, la página en el navegador.
        for carpeta in ["Applications/Chrome Apps.localized", "Applications/Chrome Apps"] {
            let dir = casa + "/" + carpeta
            if let hijos = try? FileManager.default.contentsOfDirectory(atPath: dir),
               let app = hijos.first(where: { $0.lowercased().hasPrefix("delta") && $0.hasSuffix(".app") }) {
                NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: dir + "/" + app), configuration: NSWorkspace.OpenConfiguration())
                return
            }
        }
        // Si ya está abierta (o Chrome la instaló en otro lado), se busca por su nombre.
        let yo = Bundle.main.bundleURL.path
        if let abierta = NSWorkspace.shared.runningApplications.first(where: {
            ($0.localizedName ?? "").lowercased().hasPrefix("delta") && $0.bundleURL?.path != yo
        }) {
            abierta.activate(options: [])
            return
        }
        let encontradas = spotlight("DELTA", casa: casa).map { $0["ruta"] ?? "" }
        if let app = encontradas.first(where: { $0.hasSuffix(".app") && $0 != yo && ($0 as NSString).lastPathComponent.lowercased().hasPrefix("delta") }) {
            NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: app), configuration: NSWorkspace.OpenConfiguration())
            return
        }
        if let u = URL(string: Pref.url) { NSWorkspace.shared.open(u) }
    }

    /// Los navegadores no dejan que una página suene ni hable hasta que la persona toca una tecla.
    /// Cuando DELTA queda al frente, se presiona F13 (una tecla que no escribe nada) para que suene la
    /// bienvenida y DELTA pueda contestar en voz alta. Solo con permiso de Accesibilidad.
    static func esDelta(_ app: NSRunningApplication?) -> Bool {
        guard let app, app.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return false }
        return (app.localizedName ?? "").lowercased().hasPrefix("delta")
    }

    static func darToqueADelta(esperarQueAparezca: Bool = true, agrandar: Bool = false) {
        guard Permisos.accesibilidad(preguntar: false) else { return }
        Task { @MainActor in
            for _ in 0..<(esperarQueAparezca ? 30 : 1) {
                if esDelta(NSWorkspace.shared.frontmostApplication) {
                    let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier
                    if let pid, agrandar || !yaAgrandadas.contains(pid) {
                        await agrandarVentana(pid: pid)
                    }
                    try? await Task.sleep(nanoseconds: 1_000_000_000) // que la página termine de cargar
                    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { return }
                    let fuente = CGEventSource(stateID: .combinedSessionState)
                    for bajando in [true, false] {
                        CGEvent(keyboardEventSource: fuente, virtualKey: CGKeyCode(kVK_F13), keyDown: bajando)?.post(tap: .cghidEventTap)
                    }
                    return
                }
                try? await Task.sleep(nanoseconds: 200_000_000)
            }
        }
    }

    /// Ventanas de DELTA ya agrandadas (una vez por cada vez que se abre), para no pelear si usted la achica.
    static var yaAgrandadas = Set<pid_t>()

    /// Pone la ventana de DELTA a pantalla completa (todo el espacio, dejando la barra de arriba y el Dock).
    /// Reintenta un par de segundos porque la ventana tarda en aparecer al abrir la app.
    static func agrandarVentana(pid: pid_t) async {
        for intento in 0..<8 {
            if let v = ventanaDeDelta(pid: pid), ajustar(v) {
                yaAgrandadas.insert(pid)
                Registro.anotar("Ventana de DELTA agrandada (intento \(intento + 1))")
                return
            }
            try? await Task.sleep(nanoseconds: 400_000_000)
        }
        Registro.anotar("No pude agrandar la ventana de DELTA (¿falta el permiso de Accesibilidad?)")
    }

    private static func ventanas(de pid: pid_t) -> [AXUIElement] {
        let app = AXUIElementCreateApplication(pid)
        var valor: CFTypeRef?
        if AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &valor) == .success, let v = valor,
           CFGetTypeID(v) == AXUIElementGetTypeID() {
            return [v as! AXUIElement]
        }
        if AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &valor) == .success, let lista = valor as? [AXUIElement] {
            return lista
        }
        return []
    }

    private static func titulo(_ v: AXUIElement) -> String {
        var valor: CFTypeRef?
        AXUIElementCopyAttributeValue(v, kAXTitleAttribute as CFString, &valor)
        return (valor as? String) ?? ""
    }

    /// La ventana de DELTA: la de su propia app o, si Chrome la maneja, la ventana de Chrome que se llama DELTA.
    private static func ventanaDeDelta(pid: pid_t) -> AXUIElement? {
        if let v = ventanas(de: pid).first { return v }
        for chrome in NSWorkspace.shared.runningApplications where chrome.bundleIdentifier?.hasPrefix("com.google.Chrome") == true {
            if let v = ventanas(de: chrome.processIdentifier).first(where: { titulo($0).lowercased().contains("delta") }) { return v }
        }
        return nil
    }

    private static func ajustar(_ ventana: AXUIElement) -> Bool {
        let raton = NSEvent.mouseLocation
        guard let pantalla = NSScreen.screens.first(where: { NSMouseInRect(raton, $0.frame, false) }) ?? NSScreen.main,
              let principal = NSScreen.screens.first else { return false }
        let marco = pantalla.visibleFrame
        // Las coordenadas de Accesibilidad empiezan arriba a la izquierda de la pantalla principal.
        var punto = CGPoint(x: marco.origin.x, y: principal.frame.height - marco.origin.y - marco.height)
        var tam = CGSize(width: marco.width, height: marco.height)
        guard let p = AXValueCreate(.cgPoint, &punto), let t = AXValueCreate(.cgSize, &tam) else { return false }
        let r1 = AXUIElementSetAttributeValue(ventana, kAXPositionAttribute as CFString, p)
        let r2 = AXUIElementSetAttributeValue(ventana, kAXSizeAttribute as CFString, t)
        // Algunas ventanas solo aceptan el tamaño después de moverlas: se repite una vez.
        AXUIElementSetAttributeValue(ventana, kAXPositionAttribute as CFString, p)
        AXUIElementSetAttributeValue(ventana, kAXSizeAttribute as CFString, t)
        return r1 == .success || r2 == .success
    }

    // MARK: Apps

    static let alias: [String: String] = [
        "calculadora": "calculator", "notas": "notes", "calendario": "calendar", "fotos": "photos",
        "mensajes": "messages", "musica": "music", "correo": "mail", "mail": "mail", "mapas": "maps",
        "recordatorios": "reminders", "contactos": "contacts", "vista previa": "preview",
        "ajustes": "system settings", "configuracion": "system settings", "preferencias": "system settings",
        "ajustes del sistema": "system settings", "terminal": "terminal", "word": "microsoft word",
        "excel": "microsoft excel", "powerpoint": "microsoft powerpoint", "outlook": "microsoft outlook",
        "chrome": "google chrome", "camara": "photo booth", "libros": "books", "tienda": "app store",
        "captura": "screenshot", "monitor": "activity monitor", "monitor de actividad": "activity monitor",
    ]

    static func normalizar(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
            .replacingOccurrences(of: ".app", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func buscarApp(_ nombre: String) -> URL? {
        let pedido = normalizar(nombre)
        guard !pedido.isEmpty else { return nil }
        let buscados = Set([pedido, alias[pedido]].compactMap { $0 })
        let fm = FileManager.default
        var carpetas = ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities",
                        casa + "/Applications", casa + "/Applications/Chrome Apps.localized", "/System/Library/CoreServices/Applications"]
        // Apps dentro de una carpeta (ej. /Applications/Adobe Photoshop 2025/)
        if let hijos = try? fm.contentsOfDirectory(atPath: "/Applications") {
            carpetas += hijos.filter { !$0.hasSuffix(".app") && !$0.hasPrefix(".") }.map { "/Applications/" + $0 }
        }
        var candidatos: [(URL, [String])] = []
        for c in carpetas {
            guard let hijos = try? fm.contentsOfDirectory(atPath: c) else { continue }
            for h in hijos where h.hasSuffix(".app") {
                let ruta = c + "/" + h
                candidatos.append((URL(fileURLWithPath: ruta), [normalizar(h), normalizar(fm.displayName(atPath: ruta))]))
            }
        }
        if let exacto = candidatos.first(where: { !buscados.isDisjoint(with: $0.1) }) { return exacto.0 }
        if let empieza = candidatos.first(where: { c in c.1.contains { n in buscados.contains { n.hasPrefix($0) } } }) { return empieza.0 }
        return candidatos.first(where: { c in c.1.contains { n in buscados.contains { n.contains($0) } } })?.0
    }

    // MARK: Archivos

    nonisolated static func spotlight(_ q: String, casa: String) -> [[String: String]] {
        func correr(_ args: [String]) -> [String] {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/mdfind")
            p.arguments = args
            let salida = Pipe()
            p.standardOutput = salida
            p.standardError = FileHandle.nullDevice
            do { try p.run() } catch { return [] }
            let datos = salida.fileHandleForReading.readDataToEndOfFile()
            p.waitUntilExit()
            return String(decoding: datos, as: UTF8.self).split(separator: "\n").map(String.init)
        }
        let util = { (r: String) in !r.contains("/Library/") && !r.contains("/.") && !r.contains("/node_modules/") }
        var rutas = correr(["-onlyin", casa, "-name", q]).filter(util)
        if rutas.count < 8 { rutas += correr(["-onlyin", casa, q]).filter(util).filter { !rutas.contains($0) } }
        let fm = FileManager.default
        let fecha = ISO8601DateFormatter()
        let conFecha = rutas.prefix(200).map { r -> (String, Date) in
            let f = (try? fm.attributesOfItem(atPath: r)[.modificationDate] as? Date) ?? .distantPast
            return (r, f)
        }
        return conFecha.sorted { $0.1 > $1.1 }.prefix(15).map { r, f in
            ["ruta": r, "nombre": (r as NSString).lastPathComponent, "modificado": fecha.string(from: f)]
        }
    }

    static func rutaPermitida(_ s: String) -> URL? {
        guard !s.isEmpty else { return nil }
        let expandida = (s as NSString).expandingTildeInPath
        let u = URL(fileURLWithPath: expandida).standardizedFileURL.resolvingSymlinksInPath()
        let p = u.path
        let dentro = p == casa || p.hasPrefix(casa + "/") || p.hasPrefix("/Volumes/")
        guard dentro, !p.hasPrefix(casa + "/Library"), FileManager.default.fileExists(atPath: p) else { return nil }
        return u
    }

    static let extensionesPeligrosas: Set<String> = [
        "app", "command", "sh", "zsh", "bash", "csh", "tool", "pkg", "mpkg", "dmg", "terminal", "workflow", "scpt",
        "scptd", "applescript", "jar", "py", "rb", "pl", "php", "js", "action", "osax", "prefpane", "kext", "plugin",
        "webloc", "inetloc", "fileloc", "shortcut", "mobileconfig",
    ]

    static func esEjecutable(_ u: URL) -> Bool {
        if extensionesPeligrosas.contains(u.pathExtension.lowercased()) { return true }
        var dir: ObjCBool = false
        FileManager.default.fileExists(atPath: u.path, isDirectory: &dir)
        return !dir.boolValue && FileManager.default.isExecutableFile(atPath: u.path)
    }
}

// MARK: - Teclado (requiere permiso de Accesibilidad)

enum Teclado {
    struct Atajo { let tecla: CGKeyCode; let mods: CGEventFlags }

    static let teclas: [String: Int] = [
        "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D, "e": kVK_ANSI_E, "f": kVK_ANSI_F,
        "g": kVK_ANSI_G, "h": kVK_ANSI_H, "i": kVK_ANSI_I, "j": kVK_ANSI_J, "k": kVK_ANSI_K, "l": kVK_ANSI_L,
        "m": kVK_ANSI_M, "n": kVK_ANSI_N, "o": kVK_ANSI_O, "p": kVK_ANSI_P, "q": kVK_ANSI_Q, "r": kVK_ANSI_R,
        "s": kVK_ANSI_S, "t": kVK_ANSI_T, "u": kVK_ANSI_U, "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X,
        "y": kVK_ANSI_Y, "z": kVK_ANSI_Z,
        "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3, "4": kVK_ANSI_4,
        "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7, "8": kVK_ANSI_8, "9": kVK_ANSI_9,
        "enter": kVK_Return, "return": kVK_Return, "intro": kVK_Return, "tab": kVK_Tab, "space": kVK_Space,
        "espacio": kVK_Space, "esc": kVK_Escape, "escape": kVK_Escape, "delete": kVK_Delete, "borrar": kVK_Delete,
        "left": kVK_LeftArrow, "izquierda": kVK_LeftArrow, "right": kVK_RightArrow, "derecha": kVK_RightArrow,
        "up": kVK_UpArrow, "arriba": kVK_UpArrow, "down": kVK_DownArrow, "abajo": kVK_DownArrow,
        ",": kVK_ANSI_Comma, ".": kVK_ANSI_Period, "/": kVK_ANSI_Slash, "-": kVK_ANSI_Minus, "=": kVK_ANSI_Equal,
        "f1": kVK_F1, "f2": kVK_F2, "f3": kVK_F3, "f4": kVK_F4, "f5": kVK_F5, "f6": kVK_F6,
    ]

    static func interpretar(_ s: String) -> Atajo? {
        let partes = s.lowercased().replacingOccurrences(of: " ", with: "").split(separator: "+").map(String.init)
        guard let ultima = partes.last, let codigo = teclas[ultima] else { return nil }
        var mods: CGEventFlags = []
        for m in partes.dropLast() {
            switch m {
            case "cmd", "command", "comando", "⌘": mods.insert(.maskCommand)
            case "shift", "mayus", "mayús", "⇧": mods.insert(.maskShift)
            case "alt", "option", "opcion", "opción", "opt", "⌥": mods.insert(.maskAlternate)
            case "ctrl", "control", "⌃": mods.insert(.maskControl)
            default: return nil
            }
        }
        return Atajo(tecla: CGKeyCode(codigo), mods: mods)
    }

    static func presionar(_ a: Atajo) {
        let fuente = CGEventSource(stateID: .combinedSessionState)
        let abajo = CGEvent(keyboardEventSource: fuente, virtualKey: a.tecla, keyDown: true)
        let arriba = CGEvent(keyboardEventSource: fuente, virtualKey: a.tecla, keyDown: false)
        abajo?.flags = a.mods
        arriba?.flags = a.mods
        abajo?.post(tap: .cghidEventTap)
        arriba?.post(tap: .cghidEventTap)
    }

    static func escribir(_ texto: String) {
        let fuente = CGEventSource(stateID: .combinedSessionState)
        let lineas = texto.components(separatedBy: "\n")
        for (i, linea) in lineas.enumerated() {
            let u = Array(linea.utf16)
            var j = 0
            while j < u.count {
                let trozo = Array(u[j..<min(j + 16, u.count)])
                for bajando in [true, false] {
                    let e = CGEvent(keyboardEventSource: fuente, virtualKey: 0, keyDown: bajando)
                    e?.keyboardSetUnicodeString(stringLength: trozo.count, unicodeString: trozo)
                    e?.post(tap: .cghidEventTap)
                }
                j += 16
                usleep(6000)
            }
            if i < lineas.count - 1 {
                presionar(Atajo(tecla: CGKeyCode(kVK_Return), mods: []))
                usleep(6000)
            }
        }
    }
}
