# Generate model_tiers.json from Cursor Docs

This prompt is used by a Cursor automation to keep `model_tiers.json` up to date. Run daily or when Cursor adds new models.

---

## Task

Fetch the Cursor models and pricing page, parse the model pricing table, and regenerate `model_tiers.json` in the repo root with model tiers derived from output price.

## Sources

1. **Markdown (Other Models table):** https://cursor.com/docs/models-and-pricing.md  
   Fetch the raw markdown. The `### Model pricing` table covers **third-party / Other Models** only. Columns: Model | Provider | Input | Cache write | Cache read | Output | Notes.

2. **HTML + pricing catalog (Cursor Models / Auto Cost):** https://cursor.com/docs/models-and-pricing  
   First-party Cursor Models (`grok-4.5`, `composer-2.5`) and Auto Cost are **not** in the markdown table; they render as page cards. Prices live in a hashed `docs-static/_next/static/chunks/*.js` catalog. Find the chunk that contains `id:"grok-4.5"` and `output:`, then read each model's `output` field.

## Parsing

### Markdown table (Other Models)

1. Find the table that starts with `| Model | Provider | Input | ...` (cells may be space-padded; trim after splitting on `|`)
2. For each data row (skip the header separator `| --- | --- | ...`):
   - **Model column**: Extract the display name. Format is either `[Display Name](url)` or plain text. For markdown links, use the text inside the brackets. Examples: `[Claude 4.6 Opus](https://...)` → `Claude 4.6 Opus`; `Kimi K2.5` → `Kimi K2.5`
   - **Output column**: Parse the dollar amount. Format is `$X` or `$X.Y`. Use regex `\$(\d+(?:\.\d+)?)` to extract the number. If the cell is `-` or empty, treat as 0. Use the Output column even when Notes mention temporary promo pricing.

### Cursor Models / Auto Cost cards

From the pricing catalog chunk (and/or page `modelId`s):

- Include visible first-party models referenced on the page: currently `grok-4.5` and `composer-2.5` (use catalog `id` as the model id; take `output`)
- Map catalog `auto-cost` → model id **`auto`** (never emit `auto-cost`)
- Do **not** emit hidden catalog-only models (e.g. `composer-1`) or Fast `subRows` unless they appear as their own markdown row / page `modelId`

## Model ID normalization

Convert display names to model IDs that match what Cursor stores in state.vscdb. Use this normalization:

- Lowercase
- Replace spaces with hyphens
- Keep `.` in version numbers (e.g. `4.6` stays `4.6`, not `4-6`)
- Remove parentheticals like `(Fast mode)` / `(fast mode)` (case-insensitive) and append `-fast` to the base name: `Claude Opus 4.7 (fast mode)` → `claude-opus-4.7-fast`
- Normalize Anthropic names literally from display order (`Claude Opus 4.8` → `claude-opus-4.8`; older `Claude 4.6 Opus` → `claude-4.6-opus`)
- For provider-prefixed models like `accounts/fireworks/models/kimi-k2-instruct`, keep the full path; also add the simple normalized ID

Examples:
- `Claude 4.6 Opus` → `claude-4.6-opus`
- `Claude Opus 4.7 (fast mode)` → `claude-opus-4.7-fast`
- `GPT-5.4` → `gpt-5.4`
- `Composer 2.5` → `composer-2.5`
- `Gemini 3.1 Pro` → `gemini-3.1-pro`

## Tier thresholds (output price per 1M tokens)

| Tier | Output price |
|------|--------------|
| cheap | < $5 |
| daily driver | $5 ≤ output < $20 |
| expensive | $20 ≤ output < $50 |
| extremely expensive | ≥ $50 |

Sonnet ($15) = daily driver. Opus ($25+) = expensive.

**Special cases:**
- **`auto`**: Cursor stores `"default"` in state when the user selects Auto; the extension maps it to `"auto"`. Always include an `"auto"` entry with tier **`cheap`** even if the Auto Cost output rate would otherwise be `daily driver` (Auto Cost is included in the Pro plan). Use the Auto Cost catalog `output` (e.g. 6) for the `output` field. Never emit `auto-cost`.

## Output format

Write to `model_tiers.json` at the repo root. Each model must include both `tier` and `output` (output price per 1M tokens) so the extension can compute effective cost when Max Mode is enabled:

```json
{
  "lastUpdated": "<ISO 8601 timestamp>",
  "<model-id>": { "tier": "<tier>", "output": <number> },
  ...
}
```

Example: `"claude-4.5-sonnet": { "tier": "daily driver", "output": 15 }`

## Variant Suffixes and Max Mode

The extension handles cost modifiers at runtime. Do not add `-thinking`, `-high`, or `-high-thinking` variants to model_tiers.json. The extension strips these suffixes and applies multipliers:

- `-thinking`: 2x (thinking models generate significantly more output tokens)
- `-high`: 1.5x (high reasoning effort)
- `-high-thinking`: 3x (combined)
- Max Mode: 1.2x (on top of suffix multiplier)

Effective output = base output × suffix multiplier × max mode multiplier. Red bar when effective output ≥ $20.

Example: `claude-4.6-sonnet-thinking` → base = claude-4.6-sonnet ($15) × 2 = $30 → expensive.

## Verification

After writing, ensure:
- `lastUpdated` is set to the current time in ISO 8601 format
- All models from the Cursor docs **Other Models** table are present
- First-party page models (`grok-4.5`, `composer-2.5`) and `"auto"` are present
- Claude 4.6 Opus ($25) is "expensive"
- Claude Opus 4.7 (fast mode) ($150) is "extremely expensive" (`claude-opus-4.7-fast`)
- An `"auto"` entry exists with tier `"cheap"` (Cursor stores Auto as "default"; extension maps to "auto")
- No duplicate model IDs; no `auto-cost`; no hidden catalog-only models; no Fast `subRows` unless listed as their own row
