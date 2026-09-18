import { describe, expect, it, vi } from "vitest";
import {
  AgentControlCommandKind,
  ElevenLabsAgentResponseKind,
  SessionDiagnosticEvent,
  VoiceChatState,
} from "@heygen/liveavatar-web-sdk";
import {
  ClaraStartupDiagnosticEvent,
  ClaraStartupDiagnostics,
  shouldEnableClaraStartupDiagnostics,
  STARTUP_GREETING_TIMEOUT_MS,
  STARTUP_METADATA_TIMEOUT_MS,
} from "@/src/liveavatar/startup-diagnostics";

describe("ClaraStartupDiagnostics", () => {
  it("records metadata before the greeting attempt and clears both timeouts on evidence", () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const diagnostics = new ClaraStartupDiagnostics({
      enabled: true,
      log,
      readVoiceChat: () => ({ state: VoiceChatState.ACTIVE, muted: true }),
    });

    diagnostics.observe({
      event: SessionDiagnosticEvent.ROOM_CONNECTED,
      elapsedMs: 10,
    });
    diagnostics.observe({
      event: SessionDiagnosticEvent.ELEVENLABS_AGENT_EVENT_RECEIVED,
      elapsedMs: 11,
      elevenLabsResponseKind:
        ElevenLabsAgentResponseKind.CONVERSATION_INITIATION_METADATA,
    });
    diagnostics.observe({
      event: SessionDiagnosticEvent.AGENT_CONTROL_PUBLISH_ATTEMPTED,
      elapsedMs: 12,
      commandKind: AgentControlCommandKind.USER_MESSAGE,
    });
    diagnostics.observe({
      event: SessionDiagnosticEvent.AVATAR_SPEAK_STARTED,
      elapsedMs: 13,
    });
    vi.advanceTimersByTime(STARTUP_GREETING_TIMEOUT_MS + STARTUP_METADATA_TIMEOUT_MS);

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: SessionDiagnosticEvent.ELEVENLABS_AGENT_EVENT_RECEIVED,
        sequence: expect.any(Number),
        voiceChatState: VoiceChatState.ACTIVE,
        muted: true,
      }),
    );
    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: ClaraStartupDiagnosticEvent.METADATA_MISSING_TIMEOUT,
      }),
    );
    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: ClaraStartupDiagnosticEvent.GREETING_MISSING_TIMEOUT,
      }),
    );
    vi.useRealTimers();
  });

  it("reports missing metadata and greeting only after their relevant milestones", () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const diagnostics = new ClaraStartupDiagnostics({ enabled: true, log });
    diagnostics.observe({
      event: SessionDiagnosticEvent.ROOM_CONNECTED,
      elapsedMs: 0,
    });
    vi.advanceTimersByTime(STARTUP_METADATA_TIMEOUT_MS);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ClaraStartupDiagnosticEvent.METADATA_MISSING_TIMEOUT,
      }),
    );
    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: ClaraStartupDiagnosticEvent.GREETING_MISSING_TIMEOUT,
      }),
    );

    diagnostics.observe({
      event: SessionDiagnosticEvent.AGENT_CONTROL_PUBLISH_ATTEMPTED,
      elapsedMs: 20,
      commandKind: AgentControlCommandKind.USER_MESSAGE,
    });
    vi.advanceTimersByTime(STARTUP_GREETING_TIMEOUT_MS);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ClaraStartupDiagnosticEvent.GREETING_MISSING_TIMEOUT,
      }),
    );
    vi.useRealTimers();
  });

  it("does not emit late timeout or payload data after dispose", () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const diagnostics = new ClaraStartupDiagnostics({ enabled: true, log });
    diagnostics.observe({
      event: SessionDiagnosticEvent.ROOM_CONNECTED,
      elapsedMs: 0,
    });
    diagnostics.dispose();
    vi.advanceTimersByTime(STARTUP_GREETING_TIMEOUT_MS + STARTUP_METADATA_TIMEOUT_MS);
    diagnostics.observe({
      event: "malicious-event" as SessionDiagnosticEvent,
      elapsedMs: Number.NaN,
      commandKind: "customer secret" as AgentControlCommandKind,
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("customer secret");
    vi.useRealTimers();
  });

  it("does not arm false timeouts when metadata and avatar speech arrive before room_connected", () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const diagnostics = new ClaraStartupDiagnostics({ enabled: true, log });
    diagnostics.observe({
      event: SessionDiagnosticEvent.ELEVENLABS_AGENT_EVENT_RECEIVED,
      elapsedMs: 1,
      elevenLabsResponseKind:
        ElevenLabsAgentResponseKind.CONVERSATION_INITIATION_METADATA,
    });
    diagnostics.observe({
      event: SessionDiagnosticEvent.AVATAR_SPEAK_STARTED,
      elapsedMs: 2,
    });
    diagnostics.observe({
      event: SessionDiagnosticEvent.ROOM_CONNECTED,
      elapsedMs: 3,
    });
    diagnostics.observe({
      event: SessionDiagnosticEvent.AGENT_CONTROL_PUBLISH_ATTEMPTED,
      elapsedMs: 4,
      commandKind: AgentControlCommandKind.USER_MESSAGE,
    });
    vi.advanceTimersByTime(STARTUP_GREETING_TIMEOUT_MS + STARTUP_METADATA_TIMEOUT_MS);

    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: ClaraStartupDiagnosticEvent.METADATA_MISSING_TIMEOUT,
      }),
    );
    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: ClaraStartupDiagnosticEvent.GREETING_MISSING_TIMEOUT,
      }),
    );
    vi.useRealTimers();
  });

  it("whitelists active entries and terminal SESSION_ENDED cancels timers and late signals", () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const diagnostics = new ClaraStartupDiagnostics({ enabled: true, log });
    diagnostics.observe({
      event: SessionDiagnosticEvent.ROOM_CONNECTED,
      elapsedMs: 1,
      unexpected: "customer secret",
    } as unknown as Parameters<ClaraStartupDiagnostics["observe"]>[0]);
    diagnostics.observe({
      event: "not-an-enum",
      elapsedMs: 2,
      commandKind: "secret",
    } as unknown as Parameters<ClaraStartupDiagnostics["observe"]>[0]);
    diagnostics.observe({
      event: SessionDiagnosticEvent.AGENT_CONTROL_PUBLISH_ATTEMPTED,
      elapsedMs: 3,
      commandKind: AgentControlCommandKind.USER_MESSAGE,
    });
    diagnostics.observe({
      event: SessionDiagnosticEvent.SESSION_ENDED,
      elapsedMs: 4,
    });
    diagnostics.observe({
      event: SessionDiagnosticEvent.AVATAR_SPEAK_STARTED,
      elapsedMs: 5,
    });
    vi.advanceTimersByTime(STARTUP_GREETING_TIMEOUT_MS + STARTUP_METADATA_TIMEOUT_MS);

    expect(log).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(log.mock.calls)).not.toContain("customer secret");
    expect(JSON.stringify(log.mock.calls)).not.toContain("not-an-enum");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    vi.useRealTimers();
  });

  it("survives throwing log and snapshot callbacks, and can resume after an effect replay", () => {
    vi.useFakeTimers();
    const diagnostics = new ClaraStartupDiagnostics({
      enabled: true,
      log: () => {
        throw new Error("do not expose");
      },
      readVoiceChat: () => {
        throw new Error("do not expose");
      },
    });
    expect(() =>
      diagnostics.observe({
        event: SessionDiagnosticEvent.ROOM_CONNECTED,
        elapsedMs: 0,
      }),
    ).not.toThrow();
    diagnostics.suspend();
    diagnostics.resume();
    expect(() => vi.advanceTimersByTime(STARTUP_METADATA_TIMEOUT_MS)).not.toThrow();
    vi.useRealTimers();
  });
});

describe("shouldEnableClaraStartupDiagnostics", () => {
  it("keeps production off even if the QA hostname is supplied", () => {
    expect(
      shouldEnableClaraStartupDiagnostics({
        nodeEnv: "production",
        vercelEnv: "production",
        hostname: "testers.betaskintech.com",
      }),
    ).toBe(false);
  });

  it("allows preview and local development", () => {
    expect(
      shouldEnableClaraStartupDiagnostics({
        nodeEnv: "production",
        vercelEnv: "preview",
      }),
    ).toBe(true);
    expect(shouldEnableClaraStartupDiagnostics({ nodeEnv: "development" })).toBe(
      true,
    );
  });
});
