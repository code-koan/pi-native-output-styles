# pi-native-output-styles

[![CI](https://github.com/code-koan/pi-native-output-styles/actions/workflows/ci.yml/badge.svg)](https://github.com/code-koan/pi-native-output-styles/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pi-native-output-styles.svg)](https://www.npmjs.com/package/pi-native-output-styles)
[![license](https://img.shields.io/npm/l/pi-native-output-styles.svg)](./LICENSE)

Named, swappable system-prompt styles for [Pi](https://pi.dev) — with a live `/style` switcher. Unlike Claude Code's output styles (which need `/clear` to switch), styles here apply and switch **live, mid-session**.

Styles and saved defaults live in Pi's own directories: `~/.pi/agent/output-styles/` and `<repo>/.pi/output-styles/`.

## Install

```bash
pi install npm:pi-native-output-styles

# or straight from the repo
pi install git:github.com/code-koan/pi-native-output-styles
```

Then start a **new** session. Extensions do not hot-reload.

## Use

- `/style` — show the active style and list the available ones.
- `/style <name>` — activate a style for this session.
- `/style <name> --save` — also save it as your personal (user) default.
- `/style <name> --project` — save it as the project default (committed with the repo).
- `/style off` — clear the active style for this session, overriding any saved default.
- `/style off --save` / `/style off --project` — also clear the saved default. `none` is an alias for `off`.
- While composing `/style`, a hint line below the input shows the available flags.

The style is applied every turn, and the status line shows `style: eli5`.

## How a style is applied

Pi's assembled system prompt is flat prose plus XML blocks — there is no personality slot to replace. The active style is injected as a `# Personality` block at the **top** of the prompt, above the tool list and the cwd line, the way Claude Code output styles sit.

It is idempotent: a prompt that already carries the marker is left untouched, so switching styles mid-session never stacks a second block. Nothing else in the prompt is modified.

## Bundled styles

`concise` · `explanatory` · `teacher` · `reviewer` · `diagrams-first` · `ste` · `eli5`

`ste` writes in [ASD-STE100](https://asd-ste100.org) Simplified Technical English, with the v2.0 action-first reply shape for person-addressed replies, tasks, issues, pull request descriptions, and commit messages. Adapted from [Ege Chelebi's ste-writing skill](https://github.com/woosal1337/blog/blob/9240b25eac013467554fd8217f319743aa0282b8/videos/ep01-the-cure-for-ai-slop/asd-ste100/SKILL.md).

`eli5` is [Lydia Hallie's ELI5 style](https://x.com/lydiahallie/status/2080378470111256907).

## Custom styles

Drop a Markdown file in either location. The filename is the style name unless frontmatter overrides it.

- Project: `<repo>/.pi/output-styles/<name>.md`
- Personal: `~/.pi/agent/output-styles/<name>.md`

```markdown
---
name: teacher
description: Teach as you go
---
Act as a patient teacher. Explain the concept before applying it.
```

The body becomes the `# Personality` block.

Precedence:

- **Definitions** (low → high): bundled < user < project.
- **Which style is active**: session `/style` > user default > project default.

## Config

| | Path |
| --- | --- |
| Project styles | `<repo>/.pi/output-styles/` |
| User styles | `~/.pi/agent/output-styles/` |
| Project default (`--project`) | `<repo>/.pi/output-styles.json` |
| User default (`--save`) | `~/.pi/agent/output-styles.json` |

Environment:

- `PI_CODING_AGENT_DIR` — Pi's config-dir override. Sets the user root (default `~/.pi/agent`).
- `PI_OUTPUT_STYLES_HOME` — higher-precedence override of the user root, for tests and non-standard layouts.

## Develop

```bash
bun install
bun test
bun x tsc --noEmit
```

## Credits

Started as a fork of [LoneExile/pi-output-styles](https://github.com/LoneExile/pi-output-styles), reworked to use Pi's native `.pi/` directories. MIT licensed; original work © 2026 LoneExile.
