# Generate model_tiers.json from Cursor Docs

This prompt is used by a Cursor automation to keep `model_tiers.json` up to date. Run daily or when Cursor adds new models.

---

## Task

Fetch the Cursor models and pricing page, parse every model pricing table, and regenerate `model_tiers.json` in the repo root with model tiers derived from output price.

## Source

**URL:** https://cursor.com/docs/models-and-pricing.md

Fetch the raw markdown. The page has two model tables that share this header:

`| Model | Provider | Input | Cache write | Cache read | Output | Notes |`

1. The **Cursor Models** table (Grok, Composer, and other first-party models).
2. The **Model pricing** table under `### Model pricing` (third-party models).

Parse both. Ignore other tables (plans, for example) whose headers are different.

When a row's Notes name a fast-mode model id in backticks and that id is not its own row, the fast-mode output price may be stated on the model's doc page: `https://cursor.com/docs/models/<slug>.md` (dots in the id are hyphens in the slug; strip a trailing `-fast` to get the base page). Use that page only to price a fast id the pricing notes already name.

## Parsing

1. Find every table whose header row is `| Model | Provider | Input | ... | Output | Notes |`.
2. For each data row (skip the header separator `| --- | --- | ...`):
   - **Model column**: Extract the display name. Format is either `[Display Name](url)` or plain text. For markdown links, use the text inside the brackets. Examples: `[Claude 4.6 Opus](https://...)` → `Claude 4.6 Opus`; `Kimi K2.5` → `Kimi K2.5`
   - **Output column**: Parse the dollar amount. Format is `$X` or `$X.Y`. Use regex `\$(\d+(?:\.\d+)?)` to extract the number. If the cell is `-` or empty, treat as 0.
   - Use the Output column only. Do not replace it with image-token rates or other prices mentioned in Notes.

## Model ID normalization

Convert display names to model IDs that match what Cursor stores in state.vscdb. Emit every id below that applies. Skip an id that was already emitted for the same output price.

### Simple id (always)

- Lowercase
- Replace spaces and other separators with hyphens
- Keep `.` in version numbers (e.g. `4.6` stays `4.6`, not `4-6`)
- Remove parentheticals. If the parenthetical is a fast-mode marker (`Fast`, `fast mode`, any case), append `-fast` to the base name: `Claude 4.6 Opus (Fast mode)` → `claude-4.6-opus-fast`; `Grok 4.7 (Fast)` → `grok-4.7-fast`; `Claude Opus 4.7 (fast mode)` → `claude-opus-4.7-fast`
- For provider-prefixed models like `accounts/fireworks/models/kimi-k2-instruct`, keep the full path; also add the simple normalized id

Examples:
- `Claude 4.6 Opus` → `claude-4.6-opus`
- `Claude 4.6 Opus (Fast mode)` → `claude-4.6-opus-fast`
- `GPT-5.4` → `gpt-5.4`
- `Composer 2.5` → `composer-2.5`
- `Gemini 3.1 Pro` → `gemini-3.1-pro`

### Claude canonical id (also emit)

Cursor's current Claude ids put the family before a hyphenated version: `claude-opus-4-6`, `claude-haiku-4-5`, `claude-opus-5-5`, `claude-fable-5-1`. Docs and the product catalog use this form (`claude-opus-4-8`, `claude-opus-5`, `claude-opus-5-5-fast`).

Also emit `claude-{family}-{version}` when the display name is a Claude model:

- Family is one of `opus`, `sonnet`, `haiku`, `fable`
- Split the numeric version on `.` and join with `-` (`4.6` → `4-6`, `5.5` → `5-5`, `5` stays `5`)
- Keep extra suffixes such as `1m` (`Claude 4 Sonnet 1M` → `claude-sonnet-4-1m`)
- Append `-fast` when the row is a fast-mode row

Keep the simple id as well when it differs, so older clients that still store `claude-4.6-opus` continue to match.

Examples:
- `Claude 4.6 Opus` → `claude-4.6-opus` and `claude-opus-4-6`
- `Claude 4.5 Haiku` → `claude-4.5-haiku` and `claude-haiku-4-5`
- `Claude Opus 4.8` → `claude-opus-4.8` and `claude-opus-4-8`
- `Claude Opus 5.5` → `claude-opus-5.5` and `claude-opus-5-5`
- `Claude Opus 4.7 (fast mode)` → `claude-opus-4.7-fast` and `claude-opus-4-7-fast`
- `Claude Fable 5` → `claude-fable-5`
- `Claude Fable 5.1` → `claude-fable-5.1` and `claude-fable-5-1`

### Grok catalog alias (also emit)

The model catalog stores some Grok ids with a `cursor-` prefix (`cursor-grok-4.6`) and some without (`grok-4.7`). For every Grok simple id, also emit the same id prefixed with `cursor-`.

Examples:
- `Grok 4.7` → `grok-4.7` and `cursor-grok-4.7`
- `Grok 4.6 (Fast)` → `grok-4.6-fast` and `cursor-grok-4.6-fast`

### Fast-mode ids named in Notes

Fast mode is sometimes its own table row and sometimes only named in Notes.

- If Notes contain a backtick model id ending in `-fast` (the pricing markdown escapes backticks) and that id is not already the row's own id, add it at the fast-mode output price, not the base row price.
- Resolve that price in order:
  1. A `$N/M output` amount in the same Notes clause as the id.
  2. An `{n}x lower per-token pricing than {other model}` clause, divided into the other row's output price. Example: Opus 4.7 fast mode is $150 and Opus 4.8 notes say fast mode is 3x lower, so `claude-opus-4-8-fast` is $50.
  3. Otherwise open the model doc page and read the fast-mode sentence (`$N/M output`, or `{n}x` the standard rates applied to this row's output).
- If Notes say fast mode is `2x` (`Fast mode is available at 2x pricing`, `with 2x pricing`, or `at 2x the standard rates`) and this row is not itself a fast row and there is no sibling fast row (`{Name} (Fast)`, `{Name} (fast mode)`, or `{Name} Fast`), also add `{simple-id}-fast` at `output × 2`. Apply the Claude canonical and Grok alias rules to that fast id too.
- Do not invent a price when Notes only say "higher rates" and the model doc does not give a number. Skip that fast id.
- Do not apply the 2x rule to a row that already has a sibling fast row. Those siblings are priced on their own line (Grok 4.5 fast is $18, not 2×$6; Grok 4.7 500k fast is $18, not 2×$12).

## Tier thresholds (output price per 1M tokens)

| Tier | Output price |
|------|--------------|
| cheap | < $5 |
| daily driver | $5 ≤ output < $20 |
| expensive | $20 ≤ output < $50 |
| extremely expensive | ≥ $50 |

Sonnet at $10–$15 = daily driver. Opus at $25 = expensive. Opus at $20 (Opus 5.5) = expensive. Fable at $50 = extremely expensive. Opus 4.7 fast mode at $150 = extremely expensive.

**Special cases:**
- **`auto`**: Cursor stores `"default"` in state when the user selects Auto; the extension maps `"default"` and `"auto-smart"` to `"auto"`. Always include an `"auto"` entry with tier `cheap`. Auto no longer has a separate pool rate — each request bills at the routed model's list price — but the extension still shows $ whenever any context is Auto. Keep `"output": 6` on the `auto` entry (the historical pool rate). Do not retier `auto` from a routed model.

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

Sort model ids alphabetically. `lastUpdated` stays first. No duplicate model ids. If two rules produce the same id at different prices, stop and fix the rules — do not silently keep one.

## Variant Suffixes and Max Mode

The extension handles cost modifiers at runtime. Do not add effort variants to model_tiers.json. The extension strips these suffixes and applies multipliers:

- `-high-thinking` and `-thinking-high`: 3x (combined)
- `-thinking`: 2x (thinking models generate significantly more output tokens)
- `-high`: 1.5x (high reasoning effort)
- `-xhigh`, `-max`, `-medium`, `-low`, `-none`, `-minimal`: stripped so the base model matches, with no extra multiplier. Do not strip `-max` off an id that is itself a table row (`gpt-5.1-codex-max`).
- A trailing `-fast`, or `[fast=true]`, uses the `{base}-fast` entry when that entry exists. Fast mode is not a flat multiplier; its price comes from the table or the fast-mode rules above.
- Bracket parameters such as `claude-opus-5[effort=high]` and `composer-2.5[fast=false]` are stripped the same way.
- Max Mode: 1.2x (on top of the suffix multiplier)

Effective output = base output × suffix multiplier × max mode multiplier. Red bar when effective output ≥ $20.

Example: `claude-4.6-sonnet-thinking` → base = claude-4.6-sonnet ($15) × 2 = $30 → expensive.

Example: `claude-opus-5-5-high` → base = claude-opus-5-5 ($20) × 1.5 = $30 → expensive.

## Verification

After writing, ensure:
- `lastUpdated` is set to the current time in ISO 8601 format
- Every data row from both model tables is present under its simple id
- Claude canonical ids and `cursor-grok-*` aliases described above are present
- Claude 4.6 Opus ($25) is "expensive" for both `claude-4.6-opus` and `claude-opus-4-6`
- Claude Opus 4.7 (fast mode) ($150) is "extremely expensive" for `claude-opus-4-7-fast`
- `claude-opus-4-8-fast` is "extremely expensive" at output 50 when the pricing notes still name that id
- An `"auto"` entry exists with tier `"cheap"` and output `6`
- No duplicate model ids
