# Changelog

## [0.1.4] - 2026-04-02

### Changed
- Regenerated `model_tiers.json` from the latest Cursor models and pricing docs.
- Added new model entries: `composer-2`, `gpt-5.4-mini`, `gpt-5.4-nano`, and `grok-4.20`.
- Updated `composer` to match the Auto + Composer pool output price ($2.5).
- Updated `lastUpdated` timestamp and retained `auto` (cheap, output 6).

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
