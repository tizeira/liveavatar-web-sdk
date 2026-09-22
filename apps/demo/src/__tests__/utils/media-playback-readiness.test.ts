import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEDIA_HAVE_CURRENT_DATA,
  waitForMediaPlaybackReady,
} from "../../utils/media-playback-readiness";

class FakeVideoElement extends EventTarget {
  readyState = MEDIA_HAVE_CURRENT_DATA;
  paused = false;
  private nextHandle = 1;
  private videoCallbacks = new Map<number, VideoFrameRequestCallback>();

  requestVideoFrameCallback(callback: VideoFrameRequestCallback): number {
    const handle = this.nextHandle++;
    this.videoCallbacks.set(handle, callback);
    return handle;
  }

  cancelVideoFrameCallback(handle: number): void {
    this.videoCallbacks.delete(handle);
  }

  presentFrame(): void {
    const callbacks = [...this.videoCallbacks.values()];
    this.videoCallbacks.clear();
    callbacks.forEach((callback) =>
      callback(0, {} as VideoFrameCallbackMetadata),
    );
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForMediaPlaybackReady", () => {
  it("waits for the configured number of presented video frames", async () => {
    const video = new FakeVideoElement();
    const ready = waitForMediaPlaybackReady(
      video as unknown as HTMLVideoElement,
      {
        minPresentedFrames: 3,
        timeoutMs: 5_000,
        now: () => 25,
      },
    );

    video.presentFrame();
    video.presentFrame();
    let resolved = false;
    void ready.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    video.presentFrame();

    await expect(ready).resolves.toEqual({
      reason: "presented_frames",
      elapsedMs: 0,
      framesPresented: 3,
      readyState: MEDIA_HAVE_CURRENT_DATA,
    });
  });

  it("falls back to playing plus animation frames when video frame callbacks are unavailable", async () => {
    const video = new FakeVideoElement();
    Object.defineProperty(video, "requestVideoFrameCallback", {
      value: undefined,
    });
    const animationCallbacks: FrameRequestCallback[] = [];

    const ready = waitForMediaPlaybackReady(
      video as unknown as HTMLVideoElement,
      {
        minPresentedFrames: 2,
        timeoutMs: 5_000,
        requestAnimationFrame: (callback) => {
          animationCallbacks.push(callback);
          return animationCallbacks.length;
        },
        cancelAnimationFrame: () => {},
        now: () => 10,
      },
    );

    animationCallbacks.shift()?.(0);
    animationCallbacks.shift()?.(16);

    await expect(ready).resolves.toMatchObject({
      reason: "playing_fallback",
      framesPresented: 2,
    });
  });

  it("uses a bounded timeout instead of deadlocking the greeting", async () => {
    vi.useFakeTimers();
    const video = new FakeVideoElement();
    video.paused = true;
    Object.defineProperty(video, "requestVideoFrameCallback", {
      value: undefined,
    });

    const ready = waitForMediaPlaybackReady(
      video as unknown as HTMLVideoElement,
      {
        timeoutMs: 500,
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => {},
        now: () => 0,
      },
    );

    await vi.advanceTimersByTimeAsync(500);

    await expect(ready).resolves.toMatchObject({
      reason: "timeout",
      framesPresented: 0,
    });
  });
});
