// Departamento de Diseño: habilidades, diseños en PNG, descargas en .zip e imágenes/videos con Higgsfield.
// Claude y Higgsfield se imitan con servidores falsos (no gastan créditos).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-diseno-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
process.env.ANTHROPIC_API_KEY = "falsa";

// PNG mínimo de 1x1 (lo que "genera" el Higgsfield falso)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// ---------- Higgsfield falso ----------
const hf = { pedidos: [], subidas: 0 };
const servidorHf = http.createServer((req, res) => {
  let b = [];
  req.on("data", (c) => b.push(c));
  req.on("end", () => {
    const cuerpo = Buffer.concat(b);
    const base = `http://localhost:${servidorHf.address().port}`;
    const json = (x, s = 200) => { res.statusCode = s; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(x)); };
    if (req.url === "/img.png") { res.setHeader("content-type", "image/png"); return res.end(PNG); }
    if (req.url === "/v.mp4") { res.setHeader("content-type", "video/mp4"); return res.end(Buffer.from("video-falso")); }
    if (req.url === "/subida" && req.method === "PUT") { hf.subidas++; return res.end(); }
    if (req.headers.authorization !== "Key id-falso:secreto-falso") return json({ detail: "Invalid credentials" }, 401);
    if (req.url === "/files/generate-upload-url") return json({ upload_url: `${base}/subida`, public_url: "https://cdn.falso/subida.png", upload_headers: { "Content-Type": "image/png" } });
    if (req.url.startsWith("/requests/")) {
      const id = req.url.split("/")[2];
      return json(id === "img" ? { status: "completed", images: [{ url: `${base}/img.png` }] } : { status: "completed", video: { url: `${base}/v.mp4` } });
    }
    hf.pedidos.push({ url: req.url, cuerpo: JSON.parse(cuerpo.toString() || "{}") });
    const id = req.url.includes("soul") ? "img" : "vid";
    return json({ status: "queued", request_id: id, status_url: `${base}/requests/${id}/status` });
  });
});
await new Promise((r) => servidorHf.listen(0, r));
process.env.HIGGSFIELD_URL_BASE = `http://localhost:${servidorHf.address().port}`;
process.env.HIGGSFIELD_API_KEY = "id-falso";
process.env.HIGGSFIELD_API_SECRET = "secreto-falso";

// ---------- Claude falso ----------
let guion = [];
const recibidas = [];
const servidorClaude = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    const cuerpo = JSON.parse(b);
    recibidas.push(cuerpo);
    let content;
    try { content = guion.shift()(cuerpo); } catch (e) { content = [{ type: "text", text: "FALLO EN LA PRUEBA: " + e.message }]; }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      id: "msg_" + recibidas.length, type: "message", role: "assistant", model: cuerpo.model, content,
      stop_reason: content.some((c) => c.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
});
await new Promise((r) => servidorClaude.listen(0, r));
process.env.ANTHROPIC_BASE_URL = `http://localhost:${servidorClaude.address().port}`;
after(() => { servidorHf.close(); servidorClaude.close(); });

const { crearZip, leerZip } = await import("../server/zip.js");
const habilidades = await import("../server/habilidades.js");
const diseno = await import("../server/diseno.js");
const deptos = await import("../server/departamentos.js");
const agencia = await import("../server/agencia.js");

const usar = (name, input) => () => [{ type: "tool_use", id: "toolu_" + Math.random().toString(36).slice(2), name, input }];
const texto = (t) => () => [{ type: "text", text: t }];
const ultimoResultado = (cuerpo) => cuerpo.messages.at(-1).content.find((c) => c.type === "tool_result");
const textoDe = (r) => (typeof r.content === "string" ? r.content : r.content.find((c) => c.type === "text").text);

test("zip: lo que se arma se puede volver a leer", () => {
  const z = crearZip([{ ruta: "a/uno.txt", datos: Buffer.from("hola") }, { ruta: "a/ñ.png", datos: PNG }]);
  const leido = leerZip(z);
  assert.deepEqual(leido.map((x) => x.ruta), ["a/uno.txt", "a/ñ.png"]);
  assert.equal(leido[0].datos.toString(), "hola");
  assert.throws(() => leerZip(Buffer.from("no es zip")), /no es un .zip/);
});

test("habilidades: un .zip con varias skills, encabezado con descripción en varias líneas", () => {
  const skillA = "---\nname: carrusel-viral\ndescription: >\n  Escribe carruseles virales.\n  Úsala para guiones de carrusel.\n---\n\n# Carrusel\nPaso 1: gancho.";
  const skillB = "---\nname: ganchos\ndescription: \"Evalúa ganchos\"\n---\nInstrucciones de ganchos";
  const z = crearZip([
    { ruta: "skills/carrusel-viral/SKILL.md", datos: Buffer.from(skillA) },
    { ruta: "skills/carrusel-viral/references/ejemplos.md", datos: Buffer.from("Ejemplo 1") },
    { ruta: "skills/carrusel-viral/fuente.ttf", datos: Buffer.from("binario") },
    { ruta: "skills/ganchos/SKILL.md", datos: Buffer.from(skillB) },
    { ruta: "__MACOSX/skills/._SKILL.md", datos: Buffer.from("basura") },
  ]);
  const r = habilidades.importar(z, "mis-skills.zip");
  assert.deepEqual(r.guardadas.sort(), ["carrusel-viral", "ganchos"]);
  const lista = habilidades.listar();
  assert.equal(lista.find((h) => h.nombre === "carrusel-viral").descripcion, "Escribe carruseles virales. Úsala para guiones de carrusel.");
  assert.equal(lista.find((h) => h.nombre === "carrusel-viral").archivos, 2); // el .ttf no se guarda
  assert.equal(lista.find((h) => h.nombre === "ganchos").descripcion, "Evalúa ganchos");
  assert.match(habilidades.leer("carrusel-viral"), /Paso 1: gancho[\s\S]*references\/ejemplos\.md/);
  assert.equal(habilidades.leerArchivo("carrusel-viral", "ejemplos.md"), "Ejemplo 1");
  assert.throws(() => habilidades.leer("magia"), /No tengo la habilidad/);
  assert.match(habilidades.resumenParaAgente(), /carrusel-viral: Escribe carruseles/);
  // Un SKILL.md suelto también sirve, y reemplaza al anterior con el mismo nombre
  habilidades.importar(Buffer.from(skillB.replace("Evalúa ganchos", "Evalúa ganchos v2")), "SKILL.md");
  assert.equal(habilidades.listar().find((h) => h.nombre === "ganchos").descripcion, "Evalúa ganchos v2");
  habilidades.cambiar("ganchos", false);
  assert.doesNotMatch(habilidades.resumenParaAgente(), /ganchos:/);
  habilidades.borrar("ganchos");
  assert.equal(habilidades.listar().length, 1);
  assert.throws(() => habilidades.importar(Buffer.from("hola"), "x.pdf"), /Sube un .zip/);
});

const hayNavegador = diseno.puedeRenderizar();

test("diseño: un carrusel en HTML sale como PNG de 1080x1350 y se descarga en .zip", { skip: !hayNavegador && "sin Chromium" }, async () => {
  const { pieza, hoja } = await diseno.crearPieza({
    titulo: "Mitos del blanqueamiento", tipo: "carrusel", texto: "Caption #sonrisa",
    css: ".t{font-size:90px;padding:80px}",
    slides: ["<h1 class=t>Uno</h1>", "<h1 class=t>Dos</h1>", "<h1 class=t>Tres</h1>"],
  });
  assert.deepEqual(pieza.archivos, ["01.png", "02.png", "03.png"]);
  const png = fs.readFileSync(diseno.archivoDePieza(pieza.id, "02.png").ruta);
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1350);
  assert.equal(hoja.subarray(0, 2).toString("hex"), "ffd8"); // la hoja de contacto es JPG
  const zip = leerZip(diseno.zipDePieza(pieza.id).datos);
  assert.deepEqual(zip.map((x) => x.ruta), ["Mitos-del-blanqueamiento/Mitos-del-blanqueamiento-01.png", "Mitos-del-blanqueamiento/Mitos-del-blanqueamiento-02.png", "Mitos-del-blanqueamiento/Mitos-del-blanqueamiento-03.png", "Mitos-del-blanqueamiento/texto-para-publicar.txt"]);
  assert.equal(diseno.archivoDePieza(pieza.id, "../delta.db"), null);
  // Corregir reemplaza la misma pieza; una historia sale de 1080x1920
  const { pieza: p2 } = await diseno.crearPieza({ titulo: "Historia", tipo: "historia", slides: ["<p>Hola</p>"], reemplaza_id: pieza.id });
  assert.equal(p2.id, pieza.id);
  assert.equal(fs.readFileSync(diseno.archivoDePieza(p2.id, "01.png").ruta).readUInt32BE(20), 1920);
  assert.equal(diseno.archivoDePieza(p2.id, "02.png"), null);
  assert.equal(p2.texto, "Caption #sonrisa");
  diseno.borrarPieza(p2.id);
  assert.equal(diseno.obtenerPieza(p2.id), undefined);
});

test("diseño: el departamento usa una habilidad, crea una imagen con IA, la pone en un carrusel y lo anima", { skip: !hayNavegador && "sin Chromium" }, async () => {
  agencia.crearCliente({ nombre: "Clínica Sonrisa" });
  let hojaRecibida = false;
  guion = [
    (c) => {
      assert.match(c.system[0].text, /carrusel-viral: Escribe carruseles/);
      assert.match(c.system[0].text, /Higgsfield está conectado/);
      const nombres = c.tools.map((t) => t.name);
      for (const n of ["usar_habilidad", "crear_pieza", "generar_imagen_ia", "generar_video_ia"]) assert.ok(nombres.includes(n), n);
      return usar("usar_habilidad", { nombre: "carrusel-viral" })();
    },
    (c) => {
      assert.match(textoDe(ultimoResultado(c)), /Paso 1: gancho/);
      return usar("generar_imagen_ia", { prompt: "smiling dentist, soft light", formato: "post" })();
    },
    (c) => {
      const r = ultimoResultado(c).content;
      assert.equal(JSON.parse(r[0].text).usar_como, "medio:1");
      assert.equal(r[1].type, "image");
      return usar("crear_pieza", { titulo: "Carrusel sonrisa", tipo: "carrusel", slides: ["<img src='medio:1' style='width:1080px;height:1350px;object-fit:cover'>", "<h1>CTA</h1>"], texto: "Agenda tu cita" })();
    },
    (c) => {
      const r = ultimoResultado(c).content;
      hojaRecibida = r[1]?.type === "image" && r[1].source.media_type === "image/jpeg";
      return usar("generar_video_ia", { prompt: "slow zoom in", desde_pieza: JSON.parse(r[0].text).pieza, slide: 1, duracion: 6 })();
    },
    (c) => {
      assert.equal(JSON.parse(textoDe(ultimoResultado(c))).ok, true);
      return texto("Carrusel y video listos\n- Pieza 1: carrusel de 2 slides")();
    },
  ];
  const r = deptos.encargar({ departamento: "diseno", encargo: "Carrusel sobre blanqueamiento", cliente: "Sonrisa" });
  for (let i = 0; i < 600 && agencia.obtenerTrabajo(r.trabajo_id).estado === "en_proceso"; i++) { await new Promise((x) => setTimeout(x, 50)); }
  const t = agencia.obtenerTrabajo(r.trabajo_id);
  assert.equal(t.estado, "listo", t.resultado);
  assert.doesNotMatch(t.resultado, /FALLO EN LA PRUEBA/);
  assert.ok(hojaRecibida, "el departamento debe ver la hoja de contacto");
  const piezas = diseno.listarPiezas({ trabajo_id: r.trabajo_id });
  assert.deepEqual(piezas.map((p) => p.tipo), ["carrusel", "video"]);
  assert.equal(piezas[0].cliente, "Clínica Sonrisa");
  assert.deepEqual(piezas[1].archivos, ["video.mp4"]);
  // Lo que se pidió a Higgsfield
  assert.equal(hf.pedidos[0].url, "/higgsfield-ai/soul/standard");
  assert.equal(hf.pedidos[0].cuerpo.aspect_ratio, "3:4");
  assert.equal(hf.pedidos[1].url, "/kling-video/v3.0/pro/image-to-video");
  assert.equal(hf.pedidos[1].cuerpo.image_url, "https://cdn.falso/subida.png");
  assert.equal(hf.pedidos[1].cuerpo.duration, 6);
  assert.equal(hf.subidas, 1);
});
