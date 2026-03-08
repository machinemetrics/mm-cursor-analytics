import * as vscode from 'vscode';
import { fetchUsageEventsSince } from './spendFetcher';
import { log } from './logger';

// Stored in globalState under this key
const CACHE_KEY = 'mmSpendCache';

interface SpendCache {
  // YYYY-MM-DD -> total charged dollars for that day
  days: Record<string, number>;
  // ms timestamp of the last event we've processed
  lastEventTimestamp: number;
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthPrefix(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function startOfMonthMs(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
}

function startOfTodayMs(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

function loadCache(ctx: vscode.ExtensionContext): SpendCache {
  return ctx.globalState.get<SpendCache>(CACHE_KEY) ?? { days: {}, lastEventTimestamp: 0 };
}

async function saveCache(ctx: vscode.ExtensionContext, cache: SpendCache): Promise<void> {
  await ctx.globalState.update(CACHE_KEY, cache);
}

/**
 * Refresh spend data incrementally:
 * - On first run (no cache): fetches all events since start of month
 * - On subsequent runs: fetches only events since last processed timestamp
 * - Today's bucket is always recalculated from today's events to stay current
 */
export async function refreshSpend(ctx: vscode.ExtensionContext): Promise<void> {
  const cache = loadCache(ctx);
  const now = Date.now();

  const todayStart = startOfTodayMs();
  const fetchFrom = cache.lastEventTimestamp > 0
    ? Math.min(cache.lastEventTimestamp + 1, todayStart)
    : startOfMonthMs();

  log(`Fetching events from ${new Date(fetchFrom).toISOString()} to ${new Date(now).toISOString()}`);
  log(`Cache state: lastEventTimestamp=${cache.lastEventTimestamp}, days=${JSON.stringify(Object.keys(cache.days))}`);

  const events = await fetchUsageEventsSince(fetchFrom, now);
  log(`Fetched ${events.length} events`);
  if (events.length === 0) return;

  // Clear today's bucket — we re-accumulate it fresh each time
  const today = todayKey();
  delete cache.days[today];

  for (const e of events) {
    const dollars = e.chargedCents / 100;
    cache.days[e.date] = (cache.days[e.date] ?? 0) + dollars;
  }

  // Track the latest timestamp we've seen so next fetch starts from here
  const maxTs = Math.max(...events.map(e => e.timestamp));
  if (maxTs > cache.lastEventTimestamp) {
    cache.lastEventTimestamp = maxTs;
  }

  // Prune entries older than the current month to avoid unbounded growth
  const prefix = monthPrefix();
  for (const key of Object.keys(cache.days)) {
    if (!key.startsWith(prefix)) {
      delete cache.days[key];
    }
  }

  await saveCache(ctx, cache);
}

export async function clearSpendCache(ctx: vscode.ExtensionContext): Promise<void> {
  await ctx.globalState.update(CACHE_KEY, undefined);
}

export function getSpendSummary(ctx: vscode.ExtensionContext): { today: number; month: number } {
  const cache = loadCache(ctx);
  const prefix = monthPrefix();
  const today = todayKey();

  let month = 0;
  for (const [key, val] of Object.entries(cache.days)) {
    if (key.startsWith(prefix)) month += val;
  }

  return {
    today: cache.days[today] ?? 0,
    month,
  };
}
