import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingScreen, SessionRecap } from "@/src/components/ClaraVoiceAgent";
import { SavedRoutineStatus } from "@/src/components/SavedRoutinePanel";
import { ShopifyVerificationStates } from "@/src/components/ShopifyVerificationStates";

const actions = { onTalkAgain: vi.fn(), onViewChange: vi.fn() };
afterEach(() => vi.unstubAllEnvs());

describe("Clara LAB presentation contracts", () => {
  it("keeps the outer viewport aligned with the dynamic call height", () => {
    const layout = readFileSync(
      new URL("../../../app/layout.tsx", import.meta.url),
      "utf8",
    );
    const page = readFileSync(
      new URL("../../../app/page.tsx", import.meta.url),
      "utf8",
    );
    expect(layout).toContain('className="min-h-dvh bg-[#f7f6f2] antialiased"');
    expect(page).toContain("className={labStyles.pageSurface}");
    expect(page).not.toContain('className="min-h-screen"');
  });
  it("prioritizes conversation, with one independent saved routine entry", () => {
    const html = renderToStaticMarkup(
      <LandingScreen
        userName="Ana"
        isLoading={false}
        onStartCall={async () => {}}
        onViewSavedRoutine={vi.fn()}
      />,
    );
    expect(html).toContain("Hola, Ana.");
    expect(html.indexOf("Hablar con Clara")).toBeLessThan(
      html.indexOf("Mi rutina guardada"),
    );
    expect(html.match(/Mi rutina guardada/g)).toHaveLength(1);
    expect(html).not.toContain("Última consulta");
  });

  it("keeps the start button disabled under a session limit", () => {
    const html = renderToStaticMarkup(
      <LandingScreen
        isLoading={false}
        isRateLimited
        rateLimitCountdown={45}
        onStartCall={async () => {}}
      />,
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Intenta de nuevo en 45s/,
    );
  });

  it("cannot enter preview microphone state in a production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    const html = renderToStaticMarkup(
      <LandingScreen
        isLoading={false}
        designOnly
        previewPermission="denied"
        onStartCall={async () => {}}
      />,
    );
    expect(html).toContain("Hablar con Clara");
    expect(html).not.toContain("Activa tu micrófono");
  });

  it("renders all routine moments, even steps without a product", () => {
    const html = renderToStaticMarkup(
      <SessionRecap
        {...actions}
        view="routine"
        durationSeconds={0}
        savedRoutine={{
          concerns: [],
          cautions: ["Precaución original"],
          steps: [
            {
              moment: "morning_evening",
              order: 1,
              instruction: "Paso combinado",
              product: null,
            },
            {
              moment: "weekly",
              order: 2,
              instruction: "Paso semanal",
              frequency: "Una vez por semana",
              product: null,
            },
          ],
        }}
      />,
    );
    expect(html).toContain("<ol");
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html).toContain("Mañana y noche");
    expect(html).toContain("Semanal");
    expect(html).toContain("Una vez por semana");
    expect(html).toContain("Precaución original");
    expect(html).not.toContain("Ver producto");
  });

  it("does not report an unavailable routine as empty or deleted", () => {
    const html = renderToStaticMarkup(
      <SavedRoutineStatus
        loaded={false}
        error="No pudimos recuperar tu rutina."
        onBack={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Reintentar");
    expect(html).not.toContain("Aún no tienes");
  });

  it("distinguishes loading from a confirmed empty routine", () => {
    const common = { error: null, onBack: vi.fn(), onRetry: vi.fn() };
    const loading = renderToStaticMarkup(
      <SavedRoutineStatus {...common} loaded={false} />,
    );
    const empty = renderToStaticMarkup(
      <SavedRoutineStatus {...common} loaded />,
    );
    expect(loading).toContain("Buscando tu rutina guardada");
    expect(loading).not.toContain("Aún no tienes");
    expect(empty).toContain("Aún no tienes");
    expect(empty).not.toContain("Reintentar");
  });

  it("does not present processing as a confirmed saved routine", () => {
    const html = renderToStaticMarkup(
      <SessionRecap {...actions} view="preparing" durationSeconds={60} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Preparando tu resumen");
    expect(html).not.toContain("Ver mi rutina");
  });

  it("keeps expired access linked to the store account", () => {
    const html = renderToStaticMarkup(
      <ShopifyVerificationStates state="invalid_token" />,
    );
    expect(html).toContain('href="https://betaskintech.com/account"');
    expect(html).toContain("No pudimos validar tu acceso");
    expect(html).not.toContain("Hablar con Clara");
  });
});
