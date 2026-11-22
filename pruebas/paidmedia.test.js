import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-pm-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
delete process.env.ANTHROPIC_API_KEY;
const { db } = await import("../server/db.js");
const agencia = await import("../server/agencia.js");
const pm = await import("../server/paidmedia.js");
const fin = await import("../server/finanzas.js");
const { ahoraLocalISO } = await import("../server/tiempo.js");

const mes = ahoraLocalISO().slice(0, 7);
const hoy = ahoraLocalISO().slice(0, 10);

const camp = (o) => ({ id: o.id, nombre: o.nombre, objetivo: o.objetivo || "OUTCOME_LEADS", activa: o.activa ?? true, cuenta: "Ads", gasto: o.gasto, impresiones: o.imp || 10000,
  alcance: 5000, frecuencia: o.frec || 1.5, clics_enlace: o.clics || 150, conversaciones: o.conv || 0, prospectos: o.prosp || 0, compras: o.compras || 0, valor_compras: o.valor || 0,
  semana: o.semana || { gasto: 0, resultados: 0 } });

function fotoMeta(clienteId, anuncios) {
  db.prepare("INSERT INTO meta_activos (id, tipo, nombre, cliente_id) VALUES (?, 'anuncios', 'Ads', ?)").run(`act_${clienteId}`, clienteId);
  db.prepare("INSERT INTO meta_fotos (cliente_id, fecha, datos) VALUES (?,?,?)").run(clienteId, hoy, JSON.stringify({ anuncios }));
  agencia.registrarGasto({ cliente: clienteId, plataforma: "meta", monto: anuncios.gasto_mes, fuente: "meta" });
}

test("cliente con Meta: costo por contacto, retorno y avisos por campaña", () => {
  const c = agencia.crearCliente({ nombre: "Clínica Sonrisa", presupuesto_anuncios: 10000 });
  const campanas = [
    camp({ id: "a", nombre: "Mensajes", gasto: 4000, conv: 80, objetivo: "OUTCOME_ENGAGEMENT" }),
    camp({ id: "b", nombre: "Formulario", gasto: 2000, prosp: 10, frec: 4.8 }),
    camp({ id: "c", nombre: "Ventas frías", gasto: 1500, semana: { gasto: 600, resultados: 0 }, objetivo: "OUTCOME_SALES" }),
    camp({ id: "d", nombre: "Alcance", gasto: 800, objetivo: "OUTCOME_AWARENESS" }),
  ];
  fotoMeta(c.id, { gasto_mes: 8300, impresiones: 100000, clics_enlace: 1500, conversaciones: 80, prospectos: 10, compras: 3, valor_compras: 6000, campanas_activas: 4, campanas });
  const x = pm.paidMediaCliente(agencia.obtenerCliente(c.id), mes);
  assert.equal(x.inversion, 8300);
  assert.equal(x.contactos, 90);
  assert.equal(x.costo_por_contacto, Math.round((8300 / 90) * 100) / 100);
  assert.equal(x.ventas, 3);
  assert.equal(x.roas, Math.round((6000 / 8300) * 100) / 100);
  assert.equal(x.fuente_resultados, "meta");
  assert.equal(x.nivel, "rojo");
  const tipos = x.avisos.map((a) => `${a.tipo}:${a.campana || ""}:${a.nivel}`);
  assert.ok(tipos.includes("sin_resultados:Ventas frías:rojo"), tipos.join());
  assert.ok(tipos.includes("costo_alto:Formulario:amarillo"), tipos.join()); // 200 por resultado vs 60 promedio
  assert.ok(tipos.includes("cansancio:Formulario:amarillo"));
  assert.ok(tipos.includes("retorno::rojo")); // vende 6,000 con 8,300
});

test("lo que reporta el cliente manda sobre Meta y se mide contra toda la inversión", () => {
  const c = agencia.obtenerCliente(1);
  agencia.registrarGasto({ cliente: c.id, plataforma: "google", monto: 1700 });
  const r = pm.registrarResultados({ cliente: "Clínica Sonrisa", prospectos: 120, valor_ventas: "$40,000" });
  assert.equal(r.prospectos, 120);
  assert.equal(r.ventas, null);
  const x = r.numeros;
  assert.equal(x.inversion, 10000);
  assert.equal(x.fuente_resultados, "cliente");
  assert.equal(x.contactos, 120);
  assert.equal(x.costo_por_contacto, 83.33);
  assert.equal(x.ventas, 3); // no lo dijo: sigue lo de Meta
  assert.equal(x.roas, 4);
  assert.ok(!x.avisos.some((a) => a.tipo === "retorno"));
  assert.ok(x.avisos.some((a) => a.tipo === "tope" && a.nivel === "amarillo")); // 100 % del tope
  // Una segunda anotación no borra lo anterior.
  assert.equal(pm.registrarResultados({ cliente: c.id, ventas: 9 }).prospectos, 120);
  assert.throws(() => pm.registrarResultados({ cliente: c.id }), /al menos/);
  assert.throws(() => pm.registrarResultados({ cliente: c.id, ventas: -2 }), /número/);
});

test("cliente sin Meta: gasto a mano sin resultados avisa; tablero junta todo", () => {
  const p = agencia.crearCliente({ nombre: "Pizzería Don Luis" });
  agencia.registrarGasto({ cliente: p.id, plataforma: "google", monto: 3000 });
  let x = pm.paidMediaCliente(agencia.obtenerCliente(p.id), mes);
  assert.equal(x.contactos, null);
  assert.equal(x.nivel, "verde");
  assert.equal(x.avisos[0].tipo, "sin_datos");
  pm.registrarResultados({ cliente: p.id, prospectos: 0, ventas: 0 });
  x = pm.paidMediaCliente(agencia.obtenerCliente(p.id), mes);
  assert.equal(x.nivel, "rojo");
  assert.match(x.avisos[0].texto, /no hay mensajes/);

  agencia.crearCliente({ nombre: "Sin anuncios" });
  const t = pm.paidMedia();
  assert.deepEqual(t.clientes.map((c) => c.nombre).sort(), ["Clínica Sonrisa", "Pizzería Don Luis"]);
  assert.equal(t.inversion, 13000);
  assert.equal(t.contactos, 120);
  assert.equal(t.costo_por_contacto, Math.round((10000 / 120) * 100) / 100); // la pizzería tiene 0 contactos: no entra a la base
  assert.equal(t.roas, 4);
  assert.equal(t.campanas[0].cliente, "Clínica Sonrisa");
  assert.equal(t.campanas_activas, 4);
  assert.equal(t.historia.length, 6);
  assert.equal(t.historia.at(-1).inversion, 13000);
  assert.equal(t.avisos[0].nivel, "rojo");
  assert.throws(() => pm.paidMedia("2026-13x"), /Mes no válido/);
});

test("pulso: campañas gastando sin resultados llevan a Paid media", () => {
  const p = fin.pulso();
  const k = p.items.find((x) => x.clave === "anuncios_sin_resultados");
  assert.equal(k.ir, "#/paidmedia");
  assert.equal(k.nivel, "rojo");
  assert.equal(k.n, 2); // Ventas frías + Pizzería sin resultados
});
