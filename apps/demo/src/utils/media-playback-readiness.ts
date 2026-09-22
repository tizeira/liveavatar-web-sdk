export const DEFAULT_MEDIA_READY_FRAME_COUNT = 3;
export const DEFAULT_MEDIA_READY_TIMEOUT_MS = 2_000;
export const MEDIA_HAVE_CURRENT_DATA = 2;

export type MediaPlaybackReadyReason =
  | "presented_frames"
  | "playing_fallback"
  | "timeout";

export interface MediaPlaybackReadyResult {
  reason: MediaPlaybackReadyReason;
  elapsedMs: number;
  framesPresented: number;
  readyState: number;
}

interface MediaPlaybackReadyOptions {
  signal?: AbortSignal;
  minPresentedFrames?: number;
  timeoutMs?: number;
  now?: () => number;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

/**
 * Wait until remote video is actually being presented, not merely subscribed.
 * A bounded timeout prevents a browser-specific media event from deadlocking the
 * greeting. Call this before attaching the remote tracks so no early event is lost.
 */
export function waitForMediaPlaybackReady(
  video: HTMLVideoElement,
  options: MediaPlaybackReadyOptions = {},
): Promise<MediaPlaybackReadyResult> {
  const minPresentedFrames = Math.max(
    1,
    options.minPresentedFrames ?? DEFAULT_MEDIA_READY_FRAME_COUNT,
  );
  const timeoutMs = Math.max(
    0,
    options.timeoutMs ?? DEFAULT_MEDIA_READY_TIMEOUT_MS,
  );
  const now = options.now ?? (() => performance.now());
  const requestAnimationFrameImpl =
    options.requestAnimationFrame ??
    ((callback: FrameRequestCallback) =>
      window.requestAnimationFrame(callback));
  const cancelAnimationFrameImpl =
    options.cancelAnimationFrame ??
    ((handle: number) => window.cancelAnimationFrame(handle));
  const startedAt = now();

  return new Promise((resolve, reject) => {
    let settled = false;
    let framesPresented = 0;
    let videoFrameHandle: number | null = null;
    let animationFrameHandle: number | null = null;
    let fallbackFrames = 0;

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      video.removeEventListener("playing", startFrameProbe);
      video.removeEventListener("loadeddata", startFrameProbe);
      options.signal?.removeEventListener("abort", onAbort);

      if (videoFrameHandle !== null && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(videoFrameHandle);
      }
      if (animationFrameHandle !== null) {
        cancelAnimationFrameImpl(animationFrameHandle);
      }
    };

    const finish = (reason: MediaPlaybackReadyReason) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        reason,
        elapsedMs: Math.max(0, now() - startedAt),
        framesPresented,
        readyState: video.readyState,
      });
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException("Media readiness wait aborted", "AbortError"));
    };

    const probeWithAnimationFrame = () => {
      if (settled || video.readyState < MEDIA_HAVE_CURRENT_DATA) {
        return;
      }

      animationFrameHandle = requestAnimationFrameImpl(() => {
        animationFrameHandle = null;
        if (settled || video.paused) return;

        fallbackFrames += 1;
        framesPresented = fallbackFrames;
        if (fallbackFrames >= minPresentedFrames) {
          finish("playing_fallback");
          return;
        }
        probeWithAnimationFrame();
      });
    };

    function startFrameProbe() {
      if (
        settled ||
        videoFrameHandle !== null ||
        animationFrameHandle !== null
      ) {
        return;
      }

      if (video.requestVideoFrameCallback) {
        const onVideoFrame: VideoFrameRequestCallback = () => {
          videoFrameHandle = null;
          if (settled) return;

          framesPresented += 1;
          if (framesPresented >= minPresentedFrames) {
            finish("presented_frames");
            return;
          }
          videoFrameHandle = video.requestVideoFrameCallback(onVideoFrame);
        };
        videoFrameHandle = video.requestVideoFrameCallback(onVideoFrame);
        return;
      }

      if (!video.paused) {
        probeWithAnimationFrame();
      }
    }

    const timeoutHandle = setTimeout(() => finish("timeout"), timeoutMs);

    video.addEventListener("playing", startFrameProbe);
    video.addEventListener("loadeddata", startFrameProbe);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    startFrameProbe();
  });
}
