// Pruebas de la voz natural: crear, hablar (con memoria), borrar y fallar con mensajes claros.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-voz-"));
const llamadas = [];
const servidor = http.createServer((req, res) => {
  let cuerpo = [];
  req.on("data", (c) => cuerpo.push(c));
  req.on("end", () => {
    cuerpo = Buffer.concat(cuerpo);
    llamadas.push({ metodo: req.method, ruta: req.url, clave: req.headers["xi-api-key"], cuerpo });
    if (req.headers["xi-api-key"] !== "clave-buena") { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"detail":{"status":"invalid_api_key"}}'); }
    if (req.method === "POST" && req.url === "/v1/voices/add") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(`{"voice_id":"voz${llamadas.length}"}`); }
    if (req.method === "POST" && req.url.startsWith("/v1/text-to-speech/")) { res.writeHead(200, { "Content-Type": "audio/mpeg" }); return res.end(Buffer.from("ID3audio-falso")); }
    if (req.method === "POST" && req.url === "/v1/speech-to-text") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ text: "  Delta,  qué tengo hoy " })); }
    if (req.method === "DELETE" && req.url.startsWith("/v1/voices/")) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end("{}"); }
    res.writeHead(404); res.end();
  });
});
before(async () => {
  await new Promise((r) => servidor.listen(0, r));
  process.env.ELEVENLABS_URL = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

const voz = await import("../server/voz.js");
const ogg = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(4000, 1)]);

test("sin clave, la voz natural queda apagada y la app usa la del equipo", async () => {
  delete process.env.ELEVENLABS_API_KEY;
  assert.equal(voz.estadoVoz().disponible, false);
  assert.equal(voz.estadoVoz().activa, false);
  await assert.rejects(voz.sintetizar("hola"), /no está configurada/);
});

test("rechaza archivos que no son audio y exige el permiso", async () => {
  process.env.ELEVENLABS_API_KEY = "clave-buena";
  assert.throws(() => voz.guardarMuestra(Buffer.alloc(5000, 7)), /No reconozco ese audio/);
  voz.guardarMuestra(ogg);
  await assert.rejects(voz.crearVoz({ nombre: "Ana", permiso: false }), /permiso/);
});

test("crea la voz, habla con ella y guarda la frase para no pagarla dos veces", async () => {
  voz.borrarMuestras();
  voz.guardarMuestra(ogg);
  voz.guardarMuestra(ogg);
  const estado = await voz.crearVoz({ nombre: "Ana", permiso: true });
  assert.equal(estado.activa, true);
  assert.equal(estado.voz.nombre, "Ana");
  assert.equal(estado.muestras, 0, "las grabaciones se borran después de crear la voz");
  const alta = llamadas.find((l) => l.ruta === "/v1/voices/add");
  assert.match(alta.cuerpo.toString("latin1"), /DELTA - Ana/);

  const antes = llamadas.length;
  const a1 = await voz.sintetizar("**Hola**, señor 👋 https://x.com");
  const a2 = await voz.sintetizar("**Hola**, señor 👋 https://x.com");
  assert.equal(a1.toString(), "ID3audio-falso");
  assert.deepEqual(a1, a2);
  const habladas = llamadas.slice(antes).filter((l) => l.ruta.startsWith("/v1/text-to-speech/"));
  assert.equal(habladas.length, 1, "la segunda vez sale de la memoria");
  assert.equal(JSON.parse(habladas[0].cuerpo).text, "Hola, señor");
});

test("al cambiar de voz se borra la anterior en ElevenLabs", async () => {
  const anterior = voz.vozActual().id;
  voz.guardarMuestra(ogg);
  await voz.crearVoz({ nombre: "Otra", permiso: true });
  assert.notEqual(voz.vozActual().id, anterior);
  assert.ok(llamadas.some((l) => l.metodo === "DELETE" && l.ruta === `/v1/voices/${anterior}`));
});

test("se puede apagar y borrar la voz", async () => {
  assert.equal(voz.encenderVoz(false).activa, false);
  voz.encenderVoz(true);
  const id = voz.vozActual().id;
  const estado = await voz.borrarVoz();
  assert.equal(estado.voz, null);
  assert.equal(estado.activa, false);
  assert.ok(llamadas.some((l) => l.metodo === "DELETE" && l.ruta === `/v1/voices/${id}`));
});

test("una clave mala da un mensaje claro", async () => {
  process.env.ELEVENLABS_API_KEY = "clave-mala";
  voz.guardarMuestra(ogg);
  await assert.rejects(voz.crearVoz({ nombre: "X", permiso: true }), /clave de ElevenLabs no es válida/);
  voz.borrarMuestras();
});

test("el oído del celular: manda la grabación a ElevenLabs y devuelve el texto", async () => {
  process.env.ELEVENLABS_API_KEY = "clave-buena";
  assert.equal(voz.estadoVoz().oido, true);
  const m4a = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A "), Buffer.alloc(3000, 2)]);
  const { texto } = await voz.transcribir(m4a);
  assert.equal(texto, "Delta, qué tengo hoy");
  const l = llamadas.findLast((x) => x.ruta === "/v1/speech-to-text");
  const cuerpo = l.cuerpo.toString("latin1");
  assert.match(cuerpo, /scribe_v1/);
  assert.match(cuerpo, /filename="voz\.m4a"/);
  assert.match(cuerpo, /audio\/mp4/);
  await assert.rejects(voz.transcribir(Buffer.alloc(10)), /No alcancé a oír/);
  delete process.env.ELEVENLABS_API_KEY;
  assert.equal(voz.estadoVoz().oido, false);
  await assert.rejects(voz.transcribir(m4a), /no está configurado/);
});
