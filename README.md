# MM Cursor Expensive Model Indicator

A VS Code extension that turns the **title bar red** when you're using an expensive AI model in Cursor. The status bar shows your today's spend, billing period spend, and most expensive turn at a glance.

## Install

Search for **MM Cursor Expensive Model Indicator** in the Cursor Extensions panel, or install from [Open VSX](https://open-vsx.org/extension/machinemetrics/mm-cursor-analytics).

## How It Works

- Fetches model tiers from `model_tiers.json` in this repo (kept up to date automatically)
- Polls Cursor's state database for your active model and Max Mode setting
- Applies a red title bar when effective output cost ≥ $20/1M tokens, accounting for suffix multipliers (-thinking 2x, -high 1.5x, -high-thinking 3x) and Max Mode (1.2x); restores your theme otherwise
- Fetches your spend from the Cursor API and displays it in the status bar

## Status Bar

The status bar shows spend metrics and a cost indicator:

```
MM $0.42 · $12.34 · $0.18↑  $$
   today   period   max turn  current model cost
```

- **Spend (MM … ↑)**: Today’s spend, billing period spend, and most expensive turn today. Click for refresh/clear; hover for details (model, tokens, time).
- **Dollar signs ($ to $$$$)**: Cost tier of the currently selected model — $ cheap, $$ daily driver, $$$ expensive, $$$$ extremely expensive. When **Auto** is selected (included in Pro), this shows **$** regardless of which model Auto uses.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorExpensiveModelIndicator.tiersUrl` | `https://raw.githubusercontent.com/machinemetrics/mm-cursor-analytics/main/model_tiers.json` | URL to fetch model tiers JSON |
| `cursorExpensiveModelIndicator.pollIntervalSeconds` | 8 | Seconds between model checks |

## Tier Thresholds

- **cheap**: output < $5/1M tokens
- **daily driver**: $5–20/1M tokens (Sonnet at $15)
- **expensive**: $20–50/1M tokens (triggers red title bar)
- **extremely expensive**: ≥ $50/1M tokens (triggers red title bar)
