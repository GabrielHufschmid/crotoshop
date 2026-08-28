# Política de seguridad

## Versiones soportadas

El desarrollo activo ocurre en `main`. No se mantienen ramas antiguas con
backports de seguridad.

## Reportar una vulnerabilidad

Usá **GitHub Security Advisories** para enviar un reporte privado desde la
pestaña Security del repositorio. No publiques detalles explotables en Issues,
Discussions ni pull requests.

Incluí, cuando sea posible:

- variante afectada: Web, Desktop o ambas;
- versión o commit;
- pasos mínimos para reproducir;
- impacto observado y esperado;
- archivo de prueba reducido y sin información privada;
- cualquier mitigación temporal conocida.

Se intentará confirmar la recepción y clasificar el impacto antes de discutir
una corrección o fecha de publicación. Los reportes de buena fe son bienvenidos.

## Alcance relevante

Especialmente útiles son los reportes sobre:

- lectura o escritura fuera de una ruta elegida por el usuario;
- bypass del aislamiento Electron/preload;
- ejecución de contenido al importar SVG, PDF, EPS, AI o proyectos;
- validación insuficiente de `.crotoshop` o `.crotopalette`;
- exposición de imágenes, temporales o datos de recuperación;
- carga remota inesperada de modelos o recursos;
- denegación de servicio mediante dimensiones o archivos malformados.

## Fuera de alcance

- Advertencias de Gatekeeper en builds locales con firma ad hoc.
- Dependencias desactualizadas sin una ruta de explotación aplicable.
- Problemas que requieren modificar previamente la instalación o el código.
- Ingeniería social, phishing o ataques a servicios que no opera Crotoshop.

## Manejo de secretos

El repositorio no necesita credenciales para compilar el renderer. Certificados,
tokens, claves de notarización, variables de deploy y perfiles locales deben
permanecer en el llavero, el entorno o un secret store. Nunca deben adjuntarse a
un issue ni incluirse en un commit.
