import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-seo-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
delete process.env.ANTHROPIC_API_KEY;
process.env.GOOGLE_CLIENT_ID = "id";
process.env.GOOGLE_CLIENT_SECRET = "secreto";
const { setAjuste, getAjuste } = await import("../server/db.js");
const agencia = await import("../server/agencia.js");
const seo = await import("../server/seo.js");
const fin = await import("../server/finanzas.js");

const INICIO = `<!doctype html><html lang="es"><head><title>Kardia | Cardiólogos en Guadalajara</title>
<meta name="viewport" content="width=device-width"><meta name="description" content="Consulta de cardiología en Guadalajara: chequeo del corazón, electrocardiograma y prueba de esfuerzo. Agenda hoy por WhatsApp.">
<meta property="og:image" content="/og.jpg"><script type="application/ld+json">{"@type":"MedicalClinic"}</script></head>
<body><h1>Tu corazón en buenas manos</h1><img src="a.jpg" alt="Doctor"><img src="b.jpg"><img src="c.jpg" alt="">
<a href="/servicios">Servicios</a><a href="/contacto#mapa">Contacto</a><a href="https://instagram.com/kardia">IG</a><a href="mailto:a@b.mx">Correo</a><a href="/folleto.pdf">PDF</a><a href="/roto">Roto</a></body></html>`;
const SERVICIOS = `<html><head><title>Servicios</title></head><body><h1>Servicios</h1><h1>Otro</h1><p>Poco texto</p></body></html>`;
const CONTACTO = `<html><head><title>Servicios</title><meta name="robots" content="noindex"></head><body><p>contacto</p></body></html>`;
const sitio = {
  "https://kardia.mx/": { status: 200, html: INICIO },
  "https://kardia.mx/servicios": { status: 200, html: SERVICIOS },
  "https://kardia.mx/contacto": { status: 200, html: CONTACTO },
  "https://kardia.mx/roto": { status: 404, html: "" },
  "https://kardia.mx/robots.txt": { status: 200, html: "User-agent: *\nDisallow: /admin\nSitemap: https://kardia.mx/mapa.xml", tipo: "text/plain" },
  "https://kardia.mx/mapa.xml": { status: 200, html: "<urlset></urlset>", tipo: "application/xml" },
};
const pagina = async (url) => {
  const p = sitio[url];
  if (!p) return { status: 404, url, html: "", tipo: "text/html", ms: 50 };
  return { status: p.status, url, html: p.html, tipo: p.tipo || "text/html", ms: 120 };
};

test("lee una página: título, descripción, H1, imágenes sin texto y enlaces internos", () => {
  const p = seo.analizarHTML(INICIO, "https://kardia.mx/");
  assert.equal(p.titulo, "Kardia | Cardiólogos en Guadalajara");
  assert.match(p.descripcion, /^Consulta de cardiología/);
  assert.deepEqual(p.h1, ["Tu corazón en buenas manos"]);
  assert.equal(p.imagenes, 3);
  assert.equal(p.imagenes_sin_alt, 2);
  assert.equal(p.celular, true);
  assert.equal(p.datos_estructurados, true);
  assert.deepEqual(p.enlaces.sort(), ["https://kardia.mx/contacto", "https://kardia.mx/roto", "https://kardia.mx/servicios"]);
  const pr = seo.problemasDePagina(seo.analizarHTML(CONTACTO, "https://kardia.mx/contacto"));
  assert.ok(pr.some((x) => x.nivel === "rojo" && /escondida de Google/.test(x.texto)));
  assert.ok(pr.some((x) => /No tiene descripción/.test(x.texto)));
});

test("direcciones: limpia el sitio, lo saca del texto de redes y no deja revisar sitios internos", async () => {
  assert.equal(seo.normalizarSitio("Kardia.mx/"), "https://kardia.mx");
  assert.throws(() => seo.normalizarSitio("no es sitio"), /no parece/);
  assert.equal(seo.sitioDeTexto("IG @kardia · facebook.com/kardia · www.kardia.mx"), "https://www.kardia.mx");
  assert.equal(seo.sitioDeTexto("instagram.com/kardia"), null);
  assert.equal(seo.robotsBloqueaTodo("User-agent: *\nDisallow: /"), true);
  assert.equal(seo.robotsBloqueaTodo("User-agent: *\nDisallow: /admin"), false);
  const c = agencia.crearCliente({ nombre: "Interno" });
  seo.configurarSeo({ cliente: c.id, sitio: "localhost.test" });
  // Sin cambiar las fuentes: un sitio que no existe en internet se reporta como caído, sin tronar.
  const r = await seo.revisarSitio(c.id);
  assert.equal(r.revision.caido, true);
  assert.equal(r.revision.color, "rojo");
  agencia.actualizarCliente?.(c.id, { estado: "terminado" });
});

test("revisión del sitio: páginas por mejorar, sitemap, velocidad y calificación", async () => {
  seo._fuentesDePrueba({ pagina, pagespeed: async () => seo.leerPagespeed({ lighthouseResult: { categories: { performance: { score: 0.42 }, seo: { score: 0.9 } }, audits: { "largest-contentful-paint": { numericValue: 5300 } } } }) });
  agencia.crearCliente({ nombre: "Kardia", redes: "IG @kardia, kardia.mx" });
  const r = await seo.revisarSitio("Kardia");
  assert.equal(r.sitio, "https://kardia.mx");
  assert.equal(r.sitio_sugerido, true);
  const v = r.revision;
  assert.equal(v.caido, false);
  assert.equal(v.revisadas, 4);
  assert.equal(v.sitemap, true);
  assert.equal(v.pagespeed.velocidad, 42);
  assert.equal(v.pagespeed.carga_segundos, 5.3);
  assert.ok(v.generales.some((x) => x.nivel === "rojo" && /muy lento en celular/.test(x.texto)));
  assert.equal(v.paginas[0].url, "https://kardia.mx/roto"); // lo más grave primero
  const serv = v.paginas.find((p) => p.url.endsWith("/servicios"));
  assert.ok(serv.problemas.some((x) => /2 encabezados principales/.test(x.texto)));
  assert.ok(serv.problemas.some((x) => /Título igual/.test(x.texto))); // "Servicios" se repite en contacto
  assert.ok(v.salud > 0 && v.salud < 80);
  assert.deepEqual(fin.pulso().items.find((x) => x.clave === "sitio_caido")?.detalle || [], []);
});

test("Google: Search Console y Analytics en números sencillos, con oportunidades", async () => {
  setAjuste("seo_google_refresh", "r");
  const llamadas = [];
  seo._fuentesDePrueba({
    google: async (url, cuerpo) => {
      llamadas.push(url);
      if (url.endsWith("/webmasters/v3/sites")) return { siteEntry: [{ siteUrl: "sc-domain:kardia.mx", permissionLevel: "siteOwner" }, { siteUrl: "https://otro.mx/", permissionLevel: "siteUnverifiedUser" }] };
      if (url.includes("accountSummaries")) return { accountSummaries: [{ displayName: "Agencia", propertySummaries: [{ property: "properties/111", displayName: "Kardia Web" }, { property: "properties/222", displayName: "Otro" }] }] };
      if (url.includes("searchAnalytics")) {
        const actual = cuerpo.startDate === seo.periodos().actual.desde;
        if (!cuerpo.dimensions) return { rows: [{ clicks: actual ? 300 : 200, impressions: actual ? 9000 : 8000, position: actual ? 14.2 : 16 }] };
        if (cuerpo.dimensions[0] === "query") return { rows: [
          { keys: ["cardiólogo guadalajara"], clicks: 120, impressions: 2000, position: 3.1 },
          { keys: ["prueba de esfuerzo precio"], clicks: 8, impressions: 900, position: 11.4 },
          { keys: ["electrocardiograma"], clicks: 2, impressions: 20, position: 9 },
        ] };
        return actual ? { rows: [{ keys: ["https://kardia.mx/"], clicks: 250 }, { keys: ["https://kardia.mx/blog/colesterol"], clicks: 5 }] }
          : { rows: [{ keys: ["https://kardia.mx/"], clicks: 150 }, { keys: ["https://kardia.mx/blog/colesterol"], clicks: 40 }] };
      }
      if (url.includes("runReport")) {
        if (cuerpo.dimensions) return { rows: [{ dimensionValues: [{ value: "Organic Search" }], metricValues: [{ value: "500" }] }, { dimensionValues: [{ value: "Direct" }], metricValues: [{ value: "200" }] }] };
        return { rows: [{ dimensionValues: [{ value: "date_range_0" }], metricValues: [{ value: "800" }, { value: "650" }, { value: "40" }] }, { dimensionValues: [{ value: "date_range_1" }], metricValues: [{ value: "1000" }, { value: "700" }, { value: "30" }] }] };
      }
      throw new Error("no esperada " + url);
    },
  });
  const p = await seo.propiedades();
  assert.deepEqual(p.search_console, ["sc-domain:kardia.mx"]);
  assert.equal(await seo.ligarPropiedades(), 1);
  const cfg = seo.configSeo(agencia.clienteRequerido("Kardia"));
  assert.equal(cfg.gsc_sitio, "sc-domain:kardia.mx");
  assert.equal(cfg.ga4_propiedad, "properties/111");

  const d = await seo.seoCliente("Kardia");
  const sc = d.google.search_console;
  assert.equal(sc.clics, 300);
  assert.equal(sc.clics_cambio, 50);
  assert.equal(sc.posicion, 14.2);
  assert.equal(sc.top[0].busqueda, "cardiólogo guadalajara");
  assert.deepEqual(sc.casi_primera.map((x) => x.busqueda), ["prueba de esfuerzo precio"]); // la de 20 apariciones no cuenta
  assert.equal(sc.paginas_bajan[0].pagina, "https://kardia.mx/blog/colesterol");
  assert.equal(sc.paginas_bajan[0].cambio, -87); // de 40 a 5 clics
  const ga = d.google.analytics;
  assert.equal(ga.visitas, 800);
  assert.equal(ga.visitas_cambio, -20);
  assert.equal(ga.de_donde[0].canal, "Google (sin pagar)");

  const t = await seo.tableroSeo();
  const k = t.clientes.find((c) => c.nombre === "Kardia");
  assert.equal(k.visitas, 800);
  assert.equal(k.posicion, 14.2);
  assert.equal(t.google.conectado, true);
  assert.throws(() => seo.configurarSeo({ cliente: "Kardia", ga4_propiedad: "abc" }), /número/);
});

test("sitio caído: va al Pulso, avisa una vez y la revisión semanal corre solo los lunes", async () => {
  sitio["https://kardia.mx/"] = { status: 500, html: "" };
  const r = await seo.revisarSitio("Kardia");
  assert.equal(r.revision.caido, true);
  assert.match(r.revision.generales[0].texto, /no abre \(error 500\)/);
  const item = fin.pulso().items.find((x) => x.clave === "sitio_caido");
  assert.equal(item.ir, "#/seo");
  assert.ok(item.detalle.includes("Kardia"));
  assert.equal(await seo.revisarSemana({ ahora: "2026-11-24T09:00" }), null);
  const s = await seo.revisarSemana({ ahora: "2026-11-23T07:30" });
  assert.ok(s.revisados >= 1);
  assert.equal(getAjuste("seo_semana"), "2026-11-23");
  assert.equal(await seo.revisarSemana({ ahora: "2026-11-23T09:00" }), null);
});
