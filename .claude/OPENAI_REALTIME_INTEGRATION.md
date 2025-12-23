# OpenAI Realtime Voice Agent Integration Plan

## Branch
```
claude/integrate-openai-voice-agent-h7m2K
```

## Objetivo
Reemplazar ElevenLabs Conversational AI con OpenAI Realtime API (GPT-4o-mini) para reducir costos ~6x manteniendo calidad.

## Comparación de Costos (10 min sesión)
| Proveedor | Costo/sesión |
|-----------|--------------|
| ElevenLabs | ~$1.00 |
| OpenAI GPT-4o-mini | ~$0.17 |

## Arquitectura

### Flujo Actual (ElevenLabs)
```
Mic (48kHz) → ElevenLabs WS → 16kHz PCM → Resample 24kHz → HeyGen
```

### Flujo Nuevo (OpenAI)
```
Mic (48kHz) → Resample 24kHz → OpenAI WS → 24kHz PCM → HeyGen (directo!)
```

**Ventaja clave**: OpenAI usa 24kHz nativo = mismo rate que HeyGen = sin resample en output.

## Archivos a Crear/Modificar

### 1. Nuevos Archivos

#### `/apps/demo/app/api/openai-realtime/route.ts`
API route para generar ephemeral tokens (client_secret).

```typescript
// Flujo:
// 1. POST /v1/realtime/sessions → obtiene client_secret
// 2. Cliente conecta WebSocket con el token
// 3. Token expira en 60s (suficiente para conectar)
```

#### `/apps/demo/src/hooks/useOpenAIRealtimeAgent.ts`
Hook principal que reemplaza `useElevenLabsAgent.ts`.

```typescript
interface UseOpenAIRealtimeAgentConfig {
  voice?: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse';
  instructions?: string;
  model?: 'gpt-4o-realtime-preview' | 'gpt-4o-mini-realtime-preview';
  onAudioData?: (audioBase64: string) => void;
  onAgentResponse?: (text: string) => void;
  onAgentResponseEnd?: () => void;
  onInterruption?: () => void;
  onUserTranscript?: (text: string) => void;
  onError?: (error: string) => void;
}
```

#### `/public/audio-worklet-processor-24k.js`
AudioWorklet optimizado para resample a 24kHz (input para OpenAI).

### 2. Archivos a Modificar

#### `/apps/demo/src/components/ClaraVoiceAgent.tsx`
- Cambiar import de `useElevenLabsAgent` a `useOpenAIRealtimeAgent`
- Eliminar lógica de resample (ya no necesaria)
- Actualizar callbacks para nuevo formato de eventos

#### `/apps/demo/.env.local`
```bash
# Existente
OPENAI_API_KEY=sk-xxx  # Ya existe!

# Nuevo (opcional, para configuración)
OPENAI_REALTIME_MODEL=gpt-4o-mini-realtime-preview
OPENAI_REALTIME_VOICE=alloy
```

## Protocolo WebSocket OpenAI

### Conexión
```
wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview
Headers: Authorization: Bearer <ephemeral_token>
```

### Client Events (enviamos)

| Evento | Cuándo | Payload |
|--------|--------|---------|
| `session.update` | Al conectar | Configuración de sesión |
| `input_audio_buffer.append` | Cada chunk de mic | `{type, audio: base64}` |
| `response.cancel` | Al interrumpir | `{type}` |

### Server Events (recibimos)

| Evento | Mapeo a callback |
|--------|------------------|
| `session.created` | Log |
| `input_audio_buffer.speech_started` | `onInterruption()` |
| `conversation.item.input_audio_transcription.completed` | `onUserTranscript()` |
| `response.audio.delta` | `onAudioData()` |
| `response.audio_transcript.delta` | `onAgentResponse()` |
| `response.audio.done` | `onAgentResponseEnd()` |
| `error` | `onError()` |

## Configuración de Sesión

```typescript
{
  type: 'session.update',
  session: {
    modalities: ['text', 'audio'],
    model: 'gpt-4o-mini-realtime-preview',
    voice: 'alloy',
    instructions: 'Eres Clara, asistente de belleza...',
    input_audio_format: 'pcm16',
    output_audio_format: 'pcm16',
    input_audio_transcription: {
      model: 'whisper-1'
    },
    turn_detection: {
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 500
    }
  }
}
```

## Pasos de Implementación

### Fase 1: Infraestructura (API + Hook base)
1. [ ] Crear `/api/openai-realtime/route.ts`
2. [ ] Crear `useOpenAIRealtimeAgent.ts` estructura base
3. [ ] Verificar OPENAI_API_KEY funciona

### Fase 2: Audio Pipeline
4. [ ] Implementar captura de micrófono a 24kHz
5. [ ] Implementar envío de audio chunks
6. [ ] Implementar recepción de audio (ya 24kHz!)

### Fase 3: Integración
7. [ ] Conectar hook con ClaraVoiceAgent
8. [ ] Remover lógica de resample innecesaria
9. [ ] Mapear eventos OpenAI → callbacks existentes

### Fase 4: Testing
10. [ ] Test conexión WebSocket
11. [ ] Test audio bidireccional
12. [ ] Test con HeyGen avatar
13. [ ] Test interrupciones
14. [ ] Test session timeout (10 min)

### Fase 5: Cleanup
15. [ ] Remover código ElevenLabs (o mantener como fallback?)
16. [ ] Actualizar documentación
17. [ ] Actualizar feature_list.json

## Diferencias Clave vs ElevenLabs

| Aspecto | ElevenLabs | OpenAI |
|---------|------------|--------|
| Audio Input | Native rate (config) | 24kHz fijo |
| Audio Output | 16kHz → resample | 24kHz directo ✓ |
| Mensaje audio | `{user_audio_chunk}` | `{type: "input_audio_buffer.append", audio}` |
| Interrupción | `interruption` event | `speech_started` event |
| Fin respuesta | `agent_response_end` | `response.audio.done` |
| Ping/Pong | Custom | No necesario |

## Rollback Plan
Si falla, revertir a ElevenLabs:
1. `git checkout master -- apps/demo/src/hooks/useElevenLabsAgent.ts`
2. `git checkout master -- apps/demo/src/components/ClaraVoiceAgent.tsx`

## Métricas de Éxito
- [ ] Latencia < 500ms (primer audio)
- [ ] Costo < $0.20 por sesión de 10 min
- [ ] Sin audio cortado
- [ ] Interrupciones funcionando
- [ ] Safari fallback mantenido

## Referencias
- [OpenAI Realtime API Guide](https://platform.openai.com/docs/guides/realtime)
- [OpenAI Realtime WebSocket](https://platform.openai.com/docs/guides/realtime-websocket)
- [OpenAI Pricing](https://openai.com/api/pricing/)
