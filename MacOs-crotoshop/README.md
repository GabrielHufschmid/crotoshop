# Crotoshop Desktop

La edición nativa de Crotoshop combina el renderer React/Canvas del editor con
integración de archivos de escritorio y un backend de IA local. Está enfocada
en macOS y mantiene una ruta de empaquetado para Windows.

[Volver al README principal](../README.md) · [Arquitectura](../docs/ARCHITECTURE.md)

## Qué aporta la variante Desktop

- Diálogos nativos para abrir, guardar, exportar y elegir directorios.
- Asociación con proyectos `.crotoshop` y apertura desde Finder.
- Pestañas de documento con estado sucio, guardado directo y detección de
  cambios externos.
- Menús y atajos cercanos a los flujos habituales de aplicaciones de diseño.
- Ventanas de herramientas movibles con snapping a la interfaz.
- Backend Python/ONNX para quitar fondo y crear máscaras semánticas sin subir
  imágenes a terceros.
- Herramientas vectoriales avanzadas, Pixel Stretch Bézier y Warp Mesh.

## Arquitectura nativa

La aplicación conserva una separación estricta entre procesos:

1. El renderer no tiene acceso directo a Node.js.
2. `electron/preload.cjs` expone una API pequeña mediante `contextBridge`.
3. `electron/main.cjs` valida entradas, muestra diálogos y realiza I/O nativo.
4. El sidecar de IA se comunica por mensajes JSON y archivos RGBA temporales.
5. Los temporales se eliminan al finalizar cada operación y el backend se
   detiene después de un período de inactividad.

La ventana se ejecuta con `contextIsolation`, sandbox habilitado y
`nodeIntegration` desactivado.

## Desarrollo

### Requisitos

- Node.js `22.12` o superior.
- npm `10` o superior.
- Python 3 para construir el sidecar de IA.
- macOS para generar y verificar una distribución de macOS.

```bash
npm ci
npm run dev
```

`npm run dev` inicia Vite en `127.0.0.1:5173` y abre Electron cuando el renderer
está disponible.

### Gates de calidad

```bash
npm run lint
npm test
npm run build
```

El build del renderer no descarga el modelo de IA. Los tests cubren, entre otros,
límites de lienzo, historial, snapping, máscaras, geometría de transformación,
Pixel Stretch, Warp Mesh, vectores y archivos de proyecto.

## Backend de IA

```bash
npm run build:backend
```

El script:

1. Crea un entorno virtual aislado en `backend/.venv/`.
2. Instala dependencias con rangos acotados.
3. Descarga ISNet desde su release pública y verifica su checksum.
4. Genera un sidecar autónomo con PyInstaller.
5. Reutiliza la compilación si fuente, dependencias y plataforma no cambiaron.

El modelo, el entorno virtual y el sidecar son artefactos reproducibles y están
excluidos de Git.

## Empaquetado

| Comando | Resultado |
| --- | --- |
| `npm run dist:mac` | Bundle `.app` de desarrollo |
| `npm run dist:mac:local` | `.app` y DMG con firma ad hoc para pruebas locales |
| `npm run dist:dmg` | DMG usando la configuración de electron-builder |
| `npm run release:mac` | Distribución con Developer ID y notarización |
| `npm run verify:mac` | Verificación de firma, Gatekeeper y ticket |
| `npm run dist:win` | Instalador NSIS; debe ejecutarse y probarse en Windows |

Una firma ad hoc permite probar el bundle localmente, pero no reemplaza la
firma Developer ID ni la notarización de Apple. Las credenciales de firma se
configuran únicamente en el entorno local o en un secret store de CI; nunca se
guardan en este repositorio.

## Directorios generados

Estos directorios no deben incluirse en commits:

```text
backend/.venv/
backend-build/
backend-dist/
backend-models/
dist/
release*/
```

## Solución de problemas

- **El backend tarda en el primer uso:** la primera inferencia prepara la sesión
  ONNX/CoreML; las siguientes reutilizan el caché local.
- **Gatekeeper rechaza un DMG local:** `dist:mac:local` usa firma ad hoc. Para
  distribución pública se necesita `release:mac` con credenciales válidas.
- **El puerto 5173 está ocupado:** cerrá el proceso anterior antes de ejecutar
  `npm run dev`; el script usa `--strictPort` para evitar abrir otra instancia en
  un puerto inesperado.

Para decisiones de diseño y flujos internos, consultá
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).
