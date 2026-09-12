# pi-native-output-styles

[![CI](https://github.com/code-koan/pi-native-output-styles/actions/workflows/ci.yml/badge.svg)](https://github.com/code-koan/pi-native-output-styles/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pi-native-output-styles.svg)](https://www.npmjs.com/package/pi-native-output-styles)
[![license](https://img.shields.io/npm/l/pi-native-output-styles.svg)](./LICENSE)

Named, swappable system-prompt styles for [Pi](https://pi.dev), plus an agent that can review, rewrite, and create them for you. Unlike Claude Code's output styles (which need `/clear` to switch), styles here apply and switch **live, mid-session**.

Styles and saved defaults live in Pi's own directories: `~/.pi/agent/output-styles/` and `<repo>/.pi/output-styles/`.

## Install

```bash
pi install npm:pi-native-output-styles

# or straight from the repo
pi install git:github.com/code-koan/pi-native-output-styles
```

Then start a **new** session. Extensions do not hot-reload.

## One command

`/output-style` does both jobs. What you type decides which one you get.

**Switch styles** — the first word is a style name, `off`, or nothing:

```text
/output-style                          list styles and show the active one
/output-style caveman                  use caveman for this session
/output-style concise --save           and make it your default
/output-style concise --project        save it as this project's default
/output-style off                      clear it; --save / --project also clears the default
```

**Ask the agent to work on a style** — anything else:

```text
/output-style review the reviewer style
/output-style 重写这个 output style，让它更简洁、更适合编程
/output-style 创建一个适合代码 Review 的 output style
```

The rule is one line: *a single word that names a style, `off`, or `none` is management; anything else is a request for the agent.* So `/output-style concise` activates, and `/output-style rewrite concise` asks. To review a style whose name you would otherwise activate, say more than its name.

While composing the command, a hint line under the editor shows both forms.

## How a style is applied

Pi's assembled system prompt is flat prose plus XML blocks — there is no personality slot to replace. The active style is injected as a `# Personality` block at the **top** of the prompt, above the tool list and the cwd line, the way Claude Code output styles sit.

It is idempotent: a prompt that already carries the marker is left untouched, so switching styles mid-session never stacks a second block. Nothing else in the prompt is modified.

## The style agent

`/output-style <request>` hands the task to the agent with a short brief and the live picture: which style is active, both writable directories, and every style that exists with its tier and file path.

The agent owns the task end to end. It decides for itself whether the work needs other agents — a review is the usual case, where prompt quality, responsibility boundaries, and conflicts/redundancy are worth splitting across children. It uses whatever delegation tool the session has, and does the analysis itself when there is none. The final write and the summary stay with it.

Review findings are specific: conflicting instructions, duplicate or unenforceable rules, vague wording, over-constraining the model, content that belongs to a different concern, AI-slop voice, and rules that are hard to follow while actually working. Rewrites keep what works, delete what does not, and add only what is missing.

A review reports; it does not edit. The file is written only when the request asks for a change. In observed runs the agent delegated on its own when a task had several independent angles to check, and worked solo on a small single-file review.

The brief lives in [`extensions/prompts/output-style-leader.md`](extensions/prompts/output-style-leader.md) and is plain Markdown — edit it without touching code.

## Bundled styles

`caveman` · `concise` · `explanatory` · `teacher` · `reviewer` · `diagrams-first` · `ste` · `eli5`

`caveman` is [Carlos Mello's Caveman output style](https://github.com/carlosduplar/caveman-output-style-claude-code) — terse replies, no filler, same technical signal. The same repo also ships a more aggressive `caveman-ultra`; it is not bundled, but you can drop it into your own `output-styles/` directory unchanged.

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

`name` is lowercase kebab-case, `description` is one line and shows up in `/output-style`.

Precedence:

- **Definitions** (low → high): bundled < user < project.
- **Which style is active**: session `/output-style` > user default > project default.

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

Started as a fork of [LoneExile/pi-output-styles](https://github.com/LoneExile/pi-output-styles). Bundles [caveman](https://github.com/carlosduplar/caveman-output-style-claude-code) by Carlos Mello. MIT licensed; original work © 2026 LoneExile, caveman style © 2026 Carlos Mello.
