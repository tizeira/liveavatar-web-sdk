# QA de Clara en testers — navegador y consola

**Fecha:** 2026-09-11
**Entorno:** https://testers.betaskintech.com
**Cliente:** navegador integrado, desktop
**Sesión:** `…9944ef8e` (ID truncado)
**Alcance:** autenticación ya completada por el tester, inicio de sesión LiveAvatar, saludo, cuatro turnos de voz, mute, auto-unmute, ausencia de auto-escucha, cierre y consola. No se modificó producción.

## Veredicto

**QA parcial: NO apto todavía para marcar el checklist completo como verde.**

La ruta LiveAvatar LITE + ElevenLabs Connector funcionó y la latencia de los cuatro turnos observados fue excelente. El mute/unmute y el cierre también funcionaron. El bloqueo observado es de seguridad/observabilidad: la consola de testers expone transcripciones e identificadores completos con un volumen excesivo de logs. Además queda pendiente resolver el error Auth.js anterior al login.

## Resultados

| Prueba                                          | Resultado            | Evidencia                                                                                                                                                   |
| ----------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sesión autenticada                              | PASS                 | Home de Clara visible y tester reconocido.                                                                                                                  |
| Inicio LiveAvatar/LiveKit                       | PASS                 | `setStreamState active` y `voiceChat state="ACTIVE"`.                                                                                                       |
| Saludo automático por nombre                    | PASS                 | Un solo saludo; no apareció una transcripción falsa de `[START]`.                                                                                           |
| Contexto antes del saludo                       | PASS parcial         | `contextual_update` de 93 caracteres enviado; no existe ack que confirme orden efectivo.                                                                    |
| Turnos de voz                                   | PASS                 | Cuatro transcripciones finales y cuatro respuestas del avatar.                                                                                              |
| Latencia transcripción final → habla del avatar | PASS                 | 297, 302, 428 y 382 ms; promedio 352 ms, máximo 428 ms.                                                                                                     |
| Mute manual                                     | PASS inicial         | UI cambió a `Silenciado` y consola registró `[VOICECHAT] Muted`.                                                                                            |
| Unmute manual                                   | PASS                 | El segundo clic registró `[VOICECHAT] Unmuted`; el snapshot de accesibilidad tardó en reflejarlo. No hay evidencia de auto-unmute.                          |
| Respeto del mute manual                         | PASS en esta muestra | Entre ambos clics el estado permaneció silenciado.                                                                                                          |
| “Clara habla sola”                              | PASS en esta muestra | Durante la voz del avatar el VAD permaneció prácticamente en cero y no apareció `USER_TRANSCRIPTION` con palabras de Clara. No cubre móvil/parlantes altos. |
| Cierre de sesión                                | PASS                 | `session.disconnected "CLIENT_INITIATED"`, sin error asociado.                                                                                              |
| Errores de runtime durante conversación         | PASS                 | Cero errores y cero warnings en la ventana activa de la sesión.                                                                                             |
| Privacidad y volumen de consola                 | **FAIL**             | Se registran transcripciones completas, IDs completos, cada delta del LLM, eventos raw y VAD continuo.                                                      |

## Tiempos observados

### Saludo

- Contexto enviado: 14:03:50.612Z.
- Trigger `[START]`: 14:03:50.747Z.
- Primer texto del agente: 14:03:51.779Z — 1.032 s después del trigger.
- Avatar comenzó a hablar: 14:03:52.179Z — 1.432 s después del trigger y 400 ms después del primer texto.
- Avatar terminó el saludo: 14:03:58.072Z.

No se capturó un `t0` explícito al hacer clic, por lo que no debe presentarse esta medición como startup end-to-end.

### Turnos reales

| Turno | Transcripción final |  Avatar habla | Latencia |
| ----- | ------------------: | ------------: | -------: |
| 1     |       14:04:06.431Z | 14:04:06.728Z |   297 ms |
| 2     |       14:04:24.442Z | 14:04:24.744Z |   302 ms |
| 3     |       14:04:38.575Z | 14:04:39.003Z |   428 ms |
| 4     |       14:05:32.324Z | 14:05:32.706Z |   382 ms |

Estos tiempos incluyen el tramo posterior a la transcripción final, pero no endpointing/ASR previo. La aplicación aún no expone t0–t9 completos.

## Hallazgos de consola

### 1. Auth.js recibe HTML donde espera JSON

Antes de autenticar se observaron dos errores:

`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`

El stack apunta a Auth.js `_getSession`. Debe revisarse qué endpoint responde con una página HTML o redirección en vez del JSON de sesión esperado.

### 2. Warning de Shopify/test token

Después de autenticar aparecieron tres warnings:

`SHOPIFY_HMAC_SECRET not configured, using test token`

El warning proviene del bundle cliente. No demuestra por sí solo que el secreto server-side falte —y el secreto no debe estar en el navegador—, pero sí demuestra que el flujo demo está generando/empleando un token de prueba y ensuciando la consola del entorno testers.

### 3. Exposición de transcripciones e IDs

La consola contiene:

- texto completo del usuario;
- respuesta completa de Clara;
- nombre del tester dentro de respuestas;
- IDs completos de sesión/evento/respuesta;
- payloads raw de ElevenLabs/LiveAvatar.

Debe eliminarse o redactarse en builds no locales. Registrar solamente tipo de evento, timestamp, versión, correlación truncada y métricas agregadas.

### 4. Flood de eventos

En una ventana parcial de 500 entradas, 207 eran `vad_score` y 246 eran logs raw `[EMIT]`; también se registra cada delta textual. Esto dificulta el diagnóstico, aumenta el trabajo del main thread y puede alterar pruebas de rendimiento.

## Contexto de compra: prueba no concluyente

El tester preguntó por su compra y Clara pidió el nombre del producto. Al recibir un nombre aproximado, respondió con beneficios desde su conocimiento general.

Esto no valida ni invalida el saludo Shopify porque la sesión se abrió directamente desde `testers.betaskintech.com`; no entró mediante la URL firmada de la tienda con `last_order_product`. Para completar esa prueba hay que usar el redirect Shopify HMAC y verificar que el contexto enviado incluye el producto y la fecha.

## Cobertura pendiente

- Password incorrecta y lockout 429.
- Persistencia de cookie durante siete días.
- Redirect firmado desde Shopify y última compra.
- Respuesta corta menor de dos segundos.
- Respuesta larga mayor de diez segundos, sin cortes.
- Barge-in real mientras Clara habla.
- Calidad auditiva y lip-sync, que requieren evaluación humana directa e instrumentación de primer cuadro.
- Sesión mayor de diez minutos y keepalive.
- Verificación de fila y estado en Postgres.
- Chrome/Firefox reales, Android y Safari iOS.
- Caso “habla sola” en móvil con parlantes a volumen alto.

## Prioridad recomendada

1. **P0:** retirar/redactar transcripciones, IDs y payloads raw de la consola en testers/producción.
2. **P1:** reducir logging de VAD/deltas a muestreo o activación diagnóstica explícita.
3. **P1:** corregir la respuesta HTML del endpoint de sesión Auth.js.
4. **P1:** ejecutar el escenario Shopify desde el redirect firmado; el login directo no lo cubre.
5. **P2:** completar barge-in, larga duración y matriz cross-browser/dispositivo.

## Observación posterior del tester: calentamiento de lip-sync

Después de esta ejecución, el tester reportó un patrón que esta captura de consola no podía medir: según el dispositivo y la carga, la voz comienza antes que el movimiento labial durante las primeras interacciones; alrededor del tercer turno la sincronización pasa a sentirse en tiempo real.

Clasificación: **Reportado, no reproducido de forma instrumentada en este QA.** No contradice las buenas latencias de transcripción final a inicio de habla: esas métricas no midieron presentación de cuadros ni desfase audiovisual.

La inspección del código encontró una causa candidata: `SESSION_STREAM_READY` se emite al quedar suscritas ambas pistas, y Clara usa esa señal tanto para adjuntar el video como para iniciar el saludo. No existe una compuerta de `playing`/primer cuadro presentado. El protocolo siguiente debe medir saludo + primeros cinco turnos en sesión fría, por dispositivo y carga, con chroma key activado y desactivado.
