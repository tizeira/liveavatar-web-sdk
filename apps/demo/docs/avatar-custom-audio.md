# Guía Técnica: Integración de Audio Personalizado con HeyGen LiveAvatar

## Tabla de Contenidos

1. [Introducción y Conceptos Fundamentales](#1-introducción-y-conceptos-fundamentales)

2. [Requisitos Previos y Configuración](#2-requisitos-previos-y-configuración)

3. [Implementación Técnica Paso a Paso](#3-implementación-técnica-paso-a-paso)

4. [Ejemplos de Código Funcionales](#4-ejemplos-de-código-funcionales)

5. [Aspectos Técnicos Avanzados](#5-aspectos-técnicos-avanzados)

6. [Troubleshooting y Solución de Problemas](#6-troubleshooting-y-solución-de-problemas)

7. [Referencias y Recursos](#7-referencias-y-recursos)

---

## 1. Introducción y Conceptos Fundamentales

### 1.1 ¿Qué es HeyGen LiveAvatar?

HeyGen LiveAvatar (anteriormente conocido como Streaming Avatar / Interactive Avatar) es una API que permite crear avatares de video en tiempo real con sincronización labial (lip sync). El sistema renderiza un avatar que puede hablar con audio generado o personalizado.

> **Nota de Migración**: HeyGen está deprecando "Interactive Avatar" en favor de "LiveAvatar". Esta guía usa el SDK más reciente: `@heygen/liveavatar-web-sdk`.

### 1.2 Arquitectura del Sistema

```

┌─────────────────────────────────────────────────────────────────────────┐

│                        ARQUITECTURA LIVEAVATAR                          │

├─────────────────────────────────────────────────────────────────────────┤

│                                                                          │

│   CLIENTE (Browser)                    SERVIDOR (HeyGen)                │

│   ┌──────────────────┐                ┌──────────────────┐              │

│   │  LiveAvatarSession│◄──LiveKit────►│  Avatar Renderer │              │

│   │                  │   (WebRTC)     │                  │              │

│   │  - VoiceChat     │                │  - Lip Sync      │              │

│   │  - Commands      │◄──WebSocket───►│  - Video Stream  │              │

│   │  - Events        │                │  - Audio Mixing  │              │

│   └──────────────────┘                └──────────────────┘              │

│                                                                          │

│   Protocolos:                                                           │

│   • LiveKit (WebRTC): Video/Audio bidireccional                         │

│   • WebSocket: Comandos y eventos (agent.speak, interrupt, etc.)        │

│                                                                          │

└─────────────────────────────────────────────────────────────────────────┘

```

### 1.3 Modos de Operación

| Modo | Descripción | Uso de Audio |

|------|-------------|--------------|

| **FULL** | HeyGen maneja STT → LLM → TTS | Audio interno de HeyGen |

| **CUSTOM** | Desarrollador controla el pipeline | Audio externo personalizado |

**Para audio personalizado, debes usar el modo `CUSTOM`.**

### 1.4 Flujo de Lip Sync con Audio Personalizado

```

┌────────────────────────────────────────────────────────────────────────┐

│                    FLUJO DE LIP SYNC - MODO CUSTOM                      │

├────────────────────────────────────────────────────────────────────────┤

│                                                                         │

│  1. Tu Fuente de Audio (ElevenLabs, OpenAI, archivo, etc.)             │

│           │                                                             │

│           ▼                                                             │

│  2. Conversión a PCM 16-bit 24kHz                                      │

│           │                                                             │

│           ▼                                                             │

│  3. Codificación Base64                                                │

│           │                                                             │

│           ▼                                                             │

│  4. session.repeatAudio(base64Audio)                                   │

│           │                                                             │

│           ▼                                                             │

│  5. WebSocket envía chunks de 20ms                                     │

│           │                                                             │

│           ▼                                                             │

│  6. HeyGen analiza audio → genera lip sync                             │

│           │                                                             │

│           ▼                                                             │

│  7. Avatar renderiza video sincronizado                                │

│           │                                                             │

│           ▼                                                             │

│  8. Video stream vía LiveKit/WebRTC al cliente                         │

│                                                                         │

└────────────────────────────────────────────────────────────────────────┘

```

---

## 2. Requisitos Previos y Configuración

### 2.1 Obtención de API Key

1. Crear cuenta en [HeyGen](https://www.heygen.com/)

2. Acceder al [Dashboard de API](https://app.heygen.com/settings/api)

3. Generar API Key con permisos para LiveAvatar

```typescript
// secrets.ts

export const API_KEY = "tu_heygen_api_key";

export const API_URL = "https://api.liveavatar.com";
```

### 2.2 Dependencias

```json
{
  "dependencies": {
    "@heygen/liveavatar-web-sdk": "^0.0.9",

    "livekit-client": "^2.0.0"
  }
}
```

### 2.3 Límites y Cuotas

| Parámetro | Valor |

|-----------|-------|

| Duración máxima de sesión | Configurable (ver `max_session_duration`) |

| Formato de audio | PCM 16-bit signed, 24kHz, mono |

| Tamaño de chunk | 960 bytes (20ms de audio) |

| Latencia típica | 200-500ms |

### 2.4 Avatares Disponibles

Los avatares se identifican por `avatar_id`. Puedes obtener la lista de avatares disponibles desde el dashboard de HeyGen o la API.

```typescript
// Ejemplo de avatar IDs

export const AVATAR_ID_MOBILE = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";

export const AVATAR_ID_DESKTOP = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";
```

---

## 3. Implementación Técnica Paso a Paso

### 3.1 Paso 1: Obtener Token de Sesión (Backend)

```typescript
// app/api/start-custom-session/route.ts

import { API_KEY, API_URL, AVATAR_ID } from "../secrets";

export async function POST() {
  try {
    const res = await fetch(`${API_URL}/v1/sessions/token`, {
      method: "POST",

      headers: {
        "X-API-KEY": API_KEY,

        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        mode: "CUSTOM", // ⚠️ IMPORTANTE: Usar CUSTOM para audio personalizado

        avatar_id: AVATAR_ID,
      }),
    });

    if (!res.ok) {
      const error = await res.json();

      return Response.json({ error: error.message }, { status: res.status });
    }

    const data = await res.json();

    return Response.json({
      session_token: data.data.session_token,

      session_id: data.data.session_id,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
```

### 3.2 Paso 2: Inicializar Sesión (Frontend)

```typescript
// Crear instancia de LiveAvatarSession

import { LiveAvatarSession } from "@heygen/liveavatar-web-sdk";

const session = new LiveAvatarSession(sessionToken, {
  voiceChat: false, // Desactivar VoiceChat interno para CUSTOM mode

  apiUrl: "https://api.liveavatar.com",
});

// Iniciar sesión

await session.start();
```

### 3.3 Paso 3: Conectar Video al DOM

```typescript
// Esperar a que el stream esté listo

session.on(SessionEvent.SESSION_STREAM_READY, () => {
  const videoElement = document.getElementById(
    "avatar-video",
  ) as HTMLVideoElement;

  session.attach(videoElement);
});
```

### 3.4 Paso 4: Enviar Audio Personalizado

```typescript
/**

 * Enviar audio para lip sync

 * @param audioBase64 - Audio en formato PCM 16-bit 24kHz, codificado en Base64

 */

function sendCustomAudio(audioBase64: string) {
  session.repeatAudio(audioBase64);
}
```

---

## 4. Ejemplos de Código Funcionales

### 4.1 Implementación Completa Básica

```typescript
// CustomAvatarSession.ts

import {
  LiveAvatarSession,
  SessionEvent,
  SessionState,
  AgentEventsEnum,
} from "@heygen/liveavatar-web-sdk";

export class CustomAvatarSession {
  private session: LiveAvatarSession | null = null;

  private videoElement: HTMLVideoElement;

  constructor(videoElement: HTMLVideoElement) {
    this.videoElement = videoElement;
  }

  async start(): Promise<void> {
    // 1. Obtener token del backend

    const response = await fetch("/api/start-custom-session", {
      method: "POST",
    });

    const { session_token } = await response.json();

    // 2. Crear sesión

    this.session = new LiveAvatarSession(session_token, {
      voiceChat: false,
    });

    // 3. Configurar event listeners

    this.setupEventListeners();

    // 4. Iniciar sesión

    await this.session.start();
  }

  private setupEventListeners(): void {
    if (!this.session) return;

    // Stream listo

    this.session.on(SessionEvent.SESSION_STREAM_READY, () => {
      console.log("✅ Stream ready");

      this.session!.attach(this.videoElement);
    });

    // Estado de sesión

    this.session.on(SessionEvent.SESSION_STATE_CHANGED, (state) => {
      console.log("📍 Session state:", state);
    });

    // Avatar empezó a hablar

    this.session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, (event) => {
      console.log("🎤 Avatar speaking started:", event.event_id);
    });

    // Avatar terminó de hablar

    this.session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, (event) => {
      console.log("🔇 Avatar speaking ended:", event.event_id);
    });

    // Desconexión

    this.session.on(SessionEvent.SESSION_DISCONNECTED, (reason) => {
      console.log("❌ Session disconnected:", reason);
    });
  }

  /**

   * Enviar audio personalizado al avatar

   * El audio debe estar en formato: PCM 16-bit signed, 24kHz, mono, Base64

   */

  sendAudio(audioBase64: string): void {
    if (!this.session || this.session.state !== SessionState.CONNECTED) {
      console.warn("Session not connected");

      return;
    }

    this.session.repeatAudio(audioBase64);
  }

  /**

   * Interrumpir al avatar mientras habla

   */

  interrupt(): void {
    if (this.session) {
      this.session.interrupt();
    }
  }

  /**

   * Detener sesión

   */

  async stop(): Promise<void> {
    if (this.session) {
      await this.session.stop();

      this.session = null;
    }
  }
}
```

### 4.2 Integración con ElevenLabs TTS

```typescript
// ElevenLabsIntegration.ts

const ELEVENLABS_API_KEY = "tu_elevenlabs_api_key";

const ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

/**

 * Generar audio con ElevenLabs y enviarlo al avatar

 */

async function speakWithElevenLabs(
  text: string,

  avatarSession: CustomAvatarSession,
): Promise<void> {
  // 1. Llamar a ElevenLabs API

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/with-timestamps?output_format=pcm_24000`,

    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",

        "xi-api-key": ELEVENLABS_API_KEY,
      },

      body: JSON.stringify({ text }),
    },
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs API error: ${response.status}`);
  }

  const data = await response.json();

  // 2. El audio ya viene en Base64 con formato PCM 24kHz

  const audioBase64 = data.audio_base64;

  // 3. Enviar al avatar

  avatarSession.sendAudio(audioBase64);
}
```

### 4.3 Conversión de Audio desde Otros Formatos

```typescript
// AudioConverter.ts

/**

 * Convertir ArrayBuffer de audio a Base64 string

 */

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  let binary = "";

  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

/**

 * Convertir audio WebM/Opus a PCM 24kHz

 * Requiere Web Audio API

 */

async function convertToPCM24k(audioBlob: Blob): Promise<string> {
  const audioContext = new AudioContext({ sampleRate: 24000 });

  // Decodificar audio

  const arrayBuffer = await audioBlob.arrayBuffer();

  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // Obtener datos mono

  const channelData = audioBuffer.getChannelData(0);

  // Convertir Float32 a Int16

  const pcm16 = new Int16Array(channelData.length);

  for (let i = 0; i < channelData.length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));

    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  // Convertir a Base64

  return arrayBufferToBase64(pcm16.buffer);
}
```

### 4.4 Streaming de Audio en Chunks

```typescript
// AudioStreamer.ts

/**

 * Dividir audio PCM en chunks de 20ms para streaming

 * Cada chunk: 480 samples * 2 bytes = 960 bytes

 */

function splitPcmToChunks(pcmBase64: string): string[] {
  const BYTES_PER_CHUNK = 960; // 20ms @ 24kHz mono 16-bit

  const chunks: string[] = [];

  for (let i = 0; i < pcmBase64.length; i += BYTES_PER_CHUNK) {
    chunks.push(pcmBase64.slice(i, i + BYTES_PER_CHUNK));
  }

  return chunks;
}

/**

 * Enviar audio en streaming con timing preciso

 */

async function streamAudioToAvatar(
  audioBase64: string,

  session: LiveAvatarSession,
): Promise<void> {
  const chunks = splitPcmToChunks(audioBase64);

  const CHUNK_DURATION_MS = 20;

  for (const chunk of chunks) {
    session.repeatAudio(chunk);

    await new Promise((resolve) => setTimeout(resolve, CHUNK_DURATION_MS));
  }
}
```

---

## 5. Aspectos Técnicos Avanzados

### 5.1 Especificaciones de Audio

| Parámetro | Valor Requerido | Notas |

|-----------|-----------------|-------|

| **Formato** | PCM (raw) | No comprimido |

| **Bits por sample** | 16-bit signed | Little-endian |

| **Sample rate** | 24,000 Hz | Exactamente 24kHz |

| **Canales** | Mono (1 canal) | Stereo no soportado |

| **Codificación** | Base64 | Para transmisión WebSocket |

### 5.2 Cálculo de Tamaño de Chunks

```

Fórmula:

  samples_por_segundo = 24000

  bytes_por_sample = 2 (16-bit)

  duracion_chunk = 0.02 segundos (20ms)



  samples_por_chunk = 24000 * 0.02 = 480 samples

  bytes_por_chunk = 480 * 2 = 960 bytes

```

### 5.3 Eventos del Sistema

#### Eventos de Sesión (SessionEvent)

| Evento | Descripción |

|--------|-------------|

| `SESSION_STATE_CHANGED` | Estado de conexión cambió |

| `SESSION_STREAM_READY` | Video/audio tracks disponibles |

| `SESSION_CONNECTION_QUALITY_CHANGED` | Calidad de conexión cambió |

| `SESSION_DISCONNECTED` | Sesión terminada |

#### Eventos del Agente (AgentEventsEnum)

| Evento | Descripción |

|--------|-------------|

| `AVATAR_SPEAK_STARTED` | Avatar comenzó a hablar |

| `AVATAR_SPEAK_ENDED` | Avatar terminó de hablar |

| `USER_SPEAK_STARTED` | Usuario comenzó a hablar |

| `USER_SPEAK_ENDED` | Usuario terminó de hablar |

| `USER_TRANSCRIPTION` | Transcripción del usuario |

| `AVATAR_TRANSCRIPTION` | Transcripción del avatar |

#### Comandos Disponibles (CommandEventsEnum)

| Comando | Descripción | Método SDK |

|---------|-------------|------------|

| `AVATAR_SPEAK_AUDIO` | Enviar audio personalizado | `repeatAudio()` |

| `AVATAR_SPEAK_TEXT` | Avatar habla texto (TTS interno) | `repeat()` |

| `AVATAR_INTERRUPT` | Interrumpir al avatar | `interrupt()` |

| `AVATAR_START_LISTENING` | Activar escucha | `startListening()` |

| `AVATAR_STOP_LISTENING` | Desactivar escucha | `stopListening()` |

### 5.4 Protocolo WebSocket Interno

El SDK maneja automáticamente el protocolo WebSocket. Internamente, los mensajes tienen esta estructura:

```typescript

// Envío de audio

{

  type: "agent.speak",

  event_id: "uuid-único",

  audio: "base64_chunk..."

}



// Fin de audio

{

  type: "agent.speak_end",

  event_id: "uuid-único"

}



// Interrupción

{

  type: "agent.interrupt",

  event_id: "uuid-único"

}

```

### 5.5 Optimización de Latencia

```typescript
// Configuración para baja latencia

const optimizedConfig = {
  voiceChat: false, // Desactivar si no se usa

  apiUrl: "https://api.liveavatar.com",
};

// Tips para reducir latencia:

// 1. Usar streaming en chunks en lugar de enviar todo el audio junto

// 2. Pre-generar audio cuando sea posible

// 3. Usar CDN cercano geográficamente

// 4. Implementar buffer de jitter
```

---

## 6. Troubleshooting y Solución de Problemas

### 6.1 Problemas Comunes de Lip Sync

| Problema | Causa | Solución |

|----------|-------|----------|

| Labios no se mueven | Formato de audio incorrecto | Verificar PCM 16-bit 24kHz |

| Desincronización | Chunks muy grandes | Usar chunks de 20ms (960 bytes) |

| Audio cortado | Conexión inestable | Implementar buffer/retry |

| Sin audio | Base64 malformado | Verificar codificación |

### 6.2 Verificación de Formato de Audio

```typescript
function validateAudioFormat(audioBase64: string): boolean {
  try {
    // Decodificar Base64

    const binary = atob(audioBase64);

    const bytes = binary.length;

    // Verificar que sea múltiplo de 2 (16-bit samples)

    if (bytes % 2 !== 0) {
      console.error("Audio length not multiple of 2 bytes");

      return false;
    }

    // Verificar tamaño razonable (al menos 20ms)

    const MIN_BYTES = 960; // 20ms

    if (bytes < MIN_BYTES) {
      console.warn("Audio muy corto, puede causar problemas");
    }

    return true;
  } catch (e) {
    console.error("Invalid Base64:", e);

    return false;
  }
}
```

### 6.3 Debug de Conexión

```typescript
// Habilitar logs detallados

session.on(SessionEvent.SESSION_STATE_CHANGED, (state) => {
  console.log(`[DEBUG] State: ${state}`);

  console.log(`[DEBUG] Connection Quality: ${session.connectionQuality}`);
});

session.on(SessionEvent.SESSION_DISCONNECTED, (reason) => {
  console.error(`[DEBUG] Disconnected: ${reason}`);

  // Razones posibles:

  // - CLIENT_INITIATED: Usuario cerró sesión

  // - SESSION_START_FAILED: Error al iniciar

  // - UNKNOWN_REASON: Error de red/servidor
});
```

### 6.4 Errores de API Comunes

| Código | Error | Solución |

|--------|-------|----------|

| 401 | Unauthorized | Verificar API Key |

| 403 | Forbidden | Verificar permisos/cuota |

| 429 | Too Many Requests | Implementar rate limiting |

| 500 | Server Error | Reintentar con backoff |

---

## 7. Referencias y Recursos

### 7.1 Documentación Oficial

- [HeyGen API Documentation](https://docs.heygen.com/)

- [Streaming Avatar SDK](https://docs.heygen.com/docs/streaming-avatar-sdk)

- [SDK Reference](https://docs.heygen.com/docs/streaming-avatar-sdk-reference)

- [WSS Audio to Video API (Beta)](https://docs.heygen.com/reference/heygen-interactive-avatar-realtime-api)

### 7.2 Repositorios Oficiales

- [LiveAvatar Web SDK](https://github.com/HeyGen-Official/liveavatar-web-sdk)

- [StreamingAvatarSDK (Legacy)](https://github.com/HeyGen-Official/StreamingAvatarSDK)

- [Interactive Avatar Demo](https://github.com/HeyGen-Official/InteractiveAvatarNextJSDemo)

- [Pipecat Realtime Demo](https://github.com/HeyGen-Official/pipecat-realtime-demo)

### 7.3 Integraciones Soportadas

- [Livekit Agents](https://livekit.io/agents)

- [Pipecat](https://github.com/pipecat-ai/pipecat)

- [ElevenLabs TTS](https://elevenlabs.io/docs/api-reference/text-to-speech)

- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)

### 7.4 Comunidad

- [HeyGen Community Hub](https://community.heygen.com/)

- [Interactive Avatar Users Forum](https://community.heygen.com/public/clubs/interactive-avatar-users-8lp)

---

## Apéndice A: Ejemplo Completo React + ElevenLabs

```typescript

// ClaraWithElevenLabs.tsx



import { useState, useRef, useCallback, useEffect } from "react";

import { LiveAvatarSession, SessionEvent, SessionState } from "@heygen/liveavatar-web-sdk";



interface Props {

  elevenLabsAgentId: string;

}



export function ClaraWithElevenLabs({ elevenLabsAgentId }: Props) {

  const [isConnected, setIsConnected] = useState(false);

  const [isSpeaking, setIsSpeaking] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  const sessionRef = useRef<LiveAvatarSession | null>(null);

  const elevenLabsWsRef = useRef<WebSocket | null>(null);



  // Iniciar sesión completa

  const startSession = useCallback(async () => {

    // 1. Obtener token de HeyGen

    const res = await fetch("/api/start-custom-session", { method: "POST" });

    const { session_token } = await res.json();



    // 2. Crear sesión LiveAvatar

    const session = new LiveAvatarSession(session_token, { voiceChat: false });

    sessionRef.current = session;



    // 3. Event listeners

    session.on(SessionEvent.SESSION_STREAM_READY, () => {

      if (videoRef.current) {

        session.attach(videoRef.current);

      }

      setIsConnected(true);



      // 4. Conectar a ElevenLabs Agent

      connectElevenLabs();

    });



    await session.start();

  }, [elevenLabsAgentId]);



  // Conectar a ElevenLabs Conversational AI

  const connectElevenLabs = useCallback(() => {

    const ws = new WebSocket(

      `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${elevenLabsAgentId}`

    );

    elevenLabsWsRef.current = ws;



    ws.onmessage = (event) => {

      const data = JSON.parse(event.data);



      // Recibir audio del agente

      if (data.audio) {

        setIsSpeaking(true);

        sessionRef.current?.repeatAudio(data.audio);

      }



      if (data.type === "agent_response_ended") {

        setIsSpeaking(false);

      }

    };

  }, [elevenLabsAgentId]);



  // Cleanup

  useEffect(() => {

    return () => {

      sessionRef.current?.stop();

      elevenLabsWsRef.current?.close();

    };

  }, []);



  return (

    <div>

      <video ref={videoRef} autoPlay playsInline />

      {!isConnected ? (

        <button onClick={startSession}>Start Clara</button>

      ) : (

        <div>

          {isSpeaking ? "🎤 Clara speaking..." : "👂 Listening..."}

        </div>

      )}

    </div>

  );

}

```

---

## Apéndice B: Matriz de Compatibilidad

| Fuente de Audio | Formato Nativo | Conversión Necesaria | Compatibilidad |

|-----------------|----------------|---------------------|----------------|

| ElevenLabs (pcm_24000) | PCM 24kHz 16-bit | Ninguna | ✅ Directa |

| OpenAI Realtime | PCM 24kHz 16-bit | Ninguna | ✅ Directa |

| OpenAI TTS | MP3/Opus | Sí (decode + resample) | ⚠️ Requiere conversión |

| Web Audio API | Float32 | Sí (Int16 conversion) | ⚠️ Requiere conversión |

| MediaRecorder | WebM/Opus | Sí (full decode) | ⚠️ Requiere conversión |

| Archivo WAV | PCM variable | Depende del sample rate | ⚠️ Verificar formato |

---

_Última actualización: Diciembre 2024_

_Basado en: @heygen/liveavatar-web-sdk v0.0.9_
@
