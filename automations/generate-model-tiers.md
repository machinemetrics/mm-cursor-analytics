# Generate model_tiers.json from Cursor Docs

This prompt is used by a Cursor automation to keep `model_tiers.json` up to date. Run daily or when Cursor adds new models.

---

## Task

Fetch Cursor model pricing from the docs, parse **all** markdown pricing tables (Cursor Models and Other Models) plus the catalog Auto rate when present, and regenerate `model_tiers.json` in the repo root with model tiers derived from output price.

## Sources

### 1. Markdown (Cursor Models + Other Models tables)

**URL:** https://cursor.com/docs/models-and-pricing.md

Fetch the raw markdown. As of 2026-09-24 the page has **two** tables with columns: Model | Provider | Input | Cache write | Cache read | Output | Notes:

- **Cursor Models** (first-party): Grok 4.7 (including Fast and 500k rows), Grok 4.6, Grok 4.5, Composer 2.5, and their Fast variants
- **Other Models** under `### Model pricing`: third-party models (including Claude Opus 5.5, Gemini 3.8 Flash, Claude Fable 5.1, GPT-5.6 Luna/Sol/Terra, GLM 5.2, and Muse Spark 1.3)

Parse **every** table whose header cells are `Model | Provider | ... | Output`. Skip the Plans table (`Plan | Price | ...`). Cells may be padded with spaces; trim after splitting on `|`.

### 2. HTML + pricing catalog (Auto rate / `auto-cost`, and stored model ids)

**HTML URL:** https://cursor.com/docs/models-and-pricing

Through 2026-09-07 the catalog included `auto-cost` (named **Legacy Enterprise Auto**, hidden). The rendered HTML showed a Legacy Enterprise Auto table (`$1.25 / $1.25 / $0.25 / $6`) and referenced `modelId` `auto-cost`.

As of 2026-09-08 that catalog entry and HTML table are **gone**. Docs now say all Auto modes bill at the list price of the model each request is routed to. Still emit `auto` because Cursor stores Auto as `"default"` and the extension maps that to `"auto"`. When `auto-cost` is absent, use the last known Auto Cost / Auto pool output rate (`$6`).

Output prices and stored model ids also live in a hashed Next.js chunk under `docs-static/_next/static/chunks/*.js`. Fetch chunks from `https://cursor.com` with the `?dpl=` query used by the HTML page (requests to `/docs/_next/...` return an error page).

To resolve Auto Cost / Legacy Enterprise Auto (and to cross-check first-party ids):
1. Fetch the HTML page and collect `docs-static/_next/static/chunks/*.js` script URLs.
2. Download chunks and find the pricing catalog (search for `id:"auto-cost"` or `id:"grok-4.7"` together with `output:`). The chunk hash changes over time (2026-09-24 and 2026-09-23: `03u56zy1bmq49.js`; 2026-09-21 through 2026-09-09: `109hvu9ixpa2f.js`; 2026-09-08: `0n5w.ptb66d.r.js`; 2026-09-07 through 2026-09-05: `15gbgx.vwkhtn.js`; 2026-09-04 and 2026-09-03: `0-fi77m__78_w.js`; 2026-09-02: `0~ms10zi70-sr.js`; 2026-09-01 through 2026-08-25: `07q5_bowxn4is.js`; was `0p1ggu34p8cgd.js` on 2026-08-23; was `0qfcspezy5-zl.js` on 2026-08-21).
3. Read each model's `output` field from that catalog object. Search far enough after `id:"…"` to find `output:` (Composer 2.5's fields can sit several hundred characters past the id because of long tagline/link strings). Prefer matching the object starting at `{id:"…"` and take that object's `output` field.
4. If `id:"auto-cost"` is present, use that object's `output` for the `auto` entry. If it is missing (as of 2026-09-08 through 2026-09-24), keep `auto` with output `6`.

The Teams pricing markdown (`https://cursor.com/docs/account/teams/pricing.md`) is a cross-check only. As of 2026-09-08 it also no longer lists Legacy Enterprise Auto / Auto Cost. It may still list hidden catalog-only rows such as Composer 1 — do not emit those. Source of truth for which models to emit is the models-and-pricing.md tables, plus catalog `auto-cost` when present, plus the catalog-id aliases below.

Always include:
- `auto` (never emit `auto-cost`). Map catalog `auto-cost` → `auto` when the catalog still has that id.
- Every markdown pricing-table row, including Fast variants that are their own rows (`Grok 4.7 (Fast)`, `Grok 4.7 500k`, `Grok 4.7 500k (Fast)`, `Grok 4.6 (Fast)`, `Composer 2.5 (Fast)`, `Claude Opus 4.7 (fast mode)`, …)

Do **not** emit hidden catalog-only models that are absent from the markdown tables and are not the `auto-cost` entry (for example obsolete `composer-1`). Do **not** add Fast `subRows` from the catalog unless they appear as their own markdown row (for example `gpt-5.5-fast`, `claude-opus-5-5-fast`, `claude-opus-5-fast`, `claude-opus-4-8-fast`).

Use **display-name normalization** for the primary key in `model_tiers.json`. The catalog mixes conventions (`claude-4-6-opus` vs `claude-opus-4-6`, `gpt-5.1` id with name `GPT-5`). state.vscdb historically matches dotted display names such as `claude-4.6-opus` and `gpt-5`. Also emit a catalog-id alias when the rules in **Catalog id aliases** match — Cursor's current model list stores some newer ids from the catalog (`claude-opus-5-5`, `grok-4.7-long`) rather than the display-name slug.

## Parsing (markdown tables)

1. Find each table that starts with `| Model | Provider | Input | ...` (cells may be padded with spaces; trim after splitting on `|`).
2. For each data row (skip the header separator `| --- | --- | ...`):
   - **Model column**: Extract the display name. Format is either `[Display Name](url)` or plain text. For markdown links, use the text inside the brackets. Examples: `[Claude 4.6 Opus](https://...)` → `Claude 4.6 Opus`; `Kimi K2.7 Code` → `Kimi K2.7 Code`
   - **Output column**: Parse the dollar amount. Format is `$X` or `$X.Y`. Use regex `\$(\d+(?:\.\d+)?)` to extract the number. If the cell is `-` or empty, treat as 0.
   - Use the Output column value even when Notes mention temporary promo pricing (for example Grok 4.6 launch discount, Claude Sonnet 5 launch promo, or GPT-5.6 Sol promotional pricing through 2026-11-21).

## Model ID normalization

Convert display names to model IDs that match what Cursor stores in state.vscdb. Use this normalization for the primary key:

- Lowercase
- Replace spaces with hyphens
- Keep `.` in version numbers (e.g. `4.6` stays `4.6`, not `4-6`; `5.1` stays `5.1`; `5.5` stays `5.5`)
- Remove parentheticals like `(Fast)`, `(Fast mode)`, or `(fast mode)` (case-insensitive) and append `-fast` to the base name:
  - `Grok 4.7 (Fast)` → `grok-4.7-fast`
  - `Grok 4.7 500k (Fast)` → `grok-4.7-500k-fast`
  - `Claude Opus 4.7 (fast mode)` → `claude-opus-4.7-fast`
- A bare `500k` token in the display name stays in the primary id (`Grok 4.7 500k` → `grok-4.7-500k`). Also emit the catalog alias in **Catalog id aliases**.
- Normalize Anthropic names literally from display order. Newer names flip family/version (`Claude Opus 4.8`, `Claude Opus 5.5`, `Claude Sonnet 5`, `Claude Fable 5.1`) vs older `Claude 4.6 Opus` style:
  - `Claude 4.6 Opus` → `claude-4.6-opus`
  - `Claude Opus 4.8` → `claude-opus-4.8`
  - `Claude Opus 5.5` → `claude-opus-5.5`
  - `Claude Sonnet 5` → `claude-sonnet-5`
  - `Claude Fable 5.1` → `claude-fable-5.1`
- For provider-prefixed models like `accounts/fireworks/models/kimi-k2-instruct`, keep the full path; also add the simple normalized ID

Examples:
- `Claude 4.6 Opus` → `claude-4.6-opus`
- `Claude Opus 4.7 (fast mode)` → `claude-opus-4.7-fast`
- `Claude Opus 5.5` → `claude-opus-5.5` (also alias `claude-opus-5-5`)
- `Claude Fable 5.1` → `claude-fable-5.1` (also alias `claude-fable-5-1`)
- `Grok 4.7 (Fast)` → `grok-4.7-fast`
- `Grok 4.7 500k` → `grok-4.7-500k` (also alias `grok-4.7-long`)
- `Grok 4.7 500k (Fast)` → `grok-4.7-500k-fast` (also alias `grok-4.7-fast-long`)
- `GPT-5.4` → `gpt-5.4`
- `GPT-5.6 Sol` → `gpt-5.6-sol`
- `Composer 2.5` → `composer-2.5`
- `Gemini 3.8 Flash` → `gemini-3.8-flash`
- `GLM 5.2` → `glm-5.2`
- `Kimi K2.7 Code` → `kimi-k2.7-code`
- `Muse Spark 1.3` → `muse-spark-1.3`

## Catalog id aliases

Match a markdown row to a catalog object when the row's full display name (parenthetical included) equals that object's `name` or `displayName`. Markdown output price stays the source of truth. Emit the catalog `id` as an additional key with the same tier and output only when it differs from the display-name id and one of these holds:

1. **Version dots vs hyphens on flipped Anthropic names.** The display name matches `Claude (Opus|Sonnet|Fable|Haiku) …`, and replacing `.` with `-` in the display-name id equals the catalog id. Examples: `claude-opus-5.5` + `claude-opus-5-5`, `claude-fable-5.1` + `claude-fable-5-1`, `claude-opus-4.8` + `claude-opus-4-8`, `claude-opus-4.7-fast` + `claude-opus-4-7-fast`. Cursor's model list uses the hyphenated catalog id (`claude-opus-5-5`).
2. **500k context rows.** The catalog id is the display-name id with `-500k-fast` replaced by `-fast-long`, or `-500k` replaced by `-long`. Examples: `grok-4.7-500k` + `grok-4.7-long`, `grok-4.7-500k-fast` + `grok-4.7-fast-long`.

Do **not** alias a catalog id that is a different token sequence. In particular, do not emit `gpt-5.1` for the model named GPT-5, and do not emit `claude-opus-4-7` for `Claude 4.7 Opus` or `claude-4-6-opus` for `Claude 4.6 Opus`. Those older display-name ids are what state.vscdb stores.

## Tier thresholds (output price per 1M tokens)

| Tier | Output price |
|------|--------------|
| cheap | < $5 |
| daily driver | $5 ≤ output < $20 |
| expensive | $20 ≤ output < $50 |
| extremely expensive | ≥ $50 |

Sonnet ($15) = daily driver. Opus ($25+) = expensive. Claude Opus 5.5 ($20) = expensive.

**Special cases:**
- **`auto`**: Cursor stores `"default"` in state when the user selects Auto; the extension maps it to `"auto"`. Always include an `"auto"` entry with tier `cheap` (Auto is included in the Pro plan), even though the Auto Cost output rate ($6) would otherwise be "daily driver". Prefer catalog `auto-cost` `output` when that id exists; otherwise use the last known Auto pool rate (`6`). Never write `auto-cost` into `model_tiers.json`.

## Output format

Write to `model_tiers.json` in the repo root. Prefer compact one-line JSON entries. Keep markdown table order, with each catalog alias immediately after its display-name id, and `auto` last. Each model must include both `tier` and `output` (output price per 1M tokens) so the extension can compute effective cost when Max Mode is enabled:

```json
{
  "lastUpdated": "<ISO 8601 timestamp>",
  "<model-id>": { "tier": "<tier>", "output": <number> },
  ...
}
```

Example: `"claude-4.5-sonnet": { "tier": "daily driver", "output": 15 }`

## Variant Suffixes and Max Mode

The extension handles cost modifiers at runtime. Do not add `-thinking`, `-high`, or `-high-thinking` variants to model_tiers.json. Do not add Fast `subRows` from the catalog unless they appear as their own markdown row. The extension strips these suffixes and applies multipliers:

- `-thinking`: 2x (thinking models generate significantly more output tokens)
- `-high`: 1.5x (high reasoning effort)
- `-high-thinking`: 3x (combined)
- Max Mode: 1.2x (on top of suffix multiplier)

Effective output = base output × suffix multiplier × max mode multiplier. Red bar when effective output ≥ $20.

Example: `claude-4.6-sonnet-thinking` → base = claude-4.6-sonnet ($15) × 2 = $30 → expensive.

## Verification

After writing, ensure:
- `lastUpdated` is set to the current time in ISO 8601 format
- All models from both Cursor docs markdown pricing tables are present
- An `"auto"` entry exists with tier `"cheap"` and output from catalog `auto-cost` when present, otherwise `6`; no `auto-cost` key
- Claude 4.6 Opus ($25) is "expensive"
- Claude Opus 4.7 (fast mode) ($150) is "extremely expensive" (`claude-opus-4.7-fast` and `claude-opus-4-7-fast`)
- Claude Opus 5.5 ($20) is "expensive" (`claude-opus-5.5` and `claude-opus-5-5`)
- Claude Fable 5 ($50) and Claude Fable 5.1 ($50) are "extremely expensive" (Fable 5.1 also as `claude-fable-5-1`)
- Claude Sonnet 5 ($10) is "daily driver"
- Gemini 3.5 Flash ($9) and Gemini 3.6 Flash ($7.5) are "daily driver"
- Gemini 3.7 Flash ($3.5) and Gemini 3.8 Flash ($3.5) are "cheap"
- Grok 4.7 ($6), Grok 4.7 (Fast) ($12), Grok 4.7 500k ($12), and Grok 4.7 500k (Fast) ($18) are "daily driver"
- Grok 4.7 500k is stored as both `grok-4.7-500k` and `grok-4.7-long`; Grok 4.7 500k (Fast) as both `grok-4.7-500k-fast` and `grok-4.7-fast-long`
- Grok 4.6 ($6) and Grok 4.6 (Fast) ($12) are "daily driver"
- Grok 4.5 ($6) and Grok 4.5 (Fast) ($18) are "daily driver" (Fast output is independent of Grok 4.6 Fast and Grok 4.7 Fast)
- Composer 2.5 ($2.5) is "cheap"; Composer 2.5 (Fast) ($15) is "daily driver"
- GPT-5.6 Luna ($1.2) is "cheap"; GPT-5.6 Terra ($12) is "daily driver"
- GPT-5.6 Sol ($20, promotional through 2026-11-21) is "expensive"
- GLM 5.2 ($4.4) is "cheap"
- Muse Spark 1.3 ($4.25) is "cheap"
- No duplicate model IDs
- No `gpt-5.1` key and no `claude-4-6-opus` key
- Typical size: markdown rows + catalog aliases + `auto` (55 + 6 aliases + auto = 62 as of 2026-09-24)

## Also required for every PR

- Bump `package.json` `version` (and root `package-lock.json` version fields) above the latest Open VSX published version
- Update `CHANGELOG.md` in the same commit as the version bump
