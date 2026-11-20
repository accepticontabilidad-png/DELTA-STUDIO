# DELTA — tu asistente personal

DELTA es un asistente estilo JARVIS que maneja tu agenda, tus tareas y tus avisos. Le hablas o le escribes desde la app (en la PC o en el celular) o por WhatsApp, y él se encarga.

## Qué hace hoy (fase 1)

- **Conversación con voz:** tocas el orbe, hablas, y DELTA responde en voz alta. También tiene modo manos libres: dices "Delta, …" y te escucha.
- **Tareas:** "Anota que tengo que mandarle el reporte a Acme el viernes, es urgente."
- **Calendario propio:** "Agenda junta con Café Luna mañana a las 10 por Zoom." Te avisa 15 minutos antes. En la app se ve como calendario de Día, Semana o Mes.
- **Sonidos:** tonos propios de DELTA al escuchar, enviar, responder, cuando agenda o completa algo y en los avisos. Se apagan en ⚙ Ajustes.
- **Archivos:** con el clip 📎 adjuntas fotos (o la cámara del celular), PDF, Word (.docx), Excel (.xlsx), CSV o texto, y DELTA los lee y analiza. Hasta 10 MB cada uno y 5 por mensaje.
- **Recordatorios:** "Recuérdame pagar la renta cada mes el día 1 a las 9." Únicos, diarios, semanales o mensuales.
- **Resumen de la mañana:** cada día a la hora que elijas (8:00 por defecto) te manda tus citas y pendientes.
- **Memoria:** recuerda lo que le cuentes (nombres de clientes, preferencias) para futuras conversaciones.
- **Avisos donde estés:** notificación en el celular/PC (app instalada) y mensaje por WhatsApp.
- **Panel tipo centro de comando:** orbe animado, reloj, clima, agenda, tareas y estado de las conexiones.

## Próximas fases

- Conectar las cuentas de tus clientes (Meta Ads, Instagram, TikTok, Google) y ver sus estadísticas.
- Reportes automáticos por cliente.
- Notas de voz por WhatsApp.

---

## Cómo ponerlo en marcha

### 1. Lo que necesitas

| Qué | Para qué | Dónde se consigue |
|---|---|---|
| Clave de Claude | El "cerebro" de DELTA | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| Un servidor | Para que DELTA esté encendido siempre | Railway, Render o cualquier servidor con Node 22 o Docker |
| WhatsApp Business (opcional) | Hablarle por WhatsApp | [developers.facebook.com](https://developers.facebook.com) |

### 2. Configuración

Copia `.env.example` como `.env` y llena:

- `ANTHROPIC_API_KEY`: tu clave de Claude.
- `CLAVE_ACCESO`: la contraseña con la que entrarás a la app.
- `NOMBRE_USUARIO` (opcional): cómo quieres que te llame.

### 3. Encenderlo

En tu computadora (para probar):

```bash
npm install
npm start
```

y abre http://localhost:3000.

En un servidor con Docker:

```bash
docker build -t delta .
docker run -d -p 3000:3000 -v delta-datos:/data --env-file .env delta
```

> Importante: DELTA guarda todo en un archivo dentro de la carpeta `/data`. En el servidor esa carpeta debe ser un **disco persistente** (en Railway: "Volume"; en Render: "Disk"), si no, se borra al reiniciar.

### 4. Instalarlo en el celular y la PC

1. Abre la dirección de tu servidor en el navegador (Chrome en Android/PC, Safari en iPhone).
2. Entra con tu clave.
3. **Android / PC:** botón ⚙ → "Instalar app" (o el ícono de instalar en la barra del navegador).
   **iPhone:** botón Compartir → "Agregar a pantalla de inicio".
4. Abre DELTA desde el ícono, ve a ⚙ → "Activar avisos en este equipo" y acepta el permiso.

### 5. Conectar WhatsApp

WhatsApp exige usar su plataforma oficial para negocios. Se hace una sola vez:

1. En [developers.facebook.com](https://developers.facebook.com) crea una app tipo **Business** y agrega el producto **WhatsApp**.
2. Registra un número para DELTA (debe ser un número que no esté usando WhatsApp normal; puede ser una línea nueva).
3. En **Configuración → Básica** de tu app de Meta copia el **Secreto de la app** en `WHATSAPP_APP_SECRET`. Con él DELTA comprueba que cada mensaje viene de verdad de Meta; sin él, DELTA no atiende WhatsApp.
4. Copia el **token permanente** (desde un "usuario del sistema" en Business Manager) en `WHATSAPP_TOKEN` y el **Phone number ID** en `WHATSAPP_PHONE_ID`.
5. Inventa una palabra secreta y ponla en `WHATSAPP_VERIFY_TOKEN`.
6. Pon tu número personal en `WHATSAPP_MI_NUMERO` (con código de país, sin + ni espacios, ej. `5215512345678`). DELTA solo responde a ese número.
7. En la configuración de WhatsApp de tu app de Meta, en **Webhook**, pon:
   - URL: `https://TU-SERVIDOR/webhook/whatsapp`
   - Token de verificación: la palabra secreta del paso 5
   - Suscríbete al campo **messages**.
8. **Plantilla para avisos:** WhatsApp solo deja que DELTA te escriba primero si le has escrito en las últimas 24 horas. Para que los recordatorios lleguen siempre, crea en WhatsApp Manager una plantilla de categoría *Utilidad* llamada `recordatorio_delta`, idioma Español (MX), con el texto `{{1}}`. Cuando Meta la apruebe, DELTA la usará sola.

Costos: Meta cobra los mensajes que DELTA inicia con plantilla (centavos por mensaje). Responderte dentro de una conversación que tú empezaste no tiene costo.

## Seguridad

Cómo se protege DELTA:

- **Clave obligatoria.** Sin `CLAVE_ACCESO` (mínimo 12 caracteres) DELTA no arranca, así que nunca queda abierta por error.
- **Sesión protegida.** Al entrar, el navegador recibe una sesión que el código de la página no puede leer (cookie `HttpOnly`, `SameSite=Strict`, `Secure` en HTTPS). Dura 30 días. Desde ⚙ puedes cerrar la sesión en este equipo o en **todos** los equipos (útil si pierdes el celular). Cambiar `CLAVE_ACCESO` también cierra todas las sesiones.
- **Bloqueo de intentos.** 5 claves incorrectas desde una misma conexión la bloquean 15 minutos; 20 en una hora desde cualquier lado bloquean la entrada una hora. Te llega una alerta por WhatsApp y al celular cuando pasa. Las sesiones ya abiertas siguen funcionando.
- **Archivos privados.** Lo que adjuntas se guarda en el disco de DELTA con un nombre al azar, solo se puede subir con sesión abierta y nunca queda publicado en internet. Se reconoce por su contenido (no por el nombre) y se rechaza lo que no sea foto, PDF, Office o texto.
- **WhatsApp verificado.** Cada mensaje se comprueba con la firma de Meta (`WHATSAPP_APP_SECRET`) y solo se atiende tu número. Nadie puede fingir ser tú.
- **Protección contra páginas trampa.** Toda acción que cambia algo exige una cabecera especial que otro sitio web no puede enviar, y la app no se puede incrustar en otras páginas.
- **Cabeceras de seguridad** (CSP, nosniff, no-referrer, HSTS en HTTPS) que impiden cargar código de terceros.
- **Secretos fuera del código.** Las claves viven solo en las variables del servidor (`.env`, que nunca se sube a GitHub). Los datos (`data/`) tampoco se suben.

Lo que te toca a ti:

1. Usa una clave larga y única para `CLAVE_ACCESO` (por ejemplo, 4 o 5 palabras al azar). No la reutilices en otros sitios.
2. Publica DELTA solo con **HTTPS** (Railway y Render lo dan solos).
3. Activa la verificación en dos pasos en tus cuentas de GitHub, Meta, Anthropic y del servidor: quien entre a ellas podría ver tus claves.
4. Si alguna clave se filtra, cámbiala en el servidor y reinicia DELTA.

> Nota técnica: DELTA confía en un proxy delante (lo normal en Railway/Render) para saber la IP real. Si lo corres directo en un servidor sin proxy, pon `PROXIES_DE_CONFIANZA=0`.

### Ajustes útiles

| Variable | Qué cambia | Por defecto |
|---|---|---|
| `ZONA_HORARIA` | Tu zona horaria (la app la toma de tu equipo al entrar la primera vez) | `America/Mexico_City` |
| `HORA_RESUMEN` | Hora del resumen de la mañana (también desde ⚙) | `08:00` |
| `DELTA_MODELO` | Modelo de Claude | `claude-opus-5-5` |
| `DELTA_ESFUERZO` | Cuánto "piensa" antes de responder: `low`, `medium`, `high` | `medium` |

---

## Para desarrolladores

- `server/index.js`: servidor (Express), API del panel, webhook de WhatsApp.
- `server/cerebro.js`: agente Claude (Messages API + tool runner del SDK) con las herramientas de agenda. Si el modelo principal declina una petición, la API reintenta con otro modelo (`fallbacks: "default"`).
- `server/agenda.js`: tareas, calendario, recordatorios y memoria (SQLite con `node:sqlite`).
- `server/avisos.js`: revisa cada 30 s recordatorios, citas próximas y el resumen diario; avisa por pantalla, push y WhatsApp.
- `public/`: la app (PWA sin compilación): `index.html`, `estilos.css`, `app.js`, `sw.js`.
- Pruebas: `npm test`.

Requiere Node 22.13 o superior.
