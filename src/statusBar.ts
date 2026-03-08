import * as vscode from 'vscode';
import { refreshSpend, getSpendSummary } from './spendCache';
import { log } from './logger';

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MENU_COMMAND_ID = 'mmCursorAnalytics.showMenu';

function formatDollars(amount: number): string {
  if (amount < 0.01) return '$0.00';
  return `$${amount.toFixed(2)}`;
}

export function createSpendStatusBar(ctx: vscode.ExtensionContext): {
  disposable: vscode.Disposable;
  refresh: () => Promise<void>;
} {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  item.tooltip = 'MM Cursor Spend — today · this month\nClick for options';
  item.command = MENU_COMMAND_ID;
  item.text = 'MM $(loading~spin)';
  item.show();

  function updateDisplay(): void {
    const { today, month } = getSpendSummary(ctx);
    const text = `MM ${formatDollars(today)} · ${formatDollars(month)}/mo`;
    item.text = text;
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
