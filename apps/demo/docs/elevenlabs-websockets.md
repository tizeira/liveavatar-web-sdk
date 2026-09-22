---
title: WebSocket
subtitle: "Create real-time, interactive voice conversations with AI agents"
---

<Note>
  This documentation is for developers integrating directly with the ElevenLabs WebSocket API. For
  convenience, consider using [the official SDKs provided by
  ElevenLabs](/docs/agents-platform/libraries/python).
</Note>

The ElevenLabs [Agents Platform](https://elevenlabs.io/agents) WebSocket API enables real-time, interactive voice conversations with AI agents. By establishing a WebSocket connection, you can send audio input and receive audio responses in real-time, creating life-like conversational experiences.

<Note>Endpoint: `wss://api.elevenlabs.io/v1/convai/conversation?agent_id={agent_id}`</Note>

## Authentication

### Using Agent ID

For public agents, you can directly use the `agent_id` in the WebSocket URL without additional authentication:

```bash
wss://api.elevenlabs.io/v1/convai/conversation?agent_id=<your-agent-id>
```

### Using a signed URL

For private agents or conversations requiring authorization, obtain a signed URL from your server, which securely communicates with the ElevenLabs API using your API key.

### Example using cURL

**Request:**

```bash
curl -X GET "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=<your-agent-id>" \
     -H "xi-api-key: <your-api-key>"
```

**Response:**

```json
{
  "signed_url": "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=<your-agent-id>&token=<token>"
}
```

<Warning>Never expose your ElevenLabs API key on the client side.</Warning>

## WebSocket events

### Client to server events

The following events can be sent from the client to the server:

<AccordionGroup>
  <Accordion title="Contextual Updates">
    Send non-interrupting contextual information to update the conversation state. This allows you to provide additional context without disrupting the ongoing conversation flow.

    ```javascript
    {
      "type": "contextual_update",
      "text": "User clicked on pricing page"
    }
    ```

    **Use cases:**
    - Updating user status or preferences
    - Providing environmental context
    - Adding background information
    - Tracking user interface interactions

    **Key points:**
    - Does not interrupt current conversation flow
    - Updates are incorporated as tool calls in conversation history
    - Helps maintain context without breaking the natural dialogue

    <Note>
      Contextual updates are processed asynchronously and do not require a direct response from the server.
    </Note>

  </Accordion>
</AccordionGroup>

<Card
title="WebSocket API Reference"
icon="code"
iconPosition="left"
href="/docs/agents-platform/api-reference/agents-platform/websocket"

> See the ElevenLabs Agents WebSocket API reference documentation for detailed message structures,
> parameters, and examples.
> </Card>

## Next.js implementation example

This example demonstrates how to implement a WebSocket-based conversational agent client in Next.js using the ElevenLabs WebSocket API.

<Note>
  While this example uses the `voice-stream` package for microphone input handling, you can
  implement your own solution for capturing and encoding audio. The focus here is on demonstrating
  the WebSocket connection and event handling with the ElevenLabs API.
</Note>

<Steps>
  <Step title="Install required dependencies">
    First, install the necessary packages:

    ```bash
    npm install voice-stream
    ```

    The `voice-stream` package handles microphone access and audio streaming, automatically encoding the audio in base64 format as required by the ElevenLabs API.

    <Note>
      This example uses Tailwind CSS for styling. To add Tailwind to your Next.js project:
      ```bash
      npm install -D tailwindcss postcss autoprefixer
      npx tailwindcss init -p
      ```

      Then follow the [official Tailwind CSS setup guide for Next.js](https://tailwindcss.com/docs/guides/nextjs).

      Alternatively, you can replace the className attributes with your own CSS styles.
    </Note>

  </Step>

  <Step title="Create WebSocket types">
    Define the types for WebSocket events:

    ```typescript app/types/websocket.ts
    type BaseEvent = {
      type: string;
    };

    type UserTranscriptEvent = BaseEvent & {
      type: "user_transcript";
      user_transcription_event: {
        user_transcript: string;
      };
    };

    type AgentResponseEvent = BaseEvent & {
      type: "agent_response";
      agent_response_event: {
        agent_response: string;
      };
    };

    type AgentResponseCorrectionEvent = BaseEvent & {
      type: "agent_response_correction";
      agent_response_correction_event: {
        original_agent_response: string;
        corrected_agent_response: string;
      };
    };

    type AudioResponseEvent = BaseEvent & {
      type: "audio";
      audio_event: {
        audio_base_64: string;
        event_id: number;
      };
    };

    type InterruptionEvent = BaseEvent & {
      type: "interruption";
      interruption_event: {
        reason: string;
      };
    };

    type PingEvent = BaseEvent & {
      type: "ping";
      ping_event: {
        event_id: number;
        ping_ms?: number;
      };
    };

    export type ElevenLabsWebSocketEvent =
      | UserTranscriptEvent
      | AgentResponseEvent
      | AgentResponseCorrectionEvent
      | AudioResponseEvent
      | InterruptionEvent
      | PingEvent;
    ```

  </Step>

  <Step title="Create WebSocket hook">
    Create a custom hook to manage the WebSocket connection:

    ```typescript app/hooks/useAgentConversation.ts
    'use client';

    import { useCallback, useEffect, useRef, useState } from 'react';
    import { useVoiceStream } from 'voice-stream';
    import type { ElevenLabsWebSocketEvent } from '../types/websocket';

    const sendMessage = (websocket: WebSocket, request: object) => {
      if (websocket.readyState !== WebSocket.OPEN) {
        return;
      }
      websocket.send(JSON.stringify(request));
    };

    export const useAgentConversation = () => {
      const websocketRef = useRef<WebSocket>(null);
      const [isConnected, setIsConnected] = useState<boolean>(false);

      const { startStreaming, stopStreaming } = useVoiceStream({
        onAudioChunked: (audioData) => {
          if (!websocketRef.current) return;
          sendMessage(websocketRef.current, {
            user_audio_chunk: audioData,
          });
        },
      });

      const startConversation = useCallback(async () => {
        if (isConnected) return;

        const websocket = new WebSocket("wss://api.elevenlabs.io/v1/convai/conversation");

        websocket.onopen = async () => {
          setIsConnected(true);
          sendMessage(websocket, {
            type: "conversation_initiation_client_data",
          });
          await startStreaming();
        };

        websocket.onmessage = async (event) => {
          const data = JSON.parse(event.data) as ElevenLabsWebSocketEvent;

          // Handle ping events to keep connection alive
          if (data.type === "ping") {
            setTimeout(() => {
              sendMessage(websocket, {
                type: "pong",
                event_id: data.ping_event.event_id,
              });
            }, data.ping_event.ping_ms);
          }

          if (data.type === "user_transcript") {
            const { user_transcription_event } = data;
            console.log("User transcript", user_transcription_event.user_transcript);
          }

          if (data.type === "agent_response") {
            const { agent_response_event } = data;
            console.log("Agent response", agent_response_event.agent_response);
          }

          if (data.type === "agent_response_correction") {
            const { agent_response_correction_event } = data;
            console.log("Agent response correction", agent_response_correction_event.corrected_agent_response);
          }

          if (data.type === "interruption") {
            // Handle interruption
          }

          if (data.type === "audio") {
            const { audio_event } = data;
            // Implement your own audio playback system here
            // Note: You'll need to handle audio queuing to prevent overlapping
            // as the WebSocket sends audio events in chunks
          }
        };

        websocketRef.current = websocket;

        websocket.onclose = async () => {
          websocketRef.current = null;
          setIsConnected(false);
          stopStreaming();
        };
      }, [startStreaming, isConnected, stopStreaming]);

      const stopConversation = useCallback(async () => {
        if (!websocketRef.current) return;
        websocketRef.current.close();
      }, []);

      useEffect(() => {
        return () => {
          if (websocketRef.current) {
            websocketRef.current.close();
          }
        };
      }, []);

      return {
        startConversation,
        stopConversation,
        isConnected,
      };
    };
    ```

  </Step>

  <Step title="Create the conversation component">
    Create a component to use the WebSocket hook:

    ```typescript app/components/Conversation.tsx
    'use client';

    import { useCallback } from 'react';
    import { useAgentConversation } from '../hooks/useAgentConversation';

    export function Conversation() {
      const { startConversation, stopConversation, isConnected } = useAgentConversation();

      const handleStart = useCallback(async () => {
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true });
          await startConversation();
        } catch (error) {
          console.error('Failed to start conversation:', error);
        }
      }, [startConversation]);

      return (
        <div className="flex flex-col items-center gap-4">
          <div className="flex gap-2">
            <button
              onClick={handleStart}
              disabled={isConnected}
              className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
            >
              Start Conversation
            </button>
            <button
              onClick={stopConversation}
              disabled={!isConnected}
              className="px-4 py-2 bg-red-500 text-white rounded disabled:bg-gray-300"
            >
              Stop Conversation
            </button>
          </div>
          <div className="flex flex-col items-center">
            <p>Status: {isConnected ? 'Connected' : 'Disconnected'}</p>
          </div>
        </div>
      );
    }
    ```

  </Step>
</Steps>

## Next steps

1. **Audio Playback**: Implement your own audio playback system using Web Audio API or a library. Remember to handle audio queuing to prevent overlapping as the WebSocket sends audio events in chunks.
2. **Error Handling**: Add retry logic and error recovery mechanisms
3. **UI Feedback**: Add visual indicators for voice activity and connection status

## Latency management

To ensure smooth conversations, implement these strategies:

- **Adaptive Buffering:** Adjust audio buffering based on network conditions.
- **Jitter Buffer:** Implement a jitter buffer to smooth out variations in packet arrival times.
- **Ping-Pong Monitoring:** Use ping and pong events to measure round-trip time and adjust accordingly.

## Security best practices

- Rotate API keys regularly and use environment variables to store them.
- Implement rate limiting to prevent abuse.
- Clearly explain the intention when prompting users for microphone access.
- Optimized Chunking: Tweak the audio chunk duration to balance latency and efficiency.

## Additional resources

- [ElevenLabs Agents Documentation](/docs/agents-platform/overview)
- [ElevenLabs Agents SDKs](/docs/agents-platform/libraries/python)

---

# Agent WebSockets

GET /v1/convai/conversation

Establish a WebSocket connection for real-time conversations with an AI agent.

Reference: https://elevenlabs.io/docs/agents-platform/api-reference/agents-platform/websocket

## AsyncAPI Specification

```yaml
asyncapi: 2.6.0
info:
  title: V 1 Convai Conversation
  version: subpackage_v1ConvaiConversation.v1ConvaiConversation
  description: >-
    Establish a WebSocket connection for real-time conversations with an AI
    agent.
channels:
  /v1/convai/conversation:
    description: >-
      Establish a WebSocket connection for real-time conversations with an AI
      agent.
    bindings:
      ws:
        query:
          type: object
          properties:
            agent_id:
              description: Any type
    publish:
      operationId: v-1-convai-conversation-publish
      summary: subscribe
      description: >-
        Defines the message types that can be received by the client from the
        server
      message:
        name: subscribe
        title: subscribe
        description: >-
          Defines the message types that can be received by the client from the
          server
        payload:
          $ref: "#/components/schemas/V1ConvaiConversationSubscribe"
    subscribe:
      operationId: v-1-convai-conversation-subscribe
      summary: publish
      description: Defines the message types that can be sent from client to server
      message:
        name: publish
        title: publish
        description: Defines the message types that can be sent from client to server
        payload:
          $ref: "#/components/schemas/V1ConvaiConversationPublish"
servers:
  Production:
    url: wss://api.elevenlabs.io/
    protocol: wss
    x-default: true
  Production-US:
    url: wss://api.us.elevenlabs.io/
    protocol: wss
  Production-EU:
    url: wss://api.eu.residency.elevenlabs.io/
    protocol: wss
  Production-India:
    url: wss://api.in.residency.elevenlabs.io/
    protocol: wss
components:
  schemas:
    ConversationInitiationMetadataConversationInitiationMetadataEvent:
      type: object
      properties:
        conversation_id:
          type: string
          description: Unique identifier for the conversation session.
        agent_output_audio_format:
          type: string
          description: Audio format specification for agent's speech output.
        user_input_audio_format:
          type: string
          description: Audio format specification for user's speech input.
    ConversationInitiationMetadata:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: conversation_initiation_metadata
        conversation_initiation_metadata_event:
          $ref: >-
            #/components/schemas/ConversationInitiationMetadataConversationInitiationMetadataEvent
          description: Initial conversation metadata
    UserTranscriptUserTranscriptionEvent:
      type: object
      properties:
        user_transcript:
          type: string
          description: Transcribed text from user's speech input.
    UserTranscript:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: user_transcript
        user_transcription_event:
          $ref: "#/components/schemas/UserTranscriptUserTranscriptionEvent"
          description: Transcription event data
    AgentResponseAgentResponseEvent:
      type: object
      properties:
        agent_response:
          type: string
          description: Text content of the agent's response.
      required:
        - agent_response
    AgentResponse:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: agent_response
        agent_response_event:
          $ref: "#/components/schemas/AgentResponseAgentResponseEvent"
          description: Agent response event data
      required:
        - type
    AgentResponseCorrectionAgentResponseCorrectionEvent:
      type: object
      properties:
        original_agent_response:
          type: string
          description: The original agent response before correction
        corrected_agent_response:
          type: string
          description: The corrected agent response after truncation or interruption
      required:
        - original_agent_response
        - corrected_agent_response
    AgentResponseCorrection:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: agent_response_correction
        agent_response_correction_event:
          $ref: >-
            #/components/schemas/AgentResponseCorrectionAgentResponseCorrectionEvent
          description: Agent response correction event data
      required:
        - type
    AudioResponseAudioEvent:
      type: object
      properties:
        audio_base_64:
          type: string
          description: Base64-encoded audio data of agent's speech.
        event_id:
          type: integer
          description: Sequential identifier for the audio chunk.
    AudioResponse:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: audio
        audio_event:
          $ref: "#/components/schemas/AudioResponseAudioEvent"
          description: Audio event data
      required:
        - type
    InterruptionInterruptionEvent:
      type: object
      properties:
        event_id:
          type: integer
          description: ID of the event that was interrupted.
    Interruption:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: interruption
        interruption_event:
          $ref: "#/components/schemas/InterruptionInterruptionEvent"
          description: Interruption event data
      required:
        - type
    PingPingEvent:
      type: object
      properties:
        event_id:
          type: integer
          description: Unique identifier for the ping event.
        ping_ms:
          type: integer
          description: Measured round-trip latency in milliseconds.
    Ping:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: ping
        ping_event:
          $ref: "#/components/schemas/PingPingEvent"
          description: Ping event data
      required:
        - type
    ClientToolCallClientToolCall:
      type: object
      properties:
        tool_name:
          type: string
          description: Identifier of the tool to be executed.
        tool_call_id:
          type: string
          description: Unique identifier for this tool call request.
        parameters:
          type: object
          additionalProperties:
            description: Any type
          description: Tool-specific parameters for the execution request.
    ClientToolCall:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: client_tool_call
        client_tool_call:
          $ref: "#/components/schemas/ClientToolCallClientToolCall"
          description: Tool call request data
      required:
        - type
    ContextualUpdate:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: contextual_update
        text:
          type: string
          description: Contextual information to be added to the conversation state.
      required:
        - type
        - text
    VadScoreVadScoreEvent:
      type: object
      properties:
        vad_score:
          type: number
          format: double
          description: Voice activity detection confidence score between 0 and 1
      required:
        - vad_score
    VadScore:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: vad_score
        vad_score_event:
          $ref: "#/components/schemas/VadScoreVadScoreEvent"
          description: VAD event data
      required:
        - type
    InternalTentativeAgentResponseTentativeAgentResponseInternalEvent:
      type: object
      properties:
        tentative_agent_response:
          type: string
          description: Preliminary text from the agent
      required:
        - tentative_agent_response
    InternalTentativeAgentResponse:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: internal_tentative_agent_response
        tentative_agent_response_internal_event:
          $ref: >-
            #/components/schemas/InternalTentativeAgentResponseTentativeAgentResponseInternalEvent
          description: Preliminary event data containing agent's tentative response
      required:
        - type
    V1ConvaiConversationSubscribe:
      oneOf:
        - $ref: "#/components/schemas/ConversationInitiationMetadata"
        - $ref: "#/components/schemas/UserTranscript"
        - $ref: "#/components/schemas/AgentResponse"
        - $ref: "#/components/schemas/AgentResponseCorrection"
        - $ref: "#/components/schemas/AudioResponse"
        - $ref: "#/components/schemas/Interruption"
        - $ref: "#/components/schemas/Ping"
        - $ref: "#/components/schemas/ClientToolCall"
        - $ref: "#/components/schemas/ContextualUpdate"
        - $ref: "#/components/schemas/VadScore"
        - $ref: "#/components/schemas/InternalTentativeAgentResponse"
    UserAudioChunk:
      type: object
      properties:
        user_audio_chunk:
          type: string
          description: Base64-encoded audio data chunk from user input.
    Pong:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: pong
        event_id:
          type: integer
          description: The ID of the ping event being responded to.
      required:
        - type
    ConversationInitiationClientDataConversationConfigOverrideAgentPrompt:
      type: object
      properties:
        prompt:
          type: string
          description: Custom system prompt to guide agent behavior.
        llm:
          type: string
          description: The LLM to query with the prompt and the chat history.
    ConversationInitiationClientDataConversationConfigOverrideAgent:
      type: object
      properties:
        prompt:
          $ref: >-
            #/components/schemas/ConversationInitiationClientDataConversationConfigOverrideAgentPrompt
          description: System prompt configuration
        first_message:
          type: string
          description: Initial message the agent should use to start the conversation.
        language:
          type: string
          description: Preferred language code for the conversation.
    ConversationInitiationClientDataConversationConfigOverrideTts:
      type: object
      properties:
        voice_id:
          type: string
          description: ID of the voice to use for text-to-speech synthesis.
        speed:
          type: number
          format: double
          description: The speed of generated speech, between 0.7 and 1.2.
        stability:
          type: number
          format: double
          description: The stability of generated speech, between 0.0 and 1.0.
        similarity_boost:
          type: number
          format: double
          description: The similarity boost for generated speech, between 0.0 and 1.0.
    ConversationInitiationClientDataConversationConfigOverride:
      type: object
      properties:
        agent:
          $ref: >-
            #/components/schemas/ConversationInitiationClientDataConversationConfigOverrideAgent
          description: Configuration for the AI agent's behavior
        tts:
          $ref: >-
            #/components/schemas/ConversationInitiationClientDataConversationConfigOverrideTts
          description: Text-to-speech configuration
    ConversationInitiationClientDataCustomLlmExtraBody:
      type: object
      properties:
        temperature:
          type: number
          format: double
          description: Temperature parameter controlling response randomness.
        max_tokens:
          type: integer
          description: Maximum number of tokens allowed in LLM responses.
    ConversationInitiationClientDataDynamicVariables:
      oneOf:
        - type: string
        - type: number
          format: double
        - type: integer
        - type: boolean
    ConversationInitiationClientData:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: conversation_initiation_client_data
        conversation_config_override:
          $ref: >-
            #/components/schemas/ConversationInitiationClientDataConversationConfigOverride
          description: Override settings for conversation behavior
        custom_llm_extra_body:
          $ref: >-
            #/components/schemas/ConversationInitiationClientDataCustomLlmExtraBody
          description: Additional LLM configuration parameters
        dynamic_variables:
          type: object
          additionalProperties:
            $ref: >-
              #/components/schemas/ConversationInitiationClientDataDynamicVariables
          description: >-
            Dictionary of dynamic variables to be used in the conversation. Keys
            are the dynamic variable names which must be strings, values can be
            strings, numbers, integers, or booleans.
      required:
        - type
    ClientToolResult:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: client_tool_result
        tool_call_id:
          type: string
          description: Unique identifier of the tool call being responded to.
        result:
          type: string
          description: Result data from the tool execution.
        is_error:
          type: boolean
          description: Flag indicating if the tool execution encountered an error.
      required:
        - type
    UserMessage:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: user_message
        text:
          type: string
          description: Text message content from the user.
      required:
        - type
    UserActivity:
      type: object
      properties:
        type:
          type: string
          enum:
            - type: stringLiteral
              value: user_activity
      required:
        - type
    V1ConvaiConversationPublish:
      oneOf:
        - $ref: "#/components/schemas/UserAudioChunk"
        - $ref: "#/components/schemas/Pong"
        - $ref: "#/components/schemas/ConversationInitiationClientData"
        - $ref: "#/components/schemas/ClientToolResult"
        - $ref: "#/components/schemas/ContextualUpdate"
        - $ref: "#/components/schemas/UserMessage"
        - $ref: "#/components/schemas/UserActivity"
```
