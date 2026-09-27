# Clara — fiabilidad, etapa local 1

## Alcance y estado

Trabajo aislado en `codex/clara-reliability-2026-09-26`, base `35d3cb9ee8377667da51515f86844ec58c61822e`. No se modificó el checkout principal. No hay commit, push, despliegue, migración, cambio de agente, theme, dominio ni llamadas pagadas en esta etapa.

Esta entrega prepara tres intervenciones. No demuestra que producción esté corregida ni que haya mejorado la latencia real.

## I01 — identidad de release

- `apps/demo/scripts/release-manifest.mjs` valida SHA, entorno, deployment/dominio, huella de base, rama/versión/herramientas del agente, snapshot del catálogo, observación reciente y rollback.
- `preflight-production.mjs` exige el manifiesto antes de consultar Vercel. Conserva los gates anteriores.
- Campos desconocidos, diferencias esperado/observado, observación vieja y rollback incompatible bloquean.
- Formato e instrucciones: `clara-release-manifest.md`.

Limitación: el validador es offline; no prueba por sí solo que la evidencia corresponda al remoto ni que la base o las herramientas estén disponibles. `observed` debe salir de lecturas verificadas, nunca de copiar `expected`. No se generó un manifiesto productivo aprobado.

## I02 — resultado recuperable y persistencia

- `ClaraVoiceAgent.tsx` muestra la rutina confirmada sin esperar el resumen. La liberación del acceso se informa por separado y no equivale a confirmar el cierre del proveedor.
- `poll-result.ts`: lecturas GET cancelables, máximo 30 intentos/30 segundos y 5 segundos por petición. No crea llamadas ni guarda rutinas. Contempla rutina primero, resumen primero, error de red, acceso rechazado y respuestas tardías tras cancelar.
- El resumen puede mostrarse mientras siguen las lecturas de rutina. Un resumen sin rutina al vencer el presupuesto permite actualizar la consulta; no afirma que nunca se guardará una rutina.
- Se conserva en memoria del componente el acceso a la última consulta hasta una nueva llamada exitosa o desmontaje. No se guarda token en storage; recargar la página no recupera esta capacidad. «Mi rutina guardada» conserva su mecanismo existente.
- `repository.ts`: repetición exacta del resultado persistido no escribe ni duplica métricas; toda escritura usa comparación atómica con la revisión leída. `save-routine` devuelve conflicto 409 con `saved:false` y `retryable:false` si otro cambio ganó la carrera.
- `expected_revision` es opcional por compatibilidad. El GET protegido devuelve `routineRevision`; el guardado devuelve `routine_revision`. Una integración futura puede reenviar esa revisión en `expected_revision`.

Límites: sin `expected_revision`, una petición antigua que llegue DESPUÉS de otra completada no puede distinguirse de una nueva intención legítima. No se exige todavía el campo ni se cambió la herramienta remota. Antes de activarlo hay que definir su lectura autenticada en el agente; nunca inventar una revisión ni reintentar ciegamente un 409. La revisión es de la fila de consulta, por lo que otras actualizaciones también pueden invalidarla. Las pruebas de concurrencia de esta etapa usan mocks; falta confirmación en una base aislada real.

No se infiere guardado desde el resumen ni desde texto hablado. No se cambiaron validación de productos, identidad del comprador, retención, webhook ni lógica de catálogo.

## I03 — medir antes de optimizar

- El inicio devuelve un UUID aleatorio `diagnostic_trace_id`, no un identificador de comprador o proveedor.
- `start-custom-session/route.ts`: tiempos de inicio total, tramo de proveedor y asociación de sesión en base. El tramo de asociación no incluye todas las consultas previas; no atribuir todo el resto al modelo.
- `flow-diagnostics.ts` y `context.tsx`: observador pasivo del conector LITE real; hitos de solicitud/token, eventos SDK y turnos, reproducción y primer frame cuando el navegador lo soporta.
- Registros nuevos sólo fuera de Production, reutilizando la política de diagnóstico existente en cliente. Sin transcript, payload de herramientas, tokens ni errores crudos. Máximo 48 eventos ordinarios y un terminal; máximo 20 repeticiones por clave. Es una muestra acotada, no todos los turnos.
- Los eventos fin de habla/inicio de avatar son aproximaciones del transporte, NO medición exacta de fin de habla acústica/audio audible ni desglose interno STT/LLM/TTS. Se conservan los tiempos propios del SDK separados de los del navegador.
- Errores del observador no cambian la llamada; cleanup cancela callbacks multimedia y descarta eventos tardíos.

Pendiente: llamada controlada en Preview, correlación de herramientas/post-call extremo a extremo, línea base p50/p90, artefactos audiovisuales reales, coste por tarea. No se afirmó ninguna ganancia de velocidad.

## Validación reproducible

Sin archivos de entorno productivos ni red de proveedores:

```sh
node --test apps/demo/scripts/release-manifest.test.mjs
pnpm --filter demo exec vitest run src/__tests__/consultations src/__tests__/liveavatar src/__tests__/api/clara-agent-tools.test.ts src/__tests__/api/start-custom-session-recovery.test.ts src/__tests__/api/consultation-result-revision.test.ts
pnpm --filter demo typecheck
```

Además: lint de archivos modificados y `git diff --check`. La integración Neon opt-in queda omitida de manera explícita, no aprobada. Se construyó el SDK local y generó Prisma Client sin conectar una base.

Resultado final local (27 de septiembre): 103 pruebas Vitest aprobadas, 1 integración Neon omitida; 10 pruebas Node del manifiesto aprobadas; typecheck, lint de TypeScript modificado y diff-check aprobados. Revisión independiente sin bloqueantes restantes dentro de este alcance, tras corregir el caso resumen-primero y exigir comparación atómica a todos los escritores. Aviso no bloqueante: datos de Browserslist antiguos; no se actualizaron dependencias. No se ejecutó una llamada real, validación visual en navegador, build Next productivo ni preflight remoto completo.

## Siguiente ventana (no ejecutada)

**Responsable: asistente.** Preparar commit revisado y Preview aislado, con identidad de entorno y rollback verificados. No mover producción. Confirmar compatibilidad de contratos antes de cambiar herramientas remotas. Esta ventana requiere alcance explícito de commit/push/deploy; no está implícita en esta entrega local.

**Después, responsable: usuario.** En el Preview que se entregue: guardar una rutina, finalizar, comprobar resumen y productos; volver a la última consulta; revisar rutina sin llamada; cambiar pestaña durante la llamada; finalizar y comprobar liberación. No hace falta repetir estas pruebas sobre el sitio actual, que todavía no contiene este cambio.

Rollback de la futura prueba: volver al deployment Preview previo. No hay migración que revertir. Si un 409 rompe el comportamiento del agente, detener la prueba y ajustar el manejo del conflicto; no forzar escrituras ni anunciar guardados no confirmados.
