/*
 * Genera las imágenes de una pieza.
 *   npm run render -- 2026-10-02-presentacion   →   posts/2026-10-02-presentacion/
 *
 * Lee `src/<pieza>.html` y captura cada `.pieza[data-salida]` con su tamaño
 * exacto. Las tres comprobaciones vienen del generador de la aplicación
 * (`scripts/media-federacio.mjs`) y están por lo mismo: las tres fallan en
 * silencio y el fichero que sale «parece» bueno.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

/** Por debajo de esto, el fichero es una página en blanco con un nombre bonito. */
const MINIMO_KB = 40;

const pieza = process.argv[2];
if (!pieza) throw new Error("Falta la pieza: npm run render -- <nombre del html de src/, sin extensión>");
const fuente = path.join(RAIZ, "src", `${pieza}.html`);
if (!existsSync(fuente)) throw new Error(`No existe ${fuente}`);
const salida = path.join(RAIZ, "posts", pieza);
mkdirSync(salida, { recursive: true });

const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1240, height: 1400 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(fuente).href, { waitUntil: "load" });

await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => (i.complete ? null : i.decode().catch(() => null)))));
await page.evaluate(() => document.fonts.ready);
if (!(await page.evaluate(() => document.fonts.check("600 34px Geist")))) {
  throw new Error("Geist no se ha cargado (viene de Google Fonts y hace falta red). Con la letra del sistema la pieza se maqueta distinta: no la publiques.");
}

const salidas = await page.locator(".pieza[data-salida]").evaluateAll((els) => els.map((el) => el.dataset.salida));
for (const nombre of salidas) {
  const sel = `.pieza[data-salida="${nombre}"]`;

  // Ningún texto por debajo del móvil: el fichero sale igual y no se lee.
  const choques = await page.evaluate((s) => {
    const p = document.querySelector(s);
    const movil = p.querySelector(".movil")?.getBoundingClientRect();
    if (!movil) return [];
    const tocan = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return Array.from(p.querySelectorAll(".antetitulo, h1, .subtitulo, .arroba, .puntos li, .llamada, .pie span, .marca span"))
      .filter((el) => tocan(el.getBoundingClientRect(), movil))
      .map((el) => `${el.className || el.tagName.toLowerCase()}: «${el.textContent.trim().slice(0, 42)}…»`);
  }, sel);
  if (choques.length > 0) throw new Error(`En ${nombre} hay texto por debajo del móvil:\n  ${choques.join("\n  ")}`);

  // Nada fuera del marco: `overflow: hidden` recorta el final sin avisar.
  const fuera = await page.evaluate((s) => {
    const p = document.querySelector(s);
    const marco = p.getBoundingClientRect();
    return Array.from(p.querySelectorAll(".marca, .antetitulo, .etiqueta, .calles, .lista, .accion, h1, .subtitulo, .arroba, .puntos li, .llamada, .captura, .pie span"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top < marco.top || r.bottom > marco.bottom || r.left < marco.left || r.right > marco.right;
      })
      .map((el) => el.className || el.tagName.toLowerCase());
  }, sel);
  if (fuera.length > 0) throw new Error(`En ${nombre} se sale del marco: ${fuera.join(", ")}`);

  const fichero = path.join(salida, nombre);
  await page.locator(sel).screenshot({ path: fichero });
  const kb = Math.round(statSync(fichero).size / 1024);
  if (kb < MINIMO_KB) throw new Error(`${nombre} solo pesa ${kb} kB: casi seguro que es una página vacía.`);
  console.log(`  ✓ ${nombre}  (${kb} kB)`);
}

await browser.close();
console.log(`\nEn ${salida}`);
