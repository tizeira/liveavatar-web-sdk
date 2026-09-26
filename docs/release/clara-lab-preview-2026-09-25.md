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

## Continuación autorizada: 2026-09-26

El usuario autorizó la migración del catálogo y la sincronización inicial sólo
en QA. Se reutilizó el endpoint ep-dark-moon-a4ec9v5b; no se crearon ramas ni
se descargaron credenciales. Producción mantuvo dpl_9YX7sMRM9huyjpGPUmCGTiX24Dqf.

Se añadieron los scripts bootstrap-preview-catalog.mjs y
bootstrap-preview-catalog-sync.ts con pruebas aisladas. El comando exige
Preview, endpoint QA exacto en ambas conexiones, conexión directa no pooled,
base/rol coincidentes, tienda esperada y marcadores explícitos de operación.
Verifica las migraciones locales, core ya aplicado, ausencia de migraciones
fallidas y hash del SQL autorizado antes de ejecutar prisma migrate deploy.
No modifica consultas/rutinas. La sincronización rechaza snapshot vacío y usa
el lector Shopify y el escritor transaccional del catálogo existentes.

Dos builds iniciales se detuvieron antes de escribir por falta de la variable
automática de rama en CLI. Se reemplazó por un marcador build-only, pasando la
rama Git comprobada previamente; no se cambiaron variables permanentes.
Un intento con comando largo fue rechazado antes de crear deployment.

Bootstrap confirmado en dpl_DQyobDBMb7Da5ZoLbuJNoXX6xF1g, SHA b12a2b7:
- migrationApplied: 20260922010000_add_clara_catalog.
- productCount: 11; searchVerified: true (fetch bloqueado durante la búsqueda).
- preflight: matchesQaBranch=true, ready=true, migrationReady=true,
  catalogCount=11, catalogInitialized=true.
- 8 pruebas Node de guards/preflight y 4 pruebas Vitest de sincronización pasan.
- Revisión independiente read-only sin bloqueos; sin escalación de modelo.

Config de operación ignorada .vercel/lab-bootstrap-preview.json:
`node scripts/bootstrap-preview-catalog.mjs && node scripts/preflight-preview.mjs && cd ../.. && pnpm --filter @heygen/liveavatar-web-sdk build && pnpm --filter demo build`

Se invocó con target preview y dos build-env no secretos:
CLARA_QA_SOURCE_REF=codex/clara-lab-design-2026-09-25 y
CLARA_QA_CATALOG_BOOTSTRAP=authorized-2026-09-26.

El deployment final dpl_F2ZSKoGYvV46cTGaEq43ZgGVD6GK usa el mismo SHA,
la configuración normal lab-preview.json (preflight read-only) y no recibe
los marcadores bootstrap. El corte de testers queda condicionado a READY y smoke.

Este candidato quedó READY. Smoke aislado: raíz y design_preview redirigen al
acceso protegido (307); cron y rutina sin credenciales devuelven 401; búsqueda
por POST sin autorización devuelve 401. El navegador muestra la puerta de acceso
sin datos privados. No se inició una llamada.

Se corrigió además el descubrimiento de tests de Vitest para excluir únicamente
scripts/*.test.mjs (usan node:test, se ejecutan por separado). La invocación sin
filtros confundía ambos runners. Resultado posterior: pnpm exec vitest run,
210 aprobadas / 3 omitidas; node --test, 8 aprobadas; typecheck y lint focalizado
aprobados. Esta corrección sólo afecta al runner local, no a la aplicación.

## Entrega final en testers

- SHA desplegado: e60de84929a5c8de691c12de34243127cefc057c.
- Deployment Preview: dpl_BgQm4tyxrSv5YqP2H2oHvs3Wv6sE, READY.
- URL inmutable: https://liveavatar-web-sdk-demo-4eqpurlu7.vercel.app.
- Único alias movido: https://testers.betaskintech.com.
- Build normal read-only: preflight listo, 11 productos; compilación completada.
- Antes y después del corte: raíz protegida 307, cron sin Bearer 401,
  rutina sin identidad 401. design_preview no habilita bypass remoto (307).
- Alias testers leído nuevamente: coincide con el deployment final.
- Alias clara.betaskintech.com leído nuevamente: conserva
  dpl_9YX7sMRM9huyjpGPUmCGTiX24Dqf. No se ejecutó rollback porque pasó el smoke.
- Rollback disponible de testers: liveavatar-web-sdk-demo-5ji0fo1z0.vercel.app
  (dpl_BphahP28HcwREVJ5oCC9u5iCZjft). Mantener las tablas aditivas de QA.
- Lint completo demo y typecheck final pasaron.

No se modificaron themes, agentes, voz, webhooks ni secretos. No hubo push,
merge ni cambios en la base productiva. Los scripts operativos no se ejecutan
en el build normal y no agregan endpoints públicos.

Pendiente DEL USUARIO: entrar por el acceso QA habitual, verificar diseño en
inicio/llamada/resumen/rutina, hablar y guardar una rutina, cambiar de pestaña
y finalizar. Confirmar audio, resumen en español, productos y persistencia al
reingresar. No se hizo una llamada real ni se aprobó esa prueba manual.

Siguiente paso DEL AGENTE después del reporte manual: revisar cualquier
regresión y preparar la promoción visual, sin ejecutar un corte productivo
como parte de esta autorización de Preview.
