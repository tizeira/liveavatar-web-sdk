"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

type ServiceStatus = "ok" | "error" | "missing_config";

interface ServiceResult {
  status: ServiceStatus;
  http_status?: number;
  latency_ms: number;
  error_code?: string;
  message: string;
}

interface DiagnosticsResult {
  timestamp: string;
  env: Record<string, string>;
  services: {
    heygen: ServiceResult;
    elevenlabs: ServiceResult;
    database: ServiceResult;
  };
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  const styles: Record<ServiceStatus, string> = {
    ok: "bg-green-100 text-green-800 border-green-200",
    error: "bg-red-100 text-red-800 border-red-200",
    missing_config: "bg-yellow-100 text-yellow-800 border-yellow-200",
  };
  const labels: Record<ServiceStatus, string> = {
    ok: "OK",
    error: "ERROR",
    missing_config: "NOT CONFIGURED",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function ServiceCard({
  name,
  result,
}: {
  name: string;
  result: ServiceResult;
}) {
  const borderColor = {
    ok: "border-green-300",
    error: "border-red-300",
    missing_config: "border-yellow-300",
  }[result.status];

  const bgColor = {
    ok: "bg-green-50",
    error: "bg-red-50",
    missing_config: "bg-yellow-50",
  }[result.status];

  return (
    <div className={`rounded-xl border-2 ${borderColor} ${bgColor} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-neutral-800 text-lg">{name}</h3>
        <StatusBadge status={result.status} />
      </div>
      <p className="text-sm text-neutral-700 mb-2">{result.message}</p>
      <div className="flex flex-wrap gap-2 text-xs text-neutral-500">
        {result.http_status !== undefined && (
          <span className="bg-white rounded px-2 py-0.5 border">
            HTTP {result.http_status}
          </span>
        )}
        <span className="bg-white rounded px-2 py-0.5 border">
          {result.latency_ms}ms
        </span>
        {result.error_code && (
          <span className="bg-white rounded px-2 py-0.5 border font-mono text-red-600">
            {result.error_code}
          </span>
        )}
      </div>
    </div>
  );
}

export default function DiagnosticsPage() {
  const [result, setResult] = useState<DiagnosticsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDiagnostics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/diagnostics");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const allOk =
    result &&
    result.services.heygen.status === "ok" &&
    result.services.elevenlabs.status === "ok";

  return (
    <div className="min-h-screen bg-neutral-50 p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-neutral-900 mb-1">
            Clara — Diagnóstico de servicios
          </h1>
          <p className="text-sm text-neutral-500">
            Testea HeyGen, ElevenLabs y la base de datos de forma aislada
          </p>
        </div>

        {/* ElevenLabs outage banner */}
        <div className="mb-6 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
          <span className="font-semibold">Outage conocido:</span> ElevenLabs
          Agents Platform está degradado actualmente (STT/TTS OK, Conversational
          AI afectado). Si ElevenLabs falla aquí, es el outage externo.
        </div>

        {/* Run button */}
        <button
          onClick={runDiagnostics}
          disabled={loading}
          className="w-full mb-6 py-3 px-6 bg-neutral-900 text-white font-semibold rounded-xl hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Testeando servicios..." : "Ejecutar diagnóstico"}
        </button>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <span className="font-semibold">Error al ejecutar:</span> {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Summary */}
            <div
              className={`rounded-xl p-4 text-center font-bold text-lg ${
                allOk
                  ? "bg-green-100 text-green-800"
                  : "bg-red-100 text-red-800"
              }`}
            >
              {allOk
                ? "Todos los servicios operativos"
                : "Uno o más servicios con problemas"}
            </div>

            {/* Service cards */}
            <ServiceCard
              name="HeyGen (avatar video)"
              result={result.services.heygen}
            />
            <ServiceCard
              name="ElevenLabs (voz + conversación)"
              result={result.services.elevenlabs}
            />
            <ServiceCard
              name="Base de datos"
              result={result.services.database}
            />

            {/* Env vars */}
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <h3 className="font-bold text-neutral-700 mb-3 text-sm uppercase tracking-wide">
                Variables de entorno
              </h3>
              <div className="space-y-1.5">
                {Object.entries(result.env).map(([key, value]) => (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="font-mono text-neutral-600">{key}</span>
                    <span
                      className={`font-mono ${
                        value === "MISSING"
                          ? "text-red-600 font-bold"
                          : "text-green-700"
                      }`}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Timestamp */}
            <p className="text-center text-xs text-neutral-400">
              Ejecutado: {new Date(result.timestamp).toLocaleString("es-ES")}
            </p>
          </div>
        )}

        {/* Guide */}
        {result && !allOk && (
          <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-sm">
            <h3 className="font-bold text-neutral-700 mb-2">
              Qué hacer según el error:
            </h3>
            <ul className="space-y-1.5 text-neutral-600">
              <li>
                <span className="font-mono text-red-600">
                  HEYGEN_AUTH_FAILED
                </span>{" "}
                → Regenerar API key en{" "}
                <span className="font-mono">app.heygen.com/settings/api</span>
              </li>
              <li>
                <span className="font-mono text-red-600">
                  HEYGEN_PAYMENT_REQUIRED
                </span>{" "}
                → Renovar suscripción en{" "}
                <span className="font-mono">
                  app.heygen.com/settings/billing
                </span>
              </li>
              <li>
                <span className="font-mono text-red-600">*_MISSING</span> →
                Agregar la variable en Vercel → Project → Settings → Env Vars →
                Production, luego Redeploy
              </li>
              <li>
                <span className="font-mono text-red-600">ELEVENLABS_*</span> →
                Revisar outage en{" "}
                <span className="font-mono">status.elevenlabs.io</span> o
                verificar plan en{" "}
                <span className="font-mono">
                  elevenlabs.io/app/subscription
                </span>
              </li>
            </ul>
          </div>
        )}

        <div className="mt-4 text-center">
          <Link
            href="/"
            className="text-sm text-neutral-400 hover:text-neutral-700 transition-colors"
          >
            ← Volver a Clara
          </Link>
        </div>
      </div>
    </div>
  );
}
