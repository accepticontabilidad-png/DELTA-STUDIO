// Botón "Guardar como PDF" del reporte (abre la ventana de imprimir del navegador).
document.getElementById("rp-pdf")?.addEventListener("click", () => window.print());
if (document.body.dataset.imprimir === "1") window.addEventListener("load", () => setTimeout(() => window.print(), 400));
