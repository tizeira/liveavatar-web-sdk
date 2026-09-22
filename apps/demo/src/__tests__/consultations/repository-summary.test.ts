import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findFirstOrThrow: vi.fn(),
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("@/src/lib/db/prisma", () => ({
  prisma: {
    claraConsultation: mocks,
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        claraConsultation: mocks,
        claraDailyMetric: { upsert: mocks.upsert },
      }),
  },
}));
import {
  completeClaraConsultation,
  getClaraConsultation,
  proposeClaraRoutine,
  resolveClaraRoutineProposal,
  saveClaraRoutine,
} from "@/src/consultations/repository";

describe("persisted routine owns completion summary", () => {
  const input = {
    consultationId: "test",
    elevenLabsConversationId: "test-conversation",
    transcript: [],
    analysisMetrics: {},
    summary: "Hablamos de hidratación. Tu rutina ha sido guardada con éxito.",
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({});
    mocks.updateMany.mockResolvedValue({ count: 0 });
  });
  it("sanitizes an old summary on read without inventing a persisted routine", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "test",
      status: "completed",
      routine: null,
      transcript: [],
      summary: input.summary,
      recordExpiresAt: new Date(Date.now() + 60_000),
    });
    const result = await getClaraConsultation("test");
    expect(result?.summary).toBe("Hablamos de hidratación.");
    expect(result?.routine).toBeNull();
  });
  it("does not invent a routine or retain a save claim from post-call prose", async () => {
    mocks.findUniqueOrThrow.mockResolvedValue({
      routine: null,
      completedAt: null,
    });
    await completeClaraConsultation(input);
    const data = mocks.update.mock.calls[0]![0].data;
    expect(data.summary).toBe("Hablamos de hidratación.");
    expect(data).not.toHaveProperty("routine");
  });
  it("preserves the tool-confirmed summary and routine after post-call delivery", async () => {
    mocks.findUniqueOrThrow.mockResolvedValue({
      routine: { steps: [{ instruction: "Verified" }] },
      completedAt: new Date(),
    });
    await completeClaraConsultation(input);
    const data = mocks.update.mock.calls[0]![0].data;
    expect(data.summary).toBeUndefined();
    expect(data).not.toHaveProperty("routine");
  });
});

describe("routine save idempotency", () => {
  const originalRoutine = {
    concerns: ["hidratación"],
    cautions: [],
    steps: [
      {
        moment: "morning" as const,
        order: 1,
        instruction: "Aplicar una hidratante.",
        product: null,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("claims an empty routine exactly once", async () => {
    mocks.findUniqueOrThrow
      .mockResolvedValueOnce({
        status: "pending",
        completedAt: null,
        routineMetricRecordedAt: null,
      })
      .mockResolvedValueOnce({ routine: originalRoutine });
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await saveClaraRoutine(
      "consultation",
      "Rutina acordada.",
      originalRoutine,
    );

    expect(result.created).toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "consultation",
          routine: { equals: expect.anything() },
        }),
      }),
    );
  });

  it("returns the stored routine when the atomic claim was already taken", async () => {
    mocks.findUniqueOrThrow
      .mockResolvedValueOnce({
        status: "routine_ready",
        completedAt: null,
        routineMetricRecordedAt: null,
      })
      .mockResolvedValueOnce({ routine: originalRoutine });
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await saveClaraRoutine("consultation", "Intento repetido.", {
      concerns: ["replacement"],
      cautions: [],
      steps: [
        {
          moment: "evening",
          order: 1,
          instruction: "No debe persistirse.",
          product: null,
        },
      ],
    });

    expect(result.created).toBe(false);
    expect(result.consultation.routine).toEqual(originalRoutine);
  });
});

describe("routine proposal confirmation", () => {
  const proposal = {
    concerns: ["sensibilidad"],
    cautions: [],
    steps: [
      {
        moment: "evening" as const,
        order: 1,
        instruction: "Aplicar por la noche.",
        product: null,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a pending proposal exactly once", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValueOnce({
      routineProposal: proposal,
    });

    const result = await proposeClaraRoutine(
      "consultation",
      "Rutina propuesta.",
      proposal,
    );

    expect(result.created).toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "consultation",
          routineProposalResolvedAt: null,
        }),
        data: expect.objectContaining({
          routineProposal: proposal,
          routineProposalSummary: "Rutina propuesta.",
        }),
      }),
    );
  });

  it("confirms only a buyer-scoped pending proposal and makes it durable", async () => {
    mocks.findFirstOrThrow.mockResolvedValueOnce({
      id: "consultation",
      shopifyCustomerKey: "buyer-key",
      routineProposal: proposal,
      routineProposalSummary: "Rutina propuesta.",
      status: "pending",
      completedAt: null,
    });
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    mocks.findUniqueOrThrow.mockResolvedValueOnce({ routine: proposal });

    const result = await resolveClaraRoutineProposal({
      consultationId: "consultation",
      shopifyCustomerKey: "buyer-key",
      action: "confirm",
    });

    expect(result.resolved).toBe(true);
    expect(mocks.findFirstOrThrow).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "consultation",
        shopifyCustomerKey: "buyer-key",
      }),
    });
    expect(mocks.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          routine: proposal,
          summary: "Rutina propuesta.",
          routineConfirmedAt: expect.any(Date),
          routineProposalResolvedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("dismisses a proposal without overwriting the saved routine", async () => {
    mocks.findFirstOrThrow.mockResolvedValueOnce({
      id: "consultation",
      shopifyCustomerKey: "buyer-key",
      routineProposal: proposal,
      routineProposalSummary: "Rutina propuesta.",
      status: "pending",
      completedAt: null,
    });
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValueOnce({ routine: null });

    const result = await resolveClaraRoutineProposal({
      consultationId: "consultation",
      shopifyCustomerKey: "buyer-key",
      action: "dismiss",
    });

    expect(result.resolved).toBe(true);
    const data = mocks.updateMany.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty("routine");
    expect(data.routineProposalResolvedAt).toBeInstanceOf(Date);
  });
});
