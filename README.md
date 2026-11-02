# Cotejo de albaranes

Aplicación web para el móvil para comprobar la mercancía recibida contra el albarán del proveedor. Sirve para revisar la cantidad y el precio de cada artículo.

## Qué hace

- **Importa el albarán desde Excel** (.xlsx, .xls o .csv). Reconoce solas las columnas de código, EAN, descripción, cantidad y precio, y en la app hay una plantilla para descargar (`plantilla_albaran.xlsx`).
- **Lee el albarán** (opcional) a partir de fotos o de un PDF y saca cada línea: código, EAN, descripción, cantidad y precio unitario neto. La lectura usa la API de Anthropic (Claude) con tu clave. Antes de guardar, revisas y corriges las líneas.
- **Busca cada artículo** de dos formas:
  - con el botón Escanear de abajo, que usa la cámara en vivo, tiene linterna y pita al leer;
  - escribiendo el código, la referencia o parte de la descripción.
- **Coteja** la cantidad recibida y el precio real. Marca cada línea como Correcto, Falta, Sobra, Precio distinto o No está en albarán.
- **Contar +1**: cada escaneo suma una unidad.
- **Exporta** el cotejo a CSV para abrirlo en Excel.
- **Guarda los datos** en el propio dispositivo y permite hacer una copia de seguridad en JSON para pasarlos a otro.
- **Se instala** en el móvil como una app (PWA) y abre sin conexión. La lectura automática sí necesita internet.

## Publicar en GitHub Pages

1. Crea un repositorio, por ejemplo `cotejo-albaranes`, y sube todos los archivos de esta carpeta a la raíz.
2. En el repositorio entra en **Settings → Pages → Build and deployment**. Elige **Deploy from a branch**, la rama `main` y la carpeta `/ (root)`. Pulsa Save.
3. En uno o dos minutos la app estará en `https://TU-USUARIO.github.io/cotejo-albaranes/`.
4. En el móvil, abre esa dirección y elige **Añadir a pantalla de inicio** (o **Instalar app**).

La cámara solo funciona en HTTPS, y GitHub Pages ya lo usa.

## Clave de API (lectura automática)

1. Crea una clave en https://console.anthropic.com → API Keys y añade saldo. Se paga por uso: un albarán de una página cuesta unos céntimos.
2. En la app, abre **Ajustes**, pega la clave y pulsa Guardar.

La clave queda guardada solo en el navegador de ese dispositivo y la app solo la envía a `api.anthropic.com`. **No la escribas nunca en el código ni la subas a GitHub.** Si el repositorio es público, otras personas podrán abrir la app, pero necesitarán su propia clave y no verán tus albaranes.

Sin clave, la app funciona igual: importas el albarán desde Excel o escribes las líneas a mano. La clave solo hace falta para leer fotos o PDF.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Estructura y estilos |
| `app.js` | Toda la lógica |
| `sw.js` | Uso sin conexión. **Cambia `VERSION` cada vez que modifiques la app** para que los móviles reciban la nueva versión |
| `plantilla_albaran.xlsx` | Plantilla de Excel para pasar los albaranes |
| `manifest.webmanifest`, `icon*.png`, `icon.svg` | Instalación como app |

## Probar en local

```bash
python3 -m http.server 8000
```

Después abre http://localhost:8000. Para probar el diseño de móvil en el ordenador, usa el modo dispositivo de las herramientas de desarrollo del navegador.
