import * as vscode from 'vscode';
import { refreshSpend, getSpendSummary } from './spendCache';

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const COMMAND_ID = 'mmCursorAnalytics.refreshSpend';

function formatDollars(amount: number): string {
  if (amount < 0.01) return '$0.00';
  return `$${amount.toFixed(2)}`;
}

export function createSpendStatusBar(ctx: vscode.ExtensionContext): {
  disposable: vscode.Disposable;
  refresh: () => Promise<void>;
} {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  item.tooltip = 'MM Cursor Spend — today · this month\nClick to refresh';
  item.command = COMMAND_ID;
  item.text = 'MM $(loading~spin)';
  item.show();

  function updateDisplay(): void {
    const { today, month } = getSpendSummary(ctx);
    item.text = `MM ${formatDollars(today)} · ${formatDollars(month)}/mo`;
  }

  async function refresh(): Promise<void> {
    item.text = 'MM $(loading~spin)';
    try {
      await refreshSpend(ctx);
    } catch (e) {
      console.warn('[MM Spend] Failed to refresh spend:', e);
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
