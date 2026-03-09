import * as vscode from 'vscode';
import { fetchUsageEventsSince, fetchBillingPeriodStart } from './spendFetcher';
import { log } from './logger';

const CACHE_KEY = 'mmSpendCache';
// Refresh billing period start once per day
const BILLING_PERIOD_TTL_MS = 24 * 60 * 60 * 1000;

export interface ExpensiveTurn {
  chargedCents: number;
  timestamp: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

interface SpendCache {
  // YYYY-MM-DD -> total charged dollars for that day
  days: Record<string, number>;
  // ms timestamp of the last event we've processed
  lastEventTimestamp: number;
  // ms timestamp of billing period start (from /api/usage)
  billingPeriodStartMs: number;
  // when we last fetched the billing period start
  billingPeriodFetchedAt: number;
  // most expensive single turn today
  expensiveTurnToday?: ExpensiveTurn;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfTodayMs(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

function loadCache(ctx: vscode.ExtensionContext): SpendCache {
  return ctx.globalState.get<SpendCache>(CACHE_KEY) ?? {
    days: {},
    lastEventTimestamp: 0,
    billingPeriodStartMs: 0,
    billingPeriodFetchedAt: 0,
  };
}

async function saveCache(ctx: vscode.ExtensionContext, cache: SpendCache): Promise<void> {
  await ctx.globalState.update(CACHE_KEY, cache);
}

/**
 * Refresh spend data incrementally:
 * - Fetches the billing period start from /api/usage (cached 24h)
 * - On first run: fetches all events since billing period start
 * - On subsequent runs: fetches only events since last processed timestamp
 *   (but always re-fetches today in full)
 */
export async function refreshSpend(ctx: vscode.ExtensionContext): Promise<void> {
  const cache = loadCache(ctx);
  const now = Date.now();

  // Refresh billing period start if stale or missing
  if (!cache.billingPeriodStartMs || (now - cache.billingPeriodFetchedAt) > BILLING_PERIOD_TTL_MS) {
    try {
      cache.billingPeriodStartMs = await fetchBillingPeriodStart();
      cache.billingPeriodFetchedAt = now;
      log(`Billing period start updated: ${new Date(cache.billingPeriodStartMs).toISOString()}`);
      // If billing period changed (rolled over), reset event cache
      if (cache.lastEventTimestamp < cache.billingPeriodStartMs) {
        log('Billing period rolled over — resetting event cache');
        cache.days = {};
        cache.lastEventTimestamp = 0;
      }
    } catch (e) {
      log(`Failed to fetch billing period start: ${e}`);
      // Fall back to start of today if we have nothing
      if (!cache.billingPeriodStartMs) {
        cache.billingPeriodStartMs = startOfTodayMs();
      }
    }
  }

  const todayStart = startOfTodayMs();
  const fetchFrom = cache.lastEventTimestamp > 0
    ? Math.min(cache.lastEventTimestamp + 1, todayStart)
    : cache.billingPeriodStartMs;

  log(`Fetching events from ${new Date(fetchFrom).toISOString()} to ${new Date(now).toISOString()}`);
  log(`Cache state: lastEventTimestamp=${cache.lastEventTimestamp}, days=${JSON.stringify(Object.keys(cache.days))}`);

  const events = await fetchUsageEventsSince(fetchFrom, now);
  log(`Fetched ${events.length} events`);

  // Clear today's bucket — re-accumulate fresh each time
  const today = todayKey();
  delete cache.days[today];
  cache.expensiveTurnToday = undefined;

  for (const e of events) {
    const dollars = e.chargedCents / 100;
    cache.days[e.date] = (cache.days[e.date] ?? 0) + dollars;

    // Track most expensive turn for today
    if (e.date === today && e.chargedCents > (cache.expensiveTurnToday?.chargedCents ?? 0)) {
      cache.expensiveTurnToday = {
        chargedCents: e.chargedCents,
        timestamp: e.timestamp,
        model: e.model,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
      };
    }
  }

  if (events.length > 0) {
    const maxTs = Math.max(...events.map(e => e.timestamp));
    if (maxTs > cache.lastEventTimestamp) {
      cache.lastEventTimestamp = maxTs;
    }
  }

  // Prune days before the billing period start
  const billingStartDate = toLocalDate(cache.billingPeriodStartMs);
  for (const key of Object.keys(cache.days)) {
    if (key < billingStartDate) {
      delete cache.days[key];
    }
  }

  await saveCache(ctx, cache);
}

export async function clearSpendCache(ctx: vscode.ExtensionContext): Promise<void> {
  await ctx.globalState.update(CACHE_KEY, undefined);
}

export function getSpendSummary(ctx: vscode.ExtensionContext): { today: number; month: number; expensiveTurnToday?: ExpensiveTurn } {
  const cache = loadCache(ctx);
  const today = todayKey();
  const billingStartDate = cache.billingPeriodStartMs ? toLocalDate(cache.billingPeriodStartMs) : '1970-01-01';

  let month = 0;
  for (const [key, val] of Object.entries(cache.days)) {
    if (key >= billingStartDate) month += val;
  }

  return {
    today: cache.days[today] ?? 0,
    month,
    expensiveTurnToday: cache.expensiveTurnToday,
  };
}

function toLocalDate(tsMs: number): string {
  const d = new Date(tsMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
