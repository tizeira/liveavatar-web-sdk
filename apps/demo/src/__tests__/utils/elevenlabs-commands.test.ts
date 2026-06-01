import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatRelativeDate } from "@/src/utils/heygen/elevenlabs-commands";

describe("formatRelativeDate", () => {
  beforeEach(() => {
    // Freeze "now" to 2026-06-01T12:00:00Z for deterministic day math
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'hoy' for a date earlier today", () => {
    expect(formatRelativeDate("2026-06-01T03:00:00Z")).toBe("hoy");
  });

  it("returns 'ayer' for one day ago", () => {
    expect(formatRelativeDate("2026-05-31T12:00:00Z")).toBe("ayer");
  });

  it("returns 'hace N días' for several days ago", () => {
    expect(formatRelativeDate("2026-05-27T12:00:00Z")).toBe("hace 5 días");
  });

  it("returns '' for undefined", () => {
    expect(formatRelativeDate(undefined)).toBe("");
  });

  it("returns '' for an invalid date string", () => {
    expect(formatRelativeDate("not-a-date")).toBe("");
  });
});
