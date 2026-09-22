# Session: ElevenLabs Plugin Migration + Chroma Key

**Date:** 2026-05-14
**Branch:** `feature/elevenlabs-plugin`
**PR:** #15 — https://github.com/tizeira/liveavatar-web-sdk/pull/15

---

## Objetivo

Dos cambios en una sesión:

1. **Migrar de audio pipeline manual a HeyGen ElevenLabs Plugin** — eliminar ~500 líneas de código de audio
2. **Añadir chroma key configurable** — permitir avatares sin fondo con green screen removal en frontend

---

## Parte 1: ElevenLabs Plugin Migration

### Problema

Clara usaba un pipeline de audio complejo y frágil:

```
Mic (44.1kHz) → resample 16kHz → ElevenLabs WebSocket (STT+LLM+TTS)
→ buffer chunks → gap detection → resample 24kHz → HeyGen LiveAvatar
```

~500 líneas de código: AudioContext, resampling, buffer management, gap detection,
smart chunking, fade-out interruption, phase system. Bugs frecuentes de audio cortado,
micro-pausas, y timing issues.

### Solución

HeyGen SDK v0.0.18 incluye el **ElevenLabs Plugin**: HeyGen maneja todo server-side.

```
Mic → LiveKit → HeyGen server → ElevenLabs (STT+LLM+TTS) → lip-sync video
```

Cero procesamiento de audio en el frontend.

### Cambios técnicos

| Archivo                                   | Cambio                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `packages/js-sdk/`                        | SDK v0.0.9 → v0.0.18 (upstream update)                                   |
| `app/api/secrets.ts`                      | +`HEYGEN_ELEVENLABS_SECRET_ID`, +`ELEVENLABS_AGENT_ID`                   |
| `app/api/start-custom-session/route.ts`   | `mode: "CUSTOM"` → `mode: "LITE"` + `elevenlabs_agent_config`            |
| `src/utils/heygen/elevenlabs-commands.ts` | **NUEVO** — `sendCustomerContext()` via `session.sendContextualUpdate()` |
| `src/components/ClaraVoiceAgent.tsx`      | ~1756 → ~810 líneas (-950 líneas netas)                                  |
| `turbo.json`                              | +`HEYGEN_ELEVENLABS_SECRET_ID` en globalEnv                              |

### Código eliminado

- Todas las constantes de audio (SAMPLE_RATE, BUFFER_SIZE, GAP_THRESHOLD, etc.)
- Todos los refs de audio (audioBufferRef, gapCheckIntervalRef, etc.)
- Todas las funciones de audio (resampleAudio, concatenateBase64Audio, smartSplitAudio, sendChunkedAudio, fadeOutAndInterrupt, etc.)
- Hook `useElevenLabsAgent` completo (~250 líneas)
- Efectos de sincronización audio-avatar

### Clases nuevas del SDK

```typescript
import { ElevenLabsAgentSession } from "@heygen/liveavatar-web-sdk";

// Métodos públicos (antes requerían escape hatch con `as any`):
session.sendContextualUpdate(text); // Enviar contexto al agente
session.sendUserMessage(text); // Enviar mensaje como usuario
session.sendUserActivity(); // Señalar actividad del usuario
session.sendClientToolResult(args); // Resultado de tool calls

// VoiceChat:
session.voiceChat.start({ defaultMuted: false });
session.voiceChat.mute() / unmute();

// Eventos:
AgentEventsEnum.USER_SPEAK_STARTED / ENDED;
AgentEventsEnum.AVATAR_SPEAK_STARTED / ENDED;
AgentEventsEnum.USER_TRANSCRIPTION / AVATAR_TRANSCRIPTION;
```

### HeyGen Secrets API

Para el plugin, la API key de ElevenLabs se almacena en HeyGen (no se expone al frontend):

```bash
POST https://api.liveavatar.com/v1/secrets
{
  "secret_type": "ELEVENLABS_API_KEY",
  "secret_value": "<elevenlabs-api-key>",
  "secret_name": "Clara ElevenLabs Key"
}
# Retorna: { data: { id: "<secret_id>" } }
```

El `secret_id` se usa en la creación de sesión:

```typescript
{
  mode: "LITE",
  avatar_id: avatarId,
  elevenlabs_agent_config: {
    secret_id: HEYGEN_ELEVENLABS_SECRET_ID,
    agent_id: ELEVENLABS_AGENT_ID,
  },
}
```

### Requisitos ElevenLabs Dashboard

| Setting                   | Valor requerido | Por qué                          |
| ------------------------- | --------------- | -------------------------------- |
| Agent output format (TTS) | `pcm_24000`     | HeyGen lip-sync requiere 24kHz   |
| User input format (STT)   | `pcm_16000`     | Estándar para speech recognition |

Si output no es `pcm_24000`, HeyGen devuelve error 400.

---

## Parte 2: Chroma Key (Green Screen Removal)

### Problema

Los avatares de HeyGen pueden tener fondo verde (green screen) para permitir
fondos personalizados. La API de LiveAvatar (`/v1/sessions/token`) NO tiene parámetro
de fondo — el removal se hace client-side.

### Solución

Canvas 2D chroma keying controlado por variable de entorno, siguiendo la
[guía oficial de HeyGen](https://docs.liveavatar.com/docs/guides/change-background)
y el [bg-removal-demo](https://github.com/heygen-com/liveavatar-web-sdk/tree/master/apps/bg-removal-demo).

### Flujo completo

```
Vercel env: CHROMA_KEY_ENABLED=true (Preview only)
            HEYGEN_AVATAR_ID_DESKTOP_GREENSCREEN=<uuid>
                    │
                    ▼
API: /api/start-custom-session
  → Lee CHROMA_KEY_ENABLED=true
  → Selecciona avatar green screen
  → Responde { session_token, chroma_key_enabled: true }
                    │
                    ▼
Frontend: ClaraVoiceAgent
  → chromaKeyEnabled=true state
  → Pasa a SessionWrapper → ConnectedSession → AvatarVideo
                    │
                    ▼
AvatarVideo: DOM stack de 3 capas
  ┌─────────────────────────────────┐
  │ bg-layer (z-0)  ← transparente │
  │ <video> (z-10)  ← hidden       │
  │ <canvas> (z-20) ← visible      │
  └─────────────────────────────────┘
                    │
                    ▼
useChromaKey: cada frame @ 60fps
  → Lee frame del <video>
  → Dibuja en offscreen canvas
  → Por cada pixel: RGB→HSV
  → Si hue ∈ [60°, 180°] AND saturation > 0.1
      → greenness = (G - max(R,B)) / G
      → alpha = max(0, 1 - greenness * 4) * 255
  → putImageData en canvas visible
```

### Algoritmo: por qué HSV y no RGB

| Método                 | Precisión | Problema                                                                |
| ---------------------- | --------- | ----------------------------------------------------------------------- |
| RGB distance (mi v1)   | Baja      | Tonos de piel/ropa marrón pueden estar "cerca" del verde en espacio RGB |
| **HSV hue range (v2)** | **Alta**  | Verde = hue 60°-180°. Piel = ~20°. Azul = ~240°. Sin ambigüedad         |

### Decisiones técnicas clave

| Decisión                                   | Razón                                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `visibility: hidden` (no `opacity: 0`)     | Browser puede pausar decoder de video invisible con opacity:0. visibility:hidden mantiene decoder activo |
| `willReadFrequently: true` en ambos canvas | Hint al browser para mantener datos en CPU (evita sync GPU→CPU en cada getImageData)                     |
| Esperar `readyState >= 2`                  | Video necesita frames decodificados antes de iniciar el loop. Sin esto = canvas vacío al inicio          |
| `setupChromaKey()` retorna cleanup         | Patrón imperativo con cleanup explícito previene loops duplicados de requestAnimationFrame               |
| Offscreen canvas separado                  | Lectura de pixels en canvas separado, escritura en visible. Evita flicker                                |

### Parámetros configurables

```typescript
interface ChromaKeyOptions {
  minHue: number; // Default 60  — inicio del rango verde
  maxHue: number; // Default 180 — fin del rango verde
  minSaturation: number; // Default 0.1 — evita que grises sean "verde"
  threshold: number; // Default 1.0 — dominancia verde
  edgeSharpness: number; // Default 4   — multiplicador de bordes
}
```

**Tuning:**

- Avatar con ropa verde: estrechar a `minHue: 90, maxHue: 150`
- Halo verde visible: subir `edgeSharpness` a 6-8
- Avatar se vuelve transparente: subir `threshold` a 1.2

### Variables de entorno

| Variable                               | Valor  | Scope Vercel     |
| -------------------------------------- | ------ | ---------------- |
| `CHROMA_KEY_ENABLED`                   | `true` | **Preview only** |
| `HEYGEN_AVATAR_ID_DESKTOP_GREENSCREEN` | UUID   | **Preview only** |
| `HEYGEN_AVATAR_ID_MOBILE_GREENSCREEN`  | UUID   | **Preview only** |

Production NO tiene estas variables → default `false` → avatar con fondo, sin canvas.

### Archivos nuevos/modificados

| Archivo                                 | Cambio                                                               |
| --------------------------------------- | -------------------------------------------------------------------- |
| `src/hooks/useChromaKey.ts`             | **NUEVO** — Hook HSV chroma key                                      |
| `src/hooks/index.ts`                    | Export useChromaKey                                                  |
| `app/api/secrets.ts`                    | +`CHROMA_KEY_ENABLED`, lógica de avatar ID greenscreen               |
| `app/api/start-custom-session/route.ts` | +import `CHROMA_KEY_ENABLED`, respuesta incluye `chroma_key_enabled` |
| `src/components/ClaraVoiceAgent.tsx`    | AvatarVideo con 3-layer DOM stack + chromaKeyEnabled prop threading  |
| `turbo.json`                            | +3 env vars en globalEnv                                             |

---

## Errores encontrados y resueltos

| Error                                          | Causa                                                      | Fix                                                    |
| ---------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Vercel deploy `ERR_PNPM_OUTDATED_LOCKFILE`     | SDK update cambió package.json pero lockfile no regenerado | `pnpm install` + commit lockfile                       |
| ElevenLabs `pcm_16000 but pcm_24000 required`  | Agent output format incorrecto en dashboard                | Cambiar a `pcm_24000` en ElevenLabs dashboard          |
| `customerData` no se enviaba si llegaba tarde  | Faltaba en deps del useEffect                              | Añadir `customerData` + guard `hasStartedVoiceChatRef` |
| TypeScript `number \| undefined` en pixel data | `Uint8ClampedArray` index strict                           | Non-null assertion `data[i]!`                          |
| Chroma key v1: tonos de piel desaparecían      | RGB distance es impreciso para green detection             | Reescrito con HSV color space                          |
| Video decoder se pausaba                       | `opacity: 0` permite al browser pausar                     | `visibility: hidden` mantiene decoder                  |

---

## Trabajo pendiente

- [ ] Commit + push cambios de chroma key
- [ ] Configurar env vars en Vercel (Preview scope)
- [ ] Probar chroma key en testers.betaskintech.com
- [ ] Merge PR #15 después de QA
- [ ] Futuro: selector de fondos (imagen/video) — la capa z-0 ya está preparada

---

## Referencias

- [HeyGen: Change Background Guide](https://docs.liveavatar.com/docs/guides/change-background)
- [HeyGen: bg-removal-demo (oficial)](https://github.com/heygen-com/liveavatar-web-sdk/tree/master/apps/bg-removal-demo)
- [HeyGen: ElevenLabs Plugin Connector](https://docs.liveavatar.com/docs/lite-mode/connectors/elevenlabs-agent)
- [HeyGen: Create Session Token API](https://docs.liveavatar.com/api-reference/sessions/create-session-token)
- [ElevenLabs: Contextual Updates](https://elevenlabs.io/docs/eleven-agents/customization/events/client-to-server-events)
