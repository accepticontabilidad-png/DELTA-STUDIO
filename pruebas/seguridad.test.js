import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-seg-"));
const seg = await import("../server/seguridad.js");
const { firmaValida } = await import("../server/whatsapp.js");

test("no arranca sin clave o con clave corta", () => {
  assert.throws(() => seg.revisarClave(""));
  assert.throws(() => seg.revisarClave("corta123"));
  assert.doesNotThrow(() => seg.revisarClave("una-clave-bien-larga-2026"));
});

test("compara la clave correctamente", () => {
  assert.equal(seg.claveCorrecta("abc", "abc"), true);
  assert.equal(seg.claveCorrecta("abd", "abc"), false);
  assert.equal(seg.claveCorrecta("", "abc"), false);
});

test("sesiones: se crean, se validan y se cierran", () => {
  const { id } = seg.crearSesion("prueba");
  assert.equal(seg.sesionValida(id), true);
  assert.equal(seg.sesionValida(id + "x"), false);
  assert.equal(seg.sesionValida(""), false);
  seg.cerrarSesion(id);
  assert.equal(seg.sesionValida(id), false);
});

test("cambiar la clave cierra todas las sesiones", () => {
  seg.revisarClave("una-clave-bien-larga-2026");
  const { id } = seg.crearSesion();
  seg.revisarClave("otra-clave-distinta-2026");
  assert.equal(seg.sesionValida(id), false);
});

test("bloquea tras 5 intentos fallidos desde la misma IP", () => {
  seg.reiniciarIntentos();
  for (let i = 0; i < 4; i++) seg.registrarFallo("1.1.1.1");
  assert.equal(seg.bloqueado("1.1.1.1"), 0);
  assert.equal(seg.registrarFallo("1.1.1.1"), true);
  assert.ok(seg.bloqueado("1.1.1.1") > 0);
  assert.equal(seg.bloqueado("2.2.2.2"), 0);
});

test("bloqueo general si llegan muchos intentos desde muchas IPs", () => {
  seg.reiniciarIntentos();
  for (let i = 0; i < 20; i++) seg.registrarFallo(`10.0.0.${i}`);
  assert.ok(seg.bloqueado("9.9.9.9") > 0);
  seg.reiniciarIntentos();
});

test("solo acepta mensajes de WhatsApp firmados por Meta", () => {
  const cuerpo = Buffer.from('{"entry":[]}');
  const firma = "sha256=" + crypto.createHmac("sha256", "secreto").update(cuerpo).digest("hex");
  assert.equal(firmaValida(cuerpo, firma, "secreto"), true);
  assert.equal(firmaValida(cuerpo, firma, "otro"), false);
  assert.equal(firmaValida(Buffer.from('{"entry":[1]}'), firma, "secreto"), false);
  assert.equal(firmaValida(cuerpo, undefined, "secreto"), false);
  assert.equal(firmaValida(cuerpo, firma, ""), false);
});
