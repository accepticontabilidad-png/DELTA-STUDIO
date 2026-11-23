import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoPorTelefono, estadoPorNombre } from "../server/lada.js";

test("lada del teléfono → estado", () => {
  assert.equal(estadoPorTelefono("523312345678"), "jal");
  assert.equal(estadoPorTelefono("5215512345678"), "cmx");
  assert.equal(estadoPorTelefono("8112345678"), "nle");
  assert.equal(estadoPorTelefono("524421234567"), "que");
  assert.equal(estadoPorTelefono("529991234567"), "yuc");
  assert.equal(estadoPorTelefono("526641234567"), "bcn");
  assert.equal(estadoPorTelefono("14155551234"), null);
  assert.equal(estadoPorTelefono(""), null);
});

test("nombres de estado de Meta → clave del mapa", () => {
  assert.equal(estadoPorNombre("Mexico City"), "cmx");
  assert.equal(estadoPorNombre("Nuevo Leon"), "nle");
  assert.equal(estadoPorNombre("Michoacán"), "mic");
  assert.equal(estadoPorNombre("State of Mexico"), "mex");
  assert.equal(estadoPorNombre("Texas"), null);
});
