# Generate model_tiers.json from Cursor Docs

This prompt is used by a Cursor automation to keep `model_tiers.json` up to date. Run daily or when Cursor adds new models.

---

## Task

Fetch the Cursor models and pricing page, parse the model pricing table, and regenerate `model_tiers.json` in the repo root with model tiers derived from output price.

## Source

**URL:** https://cursor.com/docs/models-and-pricing.md

Fetch the raw markdown. The page contains a table under "### Model pricing" with columns: Model | Provider | Input | Cache write | Cache read | Output | Notes.

## Parsing

1. Find the table that starts with `| Model | Provider | Input | ...`
2. For each data row (skip the header separator `| --- | --- | ...`):
   - **Model column**: Extract the display name. Format is either `[Display Name](url)` or plain text. For markdown links, use the text inside the brackets. Examples: `[Claude 4.6 Opus](https://...)` → `Claude 4.6 Opus`; `Kimi K2.5` → `Kimi K2.5`
   - **Output column**: Parse the dollar amount. Format is `$X` or `$X.Y`. Use regex `\$(\d+(?:\.\d+)?)` to extract the number. If the cell is `-` or empty, treat as 0.

## Model ID normalization

Convert display names to model IDs that match what Cursor stores in state.vscdb. Use this normalization:

- Lowercase
- Replace spaces with hyphens
- **Preserve `.` in version numbers** — do NOT replace dots with hyphens (e.g. `4.6` stays `4.6`)
- Remove parentheticals like `(Fast mode)` and append `-fast` to the base name: `Claude 4.6 Opus (Fast mode)` → `claude-4.6-opus-fast`
- For provider-prefixed models like `accounts/fireworks/models/kimi-k2-instruct`, keep the full path

Examples:
- `Claude 4.6 Opus` → `claude-4.6-opus`
- `Claude 4.6 Opus (Fast mode)` → `claude-4.6-opus-fast`
- `GPT-5.4` → `gpt-5.4`
- `Composer 1.5` → `composer-1.5`
- `Gemini 3.1 Pro` → `gemini-3.1-pro`

## Tier thresholds (output price per 1M tokens)

| Tier | Output price |
|------|--------------|
| cheap | < $5 |
| daily driver | $5 ≤ output < $20 |
| expensive | $20 ≤ output < $50 |
| extremely expensive | ≥ $50 |

Sonnet ($15) = daily driver. Opus ($25+) = expensive.

## Output format

Write to `model_tiers.json` at the repo root. Each model must include both `tier` and `output` (output price per 1M tokens) so the extension can compute effective cost when Max Mode is enabled:

```json
{
  "lastUpdated": "<ISO 8601 timestamp>",
  "<model-id>": { "tier": "<tier>", "output": <number> },
  ...
}
```

Example: `"claude-4-5-sonnet": { "tier": "daily driver", "output": 15 }`

## Variant Suffixes and Max Mode

The extension handles cost modifiers at runtime. Do **not** add `-thinking`, `-medium-thinking`, `-high`, or `-high-thinking` variants to `model_tiers.json` — only add the base model ID. The extension strips these suffixes and applies multipliers:

| Suffix | Multiplier |
|--------|------------|
| `-medium-thinking` | 3x |
| `-thinking` | 2x |
| `-high` | 1.5x |
| `-high-thinking` | 5x |
| Max Mode | 1.2x (on top of suffix multiplier) |

Effective output = base output × suffix multiplier × max mode multiplier. **Red bar when effective output ≥ $50.**

Examples:
- `claude-4.6-sonnet-medium-thinking` → base = claude-4.6-sonnet ($15) × 3 = **$45** → no red bar
- `claude-4.6-sonnet-thinking` → base = claude-4.6-sonnet ($15) × 2 = **$30** → no red bar
- `claude-4.6-opus-medium-thinking` → base = claude-4.6-opus ($25) × 3 = **$75** → 🔴 red bar
- `claude-4.6-opus-high-thinking` → base = claude-4.6-opus ($25) × 5 = **$125** → 🔴 red bar

## Verification

After writing, ensure:
- `lastUpdated` is set to the current time in ISO 8601 format
- All models from the Cursor docs table are present
- Claude 4.6 Opus ($25) is "expensive"
- Claude 4.6 Opus (Fast mode) ($150) is "extremely expensive"
- No duplicate model IDs
- No variant suffixes (`-thinking`, `-medium-thinking`, `-high`, `-high-thinking`) — base model IDs only
- Model IDs use the same format as `model_tiers.json` (periods preserved in version numbers)
