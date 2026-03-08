import * as vscode from 'vscode';
import { getCursorStateDbPath, getActiveModelsFromState } from './modelDetector';
import { fetchModelData, resolveModel, isExpensiveModel, type ModelData } from './tierFetcher';
import { createSpendStatusBar } from './statusBar';
import { clearSpendCache } from './spendCache';

const TITLEBAR_KEY = 'titleBar.activeBackground';
const RED_VALUE = '#cc0000';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let pollIntervalId: ReturnType<typeof setInterval> | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('cursorExpensiveModelIndicator');
  const tiersUrl = config.get<string>('tiersUrl', '');
  const pollIntervalSeconds = config.get<number>('pollIntervalSeconds', 8);

  if (!tiersUrl) {
    console.warn('[Cursor Expensive Model] tiersUrl not configured');
    return;
  }

  let modelDataCache: { data: Record<string, ModelData>; expiresAt: number } | null = null;

  async function refreshModelData(): Promise<Record<string, ModelData>> {
    const now = Date.now();
    if (modelDataCache && modelDataCache.expiresAt > now) {
      return modelDataCache.data;
    }
    try {
      const data = await fetchModelData(tiersUrl);
      modelDataCache = { data, expiresAt: now + CACHE_TTL_MS };
      return data;
    } catch (e) {
      console.warn('[Cursor Expensive Model] Failed to fetch model data:', e);
      return {};
    }
  }

  const savedKey = 'savedTitleBarColor';

  function applyRed(): void {
    const config = vscode.workspace.getConfiguration('workbench');
    const inspected = config.inspect<Record<string, string>>('colorCustomizations');
    const globalValue = inspected?.globalValue ?? {};
    const current = globalValue[TITLEBAR_KEY];
    if (current !== RED_VALUE) {
      context.globalState.update(savedKey, current);
      const next = { ...globalValue, [TITLEBAR_KEY]: RED_VALUE };
      config.update('colorCustomizations', next, vscode.ConfigurationTarget.Global);
    }
  }

  function restore(): void {
    const saved = context.globalState.get<string | undefined>(savedKey);
    const config = vscode.workspace.getConfiguration('workbench');
    const inspected = config.inspect<Record<string, string>>('colorCustomizations');
    const globalValue = inspected?.globalValue ?? {};
    const current = globalValue[TITLEBAR_KEY];
    if (current === RED_VALUE) {
      const next = { ...globalValue };
      if (saved !== undefined) {
        next[TITLEBAR_KEY] = saved;
      } else {
        delete next[TITLEBAR_KEY];
      }
      config.update('colorCustomizations', next, vscode.ConfigurationTarget.Global);
      context.globalState.update(savedKey, undefined);
    }
  }

  async function poll(): Promise<void> {
    const modelData = await refreshModelData();
    if (Object.keys(modelData).length === 0) {
      return;
    }

    const dbPath = getCursorStateDbPath();
    const activeEntries = await getActiveModelsFromState(dbPath);
    const anyExpensive = activeEntries.some(({ model, maxMode }) => {
      const resolved = resolveModel(model, modelData);
      if (!resolved) return false;
      return isExpensiveModel(resolved.data, resolved.multiplier, maxMode);
    });

    if (anyExpensive) {
      applyRed();
    } else {
      restore();
    }
  }

  await poll();
  pollIntervalId = setInterval(poll, pollIntervalSeconds * 1000);

  context.subscriptions.push({
    dispose: () => {
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = undefined;
      }
      restore();
    },
  });

  const spendBar = createSpendStatusBar(context);
  context.subscriptions.push(spendBar.disposable);

  context.subscriptions.push(
    vscode.commands.registerCommand('mmCursorAnalytics.refreshSpend', () => {
      spendBar.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mmCursorAnalytics.clearSpendCache', async () => {
      await clearSpendCache(context);
      spendBar.refresh();
      vscode.window.showInformationMessage('MM: Spend cache cleared. Refetching...');
    })
  );
}

export function deactivate(): void {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = undefined;
  }
}
