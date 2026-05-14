/**
 * useChromaKey — Real-time green screen removal via Canvas 2D.
 *
 * Algorithm: HSV color space detection (matches HeyGen official bg-removal-demo).
 * 1. Convert each pixel RGB → HSV
 * 2. If hue falls within green range AND saturation exceeds threshold → transparent
 * 3. Soft edges via greenness formula: (g - max(r,b)) / g
 *
 * @see https://docs.liveavatar.com/docs/guides/change-background
 * @see github.com/heygen-com/liveavatar-web-sdk/tree/master/apps/bg-removal-demo
 */
import { useEffect, useRef, useCallback } from "react";

// ============================================
// TYPES
// ============================================

export interface ChromaKeyOptions {
  /** Minimum hue (0-360) for green detection. Default: 60 */
  minHue: number;
  /** Maximum hue (0-360) for green detection. Default: 180 */
  maxHue: number;
  /** Minimum saturation (0-1) to avoid treating grays as green. Default: 0.10 */
  minSaturation: number;
  /** Green dominance multiplier — higher = less aggressive keying. Default: 1.0 */
  threshold: number;
  /** Soft edge multiplier — higher = sharper edges, less halo. Default: 4 */
  edgeSharpness: number;
}

export interface ChromaKeyConfig {
  /** Enable/disable the chroma key effect */
  enabled: boolean;
  /** Chroma key tuning options */
  options?: Partial<ChromaKeyOptions>;
}

export const DEFAULT_CHROMA_KEY_OPTIONS: ChromaKeyOptions = {
  minHue: 60,
  maxHue: 180,
  minSaturation: 0.1,
  threshold: 1.0,
  edgeSharpness: 4,
};

// ============================================
// RGB → HSV CONVERSION
// ============================================

/**
 * Convert RGB (0-255) to HSV (h: 0-360, s: 0-1, v: 0-1).
 */
function rgbToHsv(
  r: number,
  g: number,
  b: number,
): [h: number, s: number, v: number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  // Value
  const v = max;

  // Saturation
  const s = max === 0 ? 0 : delta / max;

  // Hue
  let h = 0;
  if (delta !== 0) {
    if (max === rn) {
      h = 60 * (((gn - bn) / delta) % 6);
    } else if (max === gn) {
      h = 60 * ((bn - rn) / delta + 2);
    } else {
      h = 60 * ((rn - gn) / delta + 4);
    }
  }
  if (h < 0) h += 360;

  return [h, s, v];
}

// ============================================
// FRAME PROCESSING (HSV-based chroma key)
// ============================================

function applyChromaKey(imageData: ImageData, opts: ChromaKeyOptions): void {
  const data = imageData.data;
  const { minHue, maxHue, minSaturation, edgeSharpness } = opts;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;

    const [h, s] = rgbToHsv(r, g, b);

    // Check if pixel is in the green hue range with enough saturation
    if (h >= minHue && h <= maxHue && s >= minSaturation) {
      // Soft edge: the "greener" the pixel, the more transparent
      // greenness = how much green dominates over the other channels
      const greenness = (g - Math.max(r, b)) / (g || 1);
      const alphaValue = Math.max(0, 1 - greenness * edgeSharpness);

      data[i + 3] = Math.round(alphaValue * 255);
    }
    // else: keep original pixel unchanged
  }
}

// ============================================
// SETUP FUNCTION (imperative, returns cleanup)
// ============================================

/**
 * Start the chroma key render loop. Returns a cleanup function to stop it.
 * Call ONLY when video.readyState >= 2 (has frames to decode).
 */
function setupChromaKey(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  opts: ChromaKeyOptions,
): () => void {
  let rafId: number | null = null;
  let stopped = false;

  // Offscreen canvas for pixel read (willReadFrequently hint)
  const offscreen = document.createElement("canvas");
  const offCtx = offscreen.getContext("2d", { willReadFrequently: true });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const processFrame = () => {
    if (stopped || !offCtx || !ctx) return;

    const w = video.videoWidth;
    const h = video.videoHeight;

    if (w === 0 || h === 0) {
      rafId = requestAnimationFrame(processFrame);
      return;
    }

    // Resize canvases to match video dimensions
    if (offscreen.width !== w || offscreen.height !== h) {
      offscreen.width = w;
      offscreen.height = h;
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    // Draw video frame → offscreen → process → visible canvas
    offCtx.drawImage(video, 0, 0, w, h);
    const imageData = offCtx.getImageData(0, 0, w, h);

    applyChromaKey(imageData, opts);

    ctx.clearRect(0, 0, w, h);
    ctx.putImageData(imageData, 0, 0);

    rafId = requestAnimationFrame(processFrame);
  };

  rafId = requestAnimationFrame(processFrame);

  return () => {
    stopped = true;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
}

// ============================================
// REACT HOOK
// ============================================

export function useChromaKey(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  config: ChromaKeyConfig,
) {
  const cleanupRef = useRef<(() => void) | null>(null);

  const mergedOpts: ChromaKeyOptions = {
    ...DEFAULT_CHROMA_KEY_OPTIONS,
    ...config.options,
  };

  const stopChromaKey = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!config.enabled || !video || !canvas) {
      stopChromaKey();
      return;
    }

    const startWhenReady = () => {
      if (!video || !canvas) return;
      // Need at least readyState 2 (HAVE_CURRENT_DATA) to decode frames
      if (video.readyState < 2) return;

      stopChromaKey();
      cleanupRef.current = setupChromaKey(video, canvas, mergedOpts);
    };

    // If video already has frames, start immediately
    if (video.readyState >= 2) {
      startWhenReady();
    } else {
      // Wait for video to have decodable frames
      video.addEventListener("loadedmetadata", startWhenReady);
      video.addEventListener("loadeddata", startWhenReady);
    }

    return () => {
      video.removeEventListener("loadedmetadata", startWhenReady);
      video.removeEventListener("loadeddata", startWhenReady);
      stopChromaKey();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.enabled, stopChromaKey]);

  // Final cleanup on unmount
  useEffect(() => {
    return () => {
      stopChromaKey();
    };
  }, [stopChromaKey]);
}
