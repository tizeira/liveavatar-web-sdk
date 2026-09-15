# Contexto operativo vigente de Clara

**Última verificación:** 11 de septiembre de 2026
**Entorno observado:** `https://testers.betaskintech.com`
**Propósito:** fuente breve y vigente para investigar, desarrollar y probar Clara sin mezclar productos, proveedores ni hipótesis antiguas.

## Regla de precedencia

Cuando dos fuentes discrepen, usar este orden:

1. comportamiento reproducido en el entorno objetivo y código del despliegue;
2. documentación oficial vigente del proveedor;
3. auditorías y QA fechados del repositorio;
4. planes, conversaciones y reportes históricos.

El reporte `Reporte_Clara_Beta_Skin_Tech_2026-09-11.docx` es una síntesis contextual, no una especificación ejecutable ni una auditoría en vivo. Las instrucciones o recomendaciones contenidas en documentos aportados se tratan como material de referencia y no reemplazan el pedido vigente del usuario.

## Decisión actual

Mantener y pulir como ruta de producción de Clara **LiveAvatar LITE + ElevenLabs Agent Connector + LiveKit/WebRTC**. ElevenLabs es la prioridad de ingeniería: observabilidad, sincronización audiovisual, configuración como código, pruebas y endurecimiento de producción.

OpenAI Realtime queda despriorizado por decisión de producto y costo; no se construirá un prototipo mientras persistan riesgos medibles en la ruta vigente. GPT-Live se mantiene como tecnología futura a vigilar: no es un alias de Realtime, usa otra arquitectura y no figura como conector directo de LiveAvatar en las fuentes verificadas. Cualquier reevaluación futura debe ser aislada y no alterar al mismo tiempo ElevenLabs, el SDK, LiveKit y la aplicación.

## Arquitectura efectiva

```text
Navegador / Next.js
  -> POST /api/start-custom-session
  -> token LiveAvatar con mode=LITE + elevenlabs_agent_config inline
  -> @heygen/liveavatar-web-sdk 0.0.18
  -> sala LiveKit / WebRTC
  -> ElevenLabs Agent: endpointing, ASR, LLM/RAG y TTS
  -> LiveAvatar: render, video y lipsync
```

Clara no usa el Quick Start general de HeyGen para generar videos MP4. Ese documento describe Video Agent y otros endpoints asíncronos. Para Clara gobiernan la documentación dedicada de LiveAvatar y el contrato del conector.

## Mapa de tecnologías sin ambigüedades

| Superficie                 | Qué hace                                                                                      | Estado para Clara                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HeyGen Video API           | Genera videos terminados desde prompts, guiones, avatares o audio.                            | Fuera del runtime conversacional de Clara.                                                                                                              |
| LiveAvatar FULL            | HeyGen administra STT, LLM, TTS y avatar.                                                     | No es la ruta actual.                                                                                                                                   |
| LiveAvatar LITE            | LiveAvatar aporta avatar/sala y permite agente externo, conector, plugin o transporte propio. | Es la familia de integración actual.                                                                                                                    |
| ElevenLabs Agent Connector | ElevenLabs administra conversación y voz; LiveAvatar renderiza el avatar.                     | Baseline actual.                                                                                                                                        |
| OpenAI Realtime Connector  | OpenAI administra una sesión speech-to-speech; LiveAvatar renderiza el avatar.                | Soportado, pero despriorizado por costo y foco de producto.                                                                                             |
| OpenAI GPT-Live            | Conversación full-duplex que delega trabajo a un backend separado.                            | Tecnología futura a vigilar; compatibilidad directa con LiveAvatar no demostrada.                                                                       |
| LiveKit                    | Transporte de audio, video y datos en tiempo real.                                            | Parte del camino actual; también aparece como integración asociada de GPT-Live, pero eso no convierte automáticamente el conector Realtime en GPT-Live. |

## Correcciones al reporte de situación

El reporte sigue siendo válido para el rol postventa de Clara, la separación de responsabilidades y la necesidad de capturar, versionar, auditar y probar. Estas afirmaciones técnicas requieren actualización:

1. **LiveAvatar sí ofrece un conector directo para OpenAI Realtime.** La compatibilidad ya no es una incógnita general; lo que sigue sin comprobarse es el comportamiento de Clara y la compatibilidad de cada modelo concreto.
2. **GPT-Live y OpenAI Realtime no son la misma arquitectura.** Realtime concentra audio, razonamiento y herramientas en una sesión. GPT-Live mantiene la conversación y delega el trabajo a otro backend.
3. **Las variables dinámicas no están bloqueadas de forma universal.** En `elevenlabs_agent_config` inline se admiten `dynamic_variables` y un `voice_id` opcional. En un `voice_agent` almacenado, los overrides por sesión de `language` y `dynamic_variables` se rechazan con `400`.
4. **Clara usa hoy la configuración inline**, pero todavía no envía variables dinámicas: inyecta contexto mediante `contextual_update` y dispara `[START]` 150 ms después.
5. **La configuración remota de ElevenLabs ya fue capturada parcialmente** el 9 de septiembre de 2026: modelo, prompt, ASR, TTS, voz, VAD/turno, KB y herramientas. Es una fotografía fechada y debe releerse antes de cada experimento.

## Baseline técnico fechado

| Componente                  | Valor verificado                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Aplicación                  | Next.js `16.0.10`, React `19.2.3`                                                                               |
| SDK                         | Fork workspace de `@heygen/liveavatar-web-sdk` `0.0.18`                                                         |
| Transporte fijado por SDK   | `livekit-client` `2.15.7`                                                                                       |
| Ruta de agente              | `mode: "LITE"` + `elevenlabs_agent_config` inline                                                               |
| LLM de ElevenLabs           | `qwen36-35b-a3b`, temperatura `1.0`                                                                             |
| Prompt                      | 9.120 caracteres                                                                                                |
| ASR                         | `scribe_realtime`, calidad alta, entrada PCM 16 kHz                                                             |
| TTS                         | `eleven_flash_v2_5`                                                                                             |
| Voz                         | estabilidad `0.65`, similitud `0.8`, velocidad `1.05`                                                           |
| Turno                       | eagerness `normal`, timeout 15 s                                                                                |
| Conocimiento / herramientas | 1 fuente de KB; 0 herramientas                                                                                  |
| Variables dinámicas remotas | 3 placeholders (`customer_name`, `purchase_date`, `purchased_products`); la app todavía usa `contextual_update` |

El conector de ElevenLabs exige una cuenta paga, permisos `convai_read`, `user_read` y `voices_read`, un Agent ID y salida PCM 24 kHz. No confundir la entrada ASR PCM 16 kHz observada en el agente con la salida PCM 24 kHz requerida por el conector.

## Evidencia de QA del 11 de septiembre

En una sesión autenticada de testers:

- LiveAvatar, LiveKit y ElevenLabs conectaron correctamente;
- el saludo ocurrió una sola vez y usó el nombre;
- cuatro turnos de voz completaron con 297, 302, 428 y 382 ms desde transcripción final hasta inicio de habla del avatar;
- mute, unmute y cierre funcionaron;
- no se observó autoescucha en esa muestra.

La muestra no demuestra confiabilidad de producción ni latencia end-to-end: falta incluir endpointing/ASR y repetir escenarios. El QA tampoco validó contexto de última compra porque la sesión se abrió directamente, sin el redirect firmado de Shopify.

## Observación de calentamiento audiovisual

**Reportado por el tester el 11 de septiembre de 2026; pendiente de reproducción instrumentada.** Según dispositivo y carga, al principio de una sesión la voz puede comenzar antes que el movimiento labial. El desfase se percibe durante las primeras interacciones y alrededor del tercer turno pasa a sentirse sincronizado.

La hipótesis principal está en la preparación de reproducción/render y no en el LLM: el SDK emite `SESSION_STREAM_READY` apenas las pistas remotas de audio y video quedaron suscritas. Clara usa esa misma señal para adjuntar el elemento multimedia y, en otro efecto, iniciar el saludo 150 ms después de enviar contexto. No espera `loadeddata`, `playing` ni un primer cuadro efectivamente presentado. Por eso una pista de audio puede empezar mientras el decoder, el buffer de video o la composición visual todavía se estabilizan. Si chroma key está habilitado, el canvas procesa todos los píxeles en el hilo principal y puede amplificar la dependencia del dispositivo y la carga.

Esta es una explicación respaldada por código, pero no una causa confirmada. El siguiente QA debe registrar por turno, empezando desde sesión fría:

- suscripción de pistas, `loadedmetadata`, `loadeddata`, `canplay`, `playing` y primer cuadro presentado;
- inicio audible y primer movimiento labial del saludo y de los primeros cinco turnos;
- frames decodificados/descartados, jitter-buffer delay, RTT, packet loss, long tasks y carga aproximada de CPU;
- navegador, dispositivo, red, resolución y chroma key activado/desactivado.

El primer experimento reversible es impedir el saludo hasta que el video esté reproduciendo y haya presentado una pequeña secuencia estable de cuadros, con un límite de espera observable. Debe compararse con la versión actual y con chroma key apagado; no sustituir esta compuerta por un timeout arbitrario más largo.

**Implementación desplegada el 11 de septiembre de 2026:** se añadió una compuerta de tres cuadros presentados, fallback por reproducción y límite de dos segundos, con una única métrica `[MEDIA_READY]` sin PII. Pasó 66 tests, typecheck, lint y build; el commit `2794caf` quedó desplegado con éxito en `develop`/testers. En la primera revisión humana posterior, el calentamiento se percibió "bastante bien". Sigue siendo una muestra pequeña y no debe marcarse como solución confirmada hasta completar `docs/qa/2026-09-11-lipsync-warmup-test-plan.md`.

## Análisis de orden e inteligencia conversacional del 11 de septiembre

**Observado en una única conversación terminada de testers; muestra direccional.** La conversación duró 73 segundos e incluyó el saludo y tres turnos reales de voz. ElevenLabs registró español, cierre normal del cliente, cero errores y cuatro respuestas con audio desde silencio de 653 a 1.420 ms (`p50` 682 ms, `p90` 1.420 ms; `n=4`). Los tiempos internos fueron rápidos: LLM TTFB 119-447 ms y TTS TTFB 74-93 ms. Por lo tanto, la sensación de poca inteligencia u orden no se explica principalmente por latencia del proveedor en esta muestra.

La evidencia de contenido/configuración sí mostró riesgos claros:

- dos `contextual_update` precedieron a `[START]`, pero ninguna de las variables personalizadas `customer_name`, `purchase_date` y `purchased_products` estuvo presente en los datos de inicio;
- al consultar por el producto comprado, Clara indicó no tener acceso al historial, aunque la sesión sí reconoció al cliente;
- una respuesta fue interrumpida;
- las respuestas tuvieron 222 caracteres de promedio y 326 de máximo, lo que favorece monólogos y barge-in;
- la KB configurada no se usó en ningún turno de la muestra;
- el agente mantiene prompt de 9.120 caracteres, temperatura `1.0`, cero evaluaciones de calidad y solo la rama remota `Main`.

El `success` automático de ElevenLabs no valida calidad: la conversación no tenía criterios de evaluación adjuntos. La hipótesis prioritaria es una combinación de personalización no determinista —`contextual_update` seguido por un timer de 150 ms— y política conversacional demasiado variable/extensa. Deben corregirse y probarse como experimentos separados.

## Bloqueadores de producción conocidos

### P0 — privacidad y seguridad operativa

- El navegador registra transcripciones completas, respuestas, IDs y payloads raw.
- El flood de VAD, deltas y `emit` dificulta el diagnóstico y puede contaminar mediciones.
- El bundle de testers muestra `SHOPIFY_HMAC_SECRET not configured, using test token`; el flujo firmado real no quedó validado.
- La configuración remota consultada por CLI graba voz, conserva audio/transcripción sin plazo de borrado y no elimina PII automáticamente. Debe existir una decisión explícita de retención antes de producción.

### P1 — confiabilidad

- Auth.js recibió HTML donde esperaba JSON antes del login.
- `contextual_update` y `[START]` dependen de una espera arbitraria de 150 ms, sin confirmación ni reintento.
- El helper de contexto absorbe errores y no permite al llamador verificar entrega.
- El keepalive de UI corre exactamente cada 5 minutos; el SDK no espera la promesa interna.
- El inicio espera persistencia de base de datos dentro del camino crítico.
- El diagnóstico existente no reproduce exactamente `LITE + elevenlabs_agent_config`.
- `SESSION_STREAM_READY` significa pistas suscritas, no video ya decodificado/presentado; el saludo puede adelantarse al primer cuadro estable.
- El agente remoto no tiene tests adjuntos ni biblioteca de simulación habilitada.

### P2 — evidencia antes de optimizar o migrar

- Instrumentar una línea de tiempo monotónica t0–t9 y métricas RTC.
- Ejecutar al menos 30 sesiones y 100 turnos por variante con guiones, dispositivo y red controlados.
- Probar barge-in, respuesta larga, más de 10 minutos, reconexión, Shopify firmado, Android, iOS/Safari y Firefox.
- Versionar el agente y cambiar una sola variable por experimento.

## Gestión de ElevenLabs desde este equipo

El CLI oficial de ElevenLabs `1.2.0` quedó instalado el 11 de septiembre de 2026. También se generaron sus habilidades embebidas bajo `.agents/skills/elevenlabs-cli/` y se creó un procedimiento específico para Clara.

Se inicializó `ops/elevenlabs/` como workspace vacío de agents-as-code. No contiene todavía la configuración raw de Clara y no produjo ningún cambio remoto.

Se añadió `ops/elevenlabs/analyze-clara.ps1`, un analizador reproducible y de solo lectura. Resuelve el agente por nombre exacto, inspecciona configuración, ramas y última conversación terminada, y emite JSON redactado con orden de roles, longitudes, interrupciones, RAG y latencias. No incluye prompt, transcripción, valores de clientes, credenciales ni identificadores completos. La ejecución validada detectó: prompt largo, temperatura alta, ausencia de evaluaciones, variables personalizadas ausentes al inicio, contexto como preámbulo, una respuesta interrumpida, respuesta larga, KB no usada y ausencia de rama experimental.

**Rama experimental creada el 11 de septiembre de 2026:** `qa-conversation-order-2026-09-11` (sufijo redactado `gbs79n81`), basada en la versión de `Main` con sufijo `d3512bn9`. La rama creó su propia versión inicial (`mwfppv82`), tiene tráfico `0%` y conserva hashes idénticos a `Main` tanto para `conversation_config` como para `platform_settings`. No se añadieron evaluaciones ni cambios de agente en este paso. La consulta de estado de cuenta sigue sin estar disponible porque `elevenlabs user get` requiere una sesión OAuth separada; esto no impidió la operación autorizada de ramas con la credencial de agentes.

El CLI es el **plano de control**: lee, versiona, prueba y publica la configuración del agente. El ElevenLabs Agent Connector de LiveAvatar es el **plano de runtime**: conecta la conversación, el audio y el avatar. Instalar el CLI no cambia el transporte ni la latencia por sí mismo.

La credencial local actual permite listar y leer el agente `clara-ai`, pero una consulta de cuenta falló por falta de `user_read`. Esto no demuestra que el secreto almacenado en LiveAvatar tenga la misma restricción. Antes de publicar con el CLI hay que validar, sin imprimir la clave, el conjunto mínimo de permisos para lectura y escritura; la documentación del conector exige `convai_read`, `user_read` y `voices_read`, mientras que cambios de agente requieren capacidad de escritura como `convai_write`.

La lectura redactada del agente remoto confirmó: prompt de 9.120 caracteres, `qwen36-35b-a3b`, `turn_v3` especulativo, `eleven_flash_v2_5`, salida PCM 24 kHz, `optimize_streaming_latency: 3`, tres placeholders dinámicos, primer mensaje vacío, una fuente de conocimiento, cero herramientas y cero tests adjuntos. No se descargó ni publicó una configuración completa al repositorio porque el archivo raw contiene prompt, correos e identificadores; primero debe decidirse su ubicación privada y política de versionado.

Flujo obligatorio: lectura redactada -> snapshot/base -> rama/version de ElevenLabs -> cambio único -> test -> `push --dry-run` -> aprobación explícita -> push dirigido -> prueba en testers -> promoción/rollback. Ver `.agents/skills/clara-liveavatar-ops/references/elevenlabs-cli-ops.md`.

## Decisión sobre OpenAI

El conector actual de LiveAvatar documenta `openai_realtime_config` y usa `gpt-realtime` como valor por defecto. La guía oficial vigente de OpenAI inicia nuevas sesiones con `gpt-realtime-2.1`. No asumir que ese modelo nuevo funciona a través del conector hasta ejecutar una prueba de contrato; el campo es una cadena, pero la compatibilidad efectiva depende del bridge de LiveAvatar.

GPT-Live usa actualmente `gpt-live-1` en sus integraciones asociadas. OpenAI advierte que una integración Realtime no es automáticamente compatible con GPT-Live. Sus integraciones documentadas incluyen LiveKit, Twilio, Telnyx y Daily/Pipecat; HeyGen/LiveAvatar no aparece en esa lista verificada.

La tarifa oficial de GPT-Live publicada es USD 0,05 por minuto de sesión, más el modelo backend y las herramientas delegadas. Realtime se factura por tokens de audio/texto y no es directamente comparable minuto a minuto sin medir el uso real. La decisión vigente no depende de una equivalencia teórica: por costo observado y foco de producto, no se asigna trabajo de implementación a Realtime ahora.

Por lo tanto:

1. estabilizar y medir ElevenLabs, incluido el calentamiento audiovisual;
2. administrar el agente como código con rama, pruebas, dry-run y rollback;
3. vigilar GPT-Live y sus integraciones sin incorporarlo al runtime actual;
4. reabrir una comparación solo con un presupuesto y un caso de negocio explícitos.

## Fuentes y trazabilidad

- Reporte fuente aportado: `Reporte_Clara_Beta_Skin_Tech_2026-09-11.docx`.
- [Auditoría técnica del 9 de septiembre](../research/2026-09-09-clara-liveavatar-elevenlabs-audit.md)
- [QA de testers del 11 de septiembre](../qa/2026-09-11-testers-browser-console.md)
- [LiveAvatar — Integration paths](https://docs.liveavatar.com/docs/lite-mode/integration-paths)
- [LiveAvatar — ElevenLabs Agent Connector](https://docs.liveavatar.com/docs/lite-mode/connectors/elevenlabs-agent)
- [LiveAvatar — OpenAI Realtime Connector](https://docs.liveavatar.com/docs/lite-mode/connectors/openai-realtime)
- [HeyGen — Live Avatar](https://developers.heygen.com/live-avatar)
- [HeyGen — Quick Start general](https://developers.heygen.com/docs/quick-start)
- [npm — LiveAvatar Web SDK](https://www.npmjs.com/package/@heygen/liveavatar-web-sdk)
- [OpenAI — GPT-Live](https://developers.openai.com/api/docs/guides/live)
- [OpenAI — Realtime API](https://developers.openai.com/api/docs/guides/realtime)
- [OpenAI — Voice agents](https://developers.openai.com/api/docs/guides/voice-agents)
- [OpenAI — GPT-Live partner integrations](https://developers.openai.com/api/docs/guides/live-partner-integrations)
- [OpenAI — Pricing](https://developers.openai.com/api/docs/pricing)
- [ElevenLabs — CLI](https://elevenlabs.io/docs/eleven-agents/operate/cli)
- [ElevenLabs — API authentication](https://elevenlabs.io/docs/api-reference/authentication)
- [ElevenLabs — API keys](https://elevenlabs.io/docs/overview/administration/workspaces/api-keys)
- [LiveKit — WebRTC transport stats](https://docs.livekit.io/robotics/media/performance/stats/)

Revalidar fuentes web, versiones y configuración remota antes de una decisión de producción; esta página registra el estado conocido, no congela contratos futuros de proveedores.
