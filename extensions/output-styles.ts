// pi-native-output-styles — named, swappable system-prompt styles for Pi.
// The active style is injected as a `# Personality` block at the top of the
// system prompt each turn. Pure helpers are exported for unit testing.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Style {
  name: string;
  description: string;
  body: string;
  /** Absolute file path; set by discoverStyles. */
  path?: string;
}

/** Where a style definition was found. Only `project` and `user` are writable. */
export type StyleTier = "bundled" | "user" | "project";

export interface StyleSource {
  dir: string;
  tier: StyleTier;
}

export interface StyleEntry extends Style {
  tier: StyleTier;
  path: string;
}

type NotifyType = "info" | "warning" | "error";

interface ExtensionUI {
  setStatus(key: string, text: string | undefined): void;
  setWidget(key: string, lines: string[] | undefined, options?: { placement: "aboveEditor" | "belowEditor" }): void;
  getEditorText(): string;
  notify(message: string, type?: NotifyType): void;
  select?(title: string, options: string[]): Promise<string | undefined>;
}

interface ExtensionContext {
  cwd: string;
  hasUI: boolean;
  isIdle?(): boolean;
  ui: ExtensionUI;
  setInterval?(callback: () => void, ms?: number): unknown;
}

interface BeforeAgentStartEvent {
  prompt: string;
  systemPrompt: string;
}

interface BeforeAgentStartResult {
  systemPrompt?: string;
}

interface AutocompleteItem {
  value: string;
  label: string;
  description?: string;
  hint?: string;
}

type EventHandler<E, R = void> = (event: E, ctx: ExtensionContext) => R | void | Promise<R | void>;

interface ExtensionAPI {
  on(event: "session_start", handler: EventHandler<unknown>): void;
  on(event: "session_shutdown", handler: EventHandler<unknown>): void;
  on(event: "before_agent_start", handler: EventHandler<BeforeAgentStartEvent, BeforeAgentStartResult>): void;
  registerCommand(
    name: string,
    def: {
      description: string;
      getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null;
      handler: (args: string, ctx: ExtensionContext) => void | Promise<void>;
    },
  ): void;
  sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): void;
}

export function parseStyle(text: string, fallbackName: string): Style {
  let name = fallbackName;
  let description = "";
  let body = text;
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (fm) {
    body = fm[2];
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const value = m[2].trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
      if (key === "name" && value.length > 0) name = value;
      else if (key === "description") description = value;
    }
  }
  return { name, description, body: body.trim() };
}

export function discoverStyles(dirsLowToHigh: string[]): Map<string, Style> {
  const styles = new Map<string, Style>();
  for (const dir of dirsLowToHigh) {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      let text: string;
      try {
        text = readFileSync(join(dir, entry), "utf8");
      } catch {
        continue;
      }
      const style = parseStyle(text, entry.slice(0, -3));
      if (style.body.length === 0) continue;
      styles.set(style.name, { ...style, path: join(dir, entry) });
    }
  }
  return styles;
}

// Pi config roots: `PI_CODING_AGENT_DIR` (default `~/.pi/agent`) for user scope
// and `<repo>/.pi` for project scope. `PI_OUTPUT_STYLES_HOME` overrides the
// user root and takes precedence over `PI_CODING_AGENT_DIR`.
export function configHome(): string {
  return process.env.PI_OUTPUT_STYLES_HOME || process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function userStylesDir(): string {
  return join(configHome(), "output-styles");
}

export function projectStylesDir(cwd: string): string {
  return join(cwd, ".pi", "output-styles");
}

export function bundledStylesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "styles");
}

export interface StyleState {
  active?: string;
  indicator?: IndicatorMode;
}

/** Where the active style is shown. `status` is the default. */
export const INDICATOR_MODES = ["status", "widget", "off"] as const;
export type IndicatorMode = (typeof INDICATOR_MODES)[number];

export function isIndicatorMode(value: unknown): value is IndicatorMode {
  return typeof value === "string" && (INDICATOR_MODES as readonly string[]).includes(value);
}

export function readState(file: string): StyleState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object") {
      const state: StyleState = {};
      if ("active" in parsed && typeof parsed.active === "string") state.active = parsed.active;
      if ("indicator" in parsed && isIndicatorMode(parsed.indicator)) state.indicator = parsed.indicator;
      return state;
    }
  } catch {
    // missing or malformed → empty
  }
  return {};
}

export function writeState(file: string, state: StyleState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
}

// Merge, never replace: clearing the default must not drop the indicator
// setting, and setting the indicator must not drop the default. A key passed
// as undefined drops out of the JSON, which is how a key is cleared.
export function updateState(file: string, patch: StyleState): void {
  writeState(file, { ...readState(file), ...patch });
}

export function userStateFile(): string {
  return join(configHome(), "output-styles.json");
}

export function projectStateFile(cwd: string): string {
  return join(cwd, ".pi", "output-styles.json");
}

// Session selection beats the user default, which beats the project default.
export function resolveActiveName(
  sessionActive: string | null,
  userState: StyleState,
  projectState: StyleState,
): string | null {
  return sessionActive ?? userState.active ?? projectState.active ?? null;
}

// The indicator is presentation, so it resolves from the same places as the
// default style but falls back to the status bar.
export function resolveIndicator(cwd: string): IndicatorMode {
  return readState(userStateFile()).indicator ?? readState(projectStateFile(cwd)).indicator ?? "status";
}

const MARKER_PREFIX = "<!-- output-styles:";

export function styleMarker(style: Style): string {
  return `${MARKER_PREFIX}${style.name} -->\n${style.body}`;
}

// Pi's assembled system prompt is flat prose plus XML blocks — it has no
// personality slot. So the style becomes one, prepended to the top the way
// Claude Code output styles are, rather than appended after the tool list and
// cwd line. Idempotent: a prompt that already carries a marker is returned as-is.
export function applyStyle(systemPrompt: string, style: Style): string {
  if (systemPrompt.includes(MARKER_PREFIX)) return systemPrompt;
  const marked = styleMarker(style);
  return systemPrompt.length === 0 ? marked : `# Personality\n${marked}\n\n${systemPrompt}`;
}

export type PersistScope = "none" | "user" | "project";

export interface StyleCommandArgs {
  name: string | null;
  persist: PersistScope;
}

// Flags recognized by the /style command. parseStyleCommandArgs maps each to a
// persist scope; the command handler warns on any --flag NOT in this set.
// Keep this in sync with the flag handling in parseStyleCommandArgs.
const KNOWN_FLAGS = ["--save", "--global", "--project"];

// Reserved argument words that clear the active style instead of selecting one.
const OFF_WORDS: Record<string, true> = { off: true, none: true };

export function parseStyleCommandArgs(args: string): StyleCommandArgs {
  const tokens = args.trim().split(/\s+/).filter(t => t.length > 0);
  let name: string | null = null;
  let save = false;
  let project = false;
  for (const t of tokens) {
    if (t === "--save" || t === "--global") save = true;
    else if (t === "--project") project = true;
    else if (!t.startsWith("--") && name === null) name = t;
  }
  const persist: PersistScope = project ? "project" : save ? "user" : "none";
  return { name, persist };
}

// One command serves every job, so the split has to be guessable from the
// words alone. Rule, in order: the request is `config` when it starts with the
// config word; empty, `off`, `none`, or a single word naming an existing style
// is style management; anything else is a task for the agent. `/output-style
// concise` activates; `/output-style rewrite concise` asks the agent.
export type StyleCommandRoute =
  | { kind: "config"; args: string }
  | { kind: "manage" }
  | { kind: "task"; request: string };

export function routeStyleCommand(args: string, styleNames: Iterable<string>): StyleCommandRoute {
  const request = args.trim();
  if (request.length === 0) return { kind: "manage" };
  if (/^config(?=\s|$)/i.test(request)) return { kind: "config", args: request.replace(/^config\s*/i, "").trim() };
  const words = request.split(/\s+/).filter(t => t.length > 0 && !t.startsWith("--"));
  if (words.length === 0) return { kind: "manage" }; // flags only
  if (words.length > 1) return { kind: "task", request };
  const word = words[0].toLowerCase();
  if (OFF_WORDS[word]) return { kind: "manage" };
  const known = new Set([...styleNames].map(n => n.toLowerCase()));
  return known.has(word) ? { kind: "manage" } : { kind: "task", request };
}

// Routing matches names case-insensitively, but the style map is keyed by the
// exact declared name, so the selected name has to be canonicalised before use.
export function resolveStyleName(name: string, styleNames: Iterable<string>): string | null {
  const all = [...styleNames];
  return all.find(n => n === name) ?? all.find(n => n.toLowerCase() === name.toLowerCase()) ?? null;
}

const STATUS_KEY = "output-styles";
const INDICATOR_KEY = "output-styles-indicator";
const HINT_KEY = "output-styles-hint";
// Persistent ghost hint shown below the editor while `/output-style` is being
// composed. Pi only renders inline usage ghost text for builtin commands, so
// this widget carries the same message for extension commands.
const STYLE_HINT_LINES = [
  "/output-style <name|off> [--save] [--project]",
  "/output-style config — default style, indicator",
];

// Pure matcher for the widget: show the hint while the input starts with the
// `/output-style` command word (line start, optional leading whitespace).
export function styleHintFor(text: string): string[] | null {
  return /^\s*\/output-style(?:\s|$)/.test(text) ? STYLE_HINT_LINES : null;
}

// Poller state: one started flag guards re-registration across in-process
// session restarts; lastHintInput dedupes widget updates against the text the
// hint was computed for.
let started = false;
let lastHintInput: string | null = null;

// Debounced poller: only updates the widget once the input text is stable
// across a tick and differs from the last-checked text. Exported for tests.
export function startHintPoller(ctx: ExtensionContext): void {
  if (typeof ctx.setInterval !== "function") return;
  let stableInput: string | null = null;
  ctx.setInterval(() => {
    const text = ctx.ui.getEditorText();
    if (text !== stableInput) {
      stableInput = text;
      return;
    }
    const lines = styleHintFor(text);
    if (lines !== null && lastHintInput !== text) {
      ctx.ui.setWidget(HINT_KEY, lines, { placement: "belowEditor" });
      lastHintInput = text;
    } else if (lines === null && lastHintInput !== null) {
      ctx.ui.setWidget(HINT_KEY, undefined);
      lastHintInput = null;
    }
  }, 600);
}

// Session-active style selection is process-global (module-level) state.
// This assumes one module instance per session/cwd, which holds under
// today's per-session extension loading. If Pi ever shares one module
// instance across multiple concurrent sessions, switch this to a
// cwd-keyed Map instead of a single variable.
type SessionSelection = { type: "inherit" } | { type: "off" } | { type: "style"; name: string };
let session: SessionSelection = { type: "inherit" };

export function styleSources(cwd: string): StyleSource[] {
  // low → high precedence: bundled < user < project
  return [
    { dir: bundledStylesDir(), tier: "bundled" },
    { dir: userStylesDir(), tier: "user" },
    { dir: projectStylesDir(cwd), tier: "project" },
  ];
}

// One row per style name: the winning definition plus the file that actually
// produced it, so a rewrite knows whether it may edit in place.
export function styleCatalog(cwd: string): StyleEntry[] {
  const byName = new Map<string, StyleEntry>();
  for (const { dir, tier } of styleSources(cwd)) {
    for (const style of discoverStyles([dir]).values()) {
      if (style.path) byName.set(style.name, { ...style, tier, path: style.path });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function styleDirs(cwd: string): string[] {
  return styleSources(cwd).map(s => s.dir);
}

// Argument completions for `/style <name>`: matches style names by prefix.
// getArgumentCompletions carries no ctx, so discovery uses process.cwd() as the
// project scope (best-effort; the command handler still uses ctx.cwd).
// Flags advertised as dim ghost text on every completion item, so users see
// that a style can be persisted beyond the session with --save (user default)
// or --project (per-project default). --global is accepted as a --save alias.
const FLAG_HINT = "[--save] [--project]";

export function styleCompletions(argumentPrefix: string, cwd: string): AutocompleteItem[] | null {
  if (argumentPrefix.includes(" ")) return null;
  const prefix = argumentPrefix.trim().toLowerCase();
  const styleItems: AutocompleteItem[] = [...discoverStyles(styleDirs(cwd)).values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => ({ value: s.name, label: s.name, description: s.description || undefined, hint: FLAG_HINT }));
  const offItem: AutocompleteItem = {
    value: "off",
    label: "off",
    description: "Turn off styling for this session",
    hint: FLAG_HINT,
  };
  const items = [...styleItems, offItem].filter(i => i.value.toLowerCase().startsWith(prefix));
  return items.length > 0 ? items : null;
}

export function resolveActiveStyle(cwd: string, styles?: Map<string, Style>): Style | null {
  if (session.type === "off") return null;
  const sessionActive = session.type === "style" ? session.name : null;
  const name = resolveActiveName(sessionActive, readState(userStateFile()), readState(projectStateFile(cwd)));
  if (!name) return null;
  const map = styles ?? discoverStyles(styleDirs(cwd));
  return map.get(name) ?? null;
}

// One renderer for every call site, so switching the mode can never leave a
// stale badge behind: both surfaces are written on every refresh, and only the
// configured one gets text.
function renderIndicator(ctx: ExtensionContext, style: Style | null): void {
  if (!ctx.hasUI) return;
  const mode = resolveIndicator(ctx.cwd);
  const label = style ? `style: ${style.name}` : undefined;
  if (typeof ctx.ui.setStatus === "function") {
    ctx.ui.setStatus(STATUS_KEY, mode === "status" ? label : undefined);
  }
  if (typeof ctx.ui.setWidget === "function") {
    ctx.ui.setWidget(INDICATOR_KEY, mode === "widget" && label ? [label] : undefined, { placement: "aboveEditor" });
  }
}

// The Leader brief is plain Markdown next to the extension, so its wording can
// be edited without touching code.
export function leaderBrief(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "prompts", "output-style-leader.md"), "utf8").trim();
}

// The brief stays fixed and short. What changes per run is the live picture:
// which style is active, where styles may be written, and what already exists.
// The user's words are passed through untouched — this is a router, not a form.
export function buildStyleTask(brief: string, cwd: string, active: Style | null, request: string): string {
  const catalog = styleCatalog(cwd);
  return [
    brief,
    "",
    "## Context",
    "",
    `Active style: ${active?.name ?? "(none)"}`,
    `Project style dir: ${projectStylesDir(cwd)}`,
    `User style dir: ${userStylesDir()}`,
    "",
    "Available styles:",
    ...(catalog.length
      ? catalog.map(s => `- ${s.name} [${s.tier}] ${s.path}${s.description ? ` — ${s.description}` : ""}`)
      : ["(none)"]),
    "",
    "## Request",
    "",
    request,
  ].join("\n");
}

export type ConfigKey = "default" | "indicator";

export interface ConfigArgs {
  /** null means "no key given" — open the interactive flow. */
  key: ConfigKey | null;
  value: string;
}

const CONFIG_KEY_ALIASES: Record<string, ConfigKey> = {
  default: "default",
  style: "default",
  indicator: "indicator",
};

// `null` means an unrecognised key; `{key: null}` means no key at all.
export function parseConfigArgs(args: string): ConfigArgs | null {
  const tokens = args.trim().split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return { key: null, value: "" };
  const key = CONFIG_KEY_ALIASES[tokens[0].toLowerCase()];
  if (!key) return null;
  return { key, value: tokens.slice(1).join(" ") };
}

function describeConfig(cwd: string): string {
  return `Default style (new sessions): ${readState(userStateFile()).active ?? "(none)"}\nStyle indicator: ${resolveIndicator(cwd)}`;
}

function applyConfigValue(key: ConfigKey, value: string, ctx: ExtensionContext, styles: Map<string, Style>): void {
  const raw = value.trim();

  if (key === "default") {
    if (raw.length === 0) {
      ctx.ui.notify(`Default style (new sessions): ${readState(userStateFile()).active ?? "(none)"}`, "info");
      return;
    }
    if (OFF_WORDS[raw.toLowerCase()]) {
      updateState(userStateFile(), { active: undefined });
      ctx.ui.notify("Default style cleared. New sessions start with no style.", "info");
      renderIndicator(ctx, resolveActiveStyle(ctx.cwd, styles));
      return;
    }
    const name = resolveStyleName(raw, styles.keys());
    if (!name) {
      ctx.ui.notify(`Unknown style "${raw}". Available: ${[...styles.keys()].sort().join(", ") || "(none)"}`, "error");
      return;
    }
    updateState(userStateFile(), { active: name });
    ctx.ui.notify(`Default style → "${name}" for every new session and project.`, "info");
    renderIndicator(ctx, resolveActiveStyle(ctx.cwd, styles));
    return;
  }

  if (raw.length === 0) {
    ctx.ui.notify(`Style indicator: ${resolveIndicator(ctx.cwd)}`, "info");
    return;
  }
  if (!isIndicatorMode(raw)) {
    ctx.ui.notify(`Indicator must be one of: ${INDICATOR_MODES.join(", ")}`, "error");
    return;
  }
  updateState(userStateFile(), { indicator: raw });
  ctx.ui.notify(`Style indicator → ${raw}`, "info");
  renderIndicator(ctx, resolveActiveStyle(ctx.cwd, styles));
}

// Interactive path: two dialogs, then a summary. Falls back to printing when
// the run has no dialog-capable UI (print/json modes).
async function openConfigDialogs(ctx: ExtensionContext, styles: Map<string, Style>): Promise<void> {
  if (typeof ctx.ui.select !== "function") {
    ctx.ui.notify(describeConfig(ctx.cwd), "info");
    return;
  }

  const current = readState(userStateFile()).active ?? "(none)";
  const chosen = await ctx.ui.select(`Default output style for new sessions (now: ${current})`, [
    "(keep current)",
    "(none)",
    ...[...styles.keys()].sort(),
  ]);
  if (chosen !== undefined && chosen !== "(keep current)") {
    updateState(userStateFile(), { active: chosen === "(none)" ? undefined : chosen });
  }

  const mode = await ctx.ui.select(`Style indicator (now: ${resolveIndicator(ctx.cwd)})`, [
    "(keep current)",
    ...INDICATOR_MODES,
  ]);
  if (mode !== undefined && mode !== "(keep current)" && isIndicatorMode(mode)) {
    updateState(userStateFile(), { indicator: mode });
  }

  renderIndicator(ctx, resolveActiveStyle(ctx.cwd, styles));
  ctx.ui.notify(`Saved.\n${describeConfig(ctx.cwd)}`, "info");
}

export default function outputStyles(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    renderIndicator(ctx, resolveActiveStyle(ctx.cwd));
    if (started || !ctx.hasUI) return;
    started = true;
    startHintPoller(ctx);
    pi.on("session_shutdown", () => {
      started = false;
      lastHintInput = null;
    });
  });

  pi.on("before_agent_start", (event, ctx) => {
    try {
      const style = resolveActiveStyle(ctx.cwd);
      if (!style) {
        renderIndicator(ctx, null);
        return;
      }
      // Apply first; only reflect the style in the status line once the prompt
      // was actually augmented, so a swallowed throw never advertises a style
      // the turn did not apply.
      const systemPrompt = applyStyle(event.systemPrompt ?? "", style);
      renderIndicator(ctx, style);
      return { systemPrompt };
    } catch {
      return; // never fail a turn over a styling concern
    }
  });

  pi.registerCommand("output-style", {
    description:
      "Select an output style, or ask the agent to review, rewrite, or create one. Usage: /output-style <name|off|what you want> [--save] [--project]",
    getArgumentCompletions: argumentPrefix => styleCompletions(argumentPrefix, process.cwd()),
    handler: async (args, ctx) => {
      const styles = discoverStyles(styleDirs(ctx.cwd));
      const route = routeStyleCommand(args, styles.keys());

      if (route.kind === "config") {
        const parsed = parseConfigArgs(route.args);
        if (parsed === null) {
          ctx.ui.notify("Config keys: default <style|off>, indicator <status|widget|off>", "error");
          return;
        }
        if (parsed.key === null) await openConfigDialogs(ctx, styles);
        else applyConfigValue(parsed.key, parsed.value, ctx, styles);
        return;
      }

      if (route.kind === "task") {
        let task: string;
        try {
          task = buildStyleTask(leaderBrief(), ctx.cwd, resolveActiveStyle(ctx.cwd, styles), route.request);
        } catch (err) {
          ctx.ui.notify(`Could not build the output-style task: ${String(err)}`, "error");
          return;
        }
        // Mid-stream the delivery mode is required; otherwise the message goes
        // out immediately and triggers the turn.
        pi.sendUserMessage(task, ctx.isIdle?.() === false ? { deliverAs: "followUp" } : undefined);
        return;
      }

      const { name: requested, persist } = parseStyleCommandArgs(args);
      const name = requested === null ? null : (resolveStyleName(requested, styles.keys()) ?? requested);
      const available = [...styles.keys()].sort().join(", ") || "(none)";

      const unknownFlags = args
        .trim()
        .split(/\s+/)
        .filter(t => t.startsWith("--") && !KNOWN_FLAGS.includes(t));
      if (unknownFlags.length > 0) {
        ctx.ui.notify(`Ignored unknown flag(s): ${unknownFlags.join(", ")}`, "warning");
      }

      if (!name) {
        const current = resolveActiveStyle(ctx.cwd, styles);
        const listing = [...styles.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(s => (s.description ? `${s.name} — ${s.description}` : s.name))
          .join("\n");
        ctx.ui.notify(
          `Active style: ${current?.name ?? "(none)"}\nAvailable:\n${listing || "(none)"}\n\n` +
            "/output-style <name|off> [--save] [--project] to switch, or /output-style <request> to have the agent review, rewrite, or create a style.",
          "info",
        );
        return;
      }
      if (OFF_WORDS[name.toLowerCase()]) {
        session = { type: "off" };
        let offScope = "this session";
        try {
          if (persist === "user") {
            updateState(userStateFile(), { active: undefined });
            offScope = "cleared · user default";
          } else if (persist === "project") {
            updateState(projectStateFile(ctx.cwd), { active: undefined });
            offScope = "cleared · project default";
          }
        } catch (err) {
          ctx.ui.notify(`Cleared for this session, but updating the saved default failed: ${String(err)}`, "warning");
        }
        renderIndicator(ctx, null);
        ctx.ui.notify(`Output style off (${offScope}).`, "info");
        return;
      }
      if (!styles.has(name)) {
        ctx.ui.notify(`Unknown style "${name}". Available: ${available}`, "error");
        return;
      }

      session = { type: "style", name };
      let scope = "this session";
      try {
        if (persist === "user") {
          updateState(userStateFile(), { active: name });
          scope = "saved · user default";
        } else if (persist === "project") {
          updateState(projectStateFile(ctx.cwd), { active: name });
          scope = "saved · project default";
        }
      } catch (err) {
        ctx.ui.notify(`Applied for this session, but saving failed: ${String(err)}`, "warning");
      }
      renderIndicator(ctx, styles.get(name) ?? null);
      ctx.ui.notify(`Output style → "${name}" (${scope}).`, "info");
    },
  });
}
