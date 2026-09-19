import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@/src/lib/db/prisma", () => ({
  prisma: {
    claraConsultation: mocks,
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ claraConsultation: mocks }),
  },
}));
import {
  completeClaraConsultation,
  getClaraConsultation,
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
