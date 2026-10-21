/*
 * Renderiza un reel fotograma a fotograma.
 *   node video/render-video.mjs video/2026-10-21-resumen            → reel.mp4
 *   node video/render-video.mjs video/2026-10-21-resumen --fotos 3,10,20   → PNG sueltos para revisar
 *
 * La página expone window.render(t) y window.DURACION. Cada fotograma se pide a
 * su tiempo exacto, así que el resultado no depende de lo rápido que vaya el
 * equipo. Sale H.264 + AAC (pista silenciosa), que es lo que pide Instagram.
 */
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FPS = 30;

const dir = path.resolve(process.argv[2] ?? "");
if (!existsSync(path.join(dir, "index.html"))) throw new Error(`No hay index.html en ${dir}`);
const fotos = process.argv.includes("--fotos") ? process.argv[process.argv.indexOf("--fotos") + 1].split(",").map(Number) : null;

const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(dir, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.listo === true, null, { timeout: 30000 });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => (i.complete ? null : i.decode().catch(() => null)))));
if (!(await page.evaluate(() => document.fonts.check("600 34px Geist")))) throw new Error("Geist no ha cargado (hace falta red).");
const duracion = await page.evaluate(() => window.DURACION);

if (fotos) {
  for (const t of fotos) {
    await page.evaluate((t) => window.render(t), t);
    const f = path.join(dir, `foto-${String(t).replace(".", "_")}.png`);
    await page.screenshot({ path: f });
    console.log("  ✓", f);
  }
  await browser.close();
  process.exit(0);
}

const tmp = path.join(dir, ".fotogramas");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp);
const total = Math.round(duracion * FPS);
for (let i = 0; i < total; i++) {
  await page.evaluate((t) => window.render(t), i / FPS);
  await page.screenshot({ path: path.join(tmp, `${String(i).padStart(5, "0")}.jpg`), type: "jpeg", quality: 92 });
  if (i % 60 === 0) process.stdout.write(`\r  fotograma ${i}/${total}`);
}
await browser.close();
console.log(`\r  ${total} fotogramas                `);

const salida = path.join(dir, "reel.mp4");
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error",
  "-framerate", String(FPS), "-i", path.join(tmp, "%05d.jpg"),
  "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
  "-shortest", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-profile:v", "high",
  "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", salida,
], { stdio: "inherit" });
rmSync(tmp, { recursive: true, force: true });
console.log(`  ✓ ${salida}  (${(statSync(salida).size / 1048576).toFixed(1)} MB, ${duracion} s)`);
