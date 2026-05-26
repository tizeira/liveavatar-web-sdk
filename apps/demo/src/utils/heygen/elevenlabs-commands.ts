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

/**
 * Send customer context to ElevenLabs agent via contextual_update.
 *
 * This is PURELY a silent context injection — it does NOT trigger a response.
 * The agent stores the info and uses it on the next response it generates.
 * To make the agent speak, call session.sendUserMessage(...) separately.
 *
 * Replaces `dynamic_variables` (which are blocked by the plugin).
 */
export function sendCustomerContext(
  session: ElevenLabsAgentSession,
  context: {
    firstName?: string;
    lastName?: string;
    email?: string;
    skinType?: string;
    skinConcerns?: string[];
    ordersCount?: number;
  },
): void {
  const parts: string[] = [];

  if (context.firstName) {
    parts.push(
      `La cliente se llama ${context.firstName}${context.lastName ? " " + context.lastName : ""}.`,
    );
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

  if (parts.length === 0) {
    console.log("[EL-CMD] No customer context to send, skipping");
    return;
  }

  const text = parts.join(" ");
  console.log(`[EL-CMD] Sending contextual_update (${text.length} chars)`);

  try {
    session.sendContextualUpdate(text);
  } catch (err) {
    console.error("[EL-CMD] Failed to send contextual_update:", err);
  }
}
