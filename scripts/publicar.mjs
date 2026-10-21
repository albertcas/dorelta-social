/*
 * Publica en Instagram lo que toca de `cola.json`, con la API oficial
 * (Instagram API con inicio de sesión de Instagram). Sustituye a Metricool.
 *
 *   node scripts/publicar.mjs --comprobar      valida la cola, sin red ni token
 *   node scripts/publicar.mjs                  publica lo vencido (necesita IG_TOKEN)
 *   node scripts/publicar.mjs --solo <id>      publica esa entrada ya, sea la hora que sea
 *
 * Lo lanza GitHub Actions cada 15 minutos (`.github/workflows/publicar.yml`).
 * Lo publicado se apunta en `estado.json`, que el flujo vuelve a subir al
 * repo: es lo que impide publicar dos veces lo mismo.
 *
 * Las imágenes se sirven desde este mismo repo (público) por
 * raw.githubusercontent.com, que es la URL pública que pide Instagram. Tienen
 * que ser JPEG: la API rechaza PNG.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const RAIZ = process.cwd();
const REPO = process.env.GITHUB_REPOSITORY ?? "albertcas/dorelta-social";
const RAMA = process.env.RAMA ?? "main";
const API = `https://graph.instagram.com/${process.env.IG_API_VERSION ?? "v23.0"}`;
const COLA = path.join(RAIZ, "cola.json");
const ESTADO = path.join(RAIZ, "estado.json");

/** Pasados tantos fallos seguidos se deja de reintentar: hay que mirarlo a mano. */
const MAX_INTENTOS = 3;
/** Una entrada con más retraso que esto ya no se publica: sería contenido viejo. */
const MAX_RETRASO_H = 12;

const TIPOS = new Set(["post", "carrusel", "story", "reel"]);

const leer = (f, defecto) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : defecto);
const cola = leer(COLA, []);
const estado = leer(ESTADO, {});
const guardarEstado = () => writeFileSync(ESTADO, JSON.stringify(estado, null, 2) + "\n");

/* ------------------------------------------------------------ validación */

function dimensionesJpeg(fichero) {
  const b = readFileSync(fichero);
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    const marca = b[i + 1];
    const largo = b.readUInt16BE(i + 2);
    if (marca >= 0xc0 && marca <= 0xc3) return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) };
    i += 2 + largo;
  }
  return null;
}

function comprobar(e) {
  const fallos = [];
  if (!e.id) fallos.push("falta `id`");
  if (!TIPOS.has(e.tipo)) fallos.push(`tipo «${e.tipo}» no es post, carrusel, story ni reel`);
  if (Number.isNaN(Date.parse(e.cuando)) || !/[+-]\d\d:\d\d$|Z$/.test(e.cuando ?? "")) fallos.push("`cuando` tiene que ser ISO 8601 con zona, p. ej. 2026-10-14T10:00:00+02:00");
  if (e.tipo === "reel") {
    // Un reel lleva un vídeo (`video`, MP4 H.264 + AAC, vertical) y nada de imágenes.
    if (!e.video || !/\.mp4$/i.test(e.video)) fallos.push("un reel lleva `video`, un .mp4");
    else if (!existsSync(path.join(RAIZ, e.video))) fallos.push(`${e.video}: no existe`);
    else if (statSync(path.join(RAIZ, e.video)).size > 100 * 1048576) fallos.push(`${e.video}: pasa de 100 MB`);
    if (e.imagenes?.length) fallos.push("un reel no lleva `imagenes`");
    if (!e.texto) fallos.push("falta `texto`");
    return fallos;
  }
  const imgs = e.imagenes ?? [];
  if (e.tipo === "carrusel" && (imgs.length < 2 || imgs.length > 10)) fallos.push(`un carrusel lleva de 2 a 10 imágenes, y tiene ${imgs.length}`);
  if (e.tipo !== "carrusel" && imgs.length !== 1) fallos.push(`un ${e.tipo} lleva una sola imagen, y tiene ${imgs.length}`);
  for (const img of imgs) {
    const f = path.join(RAIZ, img);
    if (!/\.jpe?g$/i.test(img)) { fallos.push(`${img}: Instagram solo publica JPEG`); continue; }
    if (!existsSync(f)) { fallos.push(`${img}: no existe`); continue; }
    const d = dimensionesJpeg(f);
    if (!d) { fallos.push(`${img}: no es un JPEG válido`); continue; }
    const r = d.ancho / d.alto;
    if (e.tipo === "story" ? Math.abs(r - 9 / 16) > 0.01 : r < 0.8 - 0.005 || r > 1.91) fallos.push(`${img}: proporción ${d.ancho}×${d.alto} fuera de lo que admite un ${e.tipo}`);
  }
  if (e.tipo === "story" && e.texto) fallos.push("una story no lleva texto: Instagram no lo publica");
  if (e.tipo !== "story") {
    if (!e.texto) fallos.push("falta `texto`");
    else {
      if (e.texto.length > 2200) fallos.push(`texto de ${e.texto.length} caracteres (máximo 2200)`);
      if ((e.texto.match(/#\w/g) ?? []).length > 30) fallos.push("más de 30 hashtags");
    }
  }
  return fallos;
}

/* ------------------------------------------------------------ API */

const TOKEN = process.env.IG_TOKEN;

async function llamar(metodo, ruta, params = {}) {
  const url = new URL(`${API}/${ruta}`);
  const cuerpo = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = metodo === "GET" ? await fetch(`${url}?${cuerpo}`) : await fetch(url, { method: "POST", body: cuerpo });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok || datos.error) {
    // Nunca el token: solo lo que dice Instagram.
    const err = datos.error ?? {};
    throw new Error(`${metodo} ${ruta} → ${res.status} ${err.type ?? ""} ${err.code ?? ""}: ${err.error_user_msg ?? err.message ?? "sin detalle"}`);
  }
  return datos;
}

const urlPublica = (img) => `https://raw.githubusercontent.com/${REPO}/${RAMA}/${img.split(path.sep).join("/")}`;
// GitHub sirve los MP4 como application/octet-stream; jsDelivr, como video/mp4.
// Se fija al commit que se está publicando, así la URL no cambia ni se cachea vieja.
const urlVideo = (v) => `https://cdn.jsdelivr.net/gh/${REPO}@${process.env.GITHUB_SHA ?? RAMA}/${v.split(path.sep).join("/")}`;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Instagram procesa cada contenedor antes de dejar publicarlo. */
async function esperarContenedor(id, intentos = 30) {
  for (let i = 0; i < intentos; i++) {
    const { status_code } = await llamar("GET", id, { fields: "status_code" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`el contenedor ${id} acabó en ${status_code}`);
    await espera(4000);
  }
  throw new Error(`el contenedor ${id} no terminó de procesarse en ${Math.round((intentos * 4) / 60)} minutos`);
}

async function contenedor(e) {
  const alt = (i) => (e.alt?.[i] ? { alt_text: e.alt[i] } : {});
  if (e.tipo === "reel") {
    const portada = e.portadaMs != null ? { thumb_offset: String(e.portadaMs) } : {};
    return (await llamar("POST", "me/media", { media_type: "REELS", video_url: urlVideo(e.video), caption: e.texto, share_to_feed: "true", ...portada })).id;
  }
  if (e.tipo === "story") return (await llamar("POST", "me/media", { image_url: urlPublica(e.imagenes[0]), media_type: "STORIES" })).id;
  if (e.tipo === "post") return (await llamar("POST", "me/media", { image_url: urlPublica(e.imagenes[0]), caption: e.texto, ...alt(0) })).id;
  const hijos = [];
  for (const [i, img] of e.imagenes.entries()) {
    const { id } = await llamar("POST", "me/media", { image_url: urlPublica(img), is_carousel_item: "true", ...alt(i) });
    await esperarContenedor(id);
    hijos.push(id);
  }
  return (await llamar("POST", "me/media", { media_type: "CAROUSEL", children: hijos.join(","), caption: e.texto })).id;
}

async function publicar(e) {
  const id = await contenedor(e);
  // Un vídeo tarda más en procesarse: hasta 6 minutos.
  await esperarContenedor(id, e.tipo === "reel" ? 90 : 30);
  const { id: mediaId } = await llamar("POST", "me/media_publish", { creation_id: id });
  const { permalink } = await llamar("GET", mediaId, { fields: "permalink" }).catch(() => ({}));
  return { mediaId, enlace: permalink ?? null };
}

/* ------------------------------------------------------------ main */

const args = process.argv.slice(2);

// Prueba de solo lectura: ¿funciona el token y de qué cuenta es? No publica nada.
if (args.includes("--probar")) {
  if (!TOKEN) {
    console.error("Falta IG_TOKEN.");
    process.exit(1);
  }
  const cuenta = await llamar("GET", "me", { fields: "user_id,username,account_type" });
  console.log(`Token válido: @${cuenta.username} (${cuenta.account_type}), id ${cuenta.user_id}`);
  const limite = await llamar("GET", "me/content_publishing_limit", { fields: "quota_usage,config" }).catch((e) => ({ error: e.message }));
  console.log("Cupo de publicación:", JSON.stringify(limite.data?.[0] ?? limite));
  process.exit(0);
}
const soloComprobar = args.includes("--comprobar");
const solo = args.includes("--solo") ? args[args.indexOf("--solo") + 1] : null;

let invalidas = 0;
const ids = new Set();
for (const e of cola) {
  const fallos = comprobar(e);
  if (ids.has(e.id)) fallos.push("id repetido");
  ids.add(e.id);
  if (fallos.length) {
    invalidas++;
    console.error(`✗ ${e.id ?? "(sin id)"}:\n    ${fallos.join("\n    ")}`);
  }
}
if (invalidas) {
  console.error(`\n${invalidas} entrada(s) inválida(s) en cola.json: no se publica nada hasta arreglarlas.`);
  process.exit(1);
}

const ahora = Date.now();
const pendientes = cola
  .filter((e) => !estado[e.id]?.publicado)
  .sort((a, b) => Date.parse(a.cuando) - Date.parse(b.cuando));

if (soloComprobar) {
  console.log(`cola.json válida: ${cola.length} entradas, ${pendientes.length} sin publicar.`);
  for (const e of pendientes) {
    const cuando = new Date(e.cuando).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" });
    console.log(`  ${Date.parse(e.cuando) <= ahora ? "VENCIDA " : "        "}${cuando}  ${e.tipo.padEnd(8)} ${e.id}`);
  }
  process.exit(0);
}

const tocan = solo
  ? pendientes.filter((e) => e.id === solo)
  : pendientes.filter((e) => Date.parse(e.cuando) <= ahora && !estado[e.id]?.descartada && (estado[e.id]?.errores ?? 0) < MAX_INTENTOS);
if (solo && tocan.length === 0) {
  console.error(`No hay ninguna entrada pendiente con id «${solo}».`);
  process.exit(1);
}
if (tocan.length === 0) {
  console.log("Nada que publicar ahora.");
  process.exit(0);
}
// El token solo hace falta si hay algo que publicar: sin él, una cola vacía
// no debe poner el flujo en rojo cada 15 minutos.
if (!TOKEN) {
  console.error("Falta el secreto IG_TOKEN y hay publicaciones vencidas.");
  process.exit(1);
}

let fallidas = 0;
for (const e of tocan) {
  const retrasoH = (ahora - Date.parse(e.cuando)) / 3_600_000;
  if (!solo && retrasoH > MAX_RETRASO_H) {
    estado[e.id] = { ...estado[e.id], descartada: new Date().toISOString(), motivo: `llegó ${retrasoH.toFixed(1)} h tarde` };
    guardarEstado();
    console.log(`· ${e.id}: descartada, llega ${retrasoH.toFixed(1)} h tarde`);
    continue;
  }
  try {
    const r = await publicar(e);
    estado[e.id] = { publicado: new Date().toISOString(), ...r };
    console.log(`✓ ${e.id} → ${r.enlace ?? r.mediaId}`);
  } catch (err) {
    fallidas++;
    const errores = (estado[e.id]?.errores ?? 0) + 1;
    estado[e.id] = { errores, ultimoError: String(err.message).slice(0, 500), intento: new Date().toISOString() };
    console.error(`✗ ${e.id} (intento ${errores}/${MAX_INTENTOS}): ${err.message}`);
  }
  // Se guarda tras cada una: si la siguiente revienta, esta ya no se repite.
  guardarEstado();
}

// Un fallo pone el flujo en rojo, y GitHub avisa por correo.
process.exit(fallidas ? 1 : 0);
