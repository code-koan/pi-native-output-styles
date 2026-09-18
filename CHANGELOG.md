# Changelog

## 0.8.0

### Added

- Bundled `dense`, a Chinese-language style: one complete judgement per sentence, scannable structure for overviews, the shortest length that still carries the decision, no AI filler.

## 0.7.0

### Changed

- Rewrote the leader brief around behaviour instead of rules. It now says what a style may and may not describe, asks for the smallest set of sentences that actually change output, and decides between edit / rewrite / create instead of following a fixed flow. Review stays report-only, and the final report is three fields: what changed, the file path, whether it was verified.
- The brief is now written in Chinese. It is still plain Markdown in `extensions/prompts/output-style-leader.md`.

### Fixed

- Delegation went dormant under the rewrite. Measured over live runs on the same task, the previous brief delegated 4 of 6 times; the permissive phrasing in the rewrite produced 0 of 4, including a run whose request asked for a two-file comparison. Naming a default — "多角度任务（如 review）默认拆开" — restored it: review then split into two children, with report-only and no-child-writes both still holding.

## 0.6.0

### Added

- `/output-style config` for the two settings worth persisting. It runs from the user config file, so both apply to every session and project:
  - `config default <style|off>` — the style new sessions start with.
  - `config indicator <status|widget|off>` — where the active style is shown; `status` is the default.
- Run `config` with no arguments for a dialog per setting. A bare key reads the value back, an unknown key is an error, and a run without a dialog UI prints the config instead.
- A `widget` indicator renders the style above the editor. Every refresh writes both surfaces, so switching modes can never leave a stale badge.

### Changed

- `config` joins the management words in the command router. `configure this style` still routes to the agent.
- Clearing a saved default now merges state instead of overwriting the file, so it no longer drops the indicator setting.

## 0.5.0

One command, plus a bundled style and an agent that maintains styles.

### Added

- `/output-style <request>` hands the task to an agent that reviews, rewrites, or creates styles. The brief is short Markdown in `extensions/prompts/output-style-leader.md`, and the agent decides for itself whether to fan work out to other agents.
- Bundled `caveman` style, from [carlosduplar/caveman-output-style-claude-code](https://github.com/carlosduplar/caveman-output-style-claude-code) (MIT, © 2026 Carlos Mello).

### Changed

- **`/style` is gone; `/output-style` is the only command.** A single word that names a style, `off`, or `none` is style management; anything else is a request for the agent. `/output-style` with no arguments lists what exists.
- Style names are matched case-insensitively and resolved to their declared name.

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
