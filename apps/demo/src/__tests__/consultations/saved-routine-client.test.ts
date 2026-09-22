import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadSavedRoutine,
  resolveRoutineProposal,
} from "@/src/components/SavedRoutinePanel";

afterEach(() => vi.unstubAllGlobals());
describe("saved routine reading", () => {
  it("reads independently of a paid conversation without client identity parameters", async () => {
    const result = {
      routine: {
        concerns: [],
        cautions: [],
        steps: [
          {
            moment: "morning",
            order: 1,
            instruction: "Aplicar",
            product: null,
          },
        ],
      },
      consultationDate: "2026-09-19T12:00:00Z",
      pendingProposal: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => result });
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    expect(await loadSavedRoutine(signal)).toEqual(result);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/consultations/saved-routine",
      { method: "GET", credentials: "same-origin", cache: "no-store", signal },
    );
  });
  it("distinguishes an empty collection from an unavailable service", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          routine: null,
          consultationDate: null,
          pendingProposal: null,
        }),
      }),
    );
    expect(
      (await loadSavedRoutine(new AbortController().signal)).routine,
    ).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );
    await expect(
      loadSavedRoutine(new AbortController().signal),
    ).rejects.toThrow("esto no significa que se haya borrado");
  });
  it("resolves a proposal without exposing buyer identity parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await resolveRoutineProposal(
      "51bcaeed-9e1b-4c75-ad05-7b23fbd9d46f",
      "confirm",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/consultations/saved-routine",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: expect.stringContaining('"action":"confirm"'),
      }),
    );
  });
  it("asks for a fresh Shopify entry when access expired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    await expect(
      loadSavedRoutine(new AbortController().signal),
    ).rejects.toThrow("Volvé a entrar desde Shopify");
  });
});
