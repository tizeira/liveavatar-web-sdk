Cómo funciona el SDK LiveAvatar
Arquitectura del SDK
┌─────────────────────────────────────────────────────────────────┐
│ LiveAvatarSession │
├─────────────────────────────────────────────────────────────────┤
│ │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│ │ LiveKit │ │ WebSocket │ │ VoiceChat │ │
│ │ Room │ │ Events │ │ (Micrófono) │ │
│ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ │
│ │ │ │ │
│ ▼ ▼ ▼ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ HeyGen Avatar Server │ │
│ │ - Recibe audio del micrófono (LiveKit) │ │
│ │ - Procesa comandos (WebSocket) │ │
│ │ - Envía video/audio del avatar (LiveKit) │ │
│ └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

Métodos clave para CUSTOM mode:
Método Descripción
repeatAudio(base64) Envía audio PCM 24kHz para que el avatar hable
interrupt() Interrumpe al avatar
startListening() Avatar escucha (para STT interno)
stopListening() Avatar deja de escuchar
Formato de Audio Requerido:
PCM 16-bit signed
24kHz mono
Base64 encoded
Integración con ElevenLabs Agents
Arquitectura Propuesta:

┌─────────────────────────────────────────────────────────────────┐
│ BROWSER │
├─────────────────────────────────────────────────────────────────┤
│ │
│ ┌────────────────┐ ┌────────────────┐ │
│ │ Micrófono │ │ LiveAvatar │ │
│ │ getUserMedia │ │ Session │ │
│ └───────┬────────┘ └───────▲────────┘ │
│ │ │ │
│ ▼ │ │
│ ┌────────────────────────────────────────────┴────────┐ │
│ │ ElevenLabs Agent WebSocket │ │
│ │ wss://api.elevenlabs.io/v1/convai/conversation │ │
│ │ │ │
│ │ Input: Audio chunks (base64) del micrófono │ │
│ │ Output: Audio chunks (base64) de respuesta │ │
│ │ → avatar.repeatAudio(chunk) │ │
│ └──────────────────────────────────────────────────────┘ │
│ │
│ El VoiceChat de LiveKit se DESACTIVA │
│ ElevenLabs maneja TODO el flujo de conversación │
│ │
└─────────────────────────────────────────────────────────────────┘
Flujo de eventos:

1. Usuario inicia sesión → LiveAvatar CUSTOM mode (sin voiceChat)
2. Se conecta WebSocket a ElevenLabs Agent
3. Usuario habla → Micrófono captura audio
4. Audio → ElevenLabs WebSocket (base64 chunks)
5. ElevenLabs procesa: STT → LLM → TTS
6. ElevenLabs envía audio chunks de respuesta
7. Cada chunk → avatar.repeatAudio(chunk)
8. Avatar sincroniza labios con el audio

Código conceptual:
// 1. Iniciar sesión CUSTOM (sin voice chat interno)
const session = new LiveAvatarSession(token, {
voiceChat: false // Desactivar VoiceChat de LiveKit
});
await session.start();

// 2. Conectar a ElevenLabs Agent
const elevenLabsWs = new WebSocket(
`wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`
);

// 3. Capturar micrófono manualmente
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const mediaRecorder = new MediaRecorder(stream);

mediaRecorder.ondataavailable = (e) => {
// Convertir a base64 y enviar a ElevenLabs
const reader = new FileReader();
reader.onloadend = () => {
elevenLabsWs.send(JSON.stringify({
user_audio_chunk: reader.result.split(',')[1]
}));
};
reader.readAsDataURL(e.data);
};

// 4. Recibir audio de ElevenLabs y enviarlo al avatar
elevenLabsWs.onmessage = (event) => {
const data = JSON.parse(event.data);

if (data.audio) {
// Audio chunk de la respuesta del agente
session.repeatAudio(data.audio); // Sincroniza con avatar
}

if (data.type === 'agent_response_started') {
// Agente empezó a responder
}

if (data.type === 'agent_response_ended') {
// Agente terminó de responder
}
};

Lo que necesitas para que funcione:

1. Configuración de ElevenLabs Agent
   // En secrets.ts
   export const ELEVENLABS_AGENT_ID = "tu_agent_id";

Crear el agente en ElevenLabs Dashboard:

Configurar LLM (GPT-4, Claude, etc.)
Configurar voz
Configurar system prompt 2. Modificar start-session para CUSTOM mode
El modo CUSTOM no activa el pipeline interno de HeyGen, solo renderiza el avatar.

3. Servicio de WebSocket Bridge
   Necesitas un servicio que:

Capture audio del micrófono
Lo envíe a ElevenLabs
Reciba las respuestas
Las envíe al avatar via repeatAudio()
¿Quieres que implemente esta integración?
Necesitaré:

Tu ELEVENLABS_AGENT_ID (lo creas en el dashboard de ElevenLabs)
Confirmar si quieres streaming completo o por turnos
