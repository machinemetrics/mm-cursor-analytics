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

function formatExpensiveTurn(turn: ExpensiveTurn): string {
  const cost = formatDollars(turn.chargedCents / 100);
  const time = new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const lines: string[] = [`Most Expensive Turn Today: ${cost}`];

  if (turn.inputTokens != null || turn.outputTokens != null) {
    const parts: string[] = [];
    if (turn.inputTokens != null) parts.push(`in: ${formatTokens(turn.inputTokens)}`);
    if (turn.outputTokens != null) parts.push(`out: ${formatTokens(turn.outputTokens)}`);
    lines.push(`Tokens: ${parts.join(' · ')}`);
  }

  if (turn.model) {
    lines.push(`Model: ${turn.model}`);
  }

  lines.push(`Time: ${time}`);
  return lines.join('\n');
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
    const text = `MM ${formatDollars(today)} · ${formatDollars(month)}/mo`;
    item.text = text;

    let tooltip = 'MM Cursor Spend — today · this month';
    if (expensiveTurnToday) {
      tooltip += '\n\n' + formatExpensiveTurn(expensiveTurnToday);
    }
    tooltip += '\nClick for options';
    item.tooltip = tooltip;

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
