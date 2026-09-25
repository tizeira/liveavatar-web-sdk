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

## Resultado observado

- Commit desplegado: c8b916bfb5cfd221188d68c38f5ca530c02d40cf.
- Deployment Preview aislado: dpl_C2o3MmhiHcghyTGzV1Ergf15fdvZ.
- Estado ERROR por el preflight (no por compilación de interfaz).
- Evidencia del build: matchesQaBranch=true, ready=false,
  reason=SCHEMA_NOT_READY; faltan clara_catalog_products y clara_catalog_state.
- No se ejecutó ningún DDL, sincronización, escritura de datos ni llamada de voz.
- No se movió ningún alias. Testers y Producción conservan sus deployments previos.
- SDK: 114 pruebas aprobadas; demo: 206 aprobadas y 3 omitidas.
- Revisión independiente aprobó UI y preflight; no hubo escalación de modelo.

Comando exacto desde la raíz del worktree:
`vercel deploy --target preview --local-config .vercel/lab-preview.json --yes --no-wait`

Config ignorada usada únicamente en esa publicación:
`buildCommand = node scripts/preflight-preview.mjs && cd ../.. && pnpm --filter @heygen/liveavatar-web-sdk build && pnpm --filter demo build`

SHA-256 de la config:
`55E3A43540FDD1A7455B4B37CEF656B54D297084D3E69FB154E3A85B97CE7F01`.
Vercel confirmó ese mismo buildCommand y el SHA/ref del candidato.
No se usa --skip-domain: CLI 59.5 sólo lo admite para Production. Este Preview
no recibió aliases; la asignación de testers era un paso separado y quedó bloqueada.

Se evitó el hook pre-commit con HUSKY=0 porque su llamada al formateador ejecuta
una reescritura global; los controles focalizados, lint, typecheck y suites se
ejecutaron explícitamente. No se realizó push ni se actualizó una PR.

## Paso pendiente con alcance adicional

Autorizar únicamente la migración aditiva 20260922010000_add_clara_catalog y la
sincronización inicial del catálogo sobre la rama QA confirmada. Después:
repetir preflight/build, verificar aislamiento y protecciones, y mover sólo
testers si todo pasa. Producción, Shopify y ElevenLabs continúan fuera de alcance.
