# Generate model_tiers.json from Cursor Docs

This prompt is used by a Cursor automation to keep `model_tiers.json` up to date. Run daily or when Cursor adds new models.

---

## Task

Fetch the Cursor models and pricing page, parse the model pricing table **and** the Cursor Models / Auto Cost pricing cards, and regenerate `model_tiers.json` in the repo root with model tiers derived from output price.

## Source

**URL (markdown):** https://cursor.com/docs/models-and-pricing.md

Fetch the raw markdown. The page contains a table under "### Model pricing" with columns: Model | Provider | Input | Cache write | Cache read | Output | Notes.

**URL (HTML):** https://cursor.com/docs/models-and-pricing

The markdown table covers **Other Models** only. First-party Cursor pricing is rendered as model cards on the HTML page (not always present as rows in the markdown table):

- **Grok 4.5 pricing** → model id `grok-4.5`
- **Composer pricing** → model id `composer-2.5`
- **Auto Cost** → model id `auto` (see special cases)

Those cards are hydrated from Cursor’s docs model catalog (a `docs-static/_next/static/chunks/*.js` bundle that contains `id:"grok-4.5"`, `id:"composer-2.5"`, `id:"auto-cost"` with `output:` prices). After fetching the HTML, locate that chunk and read each card’s `output` field. Do **not** emit hidden catalog-only models (e.g. `composer-1`) or Fast `subRows` unless they also appear as their own markdown table row or dedicated pricing-card `modelId` on the page.

## Parsing

1. Find the markdown table by splitting each line on `|`, trimming cells, and matching a header where cells are `Model`, `Provider`, `Input`, …, `Output` (raw markdown pads cells with spaces; do not require exact `| Model | Provider |` spacing).
2. For each data row (skip the header separator `| --- | --- | ...`):
   - **Model column**: Extract the display name. Format is either `[Display Name](url)` or plain text. For markdown links, use the text inside the brackets. Examples: `[Claude 4.6 Opus](https://...)` → `Claude 4.6 Opus`; `Kimi K2.7 Code` → `Kimi K2.7 Code`
   - **Output column**: Parse the dollar amount. Format is `$X` or `$X.Y`. Use regex `\$(\d+(?:\.\d+)?)` to extract the number. If the cell is `-` or empty, treat as 0. Use the Output column value even when Notes mention temporary promo pricing.
3. Merge in Grok 4.5, Composer 2.5, and Auto Cost from the HTML pricing cards / docs model catalog as described above.

## Model ID normalization

Convert display names to model IDs that match what Cursor stores in state.vscdb. Use this normalization:

- Lowercase
- Replace spaces with hyphens
- Keep `.` in version numbers (e.g. `4.6` stays `4.6`, not `4-6`)
- Normalize literally from the display name order (newer Anthropic names flip family/version: `Claude Opus 4.8` → `claude-opus-4.8`, not `claude-4.8-opus`)
- Remove parentheticals like `(Fast mode)` / `(fast mode)` (case-insensitive) and append `-fast` to the base name: `Claude Opus 4.7 (fast mode)` → `claude-opus-4.7-fast`
- For provider-prefixed models like `accounts/fireworks/models/kimi-k2-instruct`, keep the full path; also add the simple normalized ID

Examples:
- `Claude 4.6 Opus` → `claude-4.6-opus`
- `Claude Opus 4.7 (fast mode)` → `claude-opus-4.7-fast`
- `Claude Opus 4.8` → `claude-opus-4.8`
- `Claude Sonnet 5` → `claude-sonnet-5`
- `GPT-5.4` → `gpt-5.4`
- `Composer 2.5` → `composer-2.5`
- `Gemini 3.1 Pro` → `gemini-3.1-pro`
- `Grok 4.5` → `grok-4.5`
- `Kimi K2.7 Code` → `kimi-k2.7-code`

## Tier thresholds (output price per 1M tokens)

| Tier | Output price |
|------|--------------|
| cheap | < $5 |
| daily driver | $5 ≤ output < $20 |
| expensive | $20 ≤ output < $50 |
| extremely expensive | ≥ $50 |

Sonnet ($15) = daily driver. Opus ($25+) = expensive.

**Special cases:**
- **`auto`**: The Auto Cost pricing card / catalog id is `auto-cost`. Map it to model id `"auto"` (never emit `auto-cost` — normal thresholds would wrongly mark $6 as daily driver). Cursor stores `"default"` in state when the user selects Auto; the extension maps it to `"auto"`. Always include an `"auto"` entry with tier `cheap` (Auto is included in the Pro plan). Use the Auto Cost output rate (e.g. 6) for the `output` field.

## Output format

Write to `model_tiers.json` at the repo root. Prefer compact one-line JSON entries per model to match repo style. Each model must include both `tier` and `output` (output price per 1M tokens) so the extension can compute effective cost when Max Mode is enabled:

```json
{
  "lastUpdated": "<ISO 8601 timestamp>",
  "<model-id>": { "tier": "<tier>", "output": <number> },
  ...
}
```

Example: `"claude-4.5-sonnet": { "tier": "daily driver", "output": 15 }`

## Variant Suffixes and Max Mode

The extension handles cost modifiers at runtime. Do not add `-thinking`, `-high`, or `-high-thinking` variants to model_tiers.json. Do not invent separate rows for Fast mode variants that appear only in Notes or as pricing-card `subRows` without their own markdown table row. The extension strips these suffixes and applies multipliers:

- `-thinking`: 2x (thinking models generate significantly more output tokens)
- `-high`: 1.5x (high reasoning effort)
- `-high-thinking`: 3x (combined)
- Max Mode: 1.2x (on top of suffix multiplier)

Effective output = base output × suffix multiplier × max mode multiplier. Red bar when effective output ≥ $20.

Example: `claude-4.6-sonnet-thinking` → base = claude-4.6-sonnet ($15) × 2 = $30 → expensive.

## Verification

After writing, ensure:
- `lastUpdated` is set to the current time in ISO 8601 format
- All models from the Cursor docs markdown table are present
- `grok-4.5`, `composer-2.5`, and `auto` are present (from Cursor Models / Auto Cost cards)
- `claude-4.6-opus` ($25) is "expensive"
- `claude-opus-4.7-fast` ($150) is "extremely expensive"
- `claude-fable-5` ($50) is "extremely expensive"
- `composer-2.5` ($2.5) is "cheap"
- `gpt-5.5` / `gpt-5.6-sol` ($30) are "expensive"
- An `"auto"` entry exists with tier `"cheap"` and no `"auto-cost"` key (Cursor stores Auto as "default"; extension maps to "auto")
- No duplicate model IDs
