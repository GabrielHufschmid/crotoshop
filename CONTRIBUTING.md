# Contribuir a Crotoshop

Gracias por dedicarle tiempo al proyecto. La mejor contribución es pequeña,
explicable y fácil de verificar. Un PR que resuelve bien un problema concreto
vale más que una reescritura grande con muchas incógnitas.

## Antes de empezar

1. Buscá el problema en Issues para evitar trabajo duplicado.
2. Si el cambio modifica arquitectura, formatos o UX central, abrí primero una
   propuesta breve.
3. No incluyas imágenes privadas, proyectos de clientes, modelos, credenciales
   ni artefactos compilados.

## Preparar el entorno

### Web

```bash
npm ci
npm run dev
```

### Desktop

```bash
cd MacOs-crotoshop
npm ci
npm run dev
```

La construcción del backend de IA es opcional para la mayoría de los cambios de
UI y motores. Consultá su README antes de empaquetarlo.

## Flujo recomendado

1. Creá una rama descriptiva desde `main`.
2. Reproducí el problema o definí el comportamiento esperado.
3. Implementá el cambio en el módulo propietario de esa responsabilidad.
4. Agregá tests proporcionales al riesgo.
5. Validá la interacción visual cuando el cambio afecte la interfaz.
6. Ejecutá todos los gates antes de abrir el PR.

## Gates obligatorios

En la raíz:

```bash
npm run lint
npm test
npm run build
```

En Desktop:

```bash
cd MacOs-crotoshop
npm run lint
npm test
npm run build
```

## Convenciones de código

- TypeScript estricto y tipos explícitos en los límites entre módulos.
- Componentes React enfocados en presentación e interacción.
- Estado de documento y comandos en Zustand; cálculo pesado en `engine/`.
- Parsers estructurados para formatos; no extraer datos complejos con reemplazos
  de texto ad hoc.
- Comentarios cortos solo cuando explican una decisión que el código no muestra.
- Cambios de estilo coherentes con el tema existente y verificados en ventanas
  pequeñas y grandes.
- No sumar una dependencia si la plataforma o el proyecto ya resuelven el caso
  de forma clara.

## Commits y pull requests

Usá mensajes imperativos y concretos, por ejemplo:

```text
fix: keep layer inspector visible on short windows
feat: preserve vector gradients in SVG export
test: cover rotated crop bounds
```

El PR debe incluir:

- qué problema resuelve;
- decisiones relevantes y alternativas descartadas;
- pasos de prueba;
- capturas o video cuando cambia UI;
- riesgos, migraciones o limitaciones conocidas.

## Seguridad

No abras un issue público para una vulnerabilidad. Seguí el proceso indicado en
[SECURITY.md](./SECURITY.md).

## Licencia de contribuciones

Hasta que el proyecto adopte una licencia de código abierto, enviar una
contribución no cambia el copyright del repositorio ni concede permisos sobre
otras partes del código. Si se define una licencia en el futuro, esta sección se
actualizará antes de aceptar contribuciones bajo esos términos.
