# Changelog

## [0.1.4] - 2026-08-30

### Changed
- Regenerated `model_tiers.json` from current Cursor models and pricing (added Gemini 3.7 Flash, Grok 4.6, Composer 2.5, and other current models; Claude Sonnet 5 output $10; Grok 4.5 Fast output $18; GPT-5.6 Sol promotional output $20)

## [0.1.3] - 2026-03-13

### Fixed
- Auto selection now shows $ (cheap): case-insensitive model lookup and prefer Auto when present so underlying model does not override.

## [0.1.2] - 2026-03-13

### Added
- Dollar sign indicator in the status bar showing current model cost tier: $ cheap, $$ daily driver, $$$ expensive, $$$$ extremely expensive

## [0.1.1] - 2026-03-13

### Changed
- Updated README with Open VSX install instructions and status bar documentation
- Removed manual build/install steps and reference to external cursor-costs repo

## [0.1.0] - 2025-03-09

### Added
- Status bar item showing today's spend, billing period spend, and most expensive turn
- Tooltip with detailed breakdown: tokens, model, and time of most expensive turn
- Automatic spend refresh every hour from Cursor's usage API
- Commands: Show Spend Menu, Refresh Spend Data, Clear Spend Cache
- Model tier detection — turns title bar red when an expensive model is active
- Configurable tiers URL and poll interval
