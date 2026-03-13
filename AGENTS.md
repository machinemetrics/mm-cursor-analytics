# Agent Instructions

## Version Bump Required

Every PR must increment the `version` field in `package.json`. The CI pipeline enforces this — it will fail if the version is not greater than the currently published version on Open VSX.

Use semver:
- Patch (`0.1.1` → `0.1.2`): bug fixes, copy changes, minor tweaks
- Minor (`0.1.1` → `0.2.0`): new features, new UI elements
- Major (`0.1.1` → `1.0.0`): breaking changes

Always update `CHANGELOG.md` in the same commit as the version bump.
