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
 * This replaces `dynamic_variables` (which are blocked by the plugin).
 * contextual_update is MORE flexible: free-form text, updatable mid-conversation,
 * and doesn't require template placeholders in the agent prompt.
 *
 * If `triggerGreeting=true`, includes an explicit instruction asking the
 * agent to greet the user NOW. Use this when the agent's "first_message"
 * is disabled in the dashboard and you want the client to control when
 * the greeting actually starts (e.g. after WebRTC jitter buffer warmup).
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
  options: { triggerGreeting?: boolean } = {},
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

  if (options.triggerGreeting) {
    // Explicit instruction so the agent generates an opening response NOW
    // instead of waiting for the user to speak first.
    const nameRef = context.firstName
      ? ` por su nombre (${context.firstName})`
      : "";
    parts.push(
      `La cliente acaba de iniciar la sesión y aún no ha hablado. ` +
        `Salúdala ahora cálidamente${nameRef} en una sola frase corta, ` +
        `y preguntale en qué la podés ayudar hoy.`,
    );
  }

  if (parts.length === 0) {
    console.log("[EL-CMD] No customer context to send, skipping");
    return;
  }

  const text = parts.join(" ");
  console.log(
    `[EL-CMD] Sending contextual_update (${text.length} chars, triggerGreeting=${!!options.triggerGreeting})`,
  );

  try {
    session.sendContextualUpdate(text);
  } catch (err) {
    console.error("[EL-CMD] Failed to send contextual_update:", err);
  }
}
