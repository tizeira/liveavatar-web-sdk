import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseConsultation } from "@/src/consultations/release";
describe("interrupted consultation release", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("retries transient offline/503 failures and confirms only released:true", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        Response.json({ released: false }, { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json({ released: true }));
    const result = releaseConsultation("test", "test-only");
    await vi.runAllTimersAsync();
    expect(await result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.every(
        ([url]) => url === "/api/consultations/test/release",
      ),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not retry unauthorized close", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    expect(await releaseConsultation("test", "test-only")).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("bounds stalled fetches and never claims success", async () => {
    fetchMock.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const result = releaseConsultation("test", "test-only");
    await vi.runAllTimersAsync();
    expect(await result).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not accept an unsuccessful JSON body as confirmation", async () => {
    fetchMock.mockResolvedValue(Response.json({ released: false }));
    const result = releaseConsultation("test", "test-only");
    await vi.runAllTimersAsync();
    expect(await result).toBe(false);
  });
  it("bounds malformed successful responses without reporting a release", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response("not-json")),
    );
    const result = releaseConsultation("test", "test-only");
    await vi.runAllTimersAsync();
    expect(await result).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
