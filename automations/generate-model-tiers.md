# Generate model_tiers.json from Cursor Docs

This prompt is used by a Cursor automation to keep `model_tiers.json` up to date. Run daily or when Cursor adds new models.

---

## Task

Fetch the Cursor models and pricing page, parse model pricing from **both** the markdown Other Models table and the HTML/catalog Cursor Models + Auto Cost cards, and regenerate `model_tiers.json` in the repo root with model tiers derived from output price.

## Sources

### 1. Markdown (Other Models)

**URL:** https://cursor.com/docs/models-and-pricing.md

Fetch the raw markdown. The page contains a table under "### Model pricing" with columns: Model | Provider | Input | Cache write | Cache read | Output | Notes.

This table is **Other Models only**. It does **not** include Cursor Grok, Composer, or Auto Cost pricing.

### 2. HTML + pricing catalog (Cursor Models / Auto Cost)

**URL:** https://cursor.com/docs/models-and-pricing

1. Fetch the HTML page and collect first-party `modelId`s shown as cards (currently `grok-4.5`, `composer-2.5`, `auto-cost`).
2. Load the hashed pricing catalog from `docs-static/_next/static/chunks/*.js` (find the chunk that contains `id:"grok-4.5"` and `output:`).
3. For each page card `modelId`, read `output` from the catalog entry.
4. Map `auto-cost` → model id `auto` (never emit `auto-cost`).
5. Do **not** emit hidden catalog-only models (e.g. `composer-1`) or Fast `subRows` unless they appear as their own markdown table row or page card `modelId`.

## Parsing (markdown table)

1. Find the table that starts with `| Model | Provider | Input | ...` (cells may be space-padded; trim before matching).
2. For each data row (skip the header separator `| --- | --- | ...`):
   - **Model column**: Extract the display name. Format is either `[Display Name](url)` or plain text. For markdown links, use the text inside the brackets. Examples: `[Claude 4.6 Opus](https://...)` → `Claude 4.6 Opus`; `Kimi K2.7 Code` → `Kimi K2.7 Code`
   - **Output column**: Parse the dollar amount. Format is `$X` or `$X.Y`. Use regex `\$(\d+(?:\.\d+)?)` to extract the number. If the cell is `-` or empty, treat as 0. Use the Output column value even when Notes mention temporary promo pricing.

## Model ID normalization

Convert display names to model IDs that match what Cursor stores in state.vscdb. Use this normalization:

- Lowercase
- Replace spaces with hyphens
- Keep `.` in version numbers (e.g. `4.6` stays `4.6`, not `4-6`)
- Remove parentheticals like `(Fast mode)` / `(fast mode)` (case-insensitive) and append `-fast` to the base name: `Claude Opus 4.7 (fast mode)` → `claude-opus-4.7-fast`
- Normalize Anthropic names **literally** from display order. Newer names flip family/version (`Claude Opus 4.8` → `claude-opus-4.8`) vs older `Claude 4.6 Opus` → `claude-4.6-opus`
- For provider-prefixed models like `accounts/fireworks/models/kimi-k2-instruct`, keep the full path; also add the simple normalized ID

Examples:
- `Claude 4.6 Opus` → `claude-4.6-opus`
- `Claude Opus 4.7 (fast mode)` → `claude-opus-4.7-fast`
- `GPT-5.4` → `gpt-5.4`
- `Composer 2.5` → `composer-2.5`
- `Gemini 3.1 Pro` → `gemini-3.1-pro`
- `Grok 4.5` → `grok-4.5`

## Tier thresholds (output price per 1M tokens)

| Tier | Output price |
|------|--------------|
| cheap | < $5 |
| daily driver | $5 ≤ output < $20 |
| expensive | $20 ≤ output < $50 |
| extremely expensive | ≥ $50 |

Sonnet ($15) = daily driver. Opus ($25+) = expensive.

**Special cases:**
- **`auto`**: Cursor stores `"default"` in state when the user selects Auto; the extension maps it to `"auto"`. Always include an `"auto"` entry with tier `cheap` (Auto is included in the Pro plan), even if the Auto Cost output rate would otherwise be daily driver. Use the Auto Cost catalog `output` rate (e.g. 6) for the `output` field.

## Output format

Write to `model_tiers.json` at the repo root. Prefer compact one-line JSON entries. Each model must include both `tier` and `output` (output price per 1M tokens) so the extension can compute effective cost when Max Mode is enabled:

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

## Version / changelog

Every PR that regenerates tiers must also:

1. Bump `package.json` `version` (and root `package-lock.json` versions) above the latest Open VSX published version
2. Update `CHANGELOG.md` in the same commit

Use patch bumps for routine tier refreshes; minor if the generation logic/docs change meaningfully alongside new models.

## Verification

After writing, ensure:
- `lastUpdated` is set to the current time in ISO 8601 format
- All models from the Cursor docs markdown table are present
- Cursor Models card ids from the HTML page are present (`grok-4.5`, `composer-2.5`)
- An `"auto"` entry exists with tier `"cheap"` (mapped from `auto-cost`; Cursor stores Auto as "default"; extension maps to "auto")
- Claude 4.6 Opus ($25) is "expensive"
- Claude Opus 4.7 (fast mode) ($150) is "extremely expensive"
- No duplicate model IDs
- No hidden catalog-only models that are not on the page/table
