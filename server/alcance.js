// Alcance de cada petición: quién está usando DELTA y qué clientes puede ver.
// El dueño (o los procesos automáticos) no tienen alcance: ven todo.
// Una persona del equipo con clientes elegidos solo "ve" esos clientes en toda la app.
import { AsyncLocalStorage } from "node:async_hooks";

export const alcance = new AsyncLocalStorage();

/** La persona del equipo de esta petición, o null si es el dueño. */
export const usuarioActual = () => alcance.getStore()?.usuario || null;

/** null = todos los clientes; si no, un Set con los ids permitidos. */
export function clientesPermitidos() {
  const u = usuarioActual();
  return u && Array.isArray(u.clientes) ? new Set(u.clientes.map(Number)) : null;
}

export function puedeVerCliente(id) {
  const p = clientesPermitidos();
  return !p || p.has(Number(id));
}
