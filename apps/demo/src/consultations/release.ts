/** Retry only the idempotent close, never creation of a paid provider session. */
export async function releaseConsultation(
  id: string,
  accessToken: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(
        `/api/consultations/${encodeURIComponent(id)}/release`,
        {
          method: "POST",
          headers: { "x-consultation-token": accessToken },
          keepalive: true,
          signal: controller.signal,
        },
      );
      if (response.ok && (await response.json()).released === true) return true;
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      )
        return false;
    } catch {
      // Never log the access token or provider/customer data.
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}
