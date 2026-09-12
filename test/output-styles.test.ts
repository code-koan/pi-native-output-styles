import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import outputStyles, {
  parseStyle,
  discoverStyles,
  readState,
  writeState,
  resolveActiveName,
  applyStyle,
  parseStyleCommandArgs,
  bundledStylesDir,
  projectStateFile,
  userStateFile,
  userStylesDir,
  projectStylesDir,
  configHome,
  styleCompletions,
  styleHintFor,
  startHintPoller,
  resolveActiveStyle,
} from "../extensions/output-styles.ts";

describe("parseStyle", () => {
  test("parses frontmatter name, description, and body", () => {
    const text = "---\nname: teacher\ndescription: teaches the why\n---\nAct as a teacher.\nExplain first.";
    const s = parseStyle(text, "fallback");
    expect(s.name).toBe("teacher");
    expect(s.description).toBe("teaches the why");
    expect(s.body).toBe("Act as a teacher.\nExplain first.");
  });

  test("uses fallback name when frontmatter omits name", () => {
    const text = "---\ndescription: no name here\n---\nBody text.";
    const s = parseStyle(text, "concise");
    expect(s.name).toBe("concise");
    expect(s.body).toBe("Body text.");
  });

  test("treats a file with no frontmatter as all-body with fallback name", () => {
    const s = parseStyle("Just a plain body.", "plain");
    expect(s.name).toBe("plain");
    expect(s.description).toBe("");
    expect(s.body).toBe("Just a plain body.");
  });

  test("strips surrounding quotes from frontmatter values", () => {
    const s = parseStyle('---\nname: "quoted"\n---\nx', "fb");
    expect(s.name).toBe("quoted");
  });

  test("falls back to fallbackName when name value is empty", () => {
    const s = parseStyle("---\nname:\n---\nB", "fb");
    expect(s.name).toBe("fb");
  });

  test("preserves an unmatched trailing apostrophe instead of stripping it", () => {
    const s = parseStyle("---\ndescription: the devs'\n---\nB", "fb");
    expect(s.description).toBe("the devs'");
  });

  test("does not treat a line merely starting with --- as the closing fence", () => {
    const s = parseStyle("---\nname: x\n--- junk\nB", "fb");
    expect(s.name).toBe("fb");
    expect(s.body).toContain("name: x");
  });

  test("parses CRLF frontmatter and preserves CRLF body line endings", () => {
    const text = "---\r\nname: teacher\r\ndescription: why\r\n---\r\nBody one\r\nBody two";
    const s = parseStyle(text, "fb");
    expect(s.name).toBe("teacher");
    expect(s.description).toBe("why");
    expect(s.body).toBe("Body one\r\nBody two");
  });
});

function tmpStylesDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pos-styles-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

describe("discoverStyles", () => {
  test("reads .md styles from a directory keyed by name", () => {
    const dir = tmpStylesDir({
      "teacher.md": "---\nname: teacher\n---\nteach body",
      "notes.txt": "ignored",
    });
    const m = discoverStyles([dir]);
    expect(m.has("teacher")).toBe(true);
    expect(m.get("teacher")!.body).toBe("teach body");
    expect(m.size).toBe(1); // .txt ignored
  });

  test("higher-precedence dir overrides same-named style", () => {
    const low = tmpStylesDir({ "x.md": "---\nname: x\n---\nlow" });
    const high = tmpStylesDir({ "x.md": "---\nname: x\n---\nhigh" });
    const m = discoverStyles([low, high]);
    expect(m.get("x")!.body).toBe("high");
  });

  test("skips missing dirs and empty-body files", () => {
    const dir = tmpStylesDir({ "empty.md": "---\nname: empty\n---\n   " });
    const m = discoverStyles(["/no/such/dir", dir]);
    expect(m.size).toBe(0);
  });

  test("same-tier same-name collision resolves deterministically to the alphabetically-last filename", () => {
    const dir = tmpStylesDir({
      "a.md": "---\nname: dup\n---\nBODY-A",
      "z.md": "---\nname: dup\n---\nBODY-Z",
    });
    const m = discoverStyles([dir]);
    expect(m.get("dup")!.body).toBe("BODY-Z");
  });
});

describe("state", () => {
  test("writeState then readState round-trips active", () => {
    const dir = mkdtempSync(join(tmpdir(), "pos-state-"));
    const file = join(dir, "nested", "state.json");
    writeState(file, { active: "teacher" });
    expect(readState(file)).toEqual({ active: "teacher" });
  });

  test("readState returns {} for missing or malformed files", () => {
    expect(readState("/no/such/file.json")).toEqual({});
    const dir = mkdtempSync(join(tmpdir(), "pos-state-"));
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(readState(bad)).toEqual({});
    const noActive = join(dir, "noactive.json");
    writeFileSync(noActive, JSON.stringify({ other: 1 }));
    expect(readState(noActive)).toEqual({});
  });
});

describe("resolveActiveName", () => {
  test("session beats user beats project", () => {
    expect(resolveActiveName("s", { active: "u" }, { active: "p" })).toBe("s");
    expect(resolveActiveName(null, { active: "u" }, { active: "p" })).toBe("u");
    expect(resolveActiveName(null, {}, { active: "p" })).toBe("p");
    expect(resolveActiveName(null, {}, {})).toBe(null);
  });
});

describe("paths", () => {
  test("user and project locations resolve under .pi", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-pi-"));
    const home = mkdtempSync(join(tmpdir(), "pos-pihome-"));
    process.env.PI_OUTPUT_STYLES_HOME = home;
    expect(configHome()).toBe(home);
    expect(userStylesDir()).toBe(join(home, "output-styles"));
    expect(userStateFile()).toBe(join(home, "output-styles.json"));
    expect(projectStylesDir(cwd)).toBe(join(cwd, ".pi", "output-styles"));
    expect(projectStateFile(cwd)).toBe(join(cwd, ".pi", "output-styles.json"));
  });

  test("PI_CODING_AGENT_DIR sets the user root when PI_OUTPUT_STYLES_HOME is unset", () => {
    const home = mkdtempSync(join(tmpdir(), "pos-agentdir-"));
    const previous = { home: process.env.PI_OUTPUT_STYLES_HOME, agent: process.env.PI_CODING_AGENT_DIR };
    delete process.env.PI_OUTPUT_STYLES_HOME;
    process.env.PI_CODING_AGENT_DIR = home;
    try {
      expect(userStylesDir()).toBe(join(home, "output-styles"));
      expect(userStateFile()).toBe(join(home, "output-styles.json"));
    } finally {
      if (previous.home === undefined) delete process.env.PI_OUTPUT_STYLES_HOME;
      else process.env.PI_OUTPUT_STYLES_HOME = previous.home;
      if (previous.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous.agent;
    }
  });
});

describe("applyStyle", () => {
  const style = { name: "eli5", description: "", body: "Talk like I'm 5." };

  test("prepends a marked # Personality block above the prompt", () => {
    const out = applyStyle("You are a coding assistant.", style);
    expect(out).toBe("# Personality\n<!-- output-styles:eli5 -->\nTalk like I'm 5.\n\nYou are a coding assistant.");
    expect(out.indexOf("# Personality")).toBe(0);
  });

  test("leaves an empty prompt as just the marked block", () => {
    expect(applyStyle("", style)).toBe("<!-- output-styles:eli5 -->\nTalk like I'm 5.");
  });

  test("is idempotent when a marker is already present", () => {
    const once = applyStyle("BASE", style);
    expect(applyStyle(once, style)).toBe(once);
  });

  test("does not apply a second style when a marker is already present", () => {
    const other = { name: "teacher", description: "", body: "Teach." };
    expect(applyStyle(applyStyle("BASE", style), other)).toBe(applyStyle("BASE", style));
  });

  test("keeps the original prompt intact below the injected block", () => {
    const prompt = "You are a coding assistant.\n\nAvailable tools:\n- read\n\nCurrent working directory: /x";
    const out = applyStyle(prompt, style);
    expect(out.endsWith(prompt)).toBe(true);
    expect(out).toContain("- read");
  });
});

describe("parseStyleCommandArgs", () => {
  test("bare name → session scope", () => {
    expect(parseStyleCommandArgs("teacher")).toEqual({ name: "teacher", persist: "none" });
  });
  test("--save → user scope", () => {
    expect(parseStyleCommandArgs("teacher --save")).toEqual({ name: "teacher", persist: "user" });
  });
  test("--global is an alias for user scope", () => {
    expect(parseStyleCommandArgs("teacher --global")).toEqual({ name: "teacher", persist: "user" });
  });
  test("--project (with or without --save) → project scope", () => {
    expect(parseStyleCommandArgs("teacher --save --project")).toEqual({ name: "teacher", persist: "project" });
    expect(parseStyleCommandArgs("teacher --project")).toEqual({ name: "teacher", persist: "project" });
  });
  test("flag order does not matter and empty input yields null name", () => {
    expect(parseStyleCommandArgs("--save teacher")).toEqual({ name: "teacher", persist: "user" });
    expect(parseStyleCommandArgs("   ")).toEqual({ name: null, persist: "none" });
  });
  test("flag order is irrelevant to precedence: --project before --save still yields project scope", () => {
    expect(parseStyleCommandArgs("teacher --project --save")).toEqual({ name: "teacher", persist: "project" });
  });
  test("only the first non-flag token is treated as the name", () => {
    expect(parseStyleCommandArgs("teacher concise")).toEqual({ name: "teacher", persist: "none" });
  });
  test("flag-only input yields a null name with the flag's persist scope", () => {
    expect(parseStyleCommandArgs("--save")).toEqual({ name: null, persist: "user" });
  });
});

describe("bundled styles", () => {
  test("bundledStylesDir resolves to the shipped styles directory", () => {
    expect(existsSync(bundledStylesDir())).toBe(true);
  });

  test("every starter style discovers with a non-empty body and description", () => {
    const m = discoverStyles([bundledStylesDir()]);
    for (const name of ["concise", "explanatory", "teacher", "reviewer", "diagrams-first", "ste", "eli5"]) {
      expect(m.has(name)).toBe(true);
      expect(m.get(name)!.body.length).toBeGreaterThan(0);
      expect(m.get(name)!.description.length).toBeGreaterThan(0);
      expect(m.get(name)!.body.startsWith("---")).toBe(false);
    }
  });
});

interface Captured {
  commands: Record<string, (args: string, ctx: FakeCtx) => unknown>;
  handlers: Record<string, (event: unknown, ctx: FakeCtx) => unknown>;
  statuses: (string | undefined)[];
  notes: { message: string; type?: string }[];
  widgets: { key: string; lines: string[] | null }[];
  timers: (() => void)[];
  editorText: string;
}
interface FakeCtx {
  cwd: string;
  hasUI: boolean;
  ui: {
    setStatus: (k: string, t: string | undefined) => void;
    setWidget: (k: string, lines: string[] | undefined) => void;
    getEditorText: () => string;
    notify: (m: string, t?: string) => void;
  };
  setInterval: (cb: () => void, ms?: number) => unknown;
}

function harness(cwd: string): { cap: Captured; ctx: FakeCtx } {
  const cap: Captured = { commands: {}, handlers: {}, statuses: [], notes: [], widgets: [], timers: [], editorText: "" };
  const ctx: FakeCtx = {
    cwd,
    hasUI: true,
    ui: {
      setStatus: (_k, t) => cap.statuses.push(t),
      setWidget: (k, lines) => cap.widgets.push({ key: k, lines: lines ?? null }),
      getEditorText: () => cap.editorText,
      notify: (m, t) => cap.notes.push({ message: m, type: t }),
    },
    setInterval: cb => {
      cap.timers.push(cb);
      return 0;
    },
  };
  const pi = {
    setLabel: () => {},
    on: (event: string, handler: (e: unknown, c: FakeCtx) => unknown) => {
      cap.handlers[event] = handler;
    },
    registerCommand: (name: string, def: { handler: (a: string, c: FakeCtx) => unknown }) => {
      cap.commands[name] = def.handler;
    },
  };
  // Fake pi implements only the surface the extension uses; its handler/ctx
  // types are intentionally narrower than the real ExtensionAPI, so bridge
  // via `unknown` rather than `any` (Parameters<> avoids importing the
  // module-local, unexported ExtensionAPI type by name).
  outputStyles(pi as unknown as Parameters<typeof outputStyles>[0]);
  return { cap, ctx };
}

function freshCwd(prefix: string): string {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), `${prefix}home-`));
  return cwd;
}

describe("extension wiring", () => {
  test("no active style → before_agent_start leaves the prompt unchanged", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    const result = await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: "BASE" }, ctx);
    expect(result).toBeUndefined();
  });

  // NOTE: order matters. `session` is module-level and persists across tests in
  // this file, and "teacher" is a bundled style discoverable from any cwd, so
  // the teacher-session test must run after this "no active style" case.
  test("/style unknown → error notice and no prompt change", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("nope-not-real", ctx);
    expect(cap.notes.some(n => n.type === "error")).toBe(true);
    const result = await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: "BASE" }, ctx);
    expect(result).toBeUndefined();
  });

  test("/style teacher (session) → hook prepends the teacher block", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher", ctx);
    const result = (await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: "BASE" }, ctx)) as {
      systemPrompt: string;
    };
    expect(typeof result.systemPrompt).toBe("string");
    expect(result.systemPrompt).toContain("<!-- output-styles:teacher -->");
    expect(result.systemPrompt.startsWith("# Personality\n")).toBe(true);
    expect(result.systemPrompt.endsWith("BASE")).toBe(true);
    expect(cap.notes.some(n => n.type === "info")).toBe(true);
    // Personal-by-default: a bare /style (no --save/--project flag) must not
    // persist anything to disk — only `session` (in-memory) changes.
    expect(readState(projectStateFile(cwd))).toEqual({});
    expect(readState(userStateFile())).toEqual({});
  });

  test("/style teacher --project persists to the project state file", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher --project", ctx);
    expect(readState(projectStateFile(cwd))).toEqual({ active: "teacher" });
    expect(readState(userStateFile())).toEqual({});
  });

  test("/style teacher --save persists to the user state file only", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher --save", ctx);
    expect(readState(userStateFile())).toEqual({ active: "teacher" });
    expect(readState(projectStateFile(cwd))).toEqual({});
  });

  // `session` is "teacher" here (set by the session-scope test above), and each
  // harness() call below builds a fresh `cap`, so these tests observe only their
  // own captured statuses/notes.
  test("session_start sets the status line", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.handlers["session_start"](undefined, ctx);
    expect(cap.statuses).toContain("style: teacher");
  });

  test("hasUI:false suppresses status", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    const noUiCtx: FakeCtx = { ...ctx, hasUI: false };
    await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: "BASE" }, noUiCtx);
    expect(cap.statuses).toEqual([]);
  });

  test("/style <unknown> does not clobber the active style", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher", ctx);
    const first = (await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: "BASE" }, ctx)) as {
      systemPrompt: string;
    };
    expect(first.systemPrompt).toContain("<!-- output-styles:teacher -->");

    await cap.commands["style"]("nope-not-real", ctx);
    const second = (await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: "BASE" }, ctx)) as {
      systemPrompt: string;
    };
    expect(second.systemPrompt).toContain("<!-- output-styles:teacher -->");
  });

  test("/style teacher resolves a .pi/output-styles definition over the bundled one", async () => {
    const cwd = freshCwd("pos-wire-");
    mkdirSync(join(cwd, ".pi", "output-styles"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "output-styles", "teacher.md"),
      "---\nname: teacher\ndescription: local\n---\nPROJECT-OVERRIDE-BODY",
    );
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher", ctx);
    const result = (await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: "BASE" }, ctx)) as {
      systemPrompt: string;
    };
    expect(result.systemPrompt).toContain("PROJECT-OVERRIDE-BODY");
  });

  test("a .pi/output-styles.json project default activates a style with no /style call", async () => {
    const cwd = freshCwd("pos-wire-");
    writeState(projectStateFile(cwd), { active: "teacher" });
    expect(resolveActiveStyle(cwd)?.name).toBe("teacher");
    const { cap, ctx } = harness(cwd);
    const result = (await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: "BASE" }, ctx)) as {
      systemPrompt: string;
    };
    expect(result.systemPrompt).toContain("<!-- output-styles:teacher -->");
  });

  test("before_agent_start never throws even when the event is malformed", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher", ctx);
    const malformedEvent = { prompt: "hi", systemPrompt: 42 };
    const result = await cap.handlers["before_agent_start"](malformedEvent, ctx);
    expect(result).toBeUndefined();
  });

  test("/style teacher --project notifies a warning and does not throw when saving fails", async () => {
    const cwd = freshCwd("pos-wire-");
    writeFileSync(join(cwd, ".pi"), "not a directory");
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher --project", ctx);
    expect(cap.notes.some(n => n.type === "warning" && n.message.includes("saving failed"))).toBe(true);
  });

  test("/style teacher --saev warns about the unknown flag and still applies teacher", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher --saev", ctx);
    expect(cap.notes.some(n => n.type === "warning" && n.message.includes("--saev"))).toBe(true);
    const result = (await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: "BASE" }, ctx)) as {
      systemPrompt: string;
    };
    expect(result.systemPrompt).toContain("<!-- output-styles:teacher -->");
  });

  test("/style (no args) lists styles with their descriptions", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("", ctx);
    const info = cap.notes.find(n => n.type === "info");
    expect(info?.message).toContain("Teach as you go; explain concepts before applying them");
  });

  test("/style off overrides a saved default and clears the session", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    writeState(userStateFile(), { active: "teacher" }); // a saved default exists
    await cap.commands["style"]("teacher", ctx);
    expect(resolveActiveStyle(cwd)?.name).toBe("teacher");
    await cap.commands["style"]("off", ctx);
    expect(resolveActiveStyle(cwd)).toBeNull();
    expect(cap.notes.some(n => n.type === "info" && n.message.toLowerCase().includes("off"))).toBe(true);
  });

  test("/style none is an alias for off", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    writeState(userStateFile(), { active: "teacher" });
    await cap.commands["style"]("none", ctx);
    expect(resolveActiveStyle(cwd)).toBeNull();
  });

  test("/style off --save clears the saved user default", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    writeState(userStateFile(), { active: "teacher" });
    await cap.commands["style"]("off --save", ctx);
    expect(readState(userStateFile())).toEqual({});
  });
});

describe("styleCompletions", () => {
  test("completes bundled style names filtered by prefix, with descriptions", () => {
    const items = styleCompletions("te", freshCwd("pos-comp-"))!;
    expect(items.map(i => i.value)).toEqual(["teacher"]);
    expect(items[0].label).toBe("teacher");
    expect(items[0].description!.length).toBeGreaterThan(0);
  });

  test("advertises the persist flags as a hint on every item", () => {
    const items = styleCompletions("", freshCwd("pos-comp-"))!;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.hint).toBe("[--save] [--project]");
  });

  test("empty prefix returns all bundled styles plus off, sorted", () => {
    const items = styleCompletions("", freshCwd("pos-comp-"))!;
    expect(items.map(i => i.value)).toEqual([
      "concise",
      "diagrams-first",
      "eli5",
      "explanatory",
      "reviewer",
      "ste",
      "teacher",
      "off",
    ]);
  });

  test("returns null once a space is present (name already typed)", () => {
    expect(styleCompletions("teacher ", freshCwd("pos-comp-"))).toBe(null);
  });

  test("returns null when nothing matches", () => {
    expect(styleCompletions("zzz", freshCwd("pos-comp-"))).toBe(null);
  });

  test("offers 'off' to clear the active style", () => {
    expect(styleCompletions("of", freshCwd("pos-comp-"))!.map(i => i.value)).toEqual(["off"]);
  });

  test("offers a project style and can shadow a bundled name", () => {
    const cwd = freshCwd("pos-comp-");
    mkdirSync(join(cwd, ".pi", "output-styles"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "output-styles", "custom.md"), "---\nname: custom\ndescription: mine\n---\nX");
    expect(styleCompletions("cu", cwd)!.map(i => i.value)).toEqual(["custom"]);
  });
});

describe("styleHintFor", () => {
  test("shows the flag hint while a /style command is composed", () => {
    for (const text of ["/style", "/style ", "/style concise", "/style concise --save", "  /style off --project"]) {
      const lines = styleHintFor(text);
      expect(lines).not.toBeNull();
      expect(lines![0]).toContain("--save");
      expect(lines![1]).toContain("--project");
    }
  });

  test("hides the hint when the input is not a /style command", () => {
    for (const text of ["", "hello", "/styl", "/stylex", "x /style", "/mcp add", "/style:other"]) {
      expect(styleHintFor(text)).toBeNull();
    }
  });
});

describe("startHintPoller", () => {
  test("shows the flag widget while /style is composed, then clears it", () => {
    const { cap, ctx } = harness(freshCwd("pos-poll-"));
    startHintPoller(ctx);
    expect(cap.timers).toHaveLength(1);

    cap.editorText = "/style concise";
    cap.timers[0](); // tick 1: text changed → debounce, no widget yet
    expect(cap.widgets).toEqual([]);
    cap.timers[0](); // tick 2: stable → widget shown
    expect(cap.widgets).toHaveLength(1);
    expect(cap.widgets[0].key).toBe("output-styles-hint");
    expect(cap.widgets[0].lines!.join("\n")).toContain("--save");
    expect(cap.widgets[0].lines!.join("\n")).toContain("--project");

    cap.timers[0](); // tick 3: unchanged text → no churn
    expect(cap.widgets).toHaveLength(1);

    cap.editorText = "";
    cap.timers[0]();
    cap.timers[0]();
    expect(cap.widgets).toHaveLength(2);
    expect(cap.widgets[1].lines).toBeNull();
  });
});
