"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "../../src/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../src/components/ui/card";
import { Input } from "../../src/components/ui/input";
import { Label } from "../../src/components/ui/label";
import { Alert, AlertDescription } from "../../src/components/ui/alert";
import { Lock, ShieldCheck } from "lucide-react";

function AccessForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";

  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/access/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        window.location.href = redirectTo;
        return;
      }

      if (res.status === 429) {
        setError(
          "Demasiados intentos. Esperá unos minutos antes de probar nuevamente.",
        );
      } else {
        setError("Contraseña incorrecta.");
      }
      setPassword("");
    } catch {
      setError("Error de conexión. Probá nuevamente.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password" className="text-neutral-700">
          Contraseña
        </Label>
        <div className="relative">
          <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pl-10"
            autoComplete="current-password"
            autoFocus
            required
            disabled={isLoading}
            maxLength={256}
          />
        </div>
      </div>

      {error && (
        <Alert
          variant="destructive"
          className="bg-red-50 border-red-200 text-red-700"
        >
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        type="submit"
        disabled={isLoading || !password}
        className="w-full"
      >
        {isLoading ? "Verificando..." : "Acceder"}
      </Button>
    </form>
  );
}

export default function AccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 landing-gradient">
      <Card className="w-full max-w-md relative z-10 card-ios border-0 shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full glass-morphism-strong flex items-center justify-center shadow-lg">
            <ShieldCheck
              className="w-8 h-8"
              style={{ color: "var(--platinum-700)" }}
            />
          </div>
          <CardTitle className="text-2xl font-semibold text-neutral-800">
            Acceso de Beta Testers
          </CardTitle>
          <CardDescription className="text-neutral-600 mt-2">
            Esta plataforma está en pruebas privadas.
            <br />
            Ingresá la contraseña que recibiste del equipo.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-6">
          <Suspense
            fallback={
              <div className="text-center text-neutral-400">Cargando...</div>
            }
          >
            <AccessForm />
          </Suspense>

          <p className="text-xs text-neutral-500 mt-6 text-center">
            🔒 Esta página está protegida y registra intentos fallidos.
            <br />
            Si no recibiste la contraseña, contactá al equipo de Beta.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
