"use client";

import { useState } from "react";

export function OutageBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (process.env.NEXT_PUBLIC_SERVICE_OUTAGE !== "true" || dismissed) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => setDismissed(true)}
      />

      {/* Card */}
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Amber top bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-amber-400 to-orange-400" />

        <div className="p-6">
          {/* Icon + title */}
          <div className="flex items-start gap-3 mb-4">
            <div className="shrink-0 w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-amber-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-neutral-800 text-base leading-snug">
                Aviso temporal
              </h3>
              <p className="text-xs text-neutral-400 mt-0.5">
                Servicio en restauración
              </p>
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
              aria-label="Cerrar"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Message */}
          <p className="text-sm text-neutral-600 leading-relaxed">
            Nuestros proveedores de tecnología de forma extraordinaria están
            teniendo inconvenientes y tienen como máxima prioridad arreglarlo.
          </p>

          {/* Footer */}
          <div className="mt-5 flex items-center justify-between">
            <p className="text-xs text-neutral-400">Disculpá las molestias</p>
            <button
              onClick={() => setDismissed(true)}
              className="px-4 py-1.5 bg-neutral-900 text-white text-sm font-medium rounded-full hover:bg-neutral-700 transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
