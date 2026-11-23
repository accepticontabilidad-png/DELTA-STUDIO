// Conexión con DELTA: vincular, recoger órdenes (petición larga) y contestar.
import Foundation

/// La llave de esta Mac se guarda en un archivo privado (solo su usuario puede leerlo).
enum Llave {
    static var archivo: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DELTA Mac", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return dir.appendingPathComponent("llave")
    }
    static func leer() -> String? {
        guard let s = try? String(contentsOf: archivo, encoding: .utf8) else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
    static func hay() -> Bool { leer() != nil }
    static func guardar(_ v: String) {
        FileManager.default.createFile(atPath: archivo.path, contents: Data(v.utf8), attributes: [.posixPermissions: 0o600])
    }
    static func borrar() { try? FileManager.default.removeItem(at: archivo) }
}

struct ErrorDelta: LocalizedError {
    let mensaje: String
    var errorDescription: String? { mensaje }
}

final class Conexion: @unchecked Sendable {
    var alCambiar: (@MainActor (Delegado.Estado) -> Void)?
    private var corriendo = false

    private func peticion(_ ruta: String, metodo: String = "GET", cuerpo: [String: Any]? = nil, espera: TimeInterval = 20) async throws -> (Int, [String: Any]) {
        guard let base = URL(string: Pref.url) else { throw ErrorDelta(mensaje: "Dirección de DELTA no válida") }
        var req = URLRequest(url: base.appendingPathComponent(ruta))
        req.httpMethod = metodo
        req.timeoutInterval = espera
        req.setValue(VERSION, forHTTPHeaderField: "X-Delta-Mac-Version")
        if let llave = Llave.leer() { req.setValue("Bearer \(llave)", forHTTPHeaderField: "Authorization") }
        if let c = cuerpo {
            req.httpBody = try JSONSerialization.data(withJSONObject: c)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (datos, resp) = try await URLSession.shared.data(for: req)
        let codigo = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: datos)) as? [String: Any] ?? [:]
        return (codigo, json)
    }

    private func avisar(_ e: Delegado.Estado) async {
        let f = alCambiar
        await MainActor.run { f?(e) }
    }

    func vincular(codigo: String, nombre: String) async throws {
        Llave.borrar()
        let (c, json) = try await peticion("mac/vincular", metodo: "POST", cuerpo: ["codigo": codigo, "nombre": nombre, "version": VERSION])
        guard c == 200, let llave = json["llave"] as? String else {
            throw ErrorDelta(mensaje: (json["error"] as? String) ?? "DELTA no contestó (código \(c)).")
        }
        Llave.guardar(llave)
        await avisar(.conectando)
    }

    func despertar() {
        guard Llave.hay() else { return }
        Task { _ = try? await peticion("mac/despertar", metodo: "POST", cuerpo: [:], espera: 8) }
    }

    func empezar() {
        guard !corriendo else { return }
        corriendo = true
        Task { await bucle() }
    }

    private func bucle() async {
        var pausa: Double = 1
        while true {
            guard Llave.hay() else {
                await avisar(.sinVincular)
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                continue
            }
            do {
                let (c, json) = try await peticion("mac/ordenes", espera: 45)
                if c == 401 {
                    Llave.borrar()
                    await avisar(.sinVincular)
                    continue
                }
                guard c == 200 else { throw ErrorDelta(mensaje: "código \(c)") }
                await avisar(.conectada)
                pausa = 1
                for orden in (json["ordenes"] as? [[String: Any]]) ?? [] {
                    await atender(orden)
                }
            } catch {
                await avisar(.sinConexion)
                try? await Task.sleep(nanoseconds: UInt64(pausa * 1_000_000_000))
                pausa = min(pausa * 2, 30)
            }
        }
    }

    private func atender(_ orden: [String: Any]) async {
        guard let id = orden["id"] as? String, let accion = orden["accion"] as? String else { return }
        let datos = orden["datos"] as? [String: Any] ?? [:]
        let r = await Acciones.hacer(accion, datos, riesgo: orden["riesgo"] as? Bool ?? false)
        var cuerpo: [String: Any] = ["id": id, "ok": r.ok]
        if r.ok { cuerpo["resultado"] = r.valor } else { cuerpo["error"] = r.error ?? "No se pudo." }
        for intento in 0..<3 {
            if let (c, _) = try? await peticion("mac/resultado", metodo: "POST", cuerpo: cuerpo), c == 200 { return }
            try? await Task.sleep(nanoseconds: UInt64(intento + 1) * 1_000_000_000)
        }
    }
}
