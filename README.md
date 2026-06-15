# MM Cursor Expensive Model Indicator

A VS Code extension that turns the **title bar red** when you're using an expensive AI model in Cursor. The status bar shows your today's spend, billing period spend, and most expensive turn at a glance.

## Install

Search for **MM Cursor Expensive Model Indicator** in the Cursor Extensions panel, or install from [Open VSX](https://open-vsx.org/extension/machinemetrics/mm-cursor-analytics).

## How It Works

- Fetches model tiers from `model_tiers.json` in this repo (kept up to date automatically)
- Polls Cursor's state database for your active model and Max Mode setting
- Applies a red title bar when effective output cost ≥ $50/1M tokens, accounting for suffix multipliers (-thinking 2x, -medium-thinking 3x, -high 1.5x, -high-thinking 5x) and Max Mode (1.2x); restores your theme otherwise
- Fetches your spend from the Cursor API and displays it in the status bar

## Status Bar

The status bar shows spend metrics and a cost indicator:

```
MM $0.42 · $12.34 · $0.18↑  $$
   today   period   max turn  current model cost
```

- **Spend (MM … ↑)**: Today's spend, billing period spend, and most expensive turn today. Click for refresh/clear; hover for details (model, tokens, time).
- **Dollar signs ($ to $$$$)**: Cost tier of the currently selected model — $ cheap, $$ daily driver, $$$ expensive, $$$$ extremely expensive. When **Auto** is selected (included in Pro), this shows **$** regardless of which model Auto uses.

## Building from Source

1. Install dependencies and build:
   ```bash
   npm install
   npm run compile
   npx vsce package
   ```
   > `vsce` is included as a dev dependency — use `npx vsce package` rather than `npm run package` (or add `@vscode/vsce` globally if preferred).

2. Install in Cursor:
   ```bash
   /Applications/Cursor.app/Contents/Resources/app/bin/cursor --install-extension ./mm-cursor-analytics-0.1.0.vsix
   ```
   > The `cursor` CLI is not on `$PATH` by default. Use the full path above, or install via the Extensions panel: `...` → **Install from VSIX** → select the `.vsix` file.

3. Reload Cursor to activate the extension.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorExpensiveModelIndicator.tiersUrl` | `https://raw.githubusercontent.com/machinemetrics/mm-cursor-analytics/main/model_tiers.json` | URL to fetch model tiers JSON |
| `cursorExpensiveModelIndicator.pollIntervalSeconds` | 8 | Seconds between model checks |

## Tier Thresholds

- **cheap**: output < $5/1M tokens
- **daily driver**: $5–20/1M tokens (Sonnet at $15)
- **expensive**: $20–50/1M tokens (Opus at $25; Sonnet thinking at $30)
- **extremely expensive**: ≥ $50/1M tokens

Red title bar triggers at **≥ $50/1M tokens effective cost** (e.g. Opus with medium/high-thinking).

Models not in cursor-costs (e.g. Claude 4.6 Opus) are added via `MANUAL_OVERRIDES` in the seed script.
