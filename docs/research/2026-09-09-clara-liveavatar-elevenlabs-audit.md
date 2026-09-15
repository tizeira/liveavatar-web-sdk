# Auditoría técnica de Clara: LiveAvatar, ElevenLabs y latencia

**Fecha:** 9 de septiembre de 2026
**Entorno observado:** `testers.betaskintech.com` y rama `release/2026-08-produccion`
**Alcance:** arquitectura, estabilidad, latencia, artefactos de audio, observabilidad, configuración efectiva de ElevenLabs y proceso de cambios. No se modificó producción ni la configuración remota del agente.

> **Corrección verificada el 11 de septiembre de 2026:** la configuración inline `elevenlabs_agent_config`, que usa Clara, admite `dynamic_variables`. Un `voice_agent` almacenado rechaza los overrides por sesión de `language` y `dynamic_variables`. Además, LiveAvatar documenta un conector directo para OpenAI Realtime; GPT-Live es una arquitectura distinta y no debe usarse como sinónimo de Realtime. Ver `docs/context/CLARA_CURRENT_CONTEXT.md`.

## Resumen ejecutivo

Clara está construida sobre una arquitectura razonable para baja latencia: la aplicación inicia una sesión **LiveAvatar LITE** con **ElevenLabs Agent Connector**, y el audio viaja por **LiveKit/WebRTC**. ElevenLabs usa actualmente `eleven_flash_v2_5`, ASR `scribe_realtime` en calidad alta y una voz con estabilidad `0.65` y velocidad `1.05`. No hay evidencia para migrar de tecnología; sí hay varios problemas operativos y de instrumentación que impiden atribuir con precisión la variabilidad.

Los hallazgos más importantes son:

1. **La principal causa histórica de fallos no es la latencia.** Entre las últimas 100 conversaciones disponibles, 33 figuran como fallidas y 32 indican literalmente un problema de pago. Eso debe resolverse y monitorearse antes de evaluar calidad.
2. **La muestra de la configuración actual es insuficiente.** La versión remota vigente aparece en solo 2 de esas 100 conversaciones; ambas terminaron correctamente, pero dos sesiones no permiten estimar confiabilidad ni percentiles.
3. **No se mide la latencia por componente.** Hoy se observa parcialmente el intervalo entre fin de voz del usuario e inicio de voz del avatar, pero no se separan endpointing/STT, LLM, TTS, render del avatar, red y arranque de sesión.
4. **El arranque tiene esperas evitables.** La ruta espera una escritura de sesión en base de datos antes de responder, aunque el comentario la describe como no bloqueante. Una base lenta agrega variación al tiempo de inicio sin mejorar la conversación.
5. **La inicialización conversacional depende de 150 ms arbitrarios.** Se envía contexto y luego `[START]` con un temporizador, sin confirmación ni reintento. Bajo carga o red lenta el agente puede arrancar antes de recibir el contexto.
6. **El keepalive puede informar éxito falso.** El SDK llama al cliente sin `await`; una promesa rechazada queda fuera del `try/catch`. Además, la UI lo envía exactamente cada cinco minutos, el límite documentado por LiveAvatar, sin margen para jitter.
7. **Hay dos candidatos reales de costo en ElevenLabs:** un prompt de 9.120 caracteres y una base de conocimiento/RAG activa. ElevenLabs documenta que RAG agrega alrededor de 250 ms; deben evaluarse con experimentos controlados, no cambiarse simultáneamente.
8. **Los “artifacts” deben clasificarse.** En el código no existe una función de producto llamada artifact. Si se refiere a defectos de audio, hay que medir pérdida/jitter, duplicación de reproducción y formato de audio. Si se refiere a archivos generados durante desarrollo, el repositorio contiene múltiples documentos no rastreados que son independientes del runtime de Clara.

## 1. Arquitectura efectiva

```text
Navegador
  ├─ Next.js / ClaraVoiceAgent
  ├─ micrófono: echo cancellation + noise suppression + auto gain
  └─ LiveKit/WebRTC
          │
          ▼
LiveAvatar LITE + ElevenLabs Connector
  ├─ avatar/render y streaming: LiveAvatar
  └─ conversación: ElevenLabs
       ├─ ASR: scribe_realtime / high
       ├─ LLM: qwen36-35b-a3b
       ├─ KB/RAG: 1 fuente configurada
       └─ TTS: eleven_flash_v2_5
```

La ruta de inicio envía `mode: "LITE"` y `elevenlabs_agent_config`; después el frontend crea `ElevenLabsAgentSession` con `voiceChat: true`. Este es el patrón soportado por el conector oficial: LiveAvatar administra la sesión visual/LiveKit y ElevenLabs la conversación. La documentación actual también permite `voice_id` y `dynamic_variables` en la configuración inline, una capacidad que algunas notas antiguas del proyecto consideraban no disponible. [LiveAvatar: ElevenLabs Agent Connector](https://docs.liveavatar.com/docs/lite-mode/connectors/elevenlabs-agent)

No conviene actualizar `livekit-client` de forma aislada aunque npm publique una versión más nueva. El SDK público de LiveAvatar continúa en `0.0.18` y este fork fija LiveKit `2.15.7`; la compatibilidad debe verificarse como una unidad. [SDK de LiveAvatar en npm](https://www.npmjs.com/package/@heygen/liveavatar-web-sdk), [LiveKit Client en npm](https://www.npmjs.com/package/livekit-client)

### Tecnologías y estado observado

| Capa             | Implementación del repositorio                | Evaluación                                                                                                  |
| ---------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Web              | Next.js `16.0.10`, React `19.2.3`             | Funcional; hay versiones más nuevas, pero no explican por sí solas la variabilidad de voz.                  |
| Identidad        | NextAuth `5.0.0-beta.30`                      | Riesgo de dependencia beta, separado del camino de audio una vez autenticado.                               |
| Datos            | Prisma `6.19.3`, Postgres/Neon                | La escritura síncrona en el inicio sí puede aumentar el startup.                                            |
| Sesión/avatar    | Fork de `@heygen/liveavatar-web-sdk` `0.0.18` | Es la misma versión publicada actualmente; el fork está muy divergido del upstream y exige pruebas propias. |
| Transporte       | LiveKit `2.15.7`                              | Correcto para el SDK fijado; faltan métricas de reconexión, calidad y WebRTC.                               |
| Agente           | ElevenLabs Agents + Connector                 | Ruta adecuada; faltan experimentos y observabilidad por versión.                                            |
| Cache/rate limit | Vercel KV `3.0.0`                             | Puede afectar el inicio, no la latencia de turnos posteriores.                                              |

## 2. Evidencia remota de ElevenLabs

La API oficial se consultó en modo de solo lectura. No se recuperaron ni expusieron claves, prompts, transcripciones, nombres de clientes o identificadores completos.

### Configuración actual

| Parámetro           | Valor observado                     | Lectura técnica                                                                                  |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| Idioma              | `es`                                | Alineado con Clara.                                                                              |
| LLM                 | `qwen36-35b-a3b`                    | Debe compararse contra alternativas en una rama/versionado de ElevenLabs.                        |
| Temperatura         | `1.0`                               | Puede aumentar variación en respuestas; no es latencia pura.                                     |
| Longitud de prompt  | 9.120 caracteres                    | Candidato a mayor TTFT y variabilidad; medir antes de reducir.                                   |
| TTS                 | `eleven_flash_v2_5`                 | Elección de baja latencia. ElevenLabs publica ~75 ms de inferencia, no latencia end-to-end.      |
| Estabilidad de voz  | `0.65`                              | Dentro del rango recomendado para consistencia conversacional.                                   |
| Similitud           | `0.8`                               | Configuración razonable; vigilar artefactos específicos de la voz.                               |
| Velocidad           | `1.05`                              | Dentro del rango conversacional recomendado `0.9–1.1`.                                           |
| Turn eagerness      | `normal`                            | Buen baseline; probar `patient` solo si corta al usuario y `eager` solo si el silencio domina.   |
| Turn timeout        | 15 s                                | No explica el tiempo de primera respuesta; afecta inactividad durante la conversación.           |
| Duración máxima     | 600 s                               | Diez minutos.                                                                                    |
| ASR                 | `scribe_realtime`, high, PCM 16 kHz | Correcto; el conector exige PCM 24 kHz para la salida del agente, gestionada por su integración. |
| Knowledge base      | 1                                   | RAG puede añadir ~250 ms según ElevenLabs.                                                       |
| Herramientas        | 0                                   | Las llamadas a herramientas no explican la latencia actual.                                      |
| Variables dinámicas | 0 observadas                        | Oportunidad para sustituir la carrera `contextual_update` + temporizador.                        |

ElevenLabs diferencia TTFA, inferencia del modelo, red, buffering y pipeline de aplicación; los ~75 ms de Flash no son una promesa end-to-end. [Conceptos de latencia](https://elevenlabs.io/docs/eleven-api/concepts/latency), [Optimización de latencia](https://elevenlabs.io/docs/api-reference/reducing-latency), [Elección de modelo](https://elevenlabs.io/docs/eleven-api/choosing-the-right-model)

### Historial agregado

Muestra: las 100 conversaciones más recientes retornadas por la API; el endpoint indicó que existen más.

| Indicador                   |                 Resultado |
| --------------------------- | ------------------------: |
| Finalizadas (`done`)        |                        67 |
| Fallidas                    |                        33 |
| Fallas por problema de pago |                        32 |
| Desconexión cliente 1000    | 35 (1 marcada como fallo) |
| Desconexión cliente 1006    |      21 (marcadas `done`) |
| Desconexión cliente 1005    |      12 (marcadas `done`) |
| Duración p50                |                      24 s |
| Duración p90                |                      85 s |
| Duración máxima             |                     320 s |

La duración de una llamada no es la latencia de respuesta; se incluye solo para caracterizar la muestra. Los códigos 1005/1006 son estados reservados usados para indicar ausencia de código de cierre o cierre anormal, por lo que deben registrarse junto con eventos de reconexión y calidad de red. [RFC 6455, sección 7.4.1](https://www.rfc-editor.org/rfc/rfc6455#section-7.4.1)

En las 20 conversaciones más recientes disponibles (4 de junio a 1 de septiembre de 2026 UTC), 16 terminaron y 4 fallaron por pago. La versión actual del agente solo aparece en 2 conversaciones, ambas `done`. Es una señal positiva, no una validación estadística.

## 3. Causas de variabilidad por tramo

### 3.1 Arranque de sesión

La ruta `/api/start-custom-session` hace, en secuencia, control de tasa, autenticación, token de LiveAvatar y persistencia en base de datos. La llamada a `createSession(...)` se espera antes de devolver el token. Esto mezcla una dependencia administrativa con el camino crítico del usuario. La corrección recomendada es registrar de forma asíncrona con una cola fiable, o poner un timeout corto y permitir que el inicio continúe; antes debe decidirse qué garantía de auditoría necesita el negocio.

El diagnóstico actual tampoco replica producción: comprueba HeyGen con `mode: "CUSTOM"`, mientras Clara usa `LITE` + conector. Puede dar verde aunque falle el camino real.

### 3.2 Inicialización del agente

Tras `STREAM_READY`, Clara silencia el micrófono, envía contexto por `contextual_update` y 150 ms después manda `[START]`. El código marca el contexto como enviado antes de confirmar éxito y la utilidad que lo manda captura internamente el error. Esto produce una carrera: en una red lenta, `[START]` puede llegar primero; en una falla, no hay reintento.

La alternativa compatible con la ruta inline actual es pasar datos no sensibles mediante `dynamic_variables` al crear la sesión. Cambiar a un `voice_agent` almacenado es otra alternativa de gobernanza, pero no admite overrides por sesión de variables dinámicas. Si el contexto debe seguir por data channel, esperar una señal/eco verificable antes del trigger y hacer el envío idempotente. [Personalización en ElevenLabs](https://elevenlabs.io/docs/eleven-agents/customization/personalization), [Conector LiveAvatar](https://docs.liveavatar.com/docs/lite-mode/connectors/elevenlabs-agent)

### 3.3 Latencia de cada turno

No existe una medición completa. El frontend infiere `thinking` entre `user_speak_ended` y `avatar_speak_started`, agrupando varios sistemas distintos. Deben registrarse timestamps monotónicos para:

| Marca | Evento                                      |
| ----- | ------------------------------------------- |
| `t0`  | solicitud de sesión iniciada                |
| `t1`  | token de sesión recibido                    |
| `t2`  | LiveKit conectado                           |
| `t3`  | stream/avatar listo                         |
| `t4`  | usuario comienza a hablar                   |
| `t5`  | usuario termina de hablar                   |
| `t6`  | transcripción final disponible              |
| `t7`  | primer texto/respuesta tentativa del agente |
| `t8`  | avatar comienza a hablar                    |
| `t9`  | avatar termina de hablar                    |

Con esto se separan:

- `t1-t0`: API, rate limit, HeyGen/LiveAvatar y base de datos.
- `t3-t1`: conexión LiveKit y preparación del avatar.
- `t6-t5`: endpointing + ASR.
- `t7-t6`: tiempo del LLM a primera respuesta.
- `t8-t7`: síntesis, red, buffering y render del avatar.
- `t8-t5`: latencia percibida total del turno.

ElevenLabs ofrece p50/p90/p99 de turn-taking y agent response en Analytics; esos datos deben compararse con las mediciones del navegador para localizar el tramo que agrega tiempo. [ElevenLabs Analytics](https://elevenlabs.io/docs/eleven-agents/dashboard)

### 3.4 Keepalive y recuperación

El SDK ejecuta `this.sessionClient.keepAlive()` sin `await`. Por ello el `try/catch` solo cubre errores síncronos y la UI puede registrar “enviado” cuando la petición falló. Además, el intervalo de cinco minutos no deja margen frente al límite de inactividad. El runbook propone 120 s, `await`, medición de éxito/falla, exclusión mutua y backoff.

LiveKit expone eventos `Reconnecting`, `Reconnected`, cambios de reproducción y estadísticas RTC. Deben instrumentarse para distinguir red de modelo. [LiveKit RoomEvent](https://docs.livekit.io/reference/client-sdk-js/enums/RoomEvent.html), [LiveKit Track/RTC stats](https://docs.livekit.io/reference/client-sdk-js/classes/Track.html)

### 3.5 Artefactos de audio

Antes de corregir hay que registrar qué significa “artifact”:

- **audio robotizado, chasquidos o cortes:** revisar packet loss, jitter, RTT, formato y dispositivo;
- **doble voz o eco:** comprobar que solo se reproduce el audio de LiveKit/LiveAvatar y que no hay un segundo reproductor de ElevenLabs;
- **palabras cortadas:** correlacionar turn eagerness, interrupciones y endpointing;
- **frases incoherentes o formatos extraños:** clasificar como salida del LLM/prompt, no como audio;
- **archivos generados en el repositorio:** son artefactos de desarrollo y no prueban un fallo de Clara.

Los ajustes de voz pueden influir en naturalidad y costo computacional. ElevenLabs recomienda estabilidad aproximada `0.60–0.85` para consistencia y velocidad `0.9–1.1`; `style` distinto de cero y speaker boost pueden aumentar carga. La configuración actual está cerca del perfil estable. [Diseño de voz conversacional](https://elevenlabs.io/docs/eleven-agents/customization/voice/best-practices/conversational-voice-design), [Voice settings API](https://elevenlabs.io/docs/api-reference/voices/settings/get)

## 4. Plan de acción priorizado

### P0 — antes de comparar calidad

1. **Corregir y alertar problemas de facturación/cuota de ElevenLabs.** Definir un monitor que alerte por `termination_reason` de pago y por tasa de fallo, sin esperar reportes manuales.
2. **Crear un baseline repetible.** Mínimo 30 conversaciones por variante, mismos guiones, dispositivo/red registrados y mezcla de turnos cortos/largos, interrupciones y silencio.
3. **Instrumentar el timeline t0–t9.** Enviar solo timings, IDs técnicos truncados, versión, navegador/dispositivo y calidad de conexión; nunca prompt completo, transcript o datos de cliente.
4. **Añadir observabilidad Vercel.** Medir p50/p90/p99 y error rate de `/api/start-custom-session`, llamadas externas y funciones. [Vercel Observability](https://vercel.com/docs/observability), [Vercel Logs](https://vercel.com/docs/functions/logs)

### P1 — robustez del flujo actual

1. Sacar la persistencia de base de datos del camino crítico o limitarla con timeout.
2. Reemplazar el temporizador de 150 ms por variables dinámicas en la configuración inline actual o por confirmación explícita del contexto.
3. Corregir el `await` de keepalive, enviarlo cada 120 s y registrar fallos.
4. Instrumentar reconexión/desconexión y RTC stats; mostrar al tester si el problema fue red, proveedor o sesión.
5. Hacer que `/api/diagnostics` pruebe exactamente `LITE + elevenlabs_agent_config` y mida cada proveedor por separado.

### P2 — optimización controlada de ElevenLabs

Mantener la configuración actual como control y crear ramas/versiones inmutables. Probar **una sola variable por vez**:

1. prompt actual vs. una versión más corta y especializada;
2. RAG actual vs. RAG desactivado o KB reducida;
3. `qwen36-35b-a3b` vs. un modelo alternativo apto para español;
4. turn eagerness `normal` vs. `patient` si existen interrupciones;
5. estabilidad `0.65` vs. un pequeño rango alrededor, solo para artefactos de voz.

ElevenLabs recomienda versionar, probar y luego hacer A/B con 5–10% de tráfico, evitando mezclar cambios. También permite tests repetidos/simulados para respuestas y herramientas. [Experimentos](https://elevenlabs.io/docs/eleven-agents/operate/experiments), [Versionado](https://elevenlabs.io/docs/eleven-agents/operate/versioning), [Testing](https://elevenlabs.io/docs/eleven-agents/customization/agent-testing), [Prompting](https://elevenlabs.io/docs/eleven-agents/best-practices/prompting-guide)

## 5. Criterios de aceptación propuestos

Estos umbrales son objetivos de producto iniciales, no garantías de proveedores. Deben ratificarse con los testers.

| Métrica                                               |                 Objetivo inicial |
| ----------------------------------------------------- | -------------------------------: |
| Sesiones iniciadas sin error no atribuible al usuario |                            ≥ 99% |
| Latencia percibida `t8-t5`, p50                       |                          ≤ 1.2 s |
| Latencia percibida `t8-t5`, p90                       |                          ≤ 2.0 s |
| Inicio `t3-t0`, p90                                   |                            ≤ 6 s |
| Reconexiones no recuperadas                           |                           < 0.5% |
| Turnos con audio duplicado/cortado/robotizado         |                             < 1% |
| Muestra mínima antes de promover una variante         | 30 conversaciones y ≥ 100 turnos |

Cada reporte de tester debe incluir fecha/hora, navegador, dispositivo, tipo de red, ID de sesión/conversación truncado, turno exacto y clasificación del síntoma. Una grabación corta es útil solo con consentimiento y tratamiento adecuado de datos.

## 6. Estado del repositorio y gobernanza

- La rama `release/2026-08-produccion` está alineada con su remoto, pero el árbol local contiene modificaciones y documentos no rastreados ajenos a esta auditoría; no se tocaron.
- El repositorio es el fork público [tizeira/liveavatar-web-sdk](https://github.com/tizeira/liveavatar-web-sdk) del proyecto [heygen-com/liveavatar-web-sdk](https://github.com/heygen-com/liveavatar-web-sdk). El fork estaba 33 commits detrás del upstream y fuertemente divergido al momento de la revisión. Esto hace que una actualización automática sea riesgosa: primero debe inventariarse el diff funcional y crear pruebas de contrato.
- La versión de LiveAvatar SDK instalada coincide con la publicada actualmente (`0.0.18`). No hay una actualización oficial obvia que, por sí sola, resuelva el problema.
- Next.js, LiveKit y Prisma tienen versiones posteriores disponibles. Ninguna debe actualizarse dentro del mismo experimento de latencia del agente; mezclar upgrades destruye la atribución causal.
- La [PR #24](https://github.com/tizeira/liveavatar-web-sdk/pull/24) de release tenía CI/Vercel verdes, pero no revisión humana y el QA manual seguía pendiente. La [PR #23](https://github.com/tizeira/liveavatar-web-sdk/pull/23) también estaba verde; la [PR #20](https://github.com/tizeira/liveavatar-web-sdk/pull/20) estaba obsoleta y sin checks de Actions. La promoción a producción debe depender del baseline de Clara y no solo del CI.

### Evidencia de código

- `apps/demo/app/api/start-custom-session/route.ts:165-169`: LITE + ElevenLabs Connector.
- `apps/demo/app/api/start-custom-session/route.ts:329`: persistencia esperada antes de responder.
- `apps/demo/app/api/diagnostics/route.ts:51`: diagnóstico en CUSTOM, distinto de producción.
- `apps/demo/src/components/ClaraVoiceAgent.tsx:557-598`: contexto + trigger con 150 ms.
- `apps/demo/src/components/ClaraVoiceAgent.tsx:819-825`: keepalive cada cinco minutos.
- `packages/js-sdk/src/LiveAvatarSession/LiveAvatarSession.ts:238-246`: promesa de keepalive no esperada.

## 7. Habilidades actualizadas

Las habilidades oficiales `liveavatar-integrate` y `liveavatar-debug` instaladas coinciden con el repositorio oficial de HeyGen y no requieren sobrescritura. La habilidad general antigua contiene una afirmación desactualizada sobre variables dinámicas en el conector; en vez de modificar recursos globales compartidos, se creó la habilidad local:

`/.agents/skills/clara-liveavatar-ops/`

Esa habilidad fija la arquitectura real, el modelo de timings, el manejo de artefactos, el control de cambios de ElevenLabs y los requisitos de privacidad. Se aplica específicamente a Clara y evita que diagnósticos futuros vuelvan a mezclar facturación, red, LLM, TTS y render en una única etiqueta de “latencia”.

## 8. Decisión recomendada

No migrar de LiveAvatar ni de ElevenLabs todavía. Primero:

1. eliminar la causa de pago y añadir alerta;
2. implementar telemetría t0–t9 y RTC;
3. corregir la carrera de inicialización y el keepalive;
4. ejecutar un baseline de al menos 30 sesiones en la versión actual;
5. recién entonces probar prompt/RAG/modelo con ramas A/B.

La evidencia disponible sugiere que el problema observado es una combinación de fallos operativos claros, poca muestra en la última versión y ausencia de instrumentación, no una demostración de que ElevenLabs o LiveAvatar sean la tecnología equivocada.

## Fuentes primarias

- [LiveAvatar — ElevenLabs Agent Connector](https://docs.liveavatar.com/docs/lite-mode/connectors/elevenlabs-agent)
- [LiveAvatar — Agent Skills](https://docs.liveavatar.com/docs/agent-skills)
- [Repositorio oficial de habilidades LiveAvatar](https://github.com/heygen-com/liveavatar-agent-skills)
- [ElevenLabs — Conversation flow](https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow)
- [ElevenLabs — Latency concepts](https://elevenlabs.io/docs/eleven-api/concepts/latency)
- [ElevenLabs — Reducing latency](https://elevenlabs.io/docs/api-reference/reducing-latency)
- [ElevenLabs — RAG](https://elevenlabs.io/docs/eleven-agents/customization/knowledge-base/rag)
- [ElevenLabs — Analytics](https://elevenlabs.io/docs/eleven-agents/dashboard)
- [ElevenLabs — Agent experiments](https://elevenlabs.io/docs/eleven-agents/operate/experiments)
- [ElevenLabs — Agent versioning](https://elevenlabs.io/docs/eleven-agents/operate/versioning)
- [ElevenLabs — Agent testing](https://elevenlabs.io/docs/eleven-agents/customization/agent-testing)
- [ElevenLabs — Personalization](https://elevenlabs.io/docs/eleven-agents/customization/personalization)
- [ElevenLabs — Get agent API](https://elevenlabs.io/docs/api-reference/agents/get)
- [LiveKit — JavaScript client SDK](https://docs.livekit.io/reference/client-sdk-js/)
- [Vercel — Observability](https://vercel.com/docs/observability)
- [RFC 6455 — WebSocket close codes](https://www.rfc-editor.org/rfc/rfc6455#section-7.4.1)
