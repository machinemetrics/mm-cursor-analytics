import * as vscode from 'vscode';
import { refreshSpend, getSpendSummary, type ExpensiveTurn } from './spendCache';
import { log } from './logger';

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MENU_COMMAND_ID = 'mmCursorAnalytics.showMenu';

function formatDollars(amount: number): string {
  if (amount < 0.01) return '$0.00';
  return `$${amount.toFixed(2)}`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function formatExpensiveTurnDetail(turn: ExpensiveTurn): string {
  const parts: string[] = [];

  if (turn.inputTokens != null || turn.outputTokens != null) {
    const tokenParts: string[] = [];
    if (turn.inputTokens != null) tokenParts.push(`in: ${formatTokens(turn.inputTokens)}`);
    if (turn.outputTokens != null) tokenParts.push(`out: ${formatTokens(turn.outputTokens)}`);
    parts.push(`tokens: ${tokenParts.join(' · ')}`);
  }

  if (turn.model) {
    parts.push(`model: ${turn.model}`);
  }

  const time = new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  parts.push(`at ${time}`);

  return parts.join(' · ');
}

export function createSpendStatusBar(ctx: vscode.ExtensionContext): {
  disposable: vscode.Disposable;
  refresh: () => Promise<void>;
} {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  item.command = MENU_COMMAND_ID;
  item.text = 'MM $(loading~spin)';
  item.show();

  function updateDisplay(): void {
    const { today, month, expensiveTurnToday } = getSpendSummary(ctx);

    const expensiveStr = expensiveTurnToday
      ? formatDollars(expensiveTurnToday.chargedCents / 100)
      : '—';

    const text = `MM ${formatDollars(today)} · ${formatDollars(month)} · ${expensiveStr}↑`;
    item.text = text;

    const lines: string[] = [
      `Today's Spend:          ${formatDollars(today)}`,
      `Billing Period:           ${formatDollars(month)}`,
      `Most Expensive Turn:  ${expensiveTurnToday ? formatDollars(expensiveTurnToday.chargedCents / 100) : '—'}`,
    ];

    if (expensiveTurnToday) {
      lines.push(`  ${formatExpensiveTurnDetail(expensiveTurnToday)}`);
    }

    lines.push('', 'Click for options');
    item.tooltip = lines.join('\n');

    log(`Display updated: ${text}`);
  }

  async function refresh(): Promise<void> {
    item.text = 'MM $(loading~spin)';
    log('Refreshing spend data...');
    try {
      await refreshSpend(ctx);
      log('Refresh complete');
    } catch (e) {
      log(`Refresh failed: ${e}`);
    }
    updateDisplay();
  }

  // Initial load — show cached values immediately, then fetch in background
  updateDisplay();
  refresh();

  const timer = setInterval(refresh, POLL_INTERVAL_MS);

  return {
    refresh,
    disposable: {
      dispose: () => {
        clearInterval(timer);
        item.dispose();
      },
    },
  };
}
