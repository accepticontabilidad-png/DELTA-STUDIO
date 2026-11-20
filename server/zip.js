// ZIP sin dependencias: leer los archivos de un .zip (para subir habilidades) y armar uno (para descargar diseños).
import zlib from "node:zlib";

/** Lee un .zip en memoria. Devuelve [{ ruta, datos: Buffer }] (solo archivos, sin carpetas). */
export function leerZip(buf, { maxArchivo = 2_000_000, maxTotal = 30_000_000 } = {}) {
  // El "fin del directorio central" está al final (puede haber un comentario de hasta 64 KB).
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error("El archivo no es un .zip válido");
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const salida = [];
  let suma = 0;
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("El .zip está dañado");
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const tamano = buf.readUInt32LE(p + 24);
    const largoNombre = buf.readUInt16LE(p + 28);
    const largoExtra = buf.readUInt16LE(p + 30);
    const largoComentario = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const ruta = buf.subarray(p + 46, p + 46 + largoNombre).toString("utf8").replace(/\\/g, "/");
    p += 46 + largoNombre + largoExtra + largoComentario;
    if (ruta.endsWith("/") || tamano > maxArchivo) continue;
    if ((suma += tamano) > maxTotal) throw new Error("El .zip es demasiado grande");
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("El .zip está dañado");
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const crudo = buf.subarray(inicio, inicio + comprimido);
    let datos;
    if (metodo === 0) datos = Buffer.from(crudo);
    else if (metodo === 8) datos = zlib.inflateRawSync(crudo, { maxOutputLength: maxArchivo + 1 });
    else continue; // otros métodos de compresión: se ignoran
    salida.push({ ruta, datos });
  }
  return salida;
}

/** Arma un .zip (sin comprimir: los PNG y MP4 ya vienen comprimidos). archivos: [{ ruta, datos }] */
export function crearZip(archivos) {
  const partes = [];
  const central = [];
  let pos = 0;
  for (const { ruta, datos } of archivos) {
    const nombre = Buffer.from(ruta, "utf8");
    const crc = zlib.crc32(datos) >>> 0;
    const cab = Buffer.alloc(30);
    cab.writeUInt32LE(0x04034b50, 0);
    cab.writeUInt16LE(20, 4);
    cab.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    cab.writeUInt32LE(crc, 14);
    cab.writeUInt32LE(datos.length, 18);
    cab.writeUInt32LE(datos.length, 22);
    cab.writeUInt16LE(nombre.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(datos.length, 20);
    dir.writeUInt32LE(datos.length, 24);
    dir.writeUInt16LE(nombre.length, 28);
    dir.writeUInt32LE(pos, 42);
    partes.push(cab, nombre, datos);
    central.push(dir, nombre);
    pos += 30 + nombre.length + datos.length;
  }
  const dirBuf = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(dirBuf.length, 12);
  fin.writeUInt32LE(pos, 16);
  return Buffer.concat([...partes, dirBuf, fin]);
}
