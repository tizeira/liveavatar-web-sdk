# Clara LAB — implementación local

## Plan y alcance

Base: `39abffc`, rama aislada `codex/clara-lab-design-2026-09-25`.
El checkout principal y la rama previa permanecen intactos.

1. Unificar tokens visuales: papel cálido, tinta, separadores, botones discretos.
2. Aplicar la misma jerarquía a inicio, permiso, conexión, llamada, cierre,
   resumen, rutina y estados de acceso/error.
3. Mantener el recorrido: conversar → permiso → llamada → resumen → una sola
   entrada a rutina. La rutina guardada también se consulta desde el inicio.
4. Comprobar contratos, accesibilidad básica y presentación móvil/escritorio.

## Cambios

- `ClaraVoiceAgent.module.css`: sistema visual LAB, layout flexible, foco visible,
  controles de 44–60 px, movimiento reducido, producto sin recortar su imagen.
- `ClaraVoiceAgent.tsx`: inicio editorial, copy breve, productos antes de las
  instrucciones de cada paso, lista ordenada que conserva todos los momentos y
  precauciones. Foco y scroll al cambiar de pantalla sin remontar la sesión.
- `SavedRoutinePanel.tsx`: presentación compartida de carga, ausencia confirmada
  y error; no interpreta un fallo de lectura como una rutina borrada.
- `ShopifyVerificationStates.tsx` y `app/page.tsx`: continuidad visual del acceso;
  sandbox visual de desarrollo sin consulta a Shopify.
- `app/layout.tsx`: idioma español y zoom habilitado.
- `clara-lab-design.test.tsx`: ocho comprobaciones de presentación adicionales.

No se cambian endpoints, cookies, firmas, proveedor, agente, persistencia,
catálogo ni límites de llamadas. No se agregan dependencias.
No se realizó commit, push, deploy ni modificación remota.

## Preview local

Servidor: `http://127.0.0.1:3015/?design_preview=board`.
Recorrido interactivo: `http://127.0.0.1:3015/?design_preview=welcome`.

El sandbox usa fixtures, no crea sesiones ni pide micrófono. Sus fotos de
producto son placeholders, sin precios inventados. La vista real conserva los
productos, imágenes, enlaces y precios recibidos del contrato existente.
Las rutas `design_preview` siguen limitadas a desarrollo.

Para reproducir: instalar con lockfile, compilar el SDK, iniciar Next en modo
desarrollo con `--webpack --hostname 127.0.0.1 --port 3015`, secreto de autenticación
exclusivamente local y gate de beta deshabilitado exclusivamente en ese proceso.
No copiar archivos de secretos de producción.
Turbopack no resolvió dos dependencias Radix en este worktree Windows; webpack
sí compiló el preview. No se modificó la configuración del proyecto por ello.

## Validación y límites

- 22 pruebas específicas: rutina, consulta, cliente de rutina y diseño LAB.
- Typecheck y lint focalizado.
- Navegación local: inicio → permiso simulado → llamada simulada → silenciar →
  finalizar → resumen → rutina → inicio.
- Revisión en navegador de móvil 390×844, horizontal 844×390 y escritorio.
  Sin overflow horizontal; controles de llamada visibles en ambas orientaciones.
  Recuperación simulada de error de rutina verificada. Consola del tablero sin
  errores registrados. No se prueban imágenes reales ni conversación pagada.
- Captura del tablero guardada fuera del repositorio como
  `clara-lab-implemented-20260925.png` en la carpeta de visualizaciones de la sesión.

## Siguiente etapa

Usuario: revisar el diseño y los textos en la demo local.
Agente: incorporar ajustes visuales; después preparar un preview desplegado
aislado para comprobar acceso Shopify, fotos reales, llamada y rutina persistida
antes de cualquier cambio productivo.
La aprobación visual no equivale a QA productivo ni autoriza mover dominios.
