import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-rep-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.URL_PUBLICA;
const { db, setAjuste, getAjuste } = await import("../server/db.js");
const agencia = await import("../server/agencia.js");
const pm = await import("../server/paidmedia.js");
const k = await import("../server/contenido.js");
const rep = await import("../server/reportes.js");
const { ahoraLocalISO } = await import("../server/tiempo.js");

const mes = ahoraLocalISO().slice(0, 7);
const antes = rep.mover(mes, -1);
const foto = (cid, fecha, d) => db.prepare("INSERT OR REPLACE INTO meta_fotos (cliente_id, fecha, datos) VALUES (?,?,?)").run(cid, fecha, JSON.stringify(d));

test("datos del mes: redes, anuncios y contenido en frases sencillas", () => {
  const c = agencia.crearCliente({ nombre: "Kardia", presupuesto_anuncios: 20000 });
  foto(c.id, `${rep.mover(antes, -1)}-28`, { instagram: { seguidores: 5000 } });
  foto(c.id, `${antes}-27`, { instagram: { seguidores: 5420, alcance_28d: 31000, publicaciones_mes: 9, mejor_publicacion: { texto: "Chequeo", me_gusta: 300, comentarios: 12, enlace: "https://instagram.com/p/x" } } });
  agencia.registrarGasto({ cliente: c.id, plataforma: "meta", monto: 12000, mes: antes });
  agencia.registrarGasto({ cliente: c.id, plataforma: "meta", monto: 10000, mes: rep.mover(antes, -1) });
  pm.registrarResultados({ cliente: c.id, mes: antes, prospectos: 150, ventas: 12, valor_ventas: 48000 });
  pm.registrarResultados({ cliente: c.id, mes: rep.mover(antes, -1), prospectos: 80 });
  k.crearContenido({ cliente: c.id, titulo: "Reel corazón", formato: "reel", red: "instagram", etapa: "publicado", publicar: `${antes}-10` });
  k.crearContenido({ cliente: c.id, titulo: "Carrusel colesterol", formato: "carrusel", etapa: "publicado", publicar: `${antes}-20` });
  k.crearContenido({ cliente: c.id, titulo: "Post diciembre", etapa: "planeado", publicar: `${mes}-25` });

  const d = rep.datosReporte("Kardia", antes);
  assert.equal(d.redes.instagram.cambio, 420);
  assert.equal(d.redes.instagram.cambio_pct, 8.4);
  assert.equal(d.anuncios.contactos, 150);
  assert.equal(d.anuncios.costo_por_contacto, 80);
  assert.equal(d.anuncios.retorno, 4);
  assert.equal(d.contenido.publicadas.length, 2);
  assert.equal(d.contenido.siguiente_mes[0].titulo, "Post diciembre");
  const t = d.logros.map((l) => l.texto).join("\n");
  assert.match(t, /Ganaste 420 seguidores en Instagram \(\+8\.4 %\)/);
  assert.match(t, /150 contactos nuevos .* a \$80 cada uno: 36 % más barato/);
  assert.match(t, /se vendieron 4 pesos/);
  assert.match(t, /Publicamos 2 piezas/);
  assert.doesNotMatch(t, /CPL|ROAS/);
  assert.match(d.titular, /150 contactos nuevos/);
  assert.equal(d.con_score, false);

  const html = rep.htmlReporte(d);
  assert.match(html, /Lo más importante/);
  assert.match(html, /Las campañas que mejor funcionaron|Contactos nuevos/);
  assert.doesNotMatch(html, /Calificación de la cuenta/);
  assert.doesNotMatch(html, /style=/);
  assert.throws(() => rep.datosReporte("Kardia", rep.mover(mes, 1)), /todavía no llega/);
});

test("mensaje, calificación y link: solo existe si se crea, se puede quitar y no se adivina", () => {
  const d = rep.guardarReporte({ cliente: "Kardia", mes: antes, nota: "Gracias por la confianza.\nSeguimos.", con_score: true });
  assert.equal(d.nota, "Gracias por la confianza.\nSeguimos.");
  const html = rep.htmlReporte(d);
  assert.match(html, /Mensaje de tu agencia/);
  assert.match(html, /Calificación de la cuenta/);
  assert.equal(d.link, null);

  setAjuste("url_base", "https://delta.ejemplo.com");
  const l = rep.crearLink({ cliente: "Kardia", mes: antes });
  assert.match(l.link, /^https:\/\/delta\.ejemplo\.com\/r\/[A-Za-z0-9_-]{24}$/);
  assert.equal(rep.crearLink({ cliente: "Kardia", mes: antes }).link, l.link); // no cambia
  const token = l.ruta.slice(3);
  assert.equal(rep.porToken(token).cliente.nombre, "Kardia");
  assert.equal(rep.porToken("x"), null);
  assert.equal(rep.porToken("A".repeat(24)), null);
  rep.quitarLink({ cliente: "Kardia", mes: antes });
  assert.equal(rep.porToken(token), null);

  const pagina = rep.paginaReporte(rep.datosReporte("Kardia", antes), { imprimir: true });
  assert.match(pagina, /noindex/);
  assert.match(pagina, /data-imprimir="1"/);
  assert.doesNotMatch(pagina, /<script>/);
});

test("los nombres y textos del cliente no se cuelan como HTML", () => {
  const c = agencia.crearCliente({ nombre: "<b>Malo</b>" });
  k.crearContenido({ cliente: c.id, titulo: "<img src=x onerror=alert(1)>", etapa: "publicado", publicar: `${antes}-05` });
  rep.guardarReporte({ cliente: c.id, mes: antes, nota: "<script>x</script>" });
  const html = rep.htmlReporte(rep.datosReporte(c.id, antes));
  assert.doesNotMatch(html, /<img src=x|<script>x|<b>Malo/);
  assert.match(html, /&lt;b&gt;Malo/);
});

test("analítica de todos y reportes listos cada mes, una sola vez", () => {
  const a = rep.analitica(antes);
  const kardia = a.clientes.find((x) => x.nombre === "Kardia");
  assert.equal(kardia.seguidores_cambio, 420);
  assert.equal(kardia.publicadas, 2);
  assert.equal(kardia.contactos, 150);
  assert.equal(a.clientes[0].hay_datos, true);

  db.prepare("DELETE FROM reportes").run();
  const hoy = `${mes}-02`;
  const r = rep.prepararReportesDelMes({ hoy, avisarDueno: false });
  assert.equal(r.mes, antes);
  assert.ok(r.listos.includes("Kardia"));
  assert.equal(getAjuste("reportes_preparados"), antes);
  assert.equal(rep.prepararReportesDelMes({ hoy, avisarDueno: false }), null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM reportes WHERE token IS NOT NULL").get().n, 0, "nunca crea links por su cuenta");
});
