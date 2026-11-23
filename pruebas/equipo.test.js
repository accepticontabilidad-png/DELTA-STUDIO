import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-equipo-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
process.env.CLAVE_ACCESO = "clave-del-dueno-123";
delete process.env.ANTHROPIC_API_KEY;
const express = (await import("express")).default;
const { db } = await import("../server/db.js");
const seg = await import("../server/seguridad.js");
const agencia = await import("../server/agencia.js");
const agenda = await import("../server/agenda.js");
const crm = await import("../server/crm.js");
const equipo = await import("../server/equipo.js");

// Una API chiquita con las mismas protecciones que la de DELTA
const api = express.Router();
api.use(seg.protegido);
api.use(equipo.autorizar);
const envolver = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(400).json({ error: e.message }); } };
api.get("/panel", envolver((req) => ({ tareas: agenda.listarTareas({ estado: "pendiente", asignada_a: req.usuario ? req.usuario.id : "dueno" }) })));
api.get("/cuentas", envolver(() => agencia.listarClientes().map((c) => ({ id: c.id, nombre: c.nombre }))));
api.get("/crm", envolver((req) => crm.tableroCrm({ cliente: req.query.cliente })));
api.post("/crm/prospectos", envolver((req) => crm.crearProspecto(req.body)));
api.patch("/crm/prospectos/:id", envolver((req) => crm.actualizarProspecto(Number(req.params.id), req.body)));
api.get("/finanzas", envolver(() => ({ secreto: true })));
api.post("/chat", envolver(() => ({ ok: true })));
api.post("/tareas", envolver((req) => agenda.crearTarea(req.body)));
api.patch("/tareas/:id", envolver((req) => agenda.actualizarTarea(Number(req.params.id), req.body)));
api.post("/equipo/personas", envolver((req) => equipo.crearUsuario(req.body)));
const app = express();
app.use(express.json());
app.use("/api", api);
const srv = app.listen(0);
after(() => srv.close());
const base = `http://127.0.0.1:${srv.address().port}/api`;

function cliente(sesion) {
  return async (ruta, { method = "GET", body } = {}) => {
    const r = await fetch(base + ruta, { method, headers: { "Content-Type": "application/json", "X-Delta": "1", Cookie: `delta_sesion=${sesion}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, datos: await r.json() };
  };
}

const kardia = agencia.crearCliente({ nombre: "Kardia" });
const endo = agencia.crearCliente({ nombre: "Endo Woman" });
const pK = crm.crearProspecto({ cliente: "Kardia", nombre: "Ana López", telefono: "5512345678" });
const pE = crm.crearProspecto({ cliente: "Endo Woman", nombre: "Mariana Ruiz", telefono: "5544556677" });

test("crear personas del equipo: validaciones y claves que nunca se guardan tal cual", () => {
  assert.throws(() => equipo.crearUsuario({ nombre: "Sofi", usuario: "so fi", clave: "una-clave-larga" }), /usuario/);
  assert.throws(() => equipo.crearUsuario({ nombre: "Sofi", usuario: "sofi", clave: "corta" }), /al menos 10/);
  assert.throws(() => equipo.crearUsuario({ nombre: "Sofi", usuario: "sofi", clave: process.env.CLAVE_ACCESO }), /propia clave/);
  const u = equipo.crearUsuario({ nombre: "Sofi", usuario: "Sofi", clave: "clave-de-sofi-1", secciones: ["crm", "paidmedia", "finanzas"], clientes: [kardia.id] });
  assert.equal(u.usuario, "sofi");
  assert.deepEqual(u.secciones, ["crm"]); // Paid media junta a todos los clientes y Finanzas nunca se comparte
  assert.deepEqual(u.clientes, [kardia.id]);
  assert.equal(u.clave_hash, undefined);
  const fila = db.prepare("SELECT clave_hash FROM usuarios WHERE id = ?").get(u.id);
  assert.ok(!fila.clave_hash.includes("clave-de-sofi"));
  assert.throws(() => equipo.crearUsuario({ nombre: "Otra", usuario: "sofi", clave: "otra-clave-larga" }), /Ya existe/);
  assert.equal(equipo.verificarUsuario("sofi", "mal-mal-mal-1"), null);
  assert.equal(equipo.verificarUsuario("SOFI", "clave-de-sofi-1").nombre, "Sofi");
  assert.equal(equipo.verificarUsuario("nadie", "clave-de-sofi-1"), null);
});

test("alguien del equipo solo llega a sus secciones y a sus clientes", async () => {
  const sofi = equipo.verificarUsuario("sofi", "clave-de-sofi-1");
  const yo = cliente(seg.crearSesion("pc").id);
  const ella = cliente(seg.crearSesion("cel", sofi.id).id);

  // Lo del dueño: nunca
  assert.equal((await ella("/finanzas")).status, 403);
  assert.equal((await ella("/chat", { method: "POST", body: { texto: "hola" } })).status, 403);
  assert.equal((await ella("/equipo/personas", { method: "POST", body: { nombre: "x", usuario: "xxx", clave: "1234567890ab" } })).status, 403);
  assert.equal((await yo("/finanzas")).status, 200);

  // Solo ve sus clientes
  assert.deepEqual((await ella("/cuentas")).datos.map((c) => c.nombre), ["Kardia"]);
  assert.equal((await yo("/cuentas")).datos.length, 2);
  const tablero = (await ella("/crm")).datos; // sin decir cliente: se le pone el suyo
  const nombres = tablero.etapas.flatMap((e) => e.prospectos).map((p) => p.nombre);
  assert.deepEqual(nombres, ["Ana López"]);
  assert.equal((await ella(`/crm?cliente=${endo.id}`)).status, 403);
  assert.equal((await ella("/crm?cliente=Endo%20Woman")).status, 403);
  assert.equal((await ella(`/crm/prospectos/${pE.id}`, { method: "PATCH", body: { etapa: "cita" } })).status, 403);
  assert.equal((await ella("/crm/prospectos", { method: "POST", body: { cliente: "Endo Woman", nombre: "X" } })).status, 403);
  const ok = await ella(`/crm/prospectos/${pK.id}`, { method: "PATCH", body: { etapa: "contactado" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.datos.etapa, "contactado");
  // Aunque un módulo la buscara por nombre, el cliente de otro no "existe" para ella
  const { alcance } = await import("../server/alcance.js");
  alcance.run({ usuario: sofi }, () => {
    assert.throws(() => crm.crearProspecto({ cliente: "Endo Woman", nombre: "Y" }), /No encuentro/);
    assert.deepEqual(agencia.listarClientes().map((c) => c.nombre), ["Kardia"]);
  });
  assert.equal(agencia.listarClientes().length, 2, "fuera de su alcance (el dueño o lo automático) se ve todo");
});

test("tareas asignadas: ella solo ve y termina las suyas; el dueño no las mezcla con las suyas", async () => {
  const sofi = equipo.verificarUsuario("sofi", "clave-de-sofi-1");
  const mia = agenda.crearTarea({ titulo: "Llamar al contador" });
  const suya = agenda.crearTarea({ titulo: "Subir el reel de Kardia", para: "Sofi" });
  assert.equal(suya.asignada_nombre, "Sofi");
  assert.throws(() => agenda.crearTarea({ titulo: "x", para: "Pedro" }), /No encuentro a "Pedro"/);
  const ella = cliente(seg.crearSesion("cel", sofi.id).id);
  const yo = cliente(seg.crearSesion("pc").id);
  assert.deepEqual((await ella("/panel")).datos.tareas.map((t) => t.titulo), ["Subir el reel de Kardia"]);
  assert.deepEqual((await yo("/panel")).datos.tareas.map((t) => t.titulo), ["Llamar al contador"]);
  assert.equal((await ella(`/tareas/${mia.id}`, { method: "PATCH", body: { estado: "hecha" } })).status, 403);
  assert.equal((await ella(`/tareas/${suya.id}`, { method: "PATCH", body: { titulo: "otra cosa" } })).status, 403);
  assert.equal((await ella(`/tareas/${suya.id}`, { method: "PATCH", body: { estado: "hecha" } })).datos.estado, "hecha");
  const nueva = await ella("/tareas", { method: "POST", body: { titulo: "Pedir fotos al doctor", para: "yo" } });
  assert.equal(nueva.datos.asignada_a, sofi.id); // lo que ella crea es suyo
});

test("historial: quién cambió qué", async () => {
  const h = equipo.historial({});
  const deSofi = h.filter((x) => x.quien === "Sofi").map((x) => x.accion);
  assert.ok(deSofi.includes("Pasó a Ana López a Contactado"), deSofi.join(" | "));
  assert.ok(deSofi.includes('Terminó la tarea "Subir el reel de Kardia"'));
  assert.ok(deSofi.includes('Creó la tarea "Pedir fotos al doctor"'));
  assert.ok(!deSofi.some((a) => /Endo/.test(a)), "lo que se le negó no se anota");
  assert.equal(h.find((x) => x.accion.startsWith("Pasó a Ana")).cliente, "Kardia");
});

test("pausar o cambiar la clave le cierra la sesión al momento; quitarla le regresa sus tareas al dueño", async () => {
  const sofi = equipo.verificarUsuario("sofi", "clave-de-sofi-1");
  const s = seg.crearSesion("cel", sofi.id).id;
  const ella = cliente(s);
  assert.equal((await ella("/panel")).status, 200);
  equipo.actualizarUsuario(sofi.id, { activo: false });
  assert.equal((await ella("/panel")).status, 401);
  assert.equal(equipo.verificarUsuario("sofi", "clave-de-sofi-1"), null);
  equipo.actualizarUsuario(sofi.id, { activo: true, clave: "clave-nueva-de-sofi" });
  assert.equal(equipo.verificarUsuario("sofi", "clave-de-sofi-1"), null);
  assert.ok(equipo.verificarUsuario("sofi", "clave-nueva-de-sofi"));
  // Con todos los clientes ya puede tener Paid media
  const u = equipo.actualizarUsuario(sofi.id, { clientes: null, secciones: ["crm", "paidmedia"] });
  assert.deepEqual(u.secciones, ["crm", "paidmedia"]);
  const t = agenda.crearTarea({ titulo: "Pendiente de Sofi", para: "sofi" });
  equipo.borrarUsuario(sofi.id);
  assert.equal(agenda.obtenerTarea(t.id).asignada_a, null);
  assert.ok(equipo.historial({}).length > 0, "el historial se conserva");
});
