import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  release: vi.fn(),
  context: vi.fn().mockResolvedValue({
    shopifyCustomerKey: "test-buyer",
    accessTokenHash: "test-hash",
  }),
}));
vi.mock("@/src/consultations/repository", () => ({
  getClaraConsultationAccessContext: mocks.context,
}));
vi.mock("@/src/consultations/security", () => ({
  verifyConsultationAccessToken: vi.fn().mockReturnValue(true),
}));
vi.mock("@/src/lib/clara-buyer-access", () => ({
  releaseClaraBuyerSession: mocks.release,
}));
const { POST } = await import("@/app/api/consultations/[id]/release/route");
describe("release result", () => {
  it("returns a retryable error when the access lookup database is unavailable", async () => {
    mocks.context.mockRejectedValueOnce(new Error("private DB details"));
    const response = await POST(
      new NextRequest("http://localhost/api/release", {
        method: "POST",
        headers: { "x-consultation-token": "test-only" },
      }),
      {
        params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
      },
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private DB details");
  });
  it.each([true, false])(
    "does not invent success when persistence returns %s",
    async (released) => {
      mocks.release.mockResolvedValueOnce(released);
      const response = await POST(
        new NextRequest("http://localhost/api/consultations/test/release", {
          method: "POST",
          headers: { "x-consultation-token": "test-only" },
        }),
        {
          params: Promise.resolve({
            id: "11111111-1111-4111-8111-111111111111",
          }),
        },
      );
      expect(response.status).toBe(released ? 200 : 503);
      expect((await response.json()).released).toBe(released);
    },
  );
});
