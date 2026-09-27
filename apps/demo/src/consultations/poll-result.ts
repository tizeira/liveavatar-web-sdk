import type { ClaraConsultationResult } from "./types";

export type ConsultationPollOutcome =
  | "ready"
  | "partial"
  | "pending"
  | "unavailable"
  | "unauthorized"
  | "failed"
  | "cancelled";

/** Reads are retryable. This helper never creates a session or writes a routine. */
export async function pollConsultationResult(options: {
  id: string;
  accessToken: string;
  signal: AbortSignal;
  onResult: (result: ClaraConsultationResult) => void;
  fetcher?: typeof fetch;
  now?: () => number;
  budgetMs?: number;
  intervalMs?: number;
}): Promise<ConsultationPollOutcome> {
  const now = options.now ?? (() => performance.now());
  const deadline = now() + (options.budgetMs ?? 30_000);
  const fetcher = options.fetcher ?? fetch;
  let receivedResult = false;
  let receivedSummary = false;

  for (let attempt = 0; attempt < 30 && now() < deadline; attempt += 1) {
    if (options.signal.aborted) return "cancelled";
    const request = new AbortController();
    const cancel = () => request.abort();
    options.signal.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(cancel, Math.min(5_000, deadline - now()));
    try {
      const response = await fetcher(
        `/api/consultations/${encodeURIComponent(options.id)}`,
        {
          headers: { "x-consultation-token": options.accessToken },
          cache: "no-store",
          signal: request.signal,
        },
      );
      if (options.signal.aborted) return "cancelled";
      if (response.status === 401 || response.status === 403)
        return "unauthorized";
      if (response.ok) {
        const result = (await response.json()) as ClaraConsultationResult;
        if (options.signal.aborted) return "cancelled";
        if (
          result.consultationId === options.id &&
          ["pending", "routine_ready", "completed", "failed"].includes(
            result.status,
          )
        ) {
          receivedResult = true;
          // A routine is useful even before the asynchronous summary arrives.
          options.onResult(result);
          receivedSummary = Boolean(result.summary?.trim());
          // Post-call completion does not prove the independent routine write
          // has finished. Keep a bounded background read for summary-first calls.
          if (receivedSummary && result.routine?.steps.length) return "ready";
          if (result.status === "failed") return "failed";
        }
      }
    } catch {
      // No error body, credentials, customer data or transcript in diagnostics.
    } finally {
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", cancel);
    }
    if (options.signal.aborted) return "cancelled";
    const remaining = deadline - now();
    if (remaining <= 0 || attempt === 29) break;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        options.signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(
        finish,
        Math.min(options.intervalMs ?? 1_000, remaining),
      );
      options.signal.addEventListener("abort", finish, { once: true });
    });
  }
  return options.signal.aborted
    ? "cancelled"
    : receivedSummary
      ? "partial"
      : receivedResult
        ? "pending"
        : "unavailable";
}
