import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), findMany: vi.fn() }));

vi.mock("@/src/lib/db/prisma", () => ({
  prisma: { claraConsultation: mocks },
}));

import { getSavedClaraRoutine } from "@/src/consultations/repository";

const buyerKey = "buyer-key";
const olderDate = new Date("2026-09-01T10:00:00.000Z");
const newerDate = new Date("2026-09-02T10:00:00.000Z");
const routine = {
  concerns: ["Hidratación"],
  cautions: [],
  steps: [
    {
      moment: "morning" as const,
      order: 1,
      instruction: "Limpiá suavemente",
      product: null,
    },
  ],
};

describe("getSavedClaraRoutine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(null);
  });

  it("skips a later empty consultation without hiding an older saved routine", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "newer",
        createdAt: newerDate,
        routine: { concerns: [], cautions: [], steps: [] },
      },
      { id: "older", createdAt: olderDate, routine },
    ]);

    await expect(getSavedClaraRoutine(buyerKey)).resolves.toEqual({
      routine,
      consultationDate: olderDate.toISOString(),
      pendingProposal: null,
    });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shopifyCustomerKey: buyerKey,
          recordExpiresAt: { gt: expect.any(Date) },
          routine: expect.objectContaining({ not: expect.anything() }),
        }),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        select: { id: true, createdAt: true, routine: true },
      }),
    );
  });

  it("returns the newest saved routine in deterministic database order", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "newer",
        createdAt: newerDate,
        routine: { ...routine, concerns: ["Acné"] },
      },
      { id: "older", createdAt: olderDate, routine },
    ]);

    await expect(getSavedClaraRoutine(buyerKey)).resolves.toEqual({
      routine: { ...routine, concerns: ["Acné"] },
      consultationDate: newerDate.toISOString(),
      pendingProposal: null,
    });
  });

  it("returns the empty contract when no nonexpired saved routine is available", async () => {
    mocks.findMany.mockResolvedValue([]);

    await expect(getSavedClaraRoutine(buyerKey)).resolves.toEqual({
      routine: null,
      consultationDate: null,
      pendingProposal: null,
    });
  });

  it("continues past a full empty batch instead of imposing a history cutoff", async () => {
    mocks.findMany
      .mockResolvedValueOnce(
        Array.from({ length: 20 }, (_, index) => ({
          id: `empty-${index}`,
          createdAt: newerDate,
          routine: { concerns: [], cautions: [], steps: [] },
        })),
      )
      .mockResolvedValueOnce([{ id: "older", createdAt: olderDate, routine }]);

    await expect(getSavedClaraRoutine(buyerKey)).resolves.toEqual({
      routine,
      consultationDate: olderDate.toISOString(),
      pendingProposal: null,
    });
    expect(mocks.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { id: "empty-19" }, skip: 1 }),
    );
  });

  it("returns a pending proposal without hiding the last confirmed routine", async () => {
    const proposedAt = new Date("2026-09-03T10:00:00.000Z");
    const proposal = { ...routine, concerns: ["Sensibilidad"] };
    mocks.findFirst.mockResolvedValue({
      id: "proposal-consultation",
      routineProposal: proposal,
      routineProposedAt: proposedAt,
    });
    mocks.findMany.mockResolvedValue([
      { id: "older", createdAt: olderDate, routine },
    ]);

    await expect(getSavedClaraRoutine(buyerKey)).resolves.toEqual({
      routine,
      consultationDate: olderDate.toISOString(),
      pendingProposal: {
        consultationId: "proposal-consultation",
        routine: proposal,
        proposedAt: proposedAt.toISOString(),
      },
    });
  });
});
