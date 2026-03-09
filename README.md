# MM Cursor Expensive Model Indicator

A VS Code extension that turns the **title bar red** when you're using an expensive AI model in Cursor. When you switch to a cheaper model, it restores your original theme.

## How It Works

- Fetches model tiers (cheap, daily driver, expensive, extremely expensive) from `model_tiers.json` in this repo
- Polls Cursor's state database for your active model and Max Mode setting
- Applies a red title bar when effective output cost ≥ $35/1M tokens, accounting for suffix multipliers (-thinking 2x, -medium-thinking 3x, -high 1.5x, -high-thinking 5x) and Max Mode (1.2x); restores your theme otherwise

## Install Locally

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

## Requirements

- Cursor IDE
- This repo must be public (or the tiers URL reachable) so the extension can fetch `model_tiers.json`

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorExpensiveModelIndicator.tiersUrl` | `https://raw.githubusercontent.com/machinemetrics/mm-cursor-analytics/main/model_tiers.json` | URL to fetch model tiers JSON |
| `cursorExpensiveModelIndicator.pollIntervalSeconds` | 8 | Seconds between model checks |

## Updating Model Tiers

Run the seed script to regenerate `model_tiers.json` from [cursor-costs](https://github.com/sethstrz/cursor-costs):

```bash
node scripts/generate-model-tiers.js
```

Commit and push the updated file. Set up a daily automation (GitHub Actions, Cursor Cloud Agent, cron) to run this script and push updates.

## Tier Thresholds

- **cheap**: output < $5/1M tokens
- **daily driver**: $5–20/1M tokens (Sonnet at $15)
- **expensive**: $20–50/1M tokens (Opus at $25; Sonnet thinking at $30)
- **extremely expensive**: ≥ $50/1M tokens

Red title bar triggers at **≥ $35/1M tokens effective cost** (e.g. Opus with high-thinking, or Opus-fast).

Models not in cursor-costs (e.g. Claude 4.6 Opus) are added via `MANUAL_OVERRIDES` in the seed script.
