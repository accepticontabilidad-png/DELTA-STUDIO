// Estado de la República a partir de la lada de un teléfono mexicano, y de los nombres de estado que da Meta.
// Es aproximado: la lada dice dónde se dio de alta el número, no dónde vive hoy la persona.

export const ESTADOS = {
  agu: "Aguascalientes", bcn: "Baja California", bcs: "Baja California Sur", cam: "Campeche", chp: "Chiapas",
  chh: "Chihuahua", coa: "Coahuila", col: "Colima", dur: "Durango", gua: "Guanajuato", gro: "Guerrero",
  hid: "Hidalgo", jal: "Jalisco", cmx: "Ciudad de México", mex: "Estado de México", mic: "Michoacán",
  mor: "Morelos", nay: "Nayarit", nle: "Nuevo León", oax: "Oaxaca", pue: "Puebla", que: "Querétaro",
  roo: "Quintana Roo", slp: "San Luis Potosí", sin: "Sinaloa", son: "Sonora", tab: "Tabasco",
  tam: "Tamaulipas", tla: "Tlaxcala", ver: "Veracruz", yuc: "Yucatán", zac: "Zacatecas",
};

// Ladas de 3 dígitos que se salen de la regla de su grupo.
const TRES = {
  228: "ver", 229: "ver", 225: "ver", 226: "ver", 232: "ver", 235: "ver", 241: "tla", 246: "tla", 248: "pue",
  311: "nay", 319: "nay", 323: "nay", 324: "nay", 325: "nay", 327: "nay", 312: "col", 313: "col", 314: "col",
  351: "mic", 352: "mic", 353: "mic", 354: "mic", 355: "mic", 356: "mic", 359: "mic", 381: "mic", 383: "mic",
  427: "que", 441: "que", 442: "que", 448: "que", 443: "mic", 447: "mic", 444: "slp", 449: "agu", 465: "agu", 458: "agu",
  474: "jal", 475: "jal", 495: "jal", 496: "jal", 499: "jal",
  612: "bcs", 613: "bcs", 615: "bcs", 624: "bcs", 616: "bcn", 646: "bcn", 653: "son", 664: "bcn", 665: "bcn", 661: "bcn", 686: "bcn",
  618: "dur", 649: "dur", 671: "dur", 674: "dur", 675: "dur", 676: "dur", 677: "dur",
  631: "son", 632: "son", 633: "son", 634: "son", 637: "son", 638: "son", 641: "son", 642: "son", 643: "son", 644: "son", 645: "son", 647: "son", 662: "son",
  667: "sin", 668: "sin", 669: "sin", 672: "sin", 673: "sin", 687: "sin", 694: "sin", 695: "sin", 696: "sin", 697: "sin", 698: "sin",
  734: "mor", 735: "mor", 737: "mor", 739: "mor", 751: "mor", 769: "mor", 777: "mor",
  753: "mic", 764: "pue", 765: "ver", 766: "ver", 768: "ver", 797: "pue",
  868: "tam", 867: "tam", 872: "dur", 873: "nle",
  913: "tab", 914: "tab", 917: "tab", 923: "tab", 916: "chp", 919: "chp", 932: "tab", 933: "tab", 934: "tab", 936: "tab", 937: "tab", 993: "tab",
  971: "oax", 972: "oax", 981: "cam", 982: "cam", 996: "cam", 983: "roo", 984: "roo", 998: "roo",
};
// Regla por los dos primeros dígitos.
const DOS = {
  22: "pue", 23: "pue", 24: "pue", 27: "ver", 28: "ver", 29: "ver", 31: "jal", 32: "jal", 33: "jal", 34: "jal", 35: "mic", 37: "jal", 38: "jal",
  41: "gua", 42: "gua", 43: "mic", 44: "gua", 45: "mic", 46: "gua", 47: "gua", 48: "slp", 49: "zac", 55: "cmx", 56: "cmx", 59: "mex",
  61: "chh", 62: "chh", 63: "chh", 64: "son", 65: "chh", 66: "bcn", 67: "sin", 68: "sin", 69: "sin",
  71: "mex", 72: "mex", 73: "mor", 74: "gro", 75: "gro", 76: "hid", 77: "hid", 78: "ver", 79: "hid",
  81: "nle", 82: "nle", 83: "tam", 84: "coa", 86: "coa", 87: "coa", 89: "tam",
  91: "ver", 92: "ver", 93: "tab", 95: "oax", 96: "chp", 97: "oax", 98: "yuc", 99: "yuc",
};

/** "523312345678" → "jal". Solo números de México (52); otro país o sin lada → null. */
export function estadoPorTelefono(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("521")) d = d.slice(3);
  else if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
  else if (d.length !== 10) return null;
  const dos = Number(d.slice(0, 2));
  if (dos === 55 || dos === 56 || dos === 33 || dos === 81) return DOS[dos];
  return TRES[Number(d.slice(0, 3))] || DOS[dos] || null;
}

const sinAcentos = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const ALIAS = {
  "mexico city": "cmx", "distrito federal": "cmx", "federal district": "cmx", "cdmx": "cmx",
  "state of mexico": "mex", "mexico state": "mex", "mexico": "mex", "estado de mexico": "mex",
  "coahuila de zaragoza": "coa", "michoacan de ocampo": "mic", "veracruz de ignacio de la llave": "ver",
};
const POR_NOMBRE = new Map(Object.entries(ESTADOS).map(([k, v]) => [sinAcentos(v), k]));
/** Nombre de estado como lo da Meta ("Jalisco", "Mexico City", "Nuevo Leon") → clave del mapa. */
export function estadoPorNombre(nombre) {
  const n = sinAcentos(nombre);
  return ALIAS[n] || POR_NOMBRE.get(n) || null;
}
