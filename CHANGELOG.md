# Changelog

## 0.4.0

Repackaged as `pi-native-output-styles` — a Pi-only output-style switcher built on Pi's native `.pi/` directories.

### Added

- Native `.pi/` locations. Styles resolve from `~/.pi/agent/output-styles/` and `<repo>/.pi/output-styles/`; `--save` / `--project` write `~/.pi/agent/output-styles.json` and `<repo>/.pi/output-styles.json`.
- `PI_CODING_AGENT_DIR` is honoured as the user config root (default `~/.pi/agent`).

### Changed

- `/style` now injects a single `# Personality` block at the top of the system prompt, replacing the previous slot-swapping behaviour. It is idempotent and touches nothing else in the prompt.
- Bundled styles are `concise`, `explanatory`, `teacher`, `reviewer`, `diagrams-first`, `ste`, `eli5`.

### Removed

- All non-Pi harness support: the `.omp/` style and state locations, the slot-replacement logic for `§`-delimited prompts, and the three `omp-*` bundled presets.
- The CLI demo assets, which showed another harness.

### Notes

Forked from [`LoneExile/pi-output-styles`](https://github.com/LoneExile/pi-output-styles). Inherited changelog entries for versions before the fork are not reproduced here; see upstream for that history.
