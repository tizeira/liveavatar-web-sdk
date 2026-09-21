/**
 * ElevenLabs Plugin command helpers for HeyGen LiveAvatar.
 *
 * Uses the SDK's built-in ElevenLabsAgentSession.sendContextualUpdate()
 * to send customer context to the ElevenLabs agent via LiveKit data channel.
 *
 * @see https://docs.liveavatar.com/docs/lite-mode/connectors/elevenlabs-agent
 * @see https://elevenlabs.io/docs/eleven-agents/customization/events/client-to-server-events
 */
import type { ElevenLabsAgentSession } from "@heygen/liveavatar-web-sdk";
import type { ClaraConversationMemory } from "@/src/consultations/types";

export const ARGENTINA_TIME_ZONE = "America/Argentina/Buenos_Aires";
type Clock = () => Date;

function argentinaCalendarDay(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ARGENTINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"));
}

export function formatArgentinaDate(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: ARGENTINA_TIME_ZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

/** Exact consultation clock plus the local calendar the agent should use. */
export function formatConsultationTime(now: Date): string {
  return `Contexto temporal de esta consulta: instante exacto ISO UTC ${now.toISOString()}. En ${ARGENTINA_TIME_ZONE} es ${formatArgentinaDate(now)}. Interpretá hoy, ayer y las fechas relativas con ese calendario local.`;
}

/**
 * Convert an ISO date to Spanish relative text for the greeting.
 * "hoy" | "ayer" | "hace N días" | "" (if missing/invalid).
 */
export function formatRelativeDate(iso?: string, now = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";

  // Compare Argentina calendar days; UTC can cross the local date boundary.
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.round(
    (argentinaCalendarDay(now) - argentinaCalendarDay(then)) / msPerDay,
  );

  if (diffDays < 0) return ""; // future date = invalid order data
  if (diffDays === 0) return "hoy";
  if (diffDays === 1) return "ayer";
  return `hace ${diffDays} días`;
}

function formatKnownDate(iso: string | undefined, now: Date): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const relative = formatRelativeDate(iso, now);
  if (!relative) {
    return ` Fecha informada: ${date.toISOString()} (${formatArgentinaDate(date)}); parece posterior a esta consulta, no asumir una compra futura.`;
  }
  return ` Fecha informada: ${date.toISOString()} (${formatArgentinaDate(date)}; ${relative}).`;
}

function formatPreviousConsultationDate(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const relative = formatRelativeDate(iso, now);
  if (!relative) return "";
  return `Fecha de consulta: ${date.toISOString()} (${formatArgentinaDate(date)}; ${relative})`;
}

/**
 * Send customer context to ElevenLabs agent via contextual_update.
 *
 * This is PURELY a silent context injection — it does NOT trigger a response.
 * The agent stores the info and uses it on the next response it generates.
 * To make the agent speak, call session.sendUserMessage(...) separately.
 *
 * Replaces `dynamic_variables` (which are blocked by the plugin).
 */
interface CustomerContext {
  firstName?: string;
  skinType?: string;
  skinConcerns?: string[];
  ordersCount?: number;
  lastOrderProduct?: string;
  lastOrderDate?: string;
  conversationMemory?: ClaraConversationMemory;
  clock?: Clock;
}

function buildCustomerContext(context: CustomerContext): string {
  const now = context.clock?.() ?? new Date();
  const parts: string[] = [formatConsultationTime(now)];

  if (context.firstName) {
    parts.push(`La cliente se llama ${context.firstName}.`);
  }

  if (context.skinType) {
    parts.push(`Su tipo de piel es: ${context.skinType}.`);
  }

  if (context.skinConcerns?.length) {
    parts.push(
      `Sus preocupaciones principales son: ${context.skinConcerns.join(", ")}.`,
    );
  }

  if (context.ordersCount !== undefined && context.ordersCount > 0) {
    parts.push(
      `Ha realizado ${context.ordersCount} compra${context.ordersCount > 1 ? "s" : ""} anteriormente. Es cliente recurrente.`,
    );
  }

  if (context.lastOrderProduct) {
    parts.push(
      `Su compra más reciente fue: ${context.lastOrderProduct}.${formatKnownDate(context.lastOrderDate, now)}`,
    );
  }

  if (context.conversationMemory?.length) {
    const memories = context.conversationMemory
      .slice(0, 3)
      .map((memory) => {
        const when = formatRelativeDate(memory.completedAt, now);
        const date = formatPreviousConsultationDate(memory.completedAt, now);
        const details = [
          memory.summary.slice(0, 400),
          memory.concerns.length
            ? `Objetivos: ${memory.concerns.join(", ")}.`
            : "",
          memory.products.length
            ? `Productos acordados: ${memory.products.join(", ")}.`
            : "",
        ]
          .filter(Boolean)
          .join(" ");
        return when && date ? `${date}: ${details}` : "";
      })
      .filter(Boolean);
    if (memories.length) {
      parts.push(
        `Antecedentes de conversaciones previas, de la más reciente a la más antigua: ${memories.join(" | ")}. Reconocé con naturalidad que ya conversaron y preguntá cómo le resultó la recomendación anterior. No afirmes que siguió la rutina ni que obtuvo resultados.`,
      );
    }
  }

  parts.push(
    "No llames a la fecha de esta consulta una actualización de rutina ni inventes un historial de versiones. La memoria no prueba que una rutina se haya guardado o actualizado en esta consulta. Solo después de una confirmación explícita de la clienta, usá la herramienta guardar_rutina_clara_memoria_qa para guardar; no guardes automáticamente. No afirmes que se guardó ni que se actualizó hasta recibir saved:true de esa herramienta en esta consulta.",
  );

  if (parts.length === 0) {
    return "";
  }

  return parts.join(" ");
}

export function sendCustomerContext(
  session: ElevenLabsAgentSession,
  context: CustomerContext,
): void {
  const text = buildCustomerContext(context);
  if (!text) return;
  console.log(`[EL-CMD] Sending contextual_update (${text.length} chars)`);

  try {
    session.sendContextualUpdate(text);
  } catch (err) {
    console.error("[EL-CMD] Failed to send contextual_update:", err);
  }
}

export async function sendCustomerContextAndWait(
  session: ElevenLabsAgentSession,
  context: CustomerContext,
): Promise<void> {
  const text = buildCustomerContext(context);
  if (!text) return;
  console.log(
    `[EL-CMD] Sending contextual_update with delivery settlement (${text.length} chars)`,
  );
  await session.sendContextualUpdateAndWait(text);
}
