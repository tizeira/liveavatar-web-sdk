import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ElevenLabsAgentSession,
  ElevenLabsAgentSessionError,
} from "./ElevenLabsAgentSession";
import {
  AgentControlCommandKind,
  AgentType,
  ElevenLabsAgentResponseKind,
  SessionDisconnectReason,
  SessionDiagnosticEvent,
  SessionInfo,
  SessionState,
} from "./types";
import {
  AgentEventsEnum,
  CommandEventsEnum,
  ElevenLabsAgentCommandType,
  SessionEvent,
} from "./events";
import { ConnectionState } from "livekit-client";
import { LIVEKIT_COMMAND_CHANNEL_TOPIC } from "../const";
import { mockFetch } from "../test/utils/mockFetch";
import { testContext } from "../test/utils/testContext";
import { parseAgentTypeFromToken } from "./LiveAvatarSession";

beforeEach(() => {
  vi.resetAllMocks();
});

const sessionInfoMock: SessionInfo = {
  session_id: "mock-session-id",
  max_session_duration: null,
  livekit_url: "mock-livekit-url",
  livekit_client_token: "mock-livekit-client-token",
};

const buildJwt = (payload: Record<string, any>): string => {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const body = btoa(JSON.stringify(payload))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${body}.sig`;
};

const elevenLabsToken = buildJwt({
  start_session_data: {
    mode: "LITE",
    elevenlabs_agent_config: {
      agent_id: "agent_test",
      secret_id: "secret_test",
    },
  },
});

const fullToken = buildJwt({
  start_session_data: { mode: "FULL" },
});

const setupSession = (token: string) => {
  testContext.sessionId = sessionInfoMock.session_id;
  mockFetch(
    {
      url: "/v1/sessions/start",
      method: "POST",
      response: { data: sessionInfoMock, code: 1000 },
    },
    {
      url: "/v1/sessions/stop",
      method: "POST",
      response: { code: 1000 },
    },
  );
  return new ElevenLabsAgentSession(token);
};

describe("parseAgentTypeFromToken", () => {
  it("returns ELEVENLABS for tokens with elevenlabs_agent_config", () => {
    expect(parseAgentTypeFromToken(elevenLabsToken)).toBe(
      AgentType.ELEVENLABS_AGENT,
    );
  });

  it("returns FULL for plain full-mode tokens", () => {
    expect(parseAgentTypeFromToken(fullToken)).toBe(AgentType.FULL);
  });

  it("returns UNKNOWN for non-JWT tokens", () => {
    expect(parseAgentTypeFromToken("not-a-jwt")).toBe(AgentType.UNKNOWN);
  });
});

describe("ElevenLabsAgentSession constructor", () => {
  it("constructs successfully when JWT indicates ELEVENLABS", () => {
    const session = setupSession(elevenLabsToken);
    expect(session.agentType).toBe(AgentType.ELEVENLABS_AGENT);
  });

  it("does not throw when JWT does not indicate ELEVENLABS_AGENT (validation deferred to backend)", () => {
    const session = new ElevenLabsAgentSession(fullToken);
    expect(session.agentType).toBe(AgentType.FULL);
  });
});

describe("ElevenLabsAgentSession command publishing", () => {
  it("publishes user_message wrapper to agent-control topic", async () => {
    const session = setupSession(elevenLabsToken);
    await session.start();
    const publishData = (session as any).room.localParticipant
      .publishData as ReturnType<typeof vi.fn>;
    publishData.mockClear();

    const eventId = session.sendUserMessage("hello agent");

    expect(publishData).toHaveBeenCalledTimes(1);
    const [bytes, opts] = publishData.mock.calls[0];
    expect(opts.topic).toBe(LIVEKIT_COMMAND_CHANNEL_TOPIC);
    expect(opts.reliable).toBe(true);
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    expect(payload).toMatchObject({
      event_type: CommandEventsEnum.ELEVENLABS_AGENT_COMMAND,
      session_id: sessionInfoMock.session_id,
      elevenlabs_event_type: ElevenLabsAgentCommandType.USER_MESSAGE,
      data: { text: "hello agent" },
    });
    expect(payload.event_id).toBe(eventId);
  });

  it("publishes contextual_update with text data", async () => {
    const session = setupSession(elevenLabsToken);
    await session.start();
    const publishData = (session as any).room.localParticipant
      .publishData as ReturnType<typeof vi.fn>;
    publishData.mockClear();

    session.sendContextualUpdate("user on pricing page");

    const payload = JSON.parse(
      new TextDecoder().decode(publishData.mock.calls[0][0]),
    );
    expect(payload.elevenlabs_event_type).toBe(
      ElevenLabsAgentCommandType.CONTEXTUAL_UPDATE,
    );
    expect(payload.data).toEqual({ text: "user on pricing page" });
  });

  it("waits for reliable local publish settlement before resolving", async () => {
    const session = setupSession(elevenLabsToken);
    await session.start();
    const publishData = (session as any).room.localParticipant
      .publishData as ReturnType<typeof vi.fn>;
    let settle!: () => void;
    publishData.mockImplementationOnce(
      () => new Promise<void>((resolve) => (settle = resolve)),
    );

    let resolved = false;
    const pending = session
      .sendContextualUpdateAndWait("ordered context")
      .then(() => {
        resolved = true;
      });
    await Promise.resolve();
    expect(resolved).toBe(false);

    settle();
    await pending;
    expect(resolved).toBe(true);
  });

  it("rejects the awaited command when local publish rejects", async () => {
    const session = setupSession(elevenLabsToken);
    await session.start();
    const publishData = (session as any).room.localParticipant
      .publishData as ReturnType<typeof vi.fn>;
    publishData.mockRejectedValueOnce(new Error("publish rejected"));

    await expect(session.sendUserMessageAndWait("[START]")).rejects.toThrow(
      "publish rejected",
    );
  });

  it("publishes user_activity with no data field required", async () => {
    const session = setupSession(elevenLabsToken);
    await session.start();
    const publishData = (session as any).room.localParticipant
      .publishData as ReturnType<typeof vi.fn>;
    publishData.mockClear();

    session.sendUserActivity();

    const payload = JSON.parse(
      new TextDecoder().decode(publishData.mock.calls[0][0]),
    );
    expect(payload.elevenlabs_event_type).toBe(
      ElevenLabsAgentCommandType.USER_ACTIVITY,
    );
  });

  it("publishes client_tool_result with tool_call_id, result, is_error", async () => {
    const session = setupSession(elevenLabsToken);
    await session.start();
    const publishData = (session as any).room.localParticipant
      .publishData as ReturnType<typeof vi.fn>;
    publishData.mockClear();

    session.sendClientToolResult({
      toolCallId: "tool_abc",
      result: '{"ok":true}',
      isError: false,
    });

    const payload = JSON.parse(
      new TextDecoder().decode(publishData.mock.calls[0][0]),
    );
    expect(payload.data).toEqual({
      tool_call_id: "tool_abc",
      result: '{"ok":true}',
      is_error: false,
    });
  });

  it("throws when session not connected", () => {
    const session = setupSession(elevenLabsToken);
    expect(() => session.sendUserMessage("hi")).toThrow(
      ElevenLabsAgentSessionError,
    );
  });

  it("throws on legacy LiveAvatar command methods", async () => {
    const session = setupSession(elevenLabsToken);
    await session.start();
    expect(() => session.message("hi")).toThrow(ElevenLabsAgentSessionError);
    expect(() => session.repeat("hi")).toThrow(ElevenLabsAgentSessionError);
    expect(() => session.repeatAudio("hi")).toThrow(
      ElevenLabsAgentSessionError,
    );
  });
});

describe("ElevenLabsAgentSession passive startup diagnostics", () => {
  it("observes local publish settlement and rejection without changing synchronous commands", async () => {
    const diagnostics: Array<{
      event: SessionDiagnosticEvent;
      commandKind?: AgentControlCommandKind;
    }> = [];
    const session = new ElevenLabsAgentSession(elevenLabsToken, {
      onDiagnosticEvent: (entry) => diagnostics.push(entry),
    });
    testContext.sessionId = sessionInfoMock.session_id;
    mockFetch(
      {
        url: "/v1/sessions/start",
        method: "POST",
        response: { data: sessionInfoMock, code: 1000 },
      },
      {
        url: "/v1/sessions/stop",
        method: "POST",
        response: { code: 1000 },
      },
    );
    await session.start();
    const publishData = (session as any).room.localParticipant
      .publishData as ReturnType<typeof vi.fn>;

    publishData.mockImplementationOnce(() => Promise.resolve());
    session.sendUserMessage("not logged");
    await Promise.resolve();

    publishData.mockImplementationOnce(() =>
      Promise.reject(new Error("secret")),
    );
    session.sendContextualUpdate("not logged");
    await Promise.resolve();
    await Promise.resolve();

    publishData.mockImplementationOnce(() => {
      throw new Error("secret");
    });
    expect(() => session.sendUserMessage("not logged")).toThrow("secret");

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: SessionDiagnosticEvent.ROOM_CONNECTED,
        }),
        expect.objectContaining({
          event: SessionDiagnosticEvent.AGENT_CONTROL_PUBLISH_SETTLED,
          commandKind: AgentControlCommandKind.USER_MESSAGE,
        }),
        expect.objectContaining({
          event: SessionDiagnosticEvent.AGENT_CONTROL_PUBLISH_REJECTED,
          commandKind: AgentControlCommandKind.CONTEXTUAL_UPDATE,
        }),
        expect.objectContaining({
          event: SessionDiagnosticEvent.AGENT_CONTROL_PUBLISH_REJECTED,
          commandKind: AgentControlCommandKind.USER_MESSAGE,
        }),
      ]),
    );
  });

  it("observes an allowlisted ElevenLabs event before app listeners without exposing its payload", async () => {
    const diagnostics: Array<{
      event: SessionDiagnosticEvent;
      elevenLabsResponseKind?: ElevenLabsAgentResponseKind;
    }> = [];
    const session = setupSession(elevenLabsToken);
    (session as any).config.onDiagnosticEvent = (entry: any) =>
      diagnostics.push(entry);
    await session.start();

    testContext.roomInstance._triggerDataReceived({
      event_id: "sensitive-event-id",
      event_type: AgentEventsEnum.ELEVENLABS_AGENT_EVENT,
      elevenlabs_event_type: "conversation_initiation_metadata",
      data: { conversation_id: "sensitive-conversation-id", extra: "secret" },
    });

    expect(diagnostics).toContainEqual({
      event: SessionDiagnosticEvent.ELEVENLABS_AGENT_EVENT_RECEIVED,
      elapsedMs: expect.any(Number),
      elevenLabsResponseKind:
        ElevenLabsAgentResponseKind.CONVERSATION_INITIATION_METADATA,
    });
  });

  it("ignores a throwing observer", async () => {
    const session = new ElevenLabsAgentSession(elevenLabsToken, {
      onDiagnosticEvent: () => {
        throw new Error("observer failure");
      },
    });
    testContext.sessionId = sessionInfoMock.session_id;
    mockFetch(
      {
        url: "/v1/sessions/start",
        method: "POST",
        response: { data: sessionInfoMock, code: 1000 },
      },
      { url: "/v1/sessions/stop", method: "POST", response: { code: 1000 } },
    );
    await expect(session.start()).resolves.toBeUndefined();
    expect(() => session.sendUserMessage("not logged")).not.toThrow();
  });

  it("emits the central terminal signal once for manual stop", async () => {
    const diagnostics: SessionDiagnosticEvent[] = [];
    const session = new ElevenLabsAgentSession(elevenLabsToken, {
      onDiagnosticEvent: (entry) => diagnostics.push(entry.event),
    });
    testContext.sessionId = sessionInfoMock.session_id;
    mockFetch(
      {
        url: "/v1/sessions/start",
        method: "POST",
        response: { data: sessionInfoMock, code: 1000 },
      },
      { url: "/v1/sessions/stop", method: "POST", response: { code: 1000 } },
    );
    await session.start();
    await session.stop();

    expect(
      diagnostics.filter(
        (event) => event === SessionDiagnosticEvent.SESSION_ENDED,
      ),
    ).toHaveLength(1);
  });

  it("emits the central terminal signal once when start fails even if the observer throws", async () => {
    const diagnostics: SessionDiagnosticEvent[] = [];
    mockFetch(
      {
        url: "/v1/sessions/start",
        method: "POST",
        response: { code: 4000, message: "start failed" },
      },
      { url: "/v1/sessions/stop", method: "POST", response: { code: 1000 } },
    );
    const session = new ElevenLabsAgentSession(elevenLabsToken, {
      onDiagnosticEvent: (entry) => {
        diagnostics.push(entry.event);
        throw new Error("observer failure");
      },
    });

    await expect(session.start()).rejects.toBeDefined();
    expect(
      diagnostics.filter(
        (event) => event === SessionDiagnosticEvent.SESSION_ENDED,
      ),
    ).toHaveLength(1);
  });
});

describe("ElevenLabsAgentSession unexpected room termination", () => {
  it("cleans up an unexpected disconnect once and emits the terminal diagnostic", async () => {
    const diagnostics: SessionDiagnosticEvent[] = [];
    const session = new ElevenLabsAgentSession(elevenLabsToken, {
      onDiagnosticEvent: (entry) => diagnostics.push(entry.event),
    });
    testContext.sessionId = sessionInfoMock.session_id;
    mockFetch(
      {
        url: "/v1/sessions/start",
        method: "POST",
        response: { data: sessionInfoMock, code: 1000 },
      },
      { url: "/v1/sessions/stop", method: "POST", response: { code: 1000 } },
    );
    const onDisconnected = vi.fn();
    session.on(SessionEvent.SESSION_DISCONNECTED, onDisconnected);

    await session.start();
    testContext.roomInstance._triggerDisconnected();
    await Promise.resolve();

    expect(session.state).toBe(SessionState.DISCONNECTED);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(onDisconnected).toHaveBeenCalledWith(
      SessionDisconnectReason.UNKNOWN_REASON,
    );
    expect(
      diagnostics.filter(
        (event) => event === SessionDiagnosticEvent.SESSION_ENDED,
      ),
    ).toHaveLength(1);
    expect(
      diagnostics.filter(
        (event) => event === SessionDiagnosticEvent.ROOM_DISCONNECTED,
      ),
    ).toHaveLength(1);
    expect(testContext.roomInstance.disconnect).toHaveBeenCalledTimes(1);
  });

  it("ends once when LiveKit reconnect attempts are exhausted", async () => {
    const diagnostics: SessionDiagnosticEvent[] = [];
    const session = new ElevenLabsAgentSession(elevenLabsToken, {
      onDiagnosticEvent: (entry) => diagnostics.push(entry.event),
    });
    testContext.sessionId = sessionInfoMock.session_id;
    mockFetch(
      {
        url: "/v1/sessions/start",
        method: "POST",
        response: { data: sessionInfoMock, code: 1000 },
      },
      { url: "/v1/sessions/stop", method: "POST", response: { code: 1000 } },
    );
    const onDisconnected = vi.fn();
    session.on(SessionEvent.SESSION_DISCONNECTED, onDisconnected);

    await session.start();
    testContext.roomInstance._triggerConnectionStateChanged(
      ConnectionState.Reconnecting,
    );
    testContext.roomInstance._triggerConnectionStateChanged(
      ConnectionState.SignalReconnecting,
    );
    testContext.roomInstance._triggerDisconnected();
    // A second terminal notification after cleanup must not restart cleanup or
    // publish a duplicate client terminal event.
    testContext.roomInstance._triggerDisconnected();
    await Promise.resolve();

    expect(session.state).toBe(SessionState.DISCONNECTED);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(
      diagnostics.filter(
        (event) => event === SessionDiagnosticEvent.SESSION_ENDED,
      ),
    ).toHaveLength(1);
    expect(testContext.roomInstance.disconnect).toHaveBeenCalledTimes(1);
  });
});
