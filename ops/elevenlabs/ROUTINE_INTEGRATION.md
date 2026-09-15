# Clara: transcripción, resumen y rutina estructurada

Estado: integración publicada únicamente en QA y activa para `testers` desde el 15 de septiembre de 2026. Producción no fue modificada.

## Flujo

1. La aplicación crea un `consultation_id` aleatorio y lo envía como variable dinámica al conector ElevenLabs.
2. Clara llama `buscar_productos_shopify` antes de mencionar un producto. El servidor devuelve únicamente productos activos, disponibles y publicados en Online Store.
3. Al cerrar la consulta, Clara llama `guardar_rutina_clara`. El servidor vuelve a resolver cada `product_handle` contra Shopify y elimina cualquier producto inexistente, no publicado o no disponible.
4. ElevenLabs envía `post_call_transcription` firmado. La aplicación verifica la firma con el SDK oficial y guarda su transcripción y resumen, sin volver a analizarlos con otro modelo.
5. La pantalla consulta el resultado mediante un token de navegador separado cuyo hash queda en la base de datos.

## Configuración remota aplicada en QA

- `CLARA_AGENT_TOOL_SECRET` existe solamente en Vercel Preview y su forma Bearer solamente en el secreto de workspace de ElevenLabs.
- Las herramientas `buscar_productos_shopify` y `guardar_rutina_clara` están adjuntas solamente a `clara-ai-qa` / `qa-routine-tools-2026-09-14`.
- La rama QA obliga a buscar antes de recomendar, no inventar productos y guardar una única rutina después de una confirmación explícita en el turno siguiente.
- `Clara QA post-call` está asociado solamente a esa rama, entrega `post_call_transcription` como JSON, no envía audio y tiene reintentos habilitados.
- El endpoint de testers valida la firma HMAC con el SDK oficial, acepta únicamente el agente QA y persiste una transcripción normalizada, resumen y métricas permitidas.
- Vercel Preview contiene las dos conexiones Neon, los secretos del conector QA, la autorización de herramientas y el secreto del webhook. Producción conserva su configuración anterior.
- El tráfico de `clara-ai-qa` está en 100% para la rama QA. El agente `clara-ai` de Producción conserva Main en 100%.

## Candidato de resumen y cierre

- `qa-recap-routine-fix-2026-09-15` parte de la versión activa y se mantiene en 0% hasta completar el despliegue de Preview.
- Fija el idioma de análisis en español y extrae solamente `resumen_usuario`: 2–3 oraciones claras, sin nombres ni datos personales.
- Una confirmación que también incluya agradecimiento o despedida debe ejecutar `guardar_rutina_clara` antes de la respuesta final.
- Rechazos y respuestas ambiguas no guardan; la ambigüedad requiere una nueva confirmación.
- Las zonas de uso, beneficios, productos y enlaces deben estar respaldados explícitamente por la respuesta de Shopify.
- Las pruebas dirigidas del candidato pasan los tres escenarios de confirmación, rechazo y ambigüedad.

## Validación pendiente de la persona tester

La primera llamada autenticada validó micrófono, LiveAvatar, búsqueda Shopify, post-call y resumen, y detectó dos defectos: resumen en inglés y rutina sin guardar ante una confirmación combinada con despedida. El candidato anterior corrige ambos comportamientos. Después de desplegar su aplicación complementaria, deben completarse dos llamadas reales consecutivas con resumen en español, una rutina persistida y enlaces vigentes.

No usar los templates directamente mientras contengan marcadores `<...>`.

## Storefront Catalog MCP

Shopify ofrece un Storefront Catalog MCP oficial con búsqueda natural. Se probó
el endpoint de esta tienda el 2026-09-14, pero la protección por contraseña del
storefront lo redirige a `/password` y devuelve HTML en lugar de MCP. Mientras
esa protección siga activa, Clara usa el adaptador Admin API limitado al
catálogo propio. Cuando la tienda sea pública, volver a probar `/api/ucp/mcp` y
preferir `search_catalog` si supera los casos en español.
