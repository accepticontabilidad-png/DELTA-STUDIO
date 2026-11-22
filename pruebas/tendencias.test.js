import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-tend-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.META_ACCESS_TOKEN;
const { db, getAjuste, setAjuste } = await import("../server/db.js");
const agencia = await import("../server/agencia.js");
const k = await import("../server/contenido.js");
const t = await import("../server/tendencias.js");

const RSS = `<?xml version="1.0"?><rss xmlns:ht="https://trends.google.com/trending/rss"><channel>
<item><title>Gripe aviar</title><ht:approx_traffic>200K+</ht:approx_traffic><pubDate>Sun, 22 Nov 2026 08:00:00 -0800</pubDate>
  <ht:news_item><ht:news_item_title>Salud confirma caso de &amp;quot;gripe aviar&amp;quot;</ht:news_item_title><ht:news_item_url>https://ej.mx/a</ht:news_item_url><ht:news_item_source>El Diario</ht:news_item_source></ht:news_item></item>
<item><title>América vs Toluca</title><ht:approx_traffic>500K+</ht:approx_traffic><pubDate>Sun, 22 Nov 2026 07:00:00 -0800</pubDate></item>
<item><title>Infarto joven</title><ht:approx_traffic>2,000+</ht:approx_traffic>
  <ht:news_item><ht:news_item_title>Por qué aumentan los infartos en menores de 40: cardiólogos</ht:news_item_title><ht:news_item_url>https://ej.mx/b</ht:news_item_url><ht:news_item_source>Salud Hoy</ht:news_item_source></ht:news_item></item>
</channel></rss>`;

const ahora = Date.now();
const post = (dias, likes, coment, extra = {}) => ({ caption: `Post de hace ${dias} días`, like_count: likes, comments_count: coment, media_type: "VIDEO", media_product_type: "REELS", permalink: `https://instagram.com/p/${dias}`, timestamp: new Date(ahora - dias * 864e5).toISOString(), ...extra });

test("lee Google Tendencias y encuentra lo que toca el nicho", () => {
  const l = t.leerGoogleTendencias(RSS);
  assert.equal(l.length, 3);
  assert.equal(l[0].tema, "Gripe aviar");
  assert.equal(l[0].n, 200000);
  assert.equal(l[2].n, 2000);
  assert.equal(l[0].noticias[0].fuente, "El Diario");
  const r = t.relevantes(l, ["cardiología", "infartos"]);
  assert.deepEqual(r.map((x) => x.tema), ["Infarto joven"]);
  assert.deepEqual(t.relevantes(l, ["de", "la"]), []);
});

test("Instagram: solo lo que funciona muy por encima de lo normal de esa cuenta", () => {
  const cuenta = { username: "cardio.mx", followers_count: 12000, media: { data: [
    post(2, 900, 60), post(5, 100, 5), post(8, 120, 4), post(12, 90, 6), post(15, 110, 3, { media_type: "CAROUSEL_ALBUM", media_product_type: "FEED" }), post(60, 2000, 100),
  ] } };
  const d = t.destacadas(cuenta);
  assert.equal(d.length, 1); // el de hace 60 días ya no cuenta
  assert.equal(d[0].cuenta, "cardio.mx");
  assert.equal(d[0].formato, "reel");
  assert.ok(d[0].veces > 5);
  assert.deepEqual(t.destacadas({ username: "x", media: [post(1, 10, 0)] }), []); // muy pocas publicaciones
});

test("configurar el nicho: sugiere de la ficha, guarda temas y cuentas, rechaza cuentas raras", () => {
  const c = agencia.crearCliente({ nombre: "Kardia", industria: "Cardiología", servicios: "redes, anuncios" });
  assert.deepEqual(t.configCliente(c).palabras.slice(0, 1), ["Cardiología"]);
  assert.equal(t.configCliente(c).sugeridas, true);
  const r = t.configurarTendencias({ cliente: "Kardia", palabras: "cardiología, colesterol, infartos", cuentas: ["@Cardio.MX", "https://www.instagram.com/dr.corazon/"] });
  assert.deepEqual(r.palabras, ["cardiología", "colesterol", "infartos"]);
  assert.deepEqual(r.cuentas, ["cardio.mx", "dr.corazon"]);
  assert.equal(r.sugeridas, false);
  assert.throws(() => t.configurarTendencias({ cliente: "Kardia", cuentas: ["no vale!"] }), /no parece/);
  assert.deepEqual(t.configurarTendencias({ cliente: "Kardia", palabras: ["corazón"] }).cuentas, ["cardio.mx", "dr.corazon"]);
});

test("buscar: junta señales, guarda ideas y una idea pasa a Contenido una sola vez", async () => {
  let recibido = null;
  t._fuentesDePrueba({
    google: async () => t.leerGoogleTendencias(RSS),
    noticias: async (pal) => ({ lista: [{ titulo: "Nuevo estudio sobre el corazón", fuente: "X", enlace: "https://ej.mx/c", fecha: new Date().toISOString(), tema: pal[0] }], avisos: [] }),
    instagram: async () => ({ lista: [], avisos: ["@x: no es cuenta de empresa"] }),
    ideas: async (c, senales) => {
      recibido = senales;
      return [
        { titulo: "Reel: 3 señales de infarto en jóvenes", gancho: "Tienes 35 y te duele el pecho…", formato: "reel", red: "instagram", por_que: "Se está buscando mucho hoy", pasos: ["Gancho", "Señal 1", "Señal 2", "Cierre"], basada_en: "Google: Infarto joven", urgencia: "hoy" },
        { titulo: "Carrusel colesterol", gancho: "Mitos", formato: "inventado", red: "nada", por_que: "", pasos: "no", basada_en: "", urgencia: "luego" },
        { titulo: "" },
      ];
    },
  });
  t.configurarTendencias({ cliente: "Kardia", palabras: ["infartos", "corazón"] });
  setAjuste("meta_token", "prueba"); // Meta "conectado" (Instagram va simulado)
  const r = await t.buscarTendencias("Kardia");
  assert.equal(r.ideas_nuevas, 2);
  assert.deepEqual(recibido.busquedas.map((x) => x.tema), ["Infarto joven"]);
  assert.equal(recibido.noticias.length, 1);
  assert.ok(r.avisos.some((a) => /no es cuenta de empresa/.test(a)));
  assert.equal(r.ideas[0].urgencia, "hoy");
  const rara = r.ideas.find((i) => i.titulo === "Carrusel colesterol");
  assert.equal(rara.formato, "reel"); // formato desconocido → reel
  assert.equal(rara.red, "instagram");
  assert.deepEqual(rara.pasos, []);
  assert.equal(t.ideasNuevas(), 2);

  const { pieza } = t.ideaAContenido(r.ideas[0].id, { publicar: null });
  assert.equal(pieza.etapa, "planeado");
  assert.equal(pieza.titulo, "Reel: 3 señales de infarto en jóvenes");
  assert.match(pieza.notas, /Gancho: "Tienes 35/);
  assert.match(pieza.notas, /1\. Gancho/);
  assert.throws(() => t.ideaAContenido(r.ideas[0].id), /ya está en Contenido/);
  assert.equal(k.listarContenido({ cliente: "Kardia" }).length, 1);
  assert.equal(t.ideasNuevas(), 1);

  assert.equal(t.buscarIdea({ titulo: "colesterol" }).titulo, "Carrusel colesterol");
  t.descartarIdea(rara.id);
  assert.throws(() => t.buscarIdea({ titulo: "colesterol" }), /No encuentro/);
  const d = t.tendenciasCliente("Kardia");
  assert.equal(d.ideas.length, 0);
  assert.equal(d.usadas.length, 1);
  assert.equal(d.usadas[0].contenido_id, pieza.id);
});

test("tablero y lunes: busca una vez por semana; si Google falla, enseña lo último", async () => {
  const tab = await t.tableroTendencias({ cliente: "Kardia" });
  assert.equal(tab.hoy.lista[0].tema, "Gripe aviar");
  assert.equal(tab.clientes.find((c) => c.nombre === "Kardia").ideas_nuevas, 0);
  assert.equal(tab.detalle.cliente.nombre, "Kardia");

  t._fuentesDePrueba({ ideas: async () => [{ titulo: "Idea del lunes", gancho: "x", formato: "post", red: "facebook", por_que: "x", pasos: [], basada_en: "", urgencia: "semana" }] });
  assert.equal(await t.revisarSemana({ ahora: "2026-11-24T09:00", avisarDueno: false }), null); // martes
  assert.equal(await t.revisarSemana({ ahora: "2026-11-23T07:30", avisarDueno: false }), null); // muy temprano
  const r = await t.revisarSemana({ ahora: "2026-11-23T08:15", avisarDueno: false });
  assert.equal(r.ideas, 1);
  assert.equal(getAjuste("tendencias_semana"), "2026-11-23");
  assert.equal(await t.revisarSemana({ ahora: "2026-11-23T10:00", avisarDueno: false }), null);

  const { olvidarCache } = await import("../server/cache.js");
  olvidarCache("tendencias:");
  t._fuentesDePrueba({ google: async () => { throw new Error("sin red"); } });
  const h = await t.busquedasHoy();
  assert.match(h.error, /no respondió/);
  assert.equal(h.lista[0].tema, "Gripe aviar");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tendencias_busquedas").get().n, 2);
});
