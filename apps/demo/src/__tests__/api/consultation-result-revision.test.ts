import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ read: vi.fn(), verify: vi.fn() }));
vi.mock("@/src/consultations/repository", () => ({
  getClaraConsultation: mocks.read,
}));
vi.mock("@/src/consultations/security", () => ({
  verifyConsultationAccessToken: mocks.verify,
}));
const { GET } = await import("@/app/api/consultations/[id]/route");
describe("protected consultation revision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockReturnValue(true);
    mocks.read.mockResolvedValue({
      consultationId: "fixture-a",
      status: "pending",
      summary: null,
      routine: null,
      transcript: [],
      accessTokenHash: "not-public",
      routineRevision: "2026-09-27T12:00:00.000Z",
    });
  });
  const read = () =>
    GET(
      new NextRequest("http://localhost/api/consultations/fixture-a", {
        headers: { "x-consultation-token": "fixture" },
      }),
      { params: Promise.resolve({ id: "fixture-a" }) },
    );
  it("exposes the revision only alongside an authorized private result", async () => {
    const response = await read();
    const body = await response.json();
    expect(body.routineRevision).toBe("2026-09-27T12:00:00.000Z");
    expect(body).not.toHaveProperty("accessTokenHash");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not expose a revision when authorization fails", async () => {
    mocks.verify.mockReturnValue(false);
    const response = await read();
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("routineRevision");
  });
});
