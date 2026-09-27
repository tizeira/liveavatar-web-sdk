import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollConsultationResult } from "@/src/consultations/poll-result";
import type { ClaraConsultationResult } from "@/src/consultations/types";

const pending: ClaraConsultationResult = {
  consultationId: "fixture-a",
  status: "pending",
  summary: null,
  routine: null,
  transcript: [],
};
const routine = {
  concerns: [],
  cautions: [],
  steps: [
    {
      moment: "morning" as const,
      order: 1,
      instruction: "Fixture",
      product: null,
    },
  ],
};
const response = (result: ClaraConsultationResult) =>
  new Response(JSON.stringify(result));

describe("bounded consultation reads", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  function setup(fetcher: typeof fetch) {
    const controller = new AbortController();
    const onResult = vi.fn();
    const run = () =>
      pollConsultationResult({
        id: pending.consultationId,
        accessToken: "fixture-token",
        signal: controller.signal,
        onResult,
        fetcher,
        now: Date.now,
        budgetMs: 2_000,
        intervalMs: 500,
      });
    return { controller, onResult, run };
  }
  it("publishes a real routine before a late summary", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({ ...pending, status: "routine_ready", routine }),
      )
      .mockResolvedValueOnce(
        response({
          ...pending,
          status: "completed",
          routine,
          summary: "Resumen",
        }),
      );
    const { run, onResult } = setup(fetcher);
    const result = run();
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ routine, summary: null }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toBe("ready");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("reports pending separately from unavailable, without inventing a save", async () => {
    const fetcher = vi.fn().mockImplementation(async () => response(pending));
    const { run, onResult } = setup(fetcher);
    const result = run();
    await vi.advanceTimersByTimeAsync(2_100);
    expect(await result).toBe("pending");
    expect(onResult.mock.calls.every(([value]) => value.routine === null)).toBe(
      true,
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("keeps reading when the summary precedes the independent routine write", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({ ...pending, status: "completed", summary: "Resumen" }),
      )
      .mockResolvedValueOnce(
        response({
          ...pending,
          status: "completed",
          summary: "Resumen",
          routine,
        }),
      );
    const { run, onResult } = setup(fetcher);
    const result = run();
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "Resumen", routine: null }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toBe("ready");
    expect(onResult).toHaveBeenLastCalledWith(
      expect.objectContaining({ routine }),
    );
  });
  it("bounds summary-only reads without claiming there will never be a routine", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () =>
        response({ ...pending, status: "completed", summary: "Resumen" }),
      );
    const { run } = setup(fetcher);
    const result = run();
    await vi.advanceTimersByTimeAsync(2_100);
    expect(await result).toBe("partial");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("times out aborted requests within the whole budget", async () => {
    const fetcher = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("fixture abort")),
            { once: true },
          );
        }),
    );
    const { run } = setup(fetcher);
    const result = run();
    await vi.advanceTimersByTimeAsync(2_100);
    expect(await result).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403])(
    "does not retry expired/unauthorized access (%i)",
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
      const { run, onResult } = setup(fetcher);
      expect(await run()).toBe("unauthorized");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(onResult).not.toHaveBeenCalled();
    },
  );
  it("ignores late results after abort and clears wait timers", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const { run, onResult, controller } = setup(fetcher);
    const result = run();
    controller.abort();
    resolve(response({ ...pending, routine, summary: "Late" }));
    expect(await result).toBe("cancelled");
    expect(onResult).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never publishes another consultation and can retry a late result safely", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () =>
        response({ ...pending, consultationId: "fixture-b", routine }),
      );
    const { run, onResult } = setup(fetcher);
    const first = run();
    await vi.advanceTimersByTimeAsync(2_100);
    expect(await first).toBe("unavailable");
    expect(onResult).not.toHaveBeenCalled();
    fetcher.mockImplementation(async () =>
      response({ ...pending, summary: "Listo", routine }),
    );
    expect(await run()).toBe("ready");
  });
});
