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
