import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  findUniqueOrThrow: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@/src/lib/db/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ claraConsultation: mocks }),
  },
}));
import { saveClaraRoutine } from "@/src/consultations/repository";
import { ClaraRoutineConflictError } from "@/src/consultations/write-conflict";
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
const revision = "2026-09-26T10:00:00.000Z";
describe("routine replay and revision protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUniqueOrThrow.mockResolvedValue({
      status: "pending",
      routine: null,
      summary: null,
      updatedAt: new Date(revision),
    });
    mocks.update.mockResolvedValue({
      updatedAt: new Date("2026-09-26T10:00:01.000Z"),
    });
  });
  it("makes an exact replay a no-op, without duplicating metric writes", async () => {
    mocks.findUniqueOrThrow.mockResolvedValue({
      routine,
      summary: "Objetivo",
      updatedAt: new Date(revision),
    });
    await saveClaraRoutine(
      "fixture-a",
      "Objetivo",
      routine,
      "2026-09-25T10:00:00.000Z",
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it("rejects an older operation instead of overwriting a new routine", async () => {
    await expect(
      saveClaraRoutine(
        "fixture-a",
        "Objetivo",
        routine,
        "2026-09-25T10:00:00.000Z",
      ),
    ).rejects.toBeInstanceOf(ClaraRoutineConflictError);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("uses an atomic revision predicate, not just a read-time comparison", async () => {
    await saveClaraRoutine("fixture-a", "Objetivo", routine, revision);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "fixture-a", updatedAt: new Date(revision) },
      }),
    );
    expect(
      mocks.update.mock.calls[0]![0].data.updatedAt.getTime(),
    ).toBeGreaterThan(new Date(revision).getTime());
  });
  it("turns a concurrent update race into a conflict", async () => {
    mocks.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Fixture", {
        code: "P2025",
        clientVersion: "fixture",
      }),
    );
    await expect(
      saveClaraRoutine("fixture-a", "Objetivo", routine, revision),
    ).rejects.toBeInstanceOf(ClaraRoutineConflictError);
  });
  it("protects read/write races for legacy callers without requiring a new argument", async () => {
    await saveClaraRoutine("fixture-a", "Objetivo", routine);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "fixture-a", updatedAt: new Date(revision) },
      }),
    );
  });
  it("rejects a concurrent legacy write instead of silently replacing it", async () => {
    mocks.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Fixture", {
        code: "P2025",
        clientVersion: "fixture",
      }),
    );
    await expect(
      saveClaraRoutine("fixture-a", "Objetivo", routine),
    ).rejects.toBeInstanceOf(ClaraRoutineConflictError);
  });
});
