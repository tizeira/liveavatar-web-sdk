import { auth } from "@/auth";
import {
  API_KEY,
  API_URL,
  AVATAR_ID_DESKTOP,
  AVATAR_ID_MOBILE,
  ELEVENLABS_API_KEY,
  ELEVENLABS_AGENT_ID,
} from "../secrets";
import prisma from "@/src/lib/db/prisma";

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

async function testHeygen(): Promise<ServiceResult> {
  if (!API_KEY) {
    return {
      status: "missing_config",
      latency_ms: 0,
      error_code: "HEYGEN_API_KEY_MISSING",
      message: "HEYGEN_API_KEY not set in environment variables",
    };
  }

  const start = Date.now();
  try {
    const res = await fetch(`${API_URL}/v1/sessions/token`, {
      method: "POST",
      headers: {
        "X-API-KEY": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "CUSTOM",
        avatar_id: AVATAR_ID_DESKTOP,
      }),
    });

    const latency_ms = Date.now() - start;

    if (res.ok) {
      const data = await res.json();
      const hasToken = !!data?.data?.session_token;
      return {
        status: "ok",
        http_status: res.status,
        latency_ms,
        message: hasToken
          ? "Session token obtained successfully"
          : "Response OK but no session_token in body",
      };
    }

    let errorCode = "HEYGEN_ERROR";
    let errorMessage = `HTTP ${res.status}`;

    try {
      const errorData = await res.json();
      if (errorData.data?.[0]?.message)
        errorMessage = errorData.data[0].message;
      else if (errorData.message) errorMessage = errorData.message;
      else if (errorData.error) errorMessage = String(errorData.error);
    } catch {
      // keep defaults
    }

    if (res.status === 401 || res.status === 403)
      errorCode = "HEYGEN_AUTH_FAILED";
    else if (res.status === 402) errorCode = "HEYGEN_PAYMENT_REQUIRED";

    return {
      status: "error",
      http_status: res.status,
      latency_ms,
      error_code: errorCode,
      message: errorMessage,
    };
  } catch (err) {
    return {
      status: "error",
      latency_ms: Date.now() - start,
      error_code: "HEYGEN_NETWORK_ERROR",
      message: (err as Error).message,
    };
  }
}

async function testElevenLabs(): Promise<ServiceResult> {
  if (!ELEVENLABS_API_KEY) {
    return {
      status: "missing_config",
      latency_ms: 0,
      error_code: "ELEVENLABS_API_KEY_MISSING",
      message: "ELEVENLABS_API_KEY not set in environment variables",
    };
  }
  if (!ELEVENLABS_AGENT_ID) {
    return {
      status: "missing_config",
      latency_ms: 0,
      error_code: "ELEVENLABS_AGENT_ID_MISSING",
      message: "ELEVENLABS_AGENT_ID not set in environment variables",
    };
  }

  const start = Date.now();
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${ELEVENLABS_AGENT_ID}`,
      {
        method: "GET",
        headers: { "xi-api-key": ELEVENLABS_API_KEY },
      },
    );

    const latency_ms = Date.now() - start;

    if (res.ok) {
      const data = await res.json();
      return {
        status: "ok",
        http_status: res.status,
        latency_ms,
        message: data.signed_url
          ? "Signed URL obtained successfully"
          : "Response OK but no signed_url in body",
      };
    }

    let errorCode = "ELEVENLABS_ERROR";
    let errorMessage = `HTTP ${res.status}`;

    try {
      const text = await res.text();
      const json = JSON.parse(text);
      if (json.detail?.message) errorMessage = json.detail.message;
      else if (json.message) errorMessage = json.message;
      else if (text) errorMessage = text.slice(0, 200);
    } catch {
      // keep defaults
    }

    if (res.status === 401 || res.status === 403)
      errorCode = "ELEVENLABS_AUTH_FAILED";
    else if (res.status === 402) errorCode = "ELEVENLABS_PAYMENT_REQUIRED";
    else if (res.status === 404) errorCode = "ELEVENLABS_AGENT_NOT_FOUND";
    else if (res.status === 429) errorCode = "ELEVENLABS_RATE_LIMITED";

    return {
      status: "error",
      http_status: res.status,
      latency_ms,
      error_code: errorCode,
      message: errorMessage,
    };
  } catch (err) {
    return {
      status: "error",
      latency_ms: Date.now() - start,
      error_code: "ELEVENLABS_NETWORK_ERROR",
      message: (err as Error).message,
    };
  }
}

async function testDatabase(): Promise<ServiceResult> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: "ok",
      latency_ms: Date.now() - start,
      message: "Database connection OK",
    };
  } catch (err) {
    return {
      status: "error",
      latency_ms: Date.now() - start,
      error_code: "DB_CONNECTION_ERROR",
      message: (err as Error).message,
    };
  }
}

export async function GET() {
  // Require auth
  const session = await auth();
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Run all tests in parallel
  const [heygen, elevenlabs, database] = await Promise.all([
    testHeygen(),
    testElevenLabs(),
    testDatabase(),
  ]);

  const result: DiagnosticsResult = {
    timestamp: new Date().toISOString(),
    env: {
      HEYGEN_API_KEY: API_KEY ? "present" : "MISSING",
      ELEVENLABS_API_KEY: ELEVENLABS_API_KEY ? "present" : "MISSING",
      ELEVENLABS_AGENT_ID: ELEVENLABS_AGENT_ID
        ? `present (${ELEVENLABS_AGENT_ID.slice(0, 12)}...)`
        : "MISSING",
      AVATAR_ID_DESKTOP: AVATAR_ID_DESKTOP
        ? `${AVATAR_ID_DESKTOP.slice(0, 8)}...`
        : "MISSING",
      AVATAR_ID_MOBILE: AVATAR_ID_MOBILE
        ? `${AVATAR_ID_MOBILE.slice(0, 8)}...`
        : "MISSING",
    },
    services: { heygen, elevenlabs, database },
  };

  return new Response(JSON.stringify(result, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
