import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-ag-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
delete process.env.ANTHROPIC_API_KEY;
const agencia = await import("../server/agencia.js");
const deptos = await import("../server/departamentos.js");

test("clientes: alta, búsqueda por nombre o id, edición y sin duplicados", () => {
  const c = agencia.crearCliente({ nombre: "Clínica Sonrisa", industria: "odontología", presupuesto_mensual: "15000" });
  assert.equal(c.estado, "activo");
  assert.equal(c.presupuesto_mensual, 15000);
  assert.equal(agencia.buscarCliente("sonrisa").id, c.id);
  assert.equal(agencia.buscarCliente(String(c.id)).nombre, "Clínica Sonrisa");
  assert.throws(() => agencia.crearCliente({ nombre: "clínica sonrisa" }), /Ya existe/);
  assert.equal(agencia.actualizarCliente("Sonrisa", { estado: "pausado" }).estado, "pausado");
  assert.throws(() => agencia.actualizarCliente("Sonrisa", { estado: "raro" }), /no válido/);
  agencia.actualizarCliente(c.id, { estado: "activo" });
});

test("proyectos: se crean con entrega y aparecen en el tablero", () => {
  const p = agencia.crearProyecto({ cliente: "Sonrisa", titulo: "Campaña blanqueamiento", departamento: "contenido", entrega: "2099-01-10T10:00" });
  assert.equal(p.cliente, "Clínica Sonrisa");
  assert.equal(p.entrega, "2099-01-10T16:00:00.000Z");
  const t = agencia.tablero();
  assert.equal(t.clientes_activos, 1);
  assert.equal(t.proyectos_abiertos, 1);
  assert.equal(t.presupuesto_mensual, 15000);
  agencia.actualizarProyecto(p.id, { estado: "entregado" });
  assert.equal(agencia.tablero().proyectos_abiertos, 0);
});

test("aprobaciones: pendiente → aprobada una sola vez", () => {
  const a = agencia.pedirAprobacion({ departamento: "contenido", cliente_id: 1, tipo: "publicacion", titulo: "Post lunes", contenido: "Texto del post" });
  assert.equal(a.estado, "pendiente");
  assert.equal(agencia.listarAprobaciones().length, 1);
  const r = agencia.resolverAprobacion(a.id, "aprobada", "Va");
  assert.equal(r.estado, "aprobada");
  assert.throws(() => agencia.resolverAprobacion(a.id, "rechazada"), /ya estaba/);
  assert.equal(agencia.listarAprobaciones().length, 0);
  assert.throws(() => agencia.pedirAprobacion({ departamento: "x", tipo: "otro", titulo: "", contenido: "" }), /título/);
});

test("departamentos: son 11, incluye edición de video y diseño", () => {
  assert.equal(deptos.DEPARTAMENTOS.length, 11);
  assert.ok(deptos.deptoPorId("video"));
  assert.ok(deptos.deptoPorId("diseno"));
  assert.throws(() => deptos.encargar({ departamento: "magia", encargo: "x" }), /No existe el departamento/);
  assert.throws(() => deptos.encargar({ departamento: "video", encargo: "x", cliente: "Nadie" }), /No encuentro/);
});

test("encargo: responde al instante y, sin clave de Claude, el trabajo queda como fallido (no se cuelga)", async () => {
  const r = deptos.encargar({ departamento: "tendencias", encargo: "Tendencias de la semana", cliente: "Sonrisa" });
  assert.equal(r.estado, "en_proceso");
  assert.equal(r.cliente, "Clínica Sonrisa");
  for (let i = 0; i < 50 && agencia.obtenerTrabajo(r.trabajo_id).estado === "en_proceso"; i++) await new Promise((x) => setTimeout(x, 20));
  const t = agencia.obtenerTrabajo(r.trabajo_id);
  assert.equal(t.estado, "fallo");
  assert.match(t.resultado, /clave de Claude/);
});

test("cuentas: semáforo de salud con motivos, gasto contra tope y salud a mano", () => {
  const c = agencia.crearCliente({ nombre: "Semáforo Clínica", presupuesto_anuncios: 1000 });
  assert.equal(agencia.saludCliente(agencia.obtenerCliente(c.id)).nivel, "verde");
  agencia.registrarGasto({ cliente: c.id, plataforma: "meta", monto: "900" });
  let s = agencia.saludCliente(agencia.obtenerCliente(c.id));
  assert.equal(s.nivel, "amarillo");
  assert.match(s.motivos[0], /90 %/);
  // Anotar otra vez la misma plataforma reemplaza el total del mes (no suma)
  const g = agencia.registrarGasto({ cliente: c.id, plataforma: "meta", monto: 1200 });
  assert.equal(g.total_mes, 1200);
  assert.equal(agencia.saludCliente(agencia.obtenerCliente(c.id)).nivel, "rojo");
  assert.throws(() => agencia.registrarGasto({ cliente: c.id, plataforma: "radio", monto: 1 }), /Plataforma/);
  assert.throws(() => agencia.registrarGasto({ cliente: c.id, plataforma: "google", monto: -5 }), /positivo/);
  // Marcada a mano manda sobre el cálculo, y "auto" la regresa
  agencia.actualizarCliente(c.id, { salud_manual: "verde", salud_nota: "Ya lo platicamos" });
  s = agencia.saludCliente(agencia.obtenerCliente(c.id));
  assert.equal(s.nivel, "verde");
  assert.equal(s.automatico, "rojo");
  assert.match(s.motivos[0], /Ya lo platicamos/);
  agencia.actualizarCliente(c.id, { salud_manual: "auto" });
  assert.equal(agencia.obtenerCliente(c.id).salud_nota, null);
  assert.throws(() => agencia.actualizarCliente(c.id, { salud_manual: "morado" }), /Salud no válida/);
});

test("panel general: alertas del día, salud de la cartera y ficha con juntas y gasto", async () => {
  const agenda = await import("../server/agenda.js");
  const c = agencia.crearCliente({ nombre: "Alerta Derma", presupuesto_anuncios: 500 });
  agencia.crearProyecto({ cliente: c.id, titulo: "Landing atrasada", entrega: "2020-01-01T10:00" });
  agenda.crearEvento({ titulo: "Revisión mensual", inicio: "2099-03-01T10:00", cliente: "Alerta Derma" });
  const t = agencia.tablero();
  assert.ok(t.alertas.some((a) => a.nivel === "rojo" && /Landing atrasada/.test(a.texto) && a.cliente_id === c.id));
  assert.ok(t.salud.rojo >= 1);
  assert.equal(t.alertas[0].nivel, "rojo"); // lo urgente va primero
  const f = agencia.fichaCliente(c.id);
  assert.equal(f.salud.nivel, "rojo");
  assert.equal(f.juntas[0].titulo, "Revisión mensual");
  assert.equal(f.gasto.historial.length, 6);
  assert.ok(agencia.cuentas().find((x) => x.id === c.id).proxima_junta);
});
