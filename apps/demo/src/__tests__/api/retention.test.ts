import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.CRON_SECRET = "test-cron-secret";

const mockRunRetention = vi.fn();
vi.mock("@/src/consultations/repository", () => ({
  runConsultationRetention: (...args: unknown[]) => mockRunRetention(...args),
}));

const { GET } = await import("@/app/api/internal/retention/route");

function request(secret?: string) {
  return new NextRequest("http://localhost/api/internal/retention", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRunRetention.mockResolvedValue({
    transcriptsPurged: 2,
    recordsPurged: 1,
  });
});

describe("GET /api/internal/retention", () => {
  it("requires the configured cron secret", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(mockRunRetention).not.toHaveBeenCalled();
  });

  it("runs the idempotent cleanup for an authorized scheduler", async () => {
    const response = await GET(request("test-cron-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      transcriptsPurged: 2,
      recordsPurged: 1,
    });
    expect(mockRunRetention).toHaveBeenCalledTimes(1);
  });
});
