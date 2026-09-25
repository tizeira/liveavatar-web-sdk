# Clara LAB — ventana Preview del 25/09

Autorización: diseño y textos aprobados; publicar en testers, no en producción.

## Evidencia previa verificada

- Rama: codex/clara-lab-design-2026-09-25, base 39abffc.
- Testers: dpl_BphahP28HcwREVJ5oCC9u5iCZjft, READY, Preview,
  fuente baf33c982005fbca0f211dfb71e55091eb1258b0.
- Producción: dpl_9YX7sMRM9huyjpGPUmCGTiX24Dqf, READY, sin cambios.
- Proyecto Vercel liveavatar-web-sdk-demo, rootDirectory apps/demo.
- Preview tiene variables sensibles de base y herramientas tanto generales
  como específicas de la rama QA anterior. Los valores no se descargan ni imprimen.

## Corte condicionado

El código aprobado incorpora dependencias de catálogo posteriores al deployment
actual de testers. Antes de mover el dominio se ejecuta una consulta read-only
durante un build Preview aislado: verificar endpoint QA conocido, tablas,
migración terminada y catálogo inicializado. No aplicar migraciones ni copiar
datos de producción como parte de esta publicación visual.

El script preflight-preview.mjs aborta fuera de Preview o ante endpoint distinto.
La configuración local ignorada .vercel/lab-preview.json sólo cambia el comando
de este deployment; no altera configuración remota del proyecto.

Si falta infraestructura o la comprobación falla, no mover testers.
Rollback exclusivo de testers: dpl_BphahP28HcwREVJ5oCC9u5iCZjft.
No mover otros aliases, no modificar Shopify, agentes, secretos ni bases.

## Validación local

- Suite demo: 206 aprobadas, 3 omitidas (35 archivos).
- Preflight aislado: 5 pruebas aprobadas.
- Typecheck, lint completo demo y revisión independiente del diseño aprobados.
- La validación real de acceso, voz y rutina sólo puede hacerse después de
  corroborar la compatibilidad del entorno.
