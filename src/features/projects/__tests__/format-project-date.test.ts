// ---------------------------------------------------------------------------
// formatProjectDate tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { formatProjectDate } from "../utils/format-project-date";

// Reference date: 2026-07-31T12:00:00.000Z
const REFERENCE = new Date("2026-07-31T12:00:00.000Z");

describe("formatProjectDate", () => {
  it('returns "just now" for dates less than 10 seconds ago', () => {
    const d = new Date(REFERENCE.getTime() - 5000).toISOString();
    expect(formatProjectDate(d, REFERENCE)).toBe("just now");
  });

  it('returns "X seconds ago" for dates less than 1 minute ago', () => {
    const d = new Date(REFERENCE.getTime() - 30000).toISOString();
    expect(formatProjectDate(d, REFERENCE)).toBe("30 seconds ago");
  });

  it('returns "1 minute ago" for dates around 60 seconds', () => {
    const d = new Date(REFERENCE.getTime() - 60000).toISOString();
    expect(formatProjectDate(d, REFERENCE)).toBe("1 minute ago");
  });

  it('returns "5 minutes ago" for dates 5 minutes ago', () => {
    const d = new Date(REFERENCE.getTime() - 5 * 60 * 1000).toISOString();
    expect(formatProjectDate(d, REFERENCE)).toBe("5 minutes ago");
  });

  it('returns "1 hour ago" for dates around 1 hour ago', () => {
    const d = new Date(REFERENCE.getTime() - 60 * 60 * 1000).toISOString();
    expect(formatProjectDate(d, REFERENCE)).toBe("1 hour ago");
  });

  it('returns "3 hours ago" for dates 3 hours ago', () => {
    const d = new Date(REFERENCE.getTime() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatProjectDate(d, REFERENCE)).toBe("3 hours ago");
  });

  it('returns "yesterday" for yesterday', () => {
    const d = new Date(REFERENCE.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(formatProjectDate(d, REFERENCE)).toBe("yesterday");
  });

  it('returns day + month for same year', () => {
    const d = new Date("2026-07-15T10:00:00.000Z").toISOString();
    expect(formatProjectDate(d, REFERENCE)).toBe("15 Jul");
  });

  it("returns full date for previous year", () => {
    const d = new Date("2025-12-25T10:00:00.000Z").toISOString();
    expect(formatProjectDate(d, REFERENCE)).toBe("25 Dec 2025");
  });

  it('returns "Unknown" for invalid dates', () => {
    expect(formatProjectDate("not-a-date", REFERENCE)).toBe("Unknown");
  });

  it('returns "just now" for future dates (negative diff)', () => {
    const d = new Date(REFERENCE.getTime() + 5000).toISOString();
    expect(formatProjectDate(d, REFERENCE)).toBe("just now");
  });
});
