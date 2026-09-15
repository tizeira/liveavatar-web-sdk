# Clara: transcripción, resumen y rutina estructurada

Estado: implementación local preparada; configuración remota no publicada.

## Flujo

1. La aplicación crea un `consultation_id` aleatorio y lo envía como variable dinámica al conector ElevenLabs.
2. Clara llama `buscar_productos_shopify` antes de mencionar un producto. El servidor devuelve únicamente productos activos, disponibles y publicados en Online Store.
3. Al cerrar la consulta, Clara llama `guardar_rutina_clara`. El servidor vuelve a resolver cada `product_handle` contra Shopify y elimina cualquier producto inexistente, no publicado o no disponible.
4. ElevenLabs envía `post_call_transcription` firmado. La aplicación verifica la firma con el SDK oficial y guarda su transcripción y resumen, sin volver a analizarlos con otro modelo.
5. La pantalla consulta el resultado mediante un token de navegador separado cuyo hash queda en la base de datos.

## Configuración pendiente y segura

- Crear un secreto aleatorio para `CLARA_AGENT_TOOL_SECRET` en Vercel Preview.
- Crear el mismo valor como secreto de workspace de ElevenLabs y reemplazar el marcador de los dos templates por su ID. Nunca guardar el valor en Git.
- Crear/seleccionar una rama experimental de ElevenLabs, crear ambas herramientas y adjuntarlas sólo a esa rama.
- Añadir al prompt de la rama las reglas de uso descritas por cada herramienta.
- Crear el webhook de workspace `post_call_transcription` hacia `https://testers.betaskintech.com/api/webhooks/elevenlabs` y guardar el secreto generado como `ELEVENLABS_WEBHOOK_SECRET` en Vercel Preview.
- Aplicar el esquema Prisma sin `--accept-data-loss` después de confirmar que la base Neon local corresponde a QA.
- Ejecutar primero herramientas con respuestas simuladas y luego una conversación real en testers.

No usar los templates directamente mientras contengan marcadores `<...>`.

## Storefront Catalog MCP

Shopify ofrece un Storefront Catalog MCP oficial con búsqueda natural. Se probó
el endpoint de esta tienda el 2026-09-14, pero la protección por contraseña del
storefront lo redirige a `/password` y devuelve HTML en lugar de MCP. Mientras
esa protección siga activa, Clara usa el adaptador Admin API limitado al
catálogo propio. Cuando la tienda sea pública, volver a probar `/api/ucp/mcp` y
preferir `search_catalog` si supera los casos en español.
