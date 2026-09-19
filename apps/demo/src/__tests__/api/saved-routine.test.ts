import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  readBuyerTicket: vi.fn(),
  deriveTesterKey: vi.fn(),
  getSavedRoutine: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/app/api/secrets", () => ({
  SHOPIFY_HMAC_SECRET: "test-shopify-secret-hmac-key-here",
}));
vi.mock("@/src/lib/clara-buyer-access", () => ({
  CLARA_BUYER_COOKIE_NAME: "clara_buyer_access",
  readClaraBuyerTicket: mocks.readBuyerTicket,
  deriveAuthenticatedTesterKey: mocks.deriveTesterKey,
}));
vi.mock("@/src/consultations/repository", () => ({
  getSavedClaraRoutine: mocks.getSavedRoutine,
}));

const { GET } = await import("@/app/api/consultations/saved-routine/route");

function request(cookie?: string) {
  return new NextRequest("http://localhost/api/consultations/saved-routine", {
    headers:
      cookie === undefined
        ? undefined
        : { cookie: `clara_buyer_access=${cookie}` },
  });
}

describe("GET /api/consultations/saved-routine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(null);
    mocks.readBuyerTicket.mockResolvedValue(null);
    mocks.getSavedRoutine.mockResolvedValue({
      routine: null,
      consultationDate: null,
    });
  });

  it("rejects missing or tampered buyer cookies without querying routines", async () => {
    for (const cookie of [undefined, "tampered", ""]) {
      const response = await GET(request(cookie));
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.getSavedRoutine).not.toHaveBeenCalled();
  });

  it("does not fall back to a QA identity when a supplied buyer ticket is invalid", async () => {
    mocks.auth.mockResolvedValue({ user: { email: "tester@example.com" } });

    for (const cookie of ["tampered", ""]) {
      const response = await GET(request(cookie));
      expect(response.status).toBe(401);
    }
    expect(mocks.deriveTesterKey).not.toHaveBeenCalled();
    expect(mocks.getSavedRoutine).not.toHaveBeenCalled();
  });

  it("queries only the authenticated buyer scope", async () => {
    mocks.readBuyerTicket.mockResolvedValue({ buyerKey: "buyer-a" });
    mocks.getSavedRoutine.mockResolvedValue({
      routine: { concerns: [], cautions: [], steps: [{ instruction: "Paso" }] },
      consultationDate: "2026-09-01T10:00:00.000Z",
    });

    const response = await GET(request("valid-ticket"));
    expect(response.status).toBe(200);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.getSavedRoutine).toHaveBeenCalledWith("buyer-a");
  });

  it("uses the same authenticated tester-key fallback as session startup", async () => {
    mocks.auth.mockResolvedValue({ user: { email: "tester@example.com" } });
    mocks.deriveTesterKey.mockReturnValue("tester-key");

    await GET(request());

    expect(mocks.deriveTesterKey).toHaveBeenCalledWith(
      "tester@example.com",
      expect.any(String),
    );
    expect(mocks.getSavedRoutine).toHaveBeenCalledWith("tester-key");
  });

  it("returns only the routine and consultation date", async () => {
    mocks.readBuyerTicket.mockResolvedValue({ buyerKey: "buyer-a" });
    mocks.getSavedRoutine.mockResolvedValue({
      routine: { concerns: [], cautions: [], steps: [{ instruction: "Paso" }] },
      consultationDate: "2026-09-01T10:00:00.000Z",
      transcript: ["private"],
      accessTokenHash: "private",
      consultationId: "private",
    });

    const response = await GET(request("valid-ticket"));
    expect(await response.json()).toEqual({
      routine: { concerns: [], cautions: [], steps: [{ instruction: "Paso" }] },
      consultationDate: "2026-09-01T10:00:00.000Z",
    });
  });

  it("returns no-store 503 responses when an access or database service fails", async () => {
    mocks.readBuyerTicket.mockRejectedValueOnce(new Error("unavailable"));
    const accessFailure = await GET(request("valid-ticket"));
    expect(accessFailure.status).toBe(503);
    expect(accessFailure.headers.get("cache-control")).toBe(
      "private, no-store",
    );

    mocks.readBuyerTicket.mockResolvedValue({ buyerKey: "buyer-a" });
    mocks.getSavedRoutine.mockRejectedValueOnce(new Error("unavailable"));
    const databaseFailure = await GET(request("valid-ticket"));
    expect(databaseFailure.status).toBe(503);
    expect(databaseFailure.headers.get("cache-control")).toBe(
      "private, no-store",
    );
  });
});
