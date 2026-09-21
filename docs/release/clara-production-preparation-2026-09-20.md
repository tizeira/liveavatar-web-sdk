# Preparación productiva — 20/09/2026

Estado: preparación local, no autorización ni despliegue. Base QA aprobada por el usuario: `2f4577a46ae848d977e58c960da97b1dc7a5eaaa`. Preservar el checkout principal y los cambios del theme por separado.

## Delta sobre QA

- Retirar `apps/demo/app/api/qa-connector-reference/route.ts` y su test exclusivo: referencia temporal de diagnóstico, no funcionalidad de clientes.
- Ampliar `apps/demo/scripts/preflight-production.mjs` y el runbook con verificación de aislamiento de datos, destino de proveedores, respaldo del theme, revisión del contrato de acceso productivo y recuperación QA.
- No alterar el conector LITE, voz, rutinas, productos ni los límites aprobados.

## Evidencia nueva y pendientes

- Vercel QA continúa en `dpl_BYEPtmJQQBYAfAi3AJaKZjGr8KXZ`; Producción conserva `dpl_Fsr5GFXgthAvogAozEBf5w9RoJ3q`.
- Metadatos de entorno: `CLARA_AGENT_TOOL_SECRET`, `ELEVENLABS_WEBHOOK_SECRET` y `CRON_SECRET` existen solamente en Preview. No se leyeron sus valores ni se copiaron a Production.
- Los bindings `POSTGRES_PRISMA_URL` y `POSTGRES_URL_NON_POOLING` abarcan Preview y Production. Esto no acredita aislamiento: verificar destinos efectivos, ramas y respaldo antes de migraciones o retención.
- Recuperación QA aprobada por reporte del usuario («todo okey»); no representa una llamada realizada por el asistente.
- Faltan evidencia de esquema/migraciones, respaldo recuperable y ruta productiva de tools/webhook. No aprobar puertas por la sola presencia de nombres de variables.

## Contrato tienda → Clara

Conservar el acceso v2 existente: cliente autenticado en Shopify, firma con vencimiento, navegación a la raíz de Clara con el contrato de consulta existente, canje JSON POST por cookie segura y limpieza de la URL. No convertir la navegación en un GET al endpoint de canje. No registrar enlaces firmados.

Antes de cualquier escritura Shopify: corroborar ID, rol y nombre del theme, dominio, página y template asignado; respaldar los dos archivos live. Aplicar únicamente `templates/page.clara.liquid` y los dos enlaces de `templates/page.clara-landing.json`, no publicar todo un draft.

## Secuencia de cierre

1. Asistente: verificar Neon con acceso autenticado de lectura; contrastar esquema, aislamiento y recuperación sin modificar datos.
2. Asistente: presentar el alcance exacto de configuración productiva, identidad del agente/tools/webhook y cualquier migración necesaria. Usuario: autorizar esas escrituras específicas; no pegar secretos en la conversación.
3. Asistente: completar evidencia del candidato exacto, checks y preflight; conservar rollback de aplicación y theme.
4. Tras autorización de publicación: desplegar aplicación y probar acceso protegido con firma v2 generada desde un preview Shopify controlado, previamente autorizado, sin mover los CTAs live. No simular una firma con secretos expuestos.
5. Tras smoke aprobado: aplicar los dos archivos Shopify autorizados y verificar entrada desde la tienda, conversación, cierre, rutina persistente y productos. Mantener contraseña global y A/B desactivado.
6. Si falla: revertir aplicación o archivos del theme según el runbook; nunca restaurar una base automáticamente.

Referencias: [entornos de Vercel](https://vercel.com/docs/environment-variables) y [preparación productiva Neon](https://neon.com/docs/get-started/production-checklist). Son criterios de revisión, no evidencia de configuración de este proyecto.

## Catálogo Shopify persistente — candidato local 21/09/2026

La rama `codex/clara-shopify-product-context-2026-09-20` incorpora, sin despliegue, un snapshot canónico del catálogo en Neon y adapta `shopify-products` para consultarlo antes que Shopify. La sincronización completa queda protegida por `CRON_SECRET`, programada cada seis horas en la configuración local de Vercel y limitada a 1.000 productos/páginas completas. Una falla o paginación incompleta conserva el último snapshot correcto; un catálogo completo válidamente vacío reemplaza los productos anteriores.

El reemplazo borra y recrea el conjunto dentro de una sola transacción, por lo que soporta renombres, intercambios y reutilización de handles sin estados parciales. El guardado de rutinas conserva su validación directa por handle contra Shopify y no se cambió el contrato público de la herramienta del agente.

Pendiente antes de usarlo: crear o seleccionar una rama aislada de Neon, aplicar allí la migración `20260922010000_add_clara_catalog`, ejecutar la primera sincronización y verificar búsqueda con datos reales. No se aplicó ninguna migración remota, no se creó webhook, no se modificó ElevenLabs y no se desplegó esta rama.
