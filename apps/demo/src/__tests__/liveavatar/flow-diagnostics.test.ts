import { describe, expect, it, vi } from "vitest";
import {
  AgentControlCommandKind,
  SessionDiagnosticEvent,
} from "@heygen/liveavatar-web-sdk";
import {
  ClaraFlowDiagnosticEvent,
  ClaraFlowDiagnostics,
} from "@/src/liveavatar/flow-diagnostics";

const traceId = "5b393e83-1c19-4f25-b85a-bbd3815b4c01";

describe("ClaraFlowDiagnostics", () => {
  it.each([
    { enabled: false, traceId },
    { enabled: true, traceId: "private-data-not-a-trace" },
  ])("does not log disabled or invalid traces (%j)", (options) => {
    const log = vi.fn();
    const diagnostics = new ClaraFlowDiagnostics({ ...options, log });
    diagnostics.mark(ClaraFlowDiagnosticEvent.MEDIA_PLAYING);
    diagnostics.observeSdk({
      event: SessionDiagnosticEvent.ROOM_CONNECTED,
      elapsedMs: 1,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("pauses across effect cleanup and resumes without creating call actions", () => {
    const log = vi.fn();
    const diagnostics = new ClaraFlowDiagnostics({
      enabled: true,
      traceId,
      log,
    });
    diagnostics.suspend();
    diagnostics.mark(ClaraFlowDiagnosticEvent.MEDIA_PLAYING);
    expect(log).not.toHaveBeenCalled();
    diagnostics.resume();
    diagnostics.observeAgentEvent(ClaraFlowDiagnosticEvent.USER_SPEAK_ENDED);
    diagnostics.observeAgentEvent(
      ClaraFlowDiagnosticEvent.AVATAR_SPEAK_STARTED,
    );
    expect(log.mock.calls.map(([entry]) => entry.event)).toEqual([
      "user_speak_ended",
      "avatar_speak_started",
    ]);
  });
  it("uses monotonic supplied milestones and strips unallowlisted payload data", () => {
    const log = vi.fn();
    const diagnostics = new ClaraFlowDiagnostics({
      enabled: true,
      traceId,
      startedAt: 100,
      now: () => 150,
      log,
    });
    diagnostics.mark(ClaraFlowDiagnosticEvent.SESSION_START_REQUESTED, 100);
    diagnostics.mark(ClaraFlowDiagnosticEvent.SESSION_TOKEN_RECEIVED, 125);
    diagnostics.mark("customer text" as ClaraFlowDiagnosticEvent, 130);
    diagnostics.observeSdk({
      event: SessionDiagnosticEvent.AGENT_CONTROL_PUBLISH_ATTEMPTED,
      elapsedMs: 7,
      commandKind: AgentControlCommandKind.USER_MESSAGE,
      secret: "must-not-log",
    } as unknown as Parameters<ClaraFlowDiagnostics["observeSdk"]>[0]);

    expect(log.mock.calls.map(([record]) => record.elapsedMs)).toEqual([
      0, 25, 50,
    ]);
    expect(log).toHaveBeenLastCalledWith({
      traceId,
      event: SessionDiagnosticEvent.AGENT_CONTROL_PUBLISH_ATTEMPTED,
      sequence: 3,
      elapsedMs: 50,
      sdkElapsedMs: 7,
      commandKind: AgentControlCommandKind.USER_MESSAGE,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("must-not-log");
  });

  it("keeps the first terminal evidence after the bounded event budget", () => {
    const log = vi.fn();
    const diagnostics = new ClaraFlowDiagnostics({
      enabled: true,
      traceId,
      log,
    });
    const agentEvents = [
      ClaraFlowDiagnosticEvent.USER_SPEAK_STARTED,
      ClaraFlowDiagnosticEvent.USER_SPEAK_ENDED,
      ClaraFlowDiagnosticEvent.AVATAR_SPEAK_STARTED,
      ClaraFlowDiagnosticEvent.AVATAR_SPEAK_ENDED,
    ];
    for (let index = 0; index < 48; index += 1) {
      diagnostics.observeAgentEvent(agentEvents[index % agentEvents.length]!);
    }
    diagnostics.observeSdk({
      event: SessionDiagnosticEvent.SESSION_ENDED,
      elapsedMs: 99,
    });

    expect(log).toHaveBeenCalledTimes(49);
    expect(log).toHaveBeenLastCalledWith(
      expect.objectContaining({ event: SessionDiagnosticEvent.SESSION_ENDED }),
    );
  });

  it("bounds repeated events, isolates logging failures, and ignores late events after cleanup", () => {
    const log = vi.fn(() => {
      throw new Error("observer failure");
    });
    const diagnostics = new ClaraFlowDiagnostics({
      enabled: true,
      traceId,
      now: () => 1,
      log,
    });
    expect(() => {
      for (let index = 0; index < 25; index += 1) {
        diagnostics.observeSdk({
          event: SessionDiagnosticEvent.AVATAR_SPEAK_STARTED,
          elapsedMs: index,
        });
      }
      diagnostics.observeSdk({
        event: SessionDiagnosticEvent.SESSION_ENDED,
        elapsedMs: 11,
      });
      diagnostics.observeSdk({
        event: SessionDiagnosticEvent.AVATAR_SPEAK_ENDED,
        elapsedMs: 12,
      });
    }).not.toThrow();
    expect(log).toHaveBeenCalledTimes(21);
    diagnostics.suspend();
    diagnostics.observeSdk({
      event: SessionDiagnosticEvent.ROOM_CONNECTED,
      elapsedMs: 13,
    });
    expect(log).toHaveBeenCalledTimes(21);
  });
});
