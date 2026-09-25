"use client";

import React, { useEffect, useState } from "react";
import type { ClaraSavedRoutine } from "../consultations/types";
import styles from "./ClaraVoiceAgent.module.css";

export type SavedRoutineResponse = ClaraSavedRoutine;

export async function loadSavedRoutine(
  signal: AbortSignal,
): Promise<SavedRoutineResponse> {
  const response = await fetch("/api/consultations/saved-routine", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status === 401)
    throw new Error(
      "Tu acceso venció. Volvé a entrar desde Shopify para ver tu rutina.",
    );
  if (!response.ok)
    throw new Error(
      "No pudimos recuperar tu rutina. Intentá nuevamente; esto no significa que se haya borrado.",
    );
  return response.json();
}

export function SavedRoutinePanel({
  onBack,
  renderRoutine,
}: {
  onBack: () => void;
  renderRoutine: (value: SavedRoutineResponse) => React.ReactNode;
}) {
  const [value, setValue] = useState<SavedRoutineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setValue(null);
    setError(null);
    loadSavedRoutine(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setValue(result);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "No pudimos recuperar tu rutina.",
          );
      });
    return () => controller.abort();
  }, [attempt]);
  if (value?.routine?.steps.length) return <>{renderRoutine(value)}</>;
  return (
    <SavedRoutineStatus
      loaded={Boolean(value)}
      error={error}
      onBack={onBack}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}

/** Empty, loading and failure are distinct; a failed fetch is not a deleted routine. */
export function SavedRoutineStatus({
  loaded,
  error,
  onBack,
  onRetry,
}: {
  loaded: boolean;
  error: string | null;
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <div className={styles.recapScreen}>
      <div className={styles.recapInner}>
        <p className={styles.eyebrow}>Beta Skintech / Tu cuidado diario</p>
        <h1 className={styles.recapTitle}>Mi rutina guardada</h1>
        <p className={styles.recapText} role={error ? "alert" : "status"}>
          {error ||
            (loaded
              ? "Aún no tienes una rutina guardada. Acuérdala con Clara y confirma que quieres guardarla."
              : "Buscando tu rutina guardada…")}
        </p>
        <div className={styles.recapActions}>
          {error && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onRetry}
            >
              Reintentar
            </button>
          )}
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onBack}
          >
            Volver
          </button>
        </div>
      </div>
    </div>
  );
}
