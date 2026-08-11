# Generate model_tiers.json from Cursor Docs

This prompt is used by a Cursor automation to keep `model_tiers.json` up to date. Run daily or when Cursor adds new models.

---

## Task

Fetch Cursor model pricing from the docs, parse both the Other Models markdown table and the Cursor Models / Auto Cost card prices, and regenerate `model_tiers.json` in the repo root with model tiers derived from output price.

## Sources

### 1. Markdown (Other Models table)

**URL:** https://cursor.com/docs/models-and-pricing.md

Fetch the raw markdown. The page contains a table under "### Model pricing" with columns: Model | Provider | Input | Cache write | Cache read | Output | Notes.

As of 2026-08, this markdown table is **Other Models only**. First-party Cursor Models and Auto Cost are rendered as HTML cards, not markdown rows.

### 2. HTML + pricing catalog (Cursor Models / Auto)

**HTML URL:** https://cursor.com/docs/models-and-pricing

The page references first-party `modelId`s such as `grok-4.5`, `composer-2.5`, and `auto-cost`. Their output prices live in a hashed Next.js chunk under `docs-static/_next/static/chunks/*.js`.

To resolve prices:
1. Fetch the HTML page and collect `docs-static/_next/static/chunks/*.js` script URLs.
2. Download chunks and find the pricing catalog (search for `id:"grok-4.5"` together with `output:`).
3. Read each model's `output` field from that catalog object (not from Fast `subRows` unless that variant is its own page `modelId` or markdown row).

   Search far enough after `id:"…"` to find `output:` (Composer 2.5's fields can sit several hundred characters past the id because of long tagline/link strings). Prefer matching the object starting at `{id:"…"` and take that object's `output` field.

Always include these first-party entries when present on the page:
- `grok-4.5` → model id `grok-4.5`
- `composer-2.5` → model id `composer-2.5`
- `auto-cost` → model id `auto` (never emit `auto-cost`)

Do **not** emit hidden catalog-only models that are absent from the markdown table and are not page card `modelId`s (for example obsolete `composer-1`).

## Parsing (markdown table)

1. Find the table that starts with `| Model | Provider | Input | ...` (cells may be padded with spaces; trim after splitting on `|`).
2. For each data row (skip the header separator `| --- | --- | ...`):
   - **Model column**: Extract the display name. Format is either `[Display Name](url)` or plain text. For markdown links, use the text inside the brackets. Examples: `[Claude 4.6 Opus](https://...)` → `Claude 4.6 Opus`; `Kimi K2.7 Code` → `Kimi K2.7 Code`
   - **Output column**: Parse the dollar amount. Format is `$X` or `$X.Y`. Use regex `\$(\d+(?:\.\d+)?)` to extract the number. If the cell is `-` or empty, treat as 0.
   - Use the Output column value even when Notes mention temporary promo pricing.

## Model ID normalization

Convert display names to model IDs that match what Cursor stores in state.vscdb. Use this normalization:

- Lowercase
- Replace spaces with hyphens
- Keep `.` in version numbers (e.g. `4.6` stays `4.6`, not `4-6`)
- Remove parentheticals like `(Fast mode)` / `(fast mode)` (case-insensitive) and append `-fast` to the base name: `Claude Opus 4.7 (fast mode)` → `claude-opus-4.7-fast`
- Normalize Anthropic names literally from display order. Newer names flip family/version (`Claude Opus 4.8`, `Claude Sonnet 5`) vs older `Claude 4.6 Opus` style:
  - `Claude 4.6 Opus` → `claude-4.6-opus`
  - `Claude Opus 4.8` → `claude-opus-4.8`
  - `Claude Sonnet 5` → `claude-sonnet-5`
- For provider-prefixed models like `accounts/fireworks/models/kimi-k2-instruct`, keep the full path; also add the simple normalized ID

Examples:
- `Claude 4.6 Opus` → `claude-4.6-opus`
- `Claude Opus 4.7 (fast mode)` → `claude-opus-4.7-fast`
- `GPT-5.4` → `gpt-5.4`
- `GPT-5.6 Sol` → `gpt-5.6-sol`
- `Composer 2.5` → `composer-2.5`
- `Gemini 3.1 Pro` → `gemini-3.1-pro`
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
- **`auto`**: Cursor stores `"default"` in state when the user selects Auto; the extension maps it to `"auto"`. Always include an `"auto"` entry with tier `cheap` (Auto is included in the Pro plan), even though the Auto pool output rate ($6) would otherwise be "daily driver". Use the Auto Cost card / catalog `output` value for the `output` field. Map catalog id `auto-cost` → `auto`; never write `auto-cost` into `model_tiers.json`.

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

The extension handles cost modifiers at runtime. Do not add `-thinking`, `-high`, or `-high-thinking` variants to model_tiers.json. Do not add Fast `subRows` from the catalog unless they appear as their own markdown row or page `modelId`. The extension strips these suffixes and applies multipliers:

- `-thinking`: 2x (thinking models generate significantly more output tokens)
- `-high`: 1.5x (high reasoning effort)
- `-high-thinking`: 3x (combined)
- Max Mode: 1.2x (on top of suffix multiplier)

Effective output = base output × suffix multiplier × max mode multiplier. Red bar when effective output ≥ $20.

Example: `claude-4.6-sonnet-thinking` → base = claude-4.6-sonnet ($15) × 2 = $30 → expensive.

## Verification

After writing, ensure:
- `lastUpdated` is set to the current time in ISO 8601 format
- All models from the Cursor docs Other Models table are present
- Cursor Models / Auto cards are present: `auto`, `composer-2.5`, `grok-4.5` (when listed on the page)
- Claude 4.6 Opus ($25) is "expensive"
- Claude Opus 4.7 (fast mode) ($150) is "extremely expensive"
- An `"auto"` entry exists with tier `"cheap"` and output from the Auto Cost card (currently 6)
- No duplicate model IDs
- Typical size: markdown row count + `auto` + `composer-2.5` + `grok-4.5` (e.g. 40 + 3 = 43)

## Also required for every PR

- Bump `package.json` `version` (and root `package-lock.json` version fields) above the latest Open VSX published version
- Update `CHANGELOG.md` in the same commit as the version bump
