import type { ClaraCatalogProduct } from "@/src/shopify/types";

export type ClaraTranscriptTurn = {
  role: "user" | "agent";
  message: string;
  timeInCallSecs?: number;
};

export type ClaraRoutineStep = {
  moment: "morning" | "evening" | "morning_evening" | "weekly";
  order: number;
  instruction: string;
  frequency?: string;
  product: ClaraCatalogProduct | null;
};

export type ClaraConversationMemoryItem = {
  completedAt: string;
  summary: string;
  concerns: string[];
  products: string[];
};

export type ClaraConversationMemory = ClaraConversationMemoryItem[];

export type ClaraRoutine = {
  concerns: string[];
  cautions: string[];
  steps: ClaraRoutineStep[];
};

export type ClaraConsultationResult = {
  consultationId: string;
  status: "pending" | "routine_ready" | "completed" | "failed";
  summary: string | null;
  routine: ClaraRoutine | null;
  transcript: ClaraTranscriptTurn[];
};
