import * as vscode from 'vscode';
import { getCursorStateDbPath, getActiveModelsFromState } from './modelDetector';
import { fetchModelData, resolveModel, isExpensiveModel, type ModelData } from './tierFetcher';
import { createSpendStatusBar } from './statusBar';
import { clearSpendCache } from './spendCache';
import { outputChannel, log } from './logger';

const TIER_ORDER = ['cheap', 'daily driver', 'expensive', 'extremely expensive'];

function tierToDollarSigns(tier: string, multiplier: number, maxMode: boolean): string {
  // Apply runtime multipliers to effective output cost to pick the right tier
  const tierIndex = TIER_ORDER.indexOf(tier);
  if (tierIndex === -1) return '?';
  const effectiveMultiplier = multiplier * (maxMode ? 1.2 : 1);
  // Bump tier up if multiplier pushes it over the expensive threshold
  const bumped = effectiveMultiplier >= 2 ? Math.min(tierIndex + 1, TIER_ORDER.length - 1) : tierIndex;
  return '$'.repeat(bumped + 1);
}

function createModelCostBar(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  item.tooltip = 'Active model cost tier';
  item.text = '';
  return item;
}

function updateModelCostBar(
  item: vscode.StatusBarItem,
  activeEntries: { model: string; maxMode: boolean }[],
  modelData: Record<string, ModelData>
): void {
  if (activeEntries.length === 0 || Object.keys(modelData).length === 0) {
    item.hide();
    return;
  }

  let maxTierIndex = -1;
  let dollarSigns = '';

  for (const { model, maxMode } of activeEntries) {
    const resolved = resolveModel(model, modelData);
    if (!resolved) continue;
    const tierIndex = TIER_ORDER.indexOf(resolved.data.tier);
    if (tierIndex > maxTierIndex) {
      maxTierIndex = tierIndex;
      dollarSigns = tierToDollarSigns(resolved.data.tier, resolved.multiplier, maxMode);
    }
  }

  if (!dollarSigns) {
    item.hide();
    return;
  }

  item.text = dollarSigns;
  item.color = maxTierIndex >= 2
    ? new vscode.ThemeColor('statusBarItem.warningBackground')
    : undefined;
  item.backgroundColor = maxTierIndex >= 2
    ? new vscode.ThemeColor('statusBarItem.warningBackground')
    : undefined;
  item.show();
}

const TITLEBAR_KEY = 'titleBar.activeBackground';
const RED_VALUE = '#cc0000';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let pollIntervalId: ReturnType<typeof setInterval> | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(outputChannel);
  log('MM Cursor Analytics activating...');

  const config = vscode.workspace.getConfiguration('cursorExpensiveModelIndicator');
  const tiersUrl = config.get<string>('tiersUrl', '');
  const pollIntervalSeconds = config.get<number>('pollIntervalSeconds', 8);

  if (!tiersUrl) {
    log('tiersUrl not configured — expensive model indicator disabled');
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

  const modelCostBar = createModelCostBar();
  context.subscriptions.push(modelCostBar);

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

    updateModelCostBar(modelCostBar, activeEntries, modelData);
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
    vscode.commands.registerCommand('mmCursorAnalytics.showMenu', async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(refresh) Refresh Spend Data', command: 'mmCursorAnalytics.refreshSpend' },
          { label: '$(trash) Clear Spend Cache', command: 'mmCursorAnalytics.clearSpendCache' },
        ],
        { placeHolder: 'MM Cursor Spend' }
      );
      if (choice) {
        vscode.commands.executeCommand(choice.command);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mmCursorAnalytics.refreshSpend', () => {
      spendBar.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mmCursorAnalytics.clearSpendCache', async () => {
      await clearSpendCache(context);
      vscode.window.showInformationMessage('MM: Spend cache cleared. Refetching...');
      spendBar.refresh();
    })
  );
}

export function deactivate(): void {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = undefined;
  }
}
