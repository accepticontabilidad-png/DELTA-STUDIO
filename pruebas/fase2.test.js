import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "delta-f2-"));
const mercados = await import("../server/mercados.js");
const noticias = await import("../server/noticias.js");
const gmail = await import("../server/gmail.js");

test("mercados: interpreta la respuesta de Yahoo", () => {
  const d = mercados.interpretarGrafica(
    {
      chart: {
        result: [{
          meta: { symbol: "AAPL", shortName: "Apple Inc.", currency: "USD", regularMarketPrice: 110, fiftyTwoWeekHigh: 120, fiftyTwoWeekLow: 80 },
          timestamp: [1, 86401, 172801, 259201],
          indicators: { quote: [{ close: [100, null, 105, 110] }] },
        }],
      },
    },
    "Apple",
  );
  assert.equal(d.nombre, "Apple");
  assert.equal(d.precio, 110);
  assert.equal(d.cambio_dia_pct, 4.76);
  assert.equal(d.cambio_periodo_pct, 10);
  assert.equal(d.max_52s, 120);
  assert.throws(() => mercados.interpretarGrafica({ chart: { result: null, error: { description: "No data found" } } }), /No data/);
});

test("mercados: el cambio del día se compara con el cierre de AYER, aunque hoy no tenga barra todavía", () => {
  const dia = 86400;
  const base = { symbol: "NVDA", currency: "USD", gmtoffset: 0 };
  // Lunes 100, martes 120, miércoles 140 (sin barra de hoy jueves); precio actual del jueves 133.
  const sinBarraHoy = {
    chart: { result: [{
      meta: { ...base, regularMarketPrice: 133, regularMarketTime: 3 * dia + 50000 },
      timestamp: [0 * dia + 50000, 1 * dia + 50000, 2 * dia + 50000],
      indicators: { quote: [{ close: [100, 120, 140] }] },
    }] },
  };
  assert.equal(mercados.interpretarGrafica(sinBarraHoy).cambio_dia_pct, -5); // contra 140, no contra 120
  // Con barra de hoy (cierre parcial nulo o con valor) sigue comparando contra ayer.
  const conBarraHoy = structuredClone(sinBarraHoy);
  conBarraHoy.chart.result[0].timestamp.push(3 * dia + 50000);
  conBarraHoy.chart.result[0].indicators.quote[0].close.push(null);
  assert.equal(mercados.interpretarGrafica(conBarraHoy).cambio_dia_pct, -5);
});

test("mercados: lista de seguimiento editable", () => {
  assert.ok(mercados.lista().some((x) => x.simbolo === "^MXX"));
  mercados.agregar("tsla", "Tesla");
  assert.ok(mercados.lista().some((x) => x.simbolo === "TSLA" && x.nombre === "Tesla"));
  mercados.quitar("TSLA");
  assert.ok(!mercados.lista().some((x) => x.simbolo === "TSLA"));
  assert.throws(() => mercados.quitar("NOEXISTE"), /no está/);
  assert.throws(() => mercados.agregar("a b;c"), /no válido/);
});

test("noticias: lee el RSS de Google Noticias", () => {
  const xml = `<rss><channel><item><title>IA cambia el marketing &amp; más - El País</title><link>https://news.google.com/x</link>
  <pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate><source url="https://elpais.com">El País</source></item></channel></rss>`;
  const [n] = noticias.leerRSS(xml);
  assert.equal(n.titulo, "IA cambia el marketing & más");
  assert.equal(n.fuente, "El País");
  assert.equal(n.fecha, "2026-11-20T10:00:00.000Z");
});

test("noticias: temas editables", () => {
  assert.ok(noticias.temas().includes("política México"));
  noticias.agregarTema("fútbol");
  assert.ok(noticias.temas().includes("fútbol"));
  noticias.quitarTema("Fútbol");
  assert.ok(!noticias.temas().includes("fútbol"));
});

test("gmail: saca el texto del correo (texto plano o HTML)", () => {
  const b = (s) => Buffer.from(s).toString("base64url");
  assert.equal(
    gmail.textoDeMensaje({ mimeType: "multipart/alternative", parts: [
      { mimeType: "text/html", body: { data: b("<p>Hola</p>") } },
      { mimeType: "text/plain", body: { data: b("Hola jefe") } },
    ] }),
    "Hola jefe",
  );
  assert.equal(gmail.textoDeMensaje({ mimeType: "text/html", body: { data: b("<style>x{}</style><p>Pago&nbsp;listo</p>") } }), "Pago listo");
});

test("gmail: arma el correo con acentos y sin inyección de cabeceras", () => {
  const raw = gmail.armarMIME({ para: "a@b.com\r\nBcc: espia@x.com", asunto: "Cotización", cuerpo: "Señor, adjunto." });
  const txt = Buffer.from(raw, "base64url").toString();
  assert.match(txt, /^To: a@b.com Bcc: espia@x.com\r\n/);
  assert.ok(!/\r\nBcc:/.test(txt));
  assert.match(txt, /Subject: =\?UTF-8\?B\?/);
  const cuerpo = txt.split("\r\n\r\n")[1].replace(/\r\n/g, "");
  assert.equal(Buffer.from(cuerpo, "base64").toString(), "Señor, adjunto.");
});

test("gmail: sin configurar no está conectado", () => {
  delete process.env.GOOGLE_CLIENT_ID;
  assert.equal(gmail.gmailConectado(), false);
  assert.throws(() => gmail.urlConexion({ protocol: "https", get: () => "x" }), /GOOGLE_CLIENT_ID/);
});

test("tablero de bolsa: velas, tipos y símbolos", () => {
  const v = mercados.interpretarVelas({ chart: { result: [{
    meta: { symbol: "AAPL", currency: "USD", regularMarketPrice: 12 },
    timestamp: [100, 200, 300],
    indicators: { quote: [{ open: [10, null, 11], high: [11, 9, 12.5], low: [9, 8, 10.5], close: [10.5, 8.5, 12], volume: [5, 6, 7] }] },
  }] } }, "Apple");
  assert.equal(v.nombre, "Apple");
  assert.equal(v.velas.length, 2); // la vela incompleta se descarta
  assert.deepEqual(v.velas[1], { t: 300000, o: 11, h: 12.5, l: 10.5, c: 12, v: 7 });
  assert.equal(mercados.tipoDe("^GSPC"), "Índice");
  assert.equal(mercados.tipoDe("MXN=X"), "Divisa");
  assert.equal(mercados.tipoDe("BTC-USD"), "Cripto");
  assert.equal(mercados.tipoDe("WALMEX.MX"), "Acción");
  assert.throws(() => mercados.velas("a b;c"), /no válido/);
});

const panorama = await import("../server/panorama.js");

test("centro de noticias: ubica titulares en el globo", () => {
  assert.equal(panorama.ubicar("Banxico recorta su tasa de interés")?.lugar, "México");
  assert.equal(panorama.ubicar("Sismo sacude la Ciudad de México esta mañana")?.lugar, "Ciudad de México");
  assert.equal(panorama.ubicar("Israel y Hamas negocian tregua en Gaza")?.lugar, "Israel");
  assert.equal(panorama.ubicar("Japón anuncia paquete económico")?.lugar, "Japón");
  assert.equal(panorama.ubicar("El oro toca nuevo máximo"), null);
  const r = panorama.agruparPorLugar([
    { region: "Mundo", noticias: [{ titulo: "Japón sube tasas", fecha: "2026-11-21T10:00:00Z" }, { titulo: "El oro sube" }] },
    { region: "Europa", centro: [50, 10], noticias: [{ titulo: "Japón sube tasas" }, { titulo: "Cumbre climática sin acuerdo" }] },
  ]);
  assert.equal(r.puntos.find((p) => p.lugar === "Japón").noticias.length, 1); // sin repetidos
  assert.ok(r.puntos.some((p) => p.lugar === "Europa")); // sin lugar en el titular: cae en el centro de su región
  assert.deepEqual(r.sin_lugar.map((n) => n.titulo), ["El oro sube"]);
});

test("centro de noticias: lee canales y videos de YouTube", () => {
  assert.equal(panorama.idDeCanal('..."externalId":"UCabcdefghijklmnopqrstuv"...'), "UCabcdefghijklmnopqrstuv");
  assert.equal(panorama.idDeCanal("<html>nada</html>"), null);
  const v = panorama.leerVideos(`<feed><entry><yt:videoId>abcDEF12345</yt:videoId><title>Noticias &amp; más</title><published>2026-11-21T10:00:00+00:00</published></entry><entry><title>sin id</title></entry></feed>`, "N+");
  assert.equal(v.length, 1);
  assert.equal(v[0].titulo, "Noticias & más");
  assert.equal(v[0].imagen, "https://i.ytimg.com/vi/abcDEF12345/mqdefault.jpg");
});
