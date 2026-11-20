// Memoria corta para datos de afuera (bolsa, noticias): la app y las rutinas no repiten
// la misma consulta a cada rato, y la pantalla responde al instante.
const guardados = new Map();

export async function conCache(clave, msVida, obtener) {
  const g = guardados.get(clave);
  if (g && g.expira > Date.now()) return g.valor;
  if (g?.pendiente) return g.pendiente;
  const pendiente = obtener().then(
    (valor) => { guardados.set(clave, { valor, expira: Date.now() + msVida }); return valor; },
    (e) => { guardados.delete(clave); throw e; },
  );
  guardados.set(clave, { ...(g || {}), expira: 0, pendiente });
  return pendiente;
}

export function olvidarCache(prefijo = "") {
  for (const k of guardados.keys()) if (k.startsWith(prefijo)) guardados.delete(k);
}
