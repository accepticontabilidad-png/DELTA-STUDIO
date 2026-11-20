// Pruebas de archivos adjuntos: reconocer tipos, leer Word/Excel y rechazar lo que no sirve.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-archivos-"));
const { guardarArchivo, bloquesDeArchivo, infoArchivo } = await import("../server/archivos.js");

// ZIP mínimo (lo que son por dentro los .docx y .xlsx).
function zip(entradas) {
  const locales = [], centrales = [];
  let off = 0;
  for (const [nombre, texto] of Object.entries(entradas)) {
    const n = Buffer.from(nombre), datos = zlib.deflateRawSync(Buffer.from(texto));
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8); l.writeUInt32LE(datos.length, 18); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(datos.length, 20); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locales.push(l, n, datos); centrales.push(c, n);
    off += 30 + n.length + datos.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(Object.keys(entradas).length, 10); fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(off, 16);
  return Buffer.concat([...locales, dir, fin]);
}

test("lee el texto de un Word", () => {
  const docx = zip({ "word/document.xml": '<w:document><w:body><w:p><w:r><w:t>Contrato con Café Luna</w:t></w:r></w:p><w:p><w:r><w:t>Pago: $12,000 &amp; IVA</w:t></w:r></w:p></w:body></w:document>' });
  const a = guardarArchivo(docx, "contrato.docx");
  assert.equal(a.tipo, "word");
  const [b] = bloquesDeArchivo(a.id);
  assert.equal(b.type, "document");
  assert.match(b.source.data, /Contrato con Café Luna\nPago: \$12,000 & IVA/);
});

test("lee un Excel como tabla", () => {
  const xlsx = zip({
    "xl/workbook.xml": '<workbook><sheets><sheet name="Ventas" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/sharedStrings.xml": "<sst><si><t>Cliente</t></si><si><t>Monto</t></si><si><t>Clínica Sol</t></si></sst>",
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>4500</v></c></row></sheetData></worksheet>',
  });
  const a = guardarArchivo(xlsx, "ventas.xlsx");
  assert.equal(a.tipo, "excel");
  assert.equal(bloquesDeArchivo(a.id)[0].source.data, "## Hoja: Ventas\nCliente,Monto\nClínica Sol,,4500");
});

test("fotos y PDF se mandan como imagen y documento", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  const foto = guardarArchivo(png, "foto.png");
  assert.equal(bloquesDeArchivo(foto.id)[1].type, "image");
  const pdf = guardarArchivo(Buffer.from("%PDF-1.4\n..."), "reporte.pdf");
  assert.equal(bloquesDeArchivo(pdf.id)[0].source.media_type, "application/pdf");
  const csv = guardarArchivo(Buffer.from("a,b\n1,2"), "datos.csv");
  assert.equal(csv.tipo, "texto");
});

test("rechaza lo que no puede leer y no confía en el nombre", () => {
  assert.throws(() => guardarArchivo(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), "viejo.xls"), /\.xlsx/);
  assert.throws(() => guardarArchivo(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), "foto.jpg"), /No reconozco/);
  assert.throws(() => guardarArchivo(Buffer.alloc(11 * 1024 * 1024, 65), "grande.txt"), /10 MB/);
  assert.throws(() => guardarArchivo(Buffer.alloc(0), "vacio.txt"), /vacío/);
  const raro = guardarArchivo(Buffer.from("hola"), "../../etc/passwd");
  assert.equal(raro.nombre, ".._.._etc_passwd"); // el nombre nunca se usa como ruta
  assert.equal(infoArchivo("../x"), null);
});
