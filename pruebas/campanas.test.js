import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-camp-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
process.env.META_ACCESS_TOKEN = "token-de-prueba";
delete process.env.ANTHROPIC_API_KEY;
const { db } = await import("../server/db.js");
const agencia = await import("../server/agencia.js");
const campanas = await import("../server/campanas.js");

// Meta de mentira: anota cada escritura y responde ids.
const escrito = [];
let falla = null;
let n = 0;
const campanasMeta = { "900": { id: "900", name: "Promo vieja", status: "ACTIVE", account_id: "111", daily_budget: "20000" }, "901": { id: "901", name: "Por conjuntos", status: "ACTIVE", account_id: "111" }, "777": { id: "777", name: "Ajena", account_id: "999", daily_budget: "5000" } };
campanas._dePrueba({
  graph: {
    leer: async (ruta) => {
      if (ruta === "/search") return { data: [{ key: "1528", name: "Puebla", region: "Puebla" }] };
      if (ruta === "/901/adsets") return { data: [{ id: "a1", name: "A", daily_budget: "10000", effective_status: "ACTIVE" }, { id: "a2", name: "B", daily_budget: "30000", effective_status: "ACTIVE" }] };
      const id = ruta.slice(1);
      if (campanasMeta[id]) return campanasMeta[id];
      throw new Error("Meta: no existe");
    },
    escribir: async (ruta, cuerpo) => {
      if (falla && ruta.endsWith(falla)) { falla = null; const e = new Error("Meta: (#200) Requires ads_management permission"); e.codigo = 200; throw e; }
      escrito.push({ ruta, cuerpo });
      if (ruta.endsWith("/adimages")) return { images: { "x.png": { hash: "HASH1" } } };
      return { id: String(++n), success: true };
    },
  },
  proponer: async ({ c, funciono }) => ({
    nombre: `${c.nombre} · Limpieza`, resumen: "Mensajes por WhatsApp a gente cerca.", por_que: funciono.length ? "Repite lo que funcionó" : "Primera vez",
    publico: { edad_min: 25, edad_max: 55, genero: "mujeres", ciudad: "Puebla", radio_km: 15, descripcion: "Mamás cerca de la clínica" },
    textos: [1, 2, 3].map((i) => ({ enfoque: `Enfoque ${i}`, texto: `Texto ${i}`, titulo: `Título ${i}`, descripcion: "Agenda hoy" })),
    prompt_imagen: "smiling woman at a dental clinic", consejos: ["Revisa el costo por mensaje"],
  }),
  imagen: async () => ({ datos: Buffer.from([137, 80, 78, 71]), tipo: "image/png", modelo: "prueba" }),
});
const refrescados = [];
campanas._refrescarDePrueba((id) => refrescados.push(id));

const c = agencia.crearCliente({ nombre: "Clínica Sonrisa" });
db.prepare("INSERT INTO meta_activos (id, tipo, nombre, cliente_id) VALUES ('act_111','anuncios','Ads Sonrisa',?)").run(c.id);
db.prepare("INSERT INTO meta_activos (id, tipo, nombre, cliente_id, extra) VALUES ('page:222','pagina','Sonrisa',?,'{}')").run(c.id);
db.prepare("INSERT INTO meta_fotos (cliente_id, fecha, datos) VALUES (?, '2026-11-01', ?)").run(c.id, JSON.stringify({ anuncios: { campanas: [{ nombre: "WhatsApp limpieza", gasto: 1000, conversaciones: 50 }] } }));

test("valida lo básico antes de llamar a DELTA", async () => {
  await assert.rejects(campanas.crear({ cliente: c.id, objetivo: "whatsapp", oferta: "", presupuesto_diario: 100 }), /qué quieres anunciar/);
  await assert.rejects(campanas.crear({ cliente: c.id, objetivo: "nada", oferta: "x", presupuesto_diario: 100 }), /objetivo/);
  await assert.rejects(campanas.crear({ cliente: c.id, objetivo: "sitio", oferta: "x", presupuesto_diario: 100 }), /dirección del sitio/);
  await assert.rejects(campanas.crear({ cliente: c.id, objetivo: "whatsapp", oferta: "x", presupuesto_diario: 0 }), /al día/);
});

let id;
test("arma la propuesta con cuenta y página del cliente", async () => {
  const k = await campanas.crear({ cliente: c.id, objetivo: "whatsapp", oferta: "Limpieza dental $499", presupuesto_diario: "$150", dias: 7 });
  id = k.id;
  assert.equal(k.estado, "borrador");
  assert.equal(k.cuenta_id, "act_111");
  assert.equal(k.pagina_id, "222");
  assert.equal(k.presupuesto_diario, 150);
  assert.equal(k.propuesta.textos.length, 3);
  assert.equal(k.propuesta.por_que, "Repite lo que funcionó");
  assert.equal(escrito.length, 0, "todavía no toca Meta");
});

test("sin imagen no sube; con imagen sube todo EN PAUSA", async () => {
  await assert.rejects(campanas.subirAMeta(id), /Falta la imagen/);
  await campanas.generarImagen(id);
  campanas.editar(id, { texto_elegido: 1, publico: { edad_min: 60, edad_max: 30 } });
  assert.equal(campanas.obtener(id).propuesta.publico.edad_min, 30);
  const k = await campanas.subirAMeta(id);
  assert.equal(k.estado, "en_meta");
  const rutas = escrito.map((e) => e.ruta);
  assert.deepEqual(rutas, ["/act_111/adimages", "/act_111/campaigns", "/act_111/adsets", "/act_111/adcreatives", "/act_111/ads"]);
  for (const e of escrito.filter((x) => "status" in x.cuerpo)) assert.equal(e.cuerpo.status, "PAUSED");
  const conjunto = escrito[2].cuerpo;
  assert.equal(conjunto.daily_budget, 15000);
  assert.equal(conjunto.destination_type, "WHATSAPP");
  assert.deepEqual(conjunto.targeting.genders, [2]);
  assert.equal(conjunto.targeting.geo_locations.cities[0].key, "1528");
  assert.ok(conjunto.end_time);
  const creativo = escrito[3].cuerpo.object_story_spec;
  assert.equal(creativo.link_data.message, "Texto 2");
  assert.equal(creativo.link_data.call_to_action.value.app_destination, "WHATSAPP");
  assert.ok(k.administrador.includes("act=111"));
  assert.throws(() => campanas.editar(id, { oferta: "otra" }), /ya está en Meta/);
});

test("encender solo prende lo que DELTA creó", async () => {
  escrito.length = 0;
  const k = await campanas.encender(id);
  assert.equal(k.estado, "activa");
  assert.deepEqual(escrito.map((e) => e.cuerpo.status), ["ACTIVE", "ACTIVE", "ACTIVE"]);
  await assert.rejects(campanas.encender(id), /Ya está encendida/);
});

test("si Meta falla a la mitad, reintentar sigue donde se quedó", async () => {
  const k = await campanas.crear({ cliente: c.id, objetivo: "sitio", oferta: "Blanqueamiento", presupuesto_diario: 200, enlace: "sonrisa.mx" });
  await campanas.generarImagen(k.id);
  escrito.length = 0;
  falla = "/adsets";
  await assert.rejects(campanas.subirAMeta(k.id), /ads_management/);
  assert.match(campanas.obtener(k.id).error, /permiso/);
  assert.deepEqual(escrito.map((e) => e.ruta), ["/act_111/adimages", "/act_111/campaigns"]);
  escrito.length = 0;
  const listo = await campanas.subirAMeta(k.id);
  assert.equal(listo.estado, "en_meta");
  assert.deepEqual(escrito.map((e) => e.ruta), ["/act_111/adsets", "/act_111/adcreatives", "/act_111/ads"]);
  assert.equal(escrito[1].cuerpo.object_story_spec.link_data.link, "https://sonrisa.mx");
});

test("pausar y cambiar presupuesto de campañas existentes", async () => {
  escrito.length = 0;
  const r = await campanas.cambiarEstado("900", false);
  assert.equal(r.activa, false);
  assert.deepEqual(escrito[0], { ruta: "/900", cuerpo: { status: "PAUSED" } });
  await assert.rejects(campanas.cambiarEstado("777", false), /no es de una cuenta/);

  const p = await campanas.presupuesto("900");
  assert.equal(p.diario, 200);
  await assert.rejects(campanas.cambiarPresupuesto("900", 5000), /5 veces/);
  const cambio = await campanas.cambiarPresupuesto("900", 260);
  assert.equal(cambio.ahora, 260);
  assert.equal(escrito.at(-1).cuerpo.daily_budget, 26000);

  // Presupuesto en los conjuntos: se reparte igual que antes (100 y 300 → 25 % y 75 %)
  escrito.length = 0;
  const q = await campanas.cambiarPresupuesto("901", 800);
  assert.equal(q.antes, 400);
  assert.deepEqual(escrito.map((e) => [e.ruta, e.cuerpo.daily_budget]), [["/a1", 20000], ["/a2", 60000]]);
  assert.ok(refrescados.length >= 3);
});
