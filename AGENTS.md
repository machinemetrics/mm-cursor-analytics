# Agent Instructions — mm-cursor-analytics

## Handling models not found in model_tiers.json

The extension logs `[model-id] not found in tiers — skipping` when it reads a model from Cursor's state DB that has no entry in `model_tiers.json`. This means the model's cost is unknown and it won't contribute to the red title bar indicator.

### How to fix a missing model

1. **Check if it's a variant suffix** — the extension automatically handles these suffixes at runtime. Do NOT add variant entries to `model_tiers.json`:
   - `-medium-thinking`, `-thinking`, `-high-thinking`, `-high`
   - If the log shows e.g. `claude-4.6-sonnet-medium-thinking not found`, first verify `claude-4.6-sonnet` (the base) exists in `model_tiers.json`. If the base exists, the suffix resolver should handle it — check `src/tierFetcher.ts` `SUFFIX_MULTIPLIERS` to see if the suffix pattern is covered.

2. **Check if it's a genuinely new base model** — if the base model ID (without any suffix) is missing, add it to `MANUAL_OVERRIDES` in `scripts/generate-model-tiers.js` and run:
   ```bash
   node scripts/generate-model-tiers.js
   ```
   Look up the output price ($/1M tokens) from https://cursor.com/docs/models-and-pricing.

3. **Model ID format** — IDs must match exactly what Cursor stores in `state.vscdb`. The format is:
   - Lowercase, spaces → hyphens
   - **Preserve dots in version numbers** (e.g. `claude-4.6-sonnet`, not `claude-4-6-sonnet`)
   - Fast mode variants: append `-fast` (e.g. `claude-4.6-opus-fast`)

### Tier thresholds

| Tier | Output price ($/1M tokens) |
|------|---------------------------|
| cheap | < $5 |
| daily driver | $5 – $19.99 |
| expensive | $20 – $49.99 |
| extremely expensive | ≥ $50 |

**Red title bar threshold: ≥ $35 effective output cost.**

Effective cost = base output × suffix multiplier × (1.2 if Max Mode).

| Suffix | Multiplier |
|--------|------------|
| `-medium-thinking` | 3x |
| `-thinking` | 2x |
| `-high` | 1.5x |
| `-high-thinking` | 5x |

### Adding a new suffix pattern

If a new model variant suffix appears in logs that isn't handled (the base lookup fails because stripping the wrong suffix leaves a non-existent ID), add a new entry to `SUFFIX_MULTIPLIERS` in `src/tierFetcher.ts`. Order matters — more specific patterns must come before less specific ones (e.g. `-medium-thinking` before `-thinking`).

### After any change

Rebuild and reinstall the extension:
```bash
npm run compile && npx vsce package && /Applications/Cursor.app/Contents/Resources/app/bin/cursor --install-extension ./mm-cursor-analytics-0.1.0.vsix
```
Then reload Cursor (**Developer: Reload Window**) and verify in **View → Output → MM Cursor Analytics** that the model is now resolved correctly.
