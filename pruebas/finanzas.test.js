import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-fin-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
delete process.env.ANTHROPIC_API_KEY;
const { db } = await import("../server/db.js");
const agencia = await import("../server/agencia.js");
const fin = await import("../server/finanzas.js");
const { ahoraLocalISO } = await import("../server/tiempo.js");

const mes = ahoraLocalISO().slice(0, 7);
const hoy = ahoraLocalISO().slice(0, 10);
const haceDias = (n) => new Date(Date.parse(hoy + "T12:00:00Z") - n * 864e5).toISOString().slice(0, 10);

test("mensualidades: una por cliente activo que paga, sin duplicar y siguiendo su pago", () => {
  const a = agencia.crearCliente({ nombre: "Clínica Sonrisa", presupuesto_mensual: 15000, dia_pago: 10 });
  agencia.crearCliente({ nombre: "Café Origen", presupuesto_mensual: 8000 });
  agencia.crearCliente({ nombre: "Prospecto X", estado: "prospecto", presupuesto_mensual: 5000 });
  agencia.crearCliente({ nombre: "Sin pago" });
  assert.equal(fin.generarMensualidades(), 2);
  assert.equal(fin.generarMensualidades(), 0);
  const cobros = fin.listarCobros({ mes });
  assert.equal(cobros.length, 2);
  const s = cobros.find((c) => c.cliente_id === a.id);
  assert.equal(s.monto, 15000);
  assert.equal(s.vence, `${mes}-10`);
  assert.equal(s.tipo, "mensualidad");
  // Cambia el pago mensual: la mensualidad sin pagar de este mes se ajusta.
  agencia.actualizarCliente(a.id, { presupuesto_mensual: 18000, dia_pago: 12 });
  fin.generarMensualidades();
  const s2 = fin.obtenerCobro(s.id);
  assert.equal(s2.monto, 18000);
  assert.equal(s2.vence, `${mes}-12`);
  assert.throws(() => agencia.actualizarCliente(a.id, { dia_pago: 31 }), /1 al 28/);
  // Las mensualidades ya pagadas, para que las pruebas no dependan del día de hoy.
  for (const c of fin.listarCobros({ mes })) fin.marcarPagado(c.id, hoy);
});

test("cobros: vencido con días de atraso, pagado y de regreso a pendiente", () => {
  const c = fin.registrarCobro({ cliente: "Café Origen", concepto: "Sesión de fotos", monto: "$4,500", vence: haceDias(6) });
  assert.equal(c.monto, 4500);
  assert.equal(c.estado, "vencido");
  assert.equal(c.dias_atraso, 6);
  const p = fin.marcarPagado(c.id);
  assert.equal(p.estado, "pagado");
  assert.equal(p.pagado, hoy);
  assert.equal(fin.marcarPagado(c.id, false).estado, "vencido");
  assert.equal(fin.cobroPendienteDe("Café Origen").id, c.id);
  assert.throws(() => fin.cobroPendienteDe("Clínica Sonrisa"), /no tiene cobros pendientes/);
  assert.throws(() => fin.registrarCobro({ cliente: "Café Origen", concepto: "x", monto: 0 }), /mayor a cero/);
  assert.throws(() => fin.registrarCobro({ cliente: "Nadie", concepto: "x", monto: 10 }), /No encuentro/);
});

test("gastos: los fijos cuentan cada mes; los del cliente van a su rentabilidad; anuncios no cuentan", () => {
  fin.registrarGastoAgencia({ concepto: "Diseñadora", monto: 12000, categoria: "nomina", fecha: `${fin.mover(mes, -2)}-01`, fijo: true });
  fin.registrarGastoAgencia({ concepto: "Fotógrafo", monto: 2000, categoria: "produccion", cliente: "Café Origen" });
  fin.registrarGastoAgencia({ concepto: "Viejo", monto: 999, fecha: `${fin.mover(mes, -1)}-15` });
  agencia.registrarGasto({ cliente: "Café Origen", plataforma: "google", monto: 7000 }); // dinero del cliente
  assert.equal(fin.gastosDelMes(mes).reduce((s, g) => s + g.monto, 0), 14000);
  assert.equal(fin.gastosDelMes(fin.mover(mes, -1)).reduce((s, g) => s + g.monto, 0), 12999);
  assert.equal(fin.gastosDelMes(fin.mover(mes, -3)).length, 0);

  const f = fin.finanzas();
  assert.equal(f.facturado, 18000 + 8000 + 4500);
  assert.equal(f.gastos, 14000);
  assert.equal(f.utilidad, 30500 - 14000);
  assert.equal(f.margen, Math.round(((30500 - 14000) / 30500) * 1000) / 10);
  assert.equal(f.mrr, 26000);
  assert.equal(f.ticket_promedio, 13000);
  assert.equal(f.clientes_que_pagan, 2);
  assert.deepEqual(f.clientes_sin_mensualidad.map((c) => c.nombre), ["Sin pago"]);
  assert.equal(f.cobros_vencidos, 1);
  assert.equal(f.vencido, 4500);
  const cafe = f.rentabilidad.find((r) => r.nombre === "Café Origen");
  assert.equal(cafe.facturado, 12500);
  assert.equal(cafe.gastos, 2000);
  assert.equal(cafe.utilidad, 10500);
  assert.equal(f.historia.length, 12);
  assert.equal(f.historia.at(-1).mes, mes);
  assert.equal(f.gastos_por_categoria[0].categoria, "nomina");
});

test("borrar: un gasto fijo viejo se da de baja sin cambiar meses pasados; mensualidad queda en cero", () => {
  const fijo = db.prepare("SELECT id FROM gastos_agencia WHERE concepto = 'Diseñadora'").get();
  assert.equal(fin.borrarGasto(fijo.id).baja, true);
  assert.equal(fin.gastosDelMes(mes).some((g) => g.concepto === "Diseñadora"), false);
  assert.equal(fin.gastosDelMes(fin.mover(mes, -1)).some((g) => g.concepto === "Diseñadora"), true);

  const m = fin.listarCobros({ mes }).find((c) => c.tipo === "mensualidad" && c.cliente === "Clínica Sonrisa");
  fin.borrarCobro(m.id);
  fin.generarMensualidades();
  assert.equal(fin.listarCobros({ mes }).some((c) => c.id === m.id), false, "no vuelve a aparecer");
});

test("pulso: cuenta lo que pide atención y lo ordena por urgencia", () => {
  agencia.crearProyecto({ cliente: "Café Origen", titulo: "Video de lanzamiento", entrega: haceDias(2) + "T10:00" });
  agencia.pedirAprobacion({ departamento: "contenido", cliente_id: 1, titulo: "Post", contenido: "Texto" });
  const p = fin.pulso();
  const clave = (k) => p.items.find((x) => x.clave === k);
  assert.equal(clave("pagos_vencidos").n, 1);
  assert.equal(clave("pagos_vencidos").ir, "#/finanzas");
  assert.match(clave("pagos_vencidos").detalle[0], /\$4,500/);
  assert.equal(clave("entregas_atrasadas").n, 1);
  assert.equal(clave("clientes_rojo").n, 1);
  assert.equal(clave("aprobaciones").n, 1);
  assert.equal(clave("sin_mensualidad").n, 1);
  assert.equal(p.items[0].nivel, "rojo");
  assert.equal(p.items.at(-1).nivel, "info");
  assert.ok(p.urgentes >= 3);
});
