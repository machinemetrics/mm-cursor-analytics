# Generate model_tiers.json from Cursor Docs

This prompt is used by a Cursor automation to keep `model_tiers.json` up to date. Run daily or when Cursor adds new models.

---

## Task

Fetch the Cursor models and pricing page, parse every model pricing table, and regenerate `model_tiers.json` in the repo root with model tiers derived from output price.

## Source

**URL:** https://cursor.com/docs/models-and-pricing.md

Fetch the raw markdown. The page has two tables with columns `Model | Provider | Input | Cache write | Cache read | Output | Notes`:

1. The **Cursor Models** table (Grok, Composer, and other first-party models)
2. The table under **### Model pricing** (third-party models)

Parse both. Ignore other tables (plans, for example) whose headers do not start with `| Model | Provider | Input |`.

## Parsing

1. Find every table whose header row starts with `| Model | Provider | Input |`
2. For each data row (skip the header separator `| --- | --- | ...`):
   - **Model column**: Extract the display name. Format is either `[Display Name](url)` or plain text. For markdown links, use the text inside the brackets. Examples: `[Claude 4.6 Opus](https://...)` → `Claude 4.6 Opus`; `Kimi K2.7 Code` → `Kimi K2.7 Code`
   - **Output column**: Parse the dollar amount. Format is `$X` or `$X.Y`. Use regex `\$(\d+(?:\.\d+)?)` to extract the number. If the cell is `-` or empty, treat as 0.
   - **Notes column**: Keep the raw text. It names some fast-mode ids and multipliers (see below).

Docs URL slugs are not model ids. `gemini-3-8-flash` in a docs path is stored as `gemini-3.8-flash`. Use a backtick id from the notes or model page when one is given; otherwise use the normalization rules below.

## Model ID normalization

Convert display names to model IDs that match what Cursor stores in state.vscdb:

- Lowercase
- Replace spaces with hyphens
- Keep `.` in version numbers (e.g. `4.6` stays `4.6`, not `4-6`), except the Claude family-first case below
- A trailing parenthetical whose text is `fast` or `fast mode` (any case) is removed and `-fast` is appended: `Grok 4.7 (Fast)` → `grok-4.7-fast`; `Claude Opus 4.7 (fast mode)` → `claude-opus-4-7-fast`
- **Claude family-first names** (`Claude Opus …`, `Claude Sonnet …`, `Claude Haiku …`, `Claude Fable …`): after the generic normalization, replace remaining `.` with `-`. Cursor stores these with hyphenated versions, confirmed by notes and model pages (`claude-opus-5-5-fast`, `claude-opus-4-8-fast`, `claude-fable-5-1`). Older `Claude {version} {family}` names stay dotted: `Claude 4.6 Opus` → `claude-4.6-opus`
- For provider-prefixed models like `accounts/fireworks/models/kimi-k2-instruct`, keep the full path; also add the simple normalized ID

Examples:
- `Claude 4.6 Opus` → `claude-4.6-opus`
- `Claude Opus 5.5` → `claude-opus-5-5`
- `Claude Fable 5.1` → `claude-fable-5-1`
- `Claude Opus 4.7 (fast mode)` → `claude-opus-4-7-fast`
- `GPT-5.4` → `gpt-5.4`
- `GPT-5.6 Sol` → `gpt-5.6-sol`
- `Composer 2.5` → `composer-2.5`
- `Gemini 3.1 Pro` → `gemini-3.1-pro`
- `Grok 4.7 500k (Fast)` → `grok-4.7-500k-fast`
- `Muse Spark 1.3` → `muse-spark-1.3`

## Fast-mode ids that are not their own row

Table rows win. Build those entries first.

Then, for a base row that is not already a fast variant, add a `-fast` id when it is not already present:

- If Notes contain a backtick id ending in `-fast` (backticks may be escaped as `` \`id\` ``), use that id.
- Otherwise, if Notes say fast mode is **2x** the row (`2x pricing`, `with 2x pricing`, `at 2x pricing`, `2x the standard price`, `2x the standard rates`), the id is the base id plus `-fast` and output is `2 ×` the row output.
- If Notes say fast mode is **3x lower** than another fast row already parsed, output is that row's output `/ 3` (Opus 4.7 fast mode at $150 → `claude-opus-4-8-fast` at $50).
- If Notes name a fast id but do not state a numeric multiple, fetch `https://cursor.com/docs/models/{base-id}.md` and use the output price from “bills at $X/M input and $Y/M output”. If that page does not state a number, omit the fast id (do not invent a price). Example: `claude-opus-5-fast` is $50 and `claude-opus-5-5-fast` is $40 on those model pages. `gpt-5.5-fast` has no stated output price, so it is omitted.

Do not synthesize long-context multipliers (500k, 1M, 2x above a token threshold) as extra ids. Those are either their own rows or runtime context billing.

## Tier thresholds (output price per 1M tokens)

| Tier | Output price |
|------|--------------|
| cheap | < $5 |
| daily driver | $5 ≤ output < $20 |
| expensive | $20 ≤ output < $50 |
| extremely expensive | ≥ $50 |

Sonnet ($15) = daily driver. Opus 4.6 ($25) = expensive. Opus 5.5 ($20) = expensive. Fable ($50) = extremely expensive.

**Special cases:**
- **`auto`**: Cursor stores `"default"` in state when the user selects Auto; the extension maps it to `"auto"`. Always include an `"auto"` entry with tier `cheap` (Auto is included in the Pro plan). The pricing page no longer publishes one Auto pool rate (Auto bills at the routed model's list price). Keep `"output": 6` so an Auto-only selection stays under the $20 red-bar threshold.

Only include models present on the current pricing page (plus the fast ids and `auto` entry above). Drop models that disappeared from the page.

## Output format

Write to `model_tiers.json` at the repo root. `lastUpdated` is first; model ids follow in alphabetical order. Each model must include both `tier` and `output` (output price per 1M tokens) so the extension can compute effective cost when Max Mode is enabled:

```json
{
  "lastUpdated": "<ISO 8601 timestamp>",
  "<model-id>": { "tier": "<tier>", "output": <number> }
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

`-fast` is a separately priced model, not a suffix the extension strips. Include fast ids as their own entries.

## Verification

After writing, ensure:
- `lastUpdated` is set to the current time in ISO 8601 format
- All models from both Cursor docs pricing tables are present
- Claude 4.6 Opus ($25) is `claude-4.6-opus` / "expensive"
- Claude Opus 4.7 (fast mode) ($150) is `claude-opus-4-7-fast` / "extremely expensive"
- Claude Opus 5.5 ($20) is `claude-opus-5-5` / "expensive"
- Claude Opus 5.5 fast ($40) is `claude-opus-5-5-fast` / "expensive"
- An `"auto"` entry exists with tier `"cheap"` and output `6`
- No `-high`, `-thinking`, or `-high-thinking` keys
- No duplicate model IDs
