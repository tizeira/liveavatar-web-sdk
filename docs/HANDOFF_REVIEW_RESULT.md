# Handoff — Revisión de Arquitectura Clara Voice Agent (PR #14 develop → master)

Fecha: 2026-07-01
Alcance: síntesis de 6 investigaciones de solo-lectura (ruta a producción, telemetría, bug "Clara habla sola", Shopify a escala, resiliencia de sesión, salud del repo/CI).

---

## 1. Resumen ejecutivo

El PR #14 no es un cambio quirúrgico: son **53 commits**, 64 archivos, +6184/-1782 líneas acumulados en ~7 semanas (migración a plugin ElevenLabs, beta access gate, saludo Shopify, downgrade Prisma 7→6, fixes de audio). Es fast-forward puro (`develop` es superset exacto de `master`), sin conflictos, pero con blast radius grande. El bloqueador real **no es técnico ni de arquitectura: es que el QA manual nunca se ejecutó**. `docs/QA_CHECKLIST.md` existe, está bien diseñado, pero el 100% de sus checkboxes están vacíos, y `feature_list.json` confirma **6 de 14 features en `passes: false`**, incluyendo el propio motivo del PR (`audio-gap-fix`) y el tracking de sesiones en DB (`prisma-db-tracking`). A esto se suman dos gaps de infraestructura que agravan el riesgo: el CI actual **no corre en PRs hacia `develop`** (solo hacia `master`), y no hay branch protection en ningún lado — o sea que hoy nada impide mergear código roto. El bug "Clara habla sola" sigue sin causa raíz confirmada (solo hipótesis), pero es device-específico y no bloquea el merge en sí. La recomendación transversal de los 6 agentes es la misma: no se necesita construir nada nuevo para promover _este_ PR — se necesita **ejecutar lo que ya existe** (el checklist) y cerrar dos gaps de proceso baratos (CI en develop, quitar el `|| echo` que silencia fallos de Prisma). Todo lo demás (telemetría, Shopify HMAC completo, reconexión automática, e2e) es mejora continua post-merge, no pre-requisito.

---

## 2. ¿Qué bloquea el merge de PR #14?

| #   | Bloqueador                                                                                                                                                                                             | Severidad                                                                                                                                         | Pregunta de origen                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------- | ----------------- |
| 1   | QA_CHECKLIST.md nunca ejecutado (0% de checkboxes marcados)                                                                                                                                            | **Bloqueante**                                                                                                                                    | Ruta a producción                                                                                             |
| 2   | `audio-gap-fix` (el propio foco del PR) con `passes:false`, "pendiente verificar en preview"                                                                                                           | **Bloqueante**                                                                                                                                    | Ruta a producción                                                                                             |
| 3   | `prisma-db-tracking` con `passes:false` — no confirmado que una sesión real escribe en Postgres                                                                                                        | **Bloqueante**                                                                                                                                    | Ruta a producción / Telemetría                                                                                |
| 4   | `postinstall` de Prisma con `                                                                                                                                                                          |                                                                                                                                                   | echo`silencia fallos de`generate` en build de Vercel — puede dejar cliente desactualizado sin romper el build | **Bloqueante** | Ruta a producción |
| 5   | `beta-access-gate` con `passes:false` — falta QA end-to-end (lockout 429, persistencia 7 días)                                                                                                         | **Bloqueante**                                                                                                                                    | Ruta a producción                                                                                             |
| 6   | `shopify-purchase-greeting` con `passes:false` — falta validar redirect Liquid real desde la tienda                                                                                                    | **Bloqueante**                                                                                                                                    | Ruta a producción / Shopify a escala                                                                          |
| 7   | CI (`pr_code_check.yml`, `pr_code_test.yml`) solo corre en PRs hacia `master`, no hacia `develop` — el 90% del flujo real no tiene ningún check automático                                             | **Bloqueante** (gap de proceso, no de este PR puntual, pero debe cerrarse antes o junto con el merge)                                             | Salud del repo / CI                                                                                           |
| 8   | Sin branch protection en `master` ni `develop` (404 en ambas) — nada impide push directo o merge sin checks                                                                                            | **Importante**                                                                                                                                    | Salud del repo / CI                                                                                           |
| 9   | Bug "Clara habla sola" sin causa raíz confirmada, `status:"blocked"`, no reproducible en dev                                                                                                           | **Importante** (no bloquea el merge porque es preexistente y device-específico, pero debe tener plan de instrumentación antes de escalar tráfico) | Bug habla sola                                                                                                |
| 10  | Sin manejo de `SESSION_STOPPED` por `stop_reason` (usuario ve el avatar congelarse sin explicación, sin reintento)                                                                                     | **Importante**                                                                                                                                    | Resiliencia de sesión                                                                                         |
| 11  | HMAC de Shopify firma solo `customer_id`, no el resto del payload (`last_order_product`, `orders_count`, etc.) — riesgo bajo-medio, solo integridad conversacional propia, no exfiltración de terceros | **Puede esperar**                                                                                                                                 | Shopify a escala                                                                                              |
| 12  | Sin redacción de PII antes de persistir `Conversation.userMessage`/`agentResponse` en Postgres (texto plano)                                                                                           | **Puede esperar** (recomendado resolver pronto por compliance, pero no es lo que frena el fast-forward de #14)                                    | Telemetría                                                                                                    |
| 13  | Deuda de ramas (6 locales + 6 remotas huérfanas, PR #12 abierto hace 5+ meses)                                                                                                                         | **Puede esperar**                                                                                                                                 | Salud del repo                                                                                                |
| 14  | Sin tests e2e (Playwright) para audio, saludo Shopify, HMAC                                                                                                                                            | **Puede esperar**                                                                                                                                 | Salud del repo                                                                                                |

---

## 3. Plan de acción priorizado

1. **Ejecutar `docs/QA_CHECKLIST.md` completo en preview** — S/M (1-2 horas). Es el prerequisito real: sin esto no hay forma de saber si el PR funciona. Cubre exactamente los ítems 1, 2, 3, 5, 6 de la tabla. Se apoya en el instant rollback de Vercel como red de seguridad (ya existe, gratis, no requiere construir nada).

2. **Quitar el `|| echo` del `postinstall` de Prisma** (`apps/demo/package.json`) y reemplazarlo por un check que falle el build si `prisma generate` falla — S (minutos). Debe hacerse antes del punto 1 o en paralelo, porque si no, el QA de "DB tracking" puede dar falso positivo (build pasa aunque el cliente esté desactualizado).

3. **Extender CI (`pr_code_check.yml`, `pr_code_test.yml`) a `branches: [master, develop]`** + agregar step de `pnpm build` — S (30-60 min). Debe ir antes de mergear #14 porque de lo contrario el propio merge no tiene ninguna verificación automática detrás, y es la ventana perfecta para instaurarlo (evita que el próximo PR grande repita el mismo problema).

4. **Configurar branch protection en `master` y `develop`** (exigir los checks del punto 3 + 1 approval) — S (15-30 min). Depende del punto 3 (los checks deben existir antes de exigirlos). Cierra la brecha entre lo que dice CLAUDE.md ("nunca push directo") y lo que el repo permite hoy.

5. **Mergear PR #14** una vez que 1-4 estén resueltos y las 6 features de `feature_list.json` pasen a `passes:true`. (Recordatorio: mergear = decisión del usuario, Claude Code no ejecuta el merge).

6. **Documentar el rollback de Vercel en `CLAUDE.md`/`TROUBLESHOOTING.md`** — S (30 min). Post-merge inmediato, para que la red de seguridad usada en el punto 1 esté documentada para la próxima vez.

7. **Branch UI por `stop_reason` en `SESSION_STOPPED` + botón de reintento manual** (sin reconexión automática todavía) — S/M (0.5-1 día). Post-merge; cierra el gap de UX más grave de resiliencia sin riesgo de reintroducir el bug de conversaciones duplicadas.

8. **Instrumentar diff de transcripciones (usuario vs avatar) para el bug "habla sola"** — S (bajo costo, solo comparación de strings ya logueados). Post-merge; primer paso barato antes de instrumentar `getStats()`/WebRTC (más caro y con cobertura de browser limitada).

9. **Firmar el payload completo del HMAC de Shopify** (no solo `customer_id`) — S/M (medio día + testing). Post-merge; resuelve el ítem 11, de bajo riesgo pero fácil de arreglar mientras se toca esa zona.

10. **Redacción de PII antes de persistir `Conversation` + Sentry para errores técnicos** — M/L (3-5 días). Post-merge, inversión de mediano plazo en observabilidad.

11. **Limpieza de ramas huérfanas + cierre de PR #12** — S (15-20 min). Puede hacerse en cualquier momento, sin dependencias.

12. **Tests e2e (Playwright) para audio/saludo/HMAC** — L (3-5 días). Última prioridad; inversión de fondo para sostener el ritmo de futuras promociones, no bloquea nada de lo anterior.

---

## 4. Detalle por pregunta (resumen)

**Ruta a producción estable** — Diagnóstico: PR #14 es una promoción acumulada de 53 commits con checklist de QA sin ejecutar y sin red de seguridad automatizada más allá del rollback manual de Vercel. Recomendación: ejecutar el QA_CHECKLIST existente en preview (no partir el PR en pedazos — los commits están entrelazados con dependencias secuenciales entre sí, partirlos ahora es más riesgoso que promoverlos juntos).

**Observabilidad y telemetría** — Diagnóstico: ya existe un buen modelo de datos en Postgres (`Session`, `Conversation`, `SessionAnalytics`, `DailyMetrics`) y un sanitizador de logs de aplicación, pero nada redacta PII antes de escribir `Conversation` en DB, y las señales técnicas (error rate, latencia) solo existen como healthcheck manual en `/diagnostics`. Recomendación: Sentry para errores/crashes técnicos (aprovecha integración nativa Next.js/Vercel) + extender Postgres para lo que ya tiene schema, con redacción de PII en la capa de escritura, no de lectura.

**Bug "Clara habla sola"** — Diagnóstico: el fix "A" propuesto (forzar `echoCancellation:true`) ya está aplicado en el código, pero no hay confirmación de que el browser realmente lo aplique — el audio del avatar sale por un `<video>` HTML fuera del grafo WebRTC de LiveKit, lo que puede romper la referencia de eco del AEC. No hay instrumentación cuantitativa, solo hipótesis documentadas. Recomendación: primero automatizar el diff de transcripciones (usuario vs avatar) como señal barata y booleana; si no alcanza, instrumentar `getStats()`/`echoReturnLoss` de WebRTC (más caro, cobertura solo Chrome).

**Shopify a escala** — Diagnóstico: el HMAC actual firma solo `customer_id`, dejando `last_order_product`/`orders_count`/etc. sin firmar — pero el impacto real es bajo (solo integridad conversacional propia, no exfiltración de datos de terceros, porque el HMAC sigue atando el token a un customer_id específico). La migración completa a Admin API con Protected Customer Data tiene timeline incierto (días a semanas, requiere aprobación de Shopify) y depende de subir de plan. Recomendación: firmar el payload completo (fix barato, sin depender de Shopify) ahora; migrar a Admin API solo cuando suba el plan o crezca el alcance del feature.

**Resiliencia de sesión** — Diagnóstico: no existe reconexión automática ni manejo de `SESSION_STOPPED` por motivo — hoy el usuario ve el avatar congelarse en silencio. El único código con lógica de reconexión es huérfano (pipeline WebSocket viejo, ya reemplazado). Recomendación: implementar primero el branch UI por `stop_reason` + botón de reintento manual (barato, sin riesgo); posponer la reconexión automática hasta tener telemetría real de por qué se cortan las sesiones, para no reintroducir el bug de conversaciones duplicadas ya resuelto en PR #17.

**Salud del repo y CI** — Diagnóstico: CI existe pero solo corre hacia `master`, no hacia `develop` (donde entra el 90% del trabajo); no hay branch protection en ningún lado; hay deuda de 6+ ramas huérfanas y un PR (#12) abierto hace 5+ meses; la suite de tests (55 tests) es 100% unitaria y no cubre audio, Shopify endpoint, ni el componente principal. Recomendación: extender CI a `develop` + branch protection (fix de config, bajo riesgo, alto impacto) primero; tests e2e con Playwright como inversión de fase 2.

---

## 5. Riesgos que NO bloquean el merge pero hay que trackear después

- **PII en texto plano en `Conversation.userMessage`/`agentResponse`** — sin redacción, dato de skincare/salud persiste crudo en Postgres. Riesgo de compliance a mediano plazo, no bloqueante hoy.
- **HMAC de Shopify sin firmar el payload completo** — riesgo bajo-medio, acotado a integridad conversacional propia; no permite acceso a datos de terceros.
- **Falta de reconexión automática de sesión** — hoy genera mala UX (avatar se congela sin explicación) pero no es un blocker funcional del PR #14.
- **Bug "Clara habla sola"** — sigue sin causa raíz confirmada; device-específico, no reproducible en dev. Necesita instrumentación (diff de transcripciones primero) antes de poder cerrarlo con confianza.
- **Límites de concurrencia de HeyGen/ElevenLabs no verificados contra el plan real de la cuenta** — riesgo de escala si el tráfico crece; ElevenLabs Starter tiene solo 6 llamadas concurrentes, por ejemplo. Hay que confirmar cifras reales en el dashboard de cada proveedor antes de campañas de tráfico.
- **Deuda de ramas huérfanas (6 locales + 6 remotas) y PR #12 stale** — ruido operativo, sin riesgo funcional, limpiar cuando haya tiempo.
- **Ausencia de tests e2e (Playwright)** — el QA sigue dependiendo 100% de ejecución manual; no escala a mediano plazo, pero no es lo que frena esta promoción puntual.
- **Dos mecanismos de keep-alive potencialmente redundantes** (`session.keepAlive()` del SDK vs endpoint `/api/keep-session-alive`) — vale la pena verificar cuál se usa realmente en una sesión de código, no en esta revisión de solo lectura.
