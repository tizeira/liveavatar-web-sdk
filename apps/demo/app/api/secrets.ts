// HeyGen API Configuration
export const API_KEY = process.env.HEYGEN_API_KEY || "";
export const API_URL = "https://api.liveavatar.com";

// Chroma Key toggle — "true" = green screen avatar + frontend chroma key
// Configure per-environment in Vercel: set only for Preview, not Production.
export const CHROMA_KEY_ENABLED =
  (process.env.CHROMA_KEY_ENABLED || "false").toLowerCase() === "true";

// Chroma Key tuning (all optional — defaults work for standard HeyGen green)
// Tighten minHue/maxHue (e.g. 90/150) to reduce holes in hair/dark clothing
export const CHROMA_MIN_HUE = Number(process.env.CHROMA_MIN_HUE) || 60;
export const CHROMA_MAX_HUE = Number(process.env.CHROMA_MAX_HUE) || 180;
export const CHROMA_MIN_SATURATION =
  Number(process.env.CHROMA_MIN_SATURATION) || 0.1;
export const CHROMA_EDGE_SHARPNESS =
  Number(process.env.CHROMA_EDGE_SHARPNESS) || 4;

// Custom background URLs (image) — empty = transparent
// Desktop: 16:9 aspect ratio recommended
export const CHROMA_BG_URL_DESKTOP = process.env.CHROMA_BG_URL_DESKTOP || "";
// Mobile: 9:16 aspect ratio recommended
export const CHROMA_BG_URL_MOBILE = process.env.CHROMA_BG_URL_MOBILE || "";

// Avatar IDs - Responsive configuration
// When CHROMA_KEY_ENABLED=true → use green-screen (no background) avatar IDs
// When CHROMA_KEY_ENABLED=false → use avatars with pre-designed background

// Mobile: Portrait aspect ratio (9:16)
export const AVATAR_ID_MOBILE = CHROMA_KEY_ENABLED
  ? process.env.HEYGEN_AVATAR_ID_MOBILE_GREENSCREEN ||
    process.env.HEYGEN_AVATAR_ID_MOBILE ||
    "65cca4cf-b7c8-4619-871f-84e2cf8b21d4"
  : process.env.HEYGEN_AVATAR_ID_MOBILE ||
    "65cca4cf-b7c8-4619-871f-84e2cf8b21d4";

// Desktop: Landscape aspect ratio (16:9)
export const AVATAR_ID_DESKTOP = CHROMA_KEY_ENABLED
  ? process.env.HEYGEN_AVATAR_ID_DESKTOP_GREENSCREEN ||
    process.env.HEYGEN_AVATAR_ID_DESKTOP ||
    "073b60a9-89a8-45aa-8902-c358f64d2852"
  : process.env.HEYGEN_AVATAR_ID_DESKTOP ||
    "073b60a9-89a8-45aa-8902-c358f64d2852";

// Default fallback
export const AVATAR_ID = AVATAR_ID_DESKTOP;

// FULL MODE Customizations
export const VOICE_ID =
  process.env.HEYGEN_VOICE_ID || "864a26b8-bfba-4435-9cc5-1dd593de5ca7";
export const CONTEXT_ID =
  process.env.HEYGEN_CONTEXT_ID || "a467805d-524f-4435-a578-97ea76f446b1";
export const LANGUAGE = process.env.HEYGEN_LANGUAGE || "es";

// CUSTOM MODE Customizations
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// ELEVENLABS VOICE AGENT
export const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID || "";

// ELEVENLABS PLUGIN — HeyGen-stored secret (not the raw API key)
export const HEYGEN_ELEVENLABS_SECRET_ID =
  process.env.HEYGEN_ELEVENLABS_SECRET_ID || "";

// SHOPIFY Configuration
export const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "";
export const SHOPIFY_ADMIN_ACCESS_TOKEN =
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
export const SHOPIFY_HMAC_SECRET = process.env.SHOPIFY_HMAC_SECRET || "";
