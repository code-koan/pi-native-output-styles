# pi-output-styles

[![CI](https://github.com/code-koan/pi-output-styles/actions/workflows/ci.yml/badge.svg)](https://github.com/code-koan/pi-output-styles/actions/workflows/ci.yml)
[![license](https://cdn.jsdelivr.net/npm/pi-output-styles@0.3.3/LICENSE)](./LICENSE)

Named, swappable system-prompt styles for [Pi](https://pi.dev) and [Oh My Pi (OMP)](https://pi.dev) — with a live `/style` switcher. Unlike Claude Code's output styles (which need `/clear` to switch), styles here apply and switch **live, mid-session**.

This is a fork of [LoneExile/pi-output-styles](https://github.com/LoneExile/pi-output-styles) with **Pi-native `.pi/` directory support**. Upstream only reads `.omp/` paths, which means a Pi user has to create Oh My Pi's directory layout to add a style. Here, Pi's own locations come first.

Two differences from upstream:

1. **Pi-native paths.** Styles and defaults resolve from `.pi/` (`~/.pi/agent/…`, `<repo>/.pi/…`) before falling back to the OMP `.omp/` layout. Both work from one install.
2. **Pi-shaped prompts.** Pi's assembled system prompt has no `# Personality` slot and no `§` sections, so the style is injected as a `# Personality` block at the **top** of the prompt instead of being appended after the tool list and cwd line.

## Install

```bash
# Pi
pi install git:github.com/code-koan/pi-output-styles

# Oh My Pi
omp plugin install github:code-koan/pi-output-styles
```

Then start a **new** session. Extensions do not hot-reload.

## Use

- `/style` — show the active style and list available ones.
- `/style <name>` — activate a style for this session.
- `/style <name> --save` — also save it as your personal (user) default.
- `/style <name> --project` — save it as the project default (committed with the repo).
- `/style off` — clear the active style for this session (overrides any saved default). `none` is an alias; `off --save` / `off --project` also clears the saved default.
- While composing `/style`, a hint line below the input shows the available flags (`--save` / `--project`).

The style is applied every turn. The status line shows `style: eli5`. `/style off` restores the default persona on the next turn.

## How the style is applied

On Oh My Pi, `# Personality` is a real slot in the assembled system prompt, and the active style **replaces everything from `# Personality` through the next `§` heading** (including nested `# Tone` / `# Reasoning`). Tools, skills, Role, Engineering, Runtime, and later project/safety blocks stay.

On Pi — and for a custom `SYSTEM.md` with no personality heading — there is no slot to replace. The style is injected as:

- before `§ Runtime` when the prompt has one,
- else before the first `§` that is not `§ Role`,
- else **prepended to the top of the prompt** (the Pi shape).

Nothing is ever deleted except the OMP personality slot.

## Bundled styles

`omp-default` · `omp-friendly` · `omp-pragmatic` · `concise` · `explanatory` · `teacher` · `reviewer` · `diagrams-first` · `ste` · `eli5`.

`omp-default` / `omp-friendly` / `omp-pragmatic` are Oh My Pi's own built-in [`personality`](https://github.com/can1357/oh-my-pi/tree/main/packages/coding-agent/src/prompts/system/personalities) presets (`default` is the voice active when no style is selected). Useful to pin one explicitly, or as a base for Pi users (who have no native personality picker).

`ste` writes in [ASD-STE100](https://asd-ste100.org) Simplified Technical English. It also uses the v2.0 action-first reply shape for person-addressed replies, tasks, issues, pull request descriptions, and commit messages. The style adapts [Ege Chelebi's ste-writing skill](https://github.com/woosal1337/blog/blob/9240b25eac013467554fd8217f319743aa0282b8/videos/ep01-the-cure-for-ai-slop/asd-ste100/SKILL.md).

`eli5` is [Lydia Hallie's ELI5 style](https://x.com/lydiahallie/status/2080378470111256907).

## Custom styles

Pi-native locations (checked first):

- Project: `<repo>/.pi/output-styles/<name>.md`
- Personal: `~/.pi/agent/output-styles/<name>.md`

Oh My Pi locations (still supported, lower precedence):

- Project: `<repo>/.omp/output-styles/<name>.md`
- Personal: `~/.omp/agent/output-styles/<name>.md`

```markdown
---
name: teacher
description: Teach as you go
---
Act as a patient teacher. Explain the concept before applying it.
```

Filename = style name unless the frontmatter overrides it. Both scopes are searched, so the same `.pi/` directory works in Pi and OMP.

Precedence — **definitions** (low → high): bundled < OMP user < OMP project < Pi user < Pi project. **Which style is active**: session `/style` > Pi user default > Pi project default > OMP user default > OMP project default.

## Config

| | Pi (preferred) | OMP (legacy) |
| --- | --- | --- |
| Project styles | `<repo>/.pi/output-styles/` | `<repo>/.omp/output-styles/` |
| User styles | `~/.pi/agent/output-styles/` | `~/.omp/agent/output-styles/` |
| Project default (`--project`) | `<repo>/.pi/output-styles.json` | `<repo>/.omp/pi-output-styles.json` |
| User default (`--save`) | `~/.pi/agent/output-styles.json` | `~/.omp/agent/pi-output-styles.json` |

Environment:

- `PI_CODING_AGENT_DIR` — Pi's own config-dir override; sets the user root (default `~/.pi/agent`).
- `PI_OUTPUT_STYLES_HOME` — higher-precedence override for the user root, for tests and non-standard layouts.

## Develop

```bash
bun install
bun test
bun x tsc --noEmit
```

## License

MIT. Original work © 2026 LoneExile; fork maintained under [code-koan](https://github.com/code-koan).
