import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Pure helper extracted for testing — mirrors the logic in spendCache.ts
function toLocalDate(tsMs: number): string {
  const d = new Date(tsMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sumDays(days: Record<string, number>, fromDate: string): number {
  let total = 0;
  for (const [key, val] of Object.entries(days)) {
    if (key >= fromDate) total += val;
  }
  return total;
}

describe('toLocalDate', () => {
  it('formats a known timestamp correctly', () => {
    // 2025-03-09T00:00:00.000Z — local time may differ, so just check format
    const result = toLocalDate(Date.UTC(2025, 2, 9)); // month is 0-indexed
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('zero-pads month and day', () => {
    // Build a timestamp for the 5th day of January in the local timezone
    const d = new Date();
    d.setFullYear(2025, 0, 5); // Jan 5
    d.setHours(12, 0, 0, 0);
    const result = toLocalDate(d.getTime());
    assert.equal(result, '2025-01-05');
  });
});

describe('sumDays', () => {
  const days = {
    '2025-02-01': 1.00,
    '2025-02-15': 2.50,
    '2025-03-01': 0.75,
    '2025-03-09': 3.20,
  };

  it('sums all days from billing period start', () => {
    const total = sumDays(days, '2025-03-01');
    assert.equal(total, 0.75 + 3.20);
  });

  it('includes the start date itself', () => {
    const total = sumDays(days, '2025-02-01');
    assert.equal(total, 1.00 + 2.50 + 0.75 + 3.20);
  });

  it('returns 0 when no days fall in range', () => {
    const total = sumDays(days, '2026-01-01');
    assert.equal(total, 0);
  });

  it('handles empty days object', () => {
    assert.equal(sumDays({}, '2025-01-01'), 0);
  });
});
