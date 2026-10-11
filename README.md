# dorelta-social

Piezas de Instagram de [Dorelta](https://dorelta.es): la fuente HTML, el
generador y las imágenes ya publicadas.

**Este repositorio es público a propósito.** Metricool (desde donde se
programan las publicaciones) solo acepta imágenes con URL pública, y las de
aquí se sirven tal cual desde GitHub:

```
https://raw.githubusercontent.com/albertcas/dorelta-social/main/posts/<pieza>/post.png
```

Por eso aquí **no entra nada que no pueda ver cualquiera**: solo capturas del
club de ejemplo («Club Referencia»), nunca de un club real ni con nombres de
deportistas.

## Estructura

| Ruta | Qué es |
| --- | --- |
| `src/<pieza>.html` | La fuente de cada pieza. Cada `.pieza[data-salida]` es una imagen. |
| `src/piezas.css` | La composición común (post 1080 × 1350, story 1080 × 1920). |
| `src/comun.css` | Los tokens de color, copia literal de los del repo de la aplicación. |
| `src/assets/` | Logo y capturas, copiados de `public/` del repo de la aplicación. |
| `posts/<pieza>/` | Las imágenes generadas y `texto.md` con el texto del post. |

## Generar una pieza

```bash
npm install
npm run render -- 2026-10-02-presentacion
```

Necesita red (la letra Geist viene de Google Fonts) y Chrome instalado. El
generador falla, en vez de sacar un fichero que «parece» bueno, si la letra no
ha cargado, si hay texto tapado por el móvil o si la imagen sale vacía.

Si cambian las capturas de `public/producto/` en la aplicación, hay que
volver a copiarlas a `src/assets/` y regenerar.

## Publicar (sin Metricool)

Publica GitHub Actions con la API oficial de Instagram
(`.github/workflows/publicar.yml`, cada 15 minutos). Gratis: el repo es público.

1. Genera la pieza (`npm run render -- <pieza>`): además del PNG para revisar,
   sale un **JPEG**, que es lo único que publica la API de Instagram.
2. Añade la entrada a `cola.json`:

   ```json
   {
     "id": "2026-10-14-registro-post",
     "cuando": "2026-10-14T10:00:00+02:00",
     "tipo": "post",
     "imagenes": ["posts/2026-10-14-registro/post.jpg"],
     "texto": "…",
     "alt": ["…"]
   }
   ```

   `tipo` es `post` (una imagen), `carrusel` (de 2 a 10) o `story` (una, sin texto).
3. `node scripts/publicar.mjs --comprobar` valida la cola sin red ni token.
4. Commit y push. A su hora la publica el flujo y apunta el resultado en
   `estado.json` (enlace, o el error y el número de intentos).

- **Publicar ya:** pestaña Actions → «Publicar en Instagram» → Run workflow, con el `id`.
- **Fallos:** cada entrada se reintenta hasta 3 veces; un fallo pone el flujo en rojo
  y GitHub avisa por correo. Lo que llegue más de 12 h tarde no se publica.
- **Stickers** (encuesta, enlace, mención): la API no los pone. Esas stories se
  publican a mano desde la app.

### Secretos

| Secreto | Qué es |
| --- | --- |
| `IG_TOKEN` | Token de la cuenta @dorelta.es, de la app de Meta («Generar tokens de acceso»). `gh secret set IG_TOKEN --repo albertcas/dorelta-social` |
| `GH_PAT` | Opcional. Token de GitHub de grano fino con «Secrets: read and write» sobre este repo, para que `renovar-token.yml` guarde el token renovado sin intervención. |

El token de Instagram dura 60 días; `renovar-token.yml` lo renueva el 1 y el 15 de cada mes.
