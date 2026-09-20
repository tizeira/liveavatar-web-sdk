# Candidato local de recuperación — 20/09/2026

Base: QA validado `fb1f663`. Rama aislada `codex/clara-recovery-candidate-2026-09-20`, checkout `C:/Users/Ubicacion Gamer/AppData/Local/Temp/clara-recovery-candidate-20260920`. No desplegar desde el checkout principal sucio. No se modifican Shopify, secretos, proveedores, bases ni aliases.

## Delta explícito

- `apps/demo/app/api/start-custom-session/route.ts`: deadline de proveedor 20s para fetch y cuerpo, 504 sanitizado, cancelación de reserva, sin reintento de creación.
- `apps/demo/app/api/consultations/[id]/release/route.ts`: fallo de lectura/escritura no se declara éxito.
- `apps/demo/src/lib/clara-buyer-access.ts`: liberación idempotente para la misma consulta/comprador ya terminal; nunca elimina rutina guardada.
- `apps/demo/src/consultations/release.ts` y `src/components/ClaraVoiceAgent.tsx`: cierre con hasta tres intentos, 5s por request, pausas de 1s, mensaje si no se confirma. No reintenta 4xx salvo429, no inicia proveedor.
- `apps/demo/app/api/diagnostics/route.ts`: denegación en Production antes de auth/base/proveedor.
- Tests de `start-custom-session-recovery`, `release-failure`, `diagnostics-production`, `release-client`, `clara-buyer-access` y `packages/js-sdk/src/LiveAvatarSession/ElevenLabsAgentSession.test.ts`.
- `apps/demo/scripts/preflight-production.mjs`, entrada package.json y `docs/release/clara-production-runbook.md`: control previo versionado; no ejecuta migraciones ni despliegues.

## Límites de la evidencia

Simulaciones con timers y proveedor/base mockeados; no son llamadas reales ni prueban persistencia Neon real. El SDK conserva runtime previo: tests nuevos comprueban desconexión y reconexión agotada, limpieza y evento terminal único. No se altera transporte ni conector.

Abortar una petición no demuestra que el proveedor no haya creado recursos; por eso no se reintenta automáticamente una creación. Si la base permanece indisponible, no se garantiza liberación inmediata: falla explícitamente y continúa aplicando el límite de seguridad existente. Si la pestaña se cierra, el navegador puede interrumpir los reintentos; keepalive no garantiza recuperación offline.

## Próximo recorrido QA (aún no ejecutado)

Una vez autorizada la actualización QA del candidato exacto: probar una interrupción local de conexión en una sola pestaña, comprobar salida de conversación, aviso de cierre no confirmado si aplica y, al recuperar red, acceso posterior y rutina preservada. No simularlo quitando claves, pausando suscripción, alterando agentes o deshabilitando la base compartida. No repetir fecha/cuarto inicio aprobados salvo regresión del nuevo candidato.

Producción sigue bloqueada por configuración y aislamiento/esquema/backup de datos pendientes. Este candidato de recuperación no equivale a una promoción productiva ni a la allowlist final: excluir la referencia temporal QA y cerrar las puertas del manifiesto antes de promover.
