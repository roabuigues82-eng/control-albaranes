# Cotejo de albaranes

App web para el móvil que ayuda a comprobar la mercancía recibida contra el albarán. No necesita cuenta, clave ni servidor: funciona en cualquier móvil con navegador.

## Cómo se usa

1. **+ Nuevo → Importar PDF o Excel**: elige el albarán, o varios a la vez. Se abre la lista de artículos.
   - El PDF de TEDi (Lieferschein) se lee directamente: el código del artículo es el AUFTRAG de 10 cifras.
   - Si hay varios albaranes cargados, al escanear se busca el artículo en todos y se marca en el suyo.
2. Marca cada artículo al encontrarlo, de una de estas formas:
   - toca la línea;
   - pulsa **Escanear** y apunta la cámara al código de barras (se usan sus 10 primeras cifras);
   - escribe el código en el buscador.

   Lo marcado queda con ✓ y tachado.
3. Arriba se ve el progreso (por ejemplo, 120 / 364). La pestaña **Pendientes** muestra lo que falta por encontrar.
4. Si una cantidad o un precio no cuadra, toca **⋯** en ese artículo para corregirlo.
5. La pestaña **Diferencias** muestra las faltas y sobras con su importe. En **Ver todos los albaranes** se descargan las diferencias de todos en un Excel.

## Formato del Excel

La app reconoce las columnas por su nombre:

| Dato | Nombres de columna que reconoce |
|---|---|
| Código | Código, POS NR |
| Descripción | Descripción, Bezeichnung |
| Cantidad | Cantidad, Menge |
| Precio | Precio unidad, VK |
| Uds/caja (opcional) | Uds/caja, Karton-Inhalt |
| Notas (opcional) | Notas, Anotación |

En la app hay una plantilla para descargar (`plantilla_albaran.xlsx`).

## Datos

Los albaranes se guardan solo en el navegador de cada móvil. Cada persona que use la app tiene sus propios albaranes. En **Ajustes → Copia de seguridad** se puede descargar una copia y cargarla en otro móvil.

## Publicar en GitHub Pages

En el repositorio, entra en **Settings → Pages**, elige la rama `main` y la carpeta `/ (root)`, y pulsa **Save**. La app quedará en `https://USUARIO.github.io/control-albaranes/`.

Cada vez que cambies `index.html` o `app.js`, sube el número de `VERSION` en `sw.js` para que los móviles carguen la versión nueva.
