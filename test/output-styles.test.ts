import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import outputStyles, {
  parseStyle,
  discoverStyles,
  readState,
  writeState,
  updateState,
  resolveIndicator,
  parseConfigArgs,
  INDICATOR_MODES,
  resolveActiveName,
  applyStyle,
  parseStyleCommandArgs,
  bundledStylesDir,
  projectStateFile,
  userStateFile,
  userStylesDir,
  projectStylesDir,
  configHome,
  styleCatalog,
  routeStyleCommand,
  buildStyleTask,
  leaderBrief,
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
    for (const name of ["caveman", "concise", "explanatory", "teacher", "reviewer", "diagrams-first", "ste", "eli5"]) {
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
  widgets: { key: string; lines: string[] | null; placement?: string }[];
  timers: (() => void)[];
  userMessages: { content: string; deliverAs?: string }[];
  selectCalls: { title: string; options: string[] }[];
  selectAnswers: (string | undefined)[];
  editorText: string;
}
interface FakeCtx {
  cwd: string;
  hasUI: boolean;
  isIdle: () => boolean;
  ui: {
    setStatus: (k: string, t: string | undefined) => void;
    setWidget: (k: string, lines: string[] | undefined, options?: { placement: "aboveEditor" | "belowEditor" }) => void;
    getEditorText: () => string;
    notify: (m: string, t?: string) => void;
    select: (title: string, options: string[]) => Promise<string | undefined>;
  };
  setInterval: (cb: () => void, ms?: number) => unknown;
}

function harness(cwd: string): { cap: Captured; ctx: FakeCtx } {
  const cap: Captured = {
    commands: {},
    handlers: {},
    statuses: [],
    notes: [],
    widgets: [],
    timers: [],
    userMessages: [],
    selectCalls: [],
    selectAnswers: [],
    editorText: "",
  };
  const ctx: FakeCtx = {
    cwd,
    hasUI: true,
    isIdle: () => true,
    ui: {
      setStatus: (_k, t) => cap.statuses.push(t),
      setWidget: (k, lines, options) =>
        cap.widgets.push({ key: k, lines: lines ?? null, placement: options?.placement }),
      getEditorText: () => cap.editorText,
      notify: (m, t) => cap.notes.push({ message: m, type: t }),
      select: (title, options) => {
        cap.selectCalls.push({ title, options });
        return Promise.resolve(cap.selectAnswers.shift());
      },
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
    sendUserMessage: (content: string, options?: { deliverAs?: "steer" | "followUp" }) =>
      cap.userMessages.push({ content, deliverAs: options?.deliverAs }),
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
  test("/output-style <Name> activates the canonical case-insensitive match", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("Teacher", ctx);
    expect(cap.notes.some(n => n.type === "error")).toBe(false);
    expect(resolveActiveStyle(cwd)?.name).toBe("teacher");
  });

  test("/output-style teacher (session) → hook prepends the teacher block", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("teacher", ctx);
    const result = (await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: "BASE" }, ctx)) as {
      systemPrompt: string;
    };
    expect(typeof result.systemPrompt).toBe("string");
    expect(result.systemPrompt).toContain("<!-- output-styles:teacher -->");
    expect(result.systemPrompt.startsWith("# Personality\n")).toBe(true);
    expect(result.systemPrompt.endsWith("BASE")).toBe(true);
    expect(cap.notes.some(n => n.type === "info")).toBe(true);
    // Personal-by-default: a bare /output-style (no --save/--project flag) must not
    // persist anything to disk — only `session` (in-memory) changes.
    expect(readState(projectStateFile(cwd))).toEqual({});
    expect(readState(userStateFile())).toEqual({});
  });

  test("/output-style teacher --project persists to the project state file", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("teacher --project", ctx);
    expect(readState(projectStateFile(cwd))).toEqual({ active: "teacher" });
    expect(readState(userStateFile())).toEqual({});
  });

  test("/output-style teacher --save persists to the user state file only", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("teacher --save", ctx);
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

  test("/output-style <unknown> does not clobber the active style", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("teacher", ctx);
    const first = (await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: "BASE" }, ctx)) as {
      systemPrompt: string;
    };
    expect(first.systemPrompt).toContain("<!-- output-styles:teacher -->");

    await cap.commands["output-style"]("nope-not-real", ctx);
    const second = (await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: "BASE" }, ctx)) as {
      systemPrompt: string;
    };
    expect(second.systemPrompt).toContain("<!-- output-styles:teacher -->");
  });

  test("/output-style teacher resolves a .pi/output-styles definition over the bundled one", async () => {
    const cwd = freshCwd("pos-wire-");
    mkdirSync(join(cwd, ".pi", "output-styles"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "output-styles", "teacher.md"),
      "---\nname: teacher\ndescription: local\n---\nPROJECT-OVERRIDE-BODY",
    );
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("teacher", ctx);
    const result = (await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: "BASE" }, ctx)) as {
      systemPrompt: string;
    };
    expect(result.systemPrompt).toContain("PROJECT-OVERRIDE-BODY");
  });

  test("a .pi/output-styles.json project default activates a style with no /output-style call", async () => {
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
    await cap.commands["output-style"]("teacher", ctx);
    const malformedEvent = { prompt: "hi", systemPrompt: 42 };
    const result = await cap.handlers["before_agent_start"](malformedEvent, ctx);
    expect(result).toBeUndefined();
  });

  test("/output-style teacher --project notifies a warning and does not throw when saving fails", async () => {
    const cwd = freshCwd("pos-wire-");
    writeFileSync(join(cwd, ".pi"), "not a directory");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("teacher --project", ctx);
    expect(cap.notes.some(n => n.type === "warning" && n.message.includes("saving failed"))).toBe(true);
  });

  test("/output-style teacher --saev warns about the unknown flag and still applies teacher", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("teacher --saev", ctx);
    expect(cap.notes.some(n => n.type === "warning" && n.message.includes("--saev"))).toBe(true);
    const result = (await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: "BASE" }, ctx)) as {
      systemPrompt: string;
    };
    expect(result.systemPrompt).toContain("<!-- output-styles:teacher -->");
  });

  test("/output-style (no args) lists styles with their descriptions", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("", ctx);
    const info = cap.notes.find(n => n.type === "info");
    expect(info?.message).toContain("Teach as you go; explain concepts before applying them");
  });

  test("/output-style off overrides a saved default and clears the session", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    writeState(userStateFile(), { active: "teacher" }); // a saved default exists
    await cap.commands["output-style"]("teacher", ctx);
    expect(resolveActiveStyle(cwd)?.name).toBe("teacher");
    await cap.commands["output-style"]("off", ctx);
    expect(resolveActiveStyle(cwd)).toBeNull();
    expect(cap.notes.some(n => n.type === "info" && n.message.toLowerCase().includes("off"))).toBe(true);
  });

  test("/output-style none is an alias for off", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    writeState(userStateFile(), { active: "teacher" });
    await cap.commands["output-style"]("none", ctx);
    expect(resolveActiveStyle(cwd)).toBeNull();
  });

  test("/output-style off --save clears the saved user default", async () => {
    const cwd = freshCwd("pos-wire-");
    const { cap, ctx } = harness(cwd);
    writeState(userStateFile(), { active: "teacher" });
    await cap.commands["output-style"]("off --save", ctx);
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
      "caveman",
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
  test("shows the hint while an /output-style command is composed", () => {
    for (const text of [
      "/output-style",
      "/output-style ",
      "/output-style concise",
      "/output-style concise --save",
      "  /output-style off --project",
    ]) {
      const lines = styleHintFor(text);
      expect(lines).not.toBeNull();
      // Line 1 is the management form, line 2 advertises the agent form.
      expect(lines![0]).toContain("--save");
      expect(lines![0]).toContain("--project");
      expect(lines![1]).toContain("config");
    }
  });

  test("hides the hint when the input is not an /output-style command", () => {
    for (const text of [
      "",
      "hello",
      "/styl",
      "/style",
      "/output-styl",
      "/output-styleX",
      "x /output-style",
      "/mcp add",
      "/output-style:other",
    ]) {
      expect(styleHintFor(text)).toBeNull();
    }
  });
});

describe("startHintPoller", () => {
  test("shows the hint widget while /output-style is composed, then clears it", () => {
    const { cap, ctx } = harness(freshCwd("pos-poll-"));
    startHintPoller(ctx);
    expect(cap.timers).toHaveLength(1);

    cap.editorText = "/output-style concise";
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

describe("styleCatalog", () => {
  test("reports the winning definition per name with tier and real path", () => {
    const cwd = freshCwd("pos-cat-");
    mkdirSync(join(cwd, ".pi", "output-styles"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "output-styles", "teacher.md"), "---\nname: teacher\ndescription: local\n---\nX");
    const catalog = styleCatalog(cwd);

    const teacher = catalog.find(s => s.name === "teacher")!;
    expect(teacher.tier).toBe("project");
    expect(teacher.path).toBe(join(cwd, ".pi", "output-styles", "teacher.md"));
    expect(teacher.description).toBe("local");

    // Bundled styles remain visible and are marked non-writable.
    const concise = catalog.find(s => s.name === "concise")!;
    expect(concise.tier).toBe("bundled");
    expect(concise.path).toBe(join(bundledStylesDir(), "concise.md"));
  });

  test("is sorted and never repeats a name", () => {
    const cwd = freshCwd("pos-cat-");
    mkdirSync(join(cwd, ".pi", "output-styles"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "output-styles", "teacher.md"), "---\nname: teacher\n---\nX");
    const names = styleCatalog(cwd).map(s => s.name);
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("leader brief", () => {
  test("loads from disk and stays short enough to maintain", () => {
    const brief = leaderBrief();
    expect(brief.startsWith("# Output style task")).toBe(true);
    // Guard against prompt creep: this is a task brief, not a system prompt.
    expect(brief.length).toBeLessThan(3000);
  });

  test("tells the leader it decides on delegation and owns the write", () => {
    const brief = leaderBrief();
    // Delegation is what produced the multi-agent behaviour; the final write is
    // the leader's alone.
    expect(brief).toContain("subagent");
    expect(brief).toContain("最终文件由你自己写");
    // Observed failure: a delegated child wrote the style file itself.
    expect(brief).toContain("子 agent 只报告不写文件");
  });

  test("scopes a style to output behaviour and keeps review report-only", () => {
    const brief = leaderBrief();
    expect(brief).toContain("怎么说");
    expect(brief).toContain("项目架构");
    // Observed failure: a review silently rewrote the file it was asked to review.
    expect(brief).toContain("只报告问题，不直接修改");
    // The report is meant to be three fields, not prose.
    expect(brief).toContain("文件路径");
    expect(brief).toContain("是否完成验证");
  });
});

describe("buildStyleTask", () => {
  test("passes the user's words through verbatim under a Request heading", () => {
    const cwd = freshCwd("pos-task-");
    const request = "重写这个 output style，让它更简洁、更适合编程";
    const task = buildStyleTask(leaderBrief(), cwd, null, request);
    expect(task.endsWith(`## Request\n\n${request}`)).toBe(true);
    expect(task).toContain("## Context");
  });

  test("names the active style, both writable dirs, and every discovered style", () => {
    const cwd = freshCwd("pos-task-");
    mkdirSync(join(cwd, ".pi", "output-styles"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "output-styles", "custom.md"), "---\nname: custom\ndescription: mine\n---\nX");
    const task = buildStyleTask(leaderBrief(), cwd, { name: "teacher", description: "", body: "" }, "review");
    expect(task).toContain("Active style: teacher");
    expect(task).toContain(`Project style dir: ${projectStylesDir(cwd)}`);
    expect(task).toContain(`User style dir: ${userStylesDir()}`);
    expect(task).toContain(`- custom [project] ${join(cwd, ".pi", "output-styles", "custom.md")} — mine`);
    expect(task).toContain("[bundled]");
  });

  test("reports no active style when nothing is selected", () => {
    const cwd = freshCwd("pos-task-");
    expect(buildStyleTask("brief", cwd, null, "review")).toContain("Active style: (none)");
  });
});

describe("/output-style command", () => {
  test("routes a review request to the agent as one user message", async () => {
    const cwd = freshCwd("pos-os-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("帮我审核一下这个 output style", ctx);
    expect(cap.userMessages).toHaveLength(1);
    expect(cap.userMessages[0].content).toContain("帮我审核一下这个 output style");
    expect(cap.userMessages[0].content).toContain("# Output style task");
    // Idle: no delivery mode needed, the message triggers the turn directly.
    expect(cap.userMessages[0].deliverAs).toBeUndefined();
  });

  test("carries the live state to the agent (active style + catalog)", async () => {
    const cwd = freshCwd("pos-os-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("teacher", ctx);
    await cap.commands["output-style"]("review it", ctx);
    const task = cap.userMessages[0].content;
    expect(task).toContain("Active style: teacher");
    expect(task).toContain(`- teacher [bundled] ${join(bundledStylesDir(), "teacher.md")}`);
  });

  test("create request works with no styles in the project yet", async () => {
    const cwd = freshCwd("pos-os-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("创建一个适合代码 Review 的 output style", ctx);
    expect(cap.userMessages).toHaveLength(1);
    expect(cap.userMessages[0].content).toContain("创建一个适合代码 Review 的 output style");
    expect(cap.userMessages[0].content).toContain(`Project style dir: ${projectStylesDir(cwd)}`);
  });

  test("empty request lists styles instead of starting a task", async () => {
    const cwd = freshCwd("pos-os-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("   ", ctx);
    expect(cap.userMessages).toHaveLength(0);
    const info = cap.notes.find(n => n.type === "info");
    expect(info?.message).toContain("Active style:");
    expect(info?.message).toContain("caveman");
  });

  test("a bare style name stays management, not a task", async () => {
    const cwd = freshCwd("pos-os-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("caveman", ctx);
    expect(cap.userMessages).toHaveLength(0);
    expect(resolveActiveStyle(cwd)?.name).toBe("caveman");
    expect(cap.notes.some(n => n.message.includes('Output style → "caveman"'))).toBe(true);
  });

  test("flags after a style name stay management", async () => {
    const cwd = freshCwd("pos-os-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("caveman --project", ctx);
    expect(cap.userMessages).toHaveLength(0);
    expect(readState(projectStateFile(cwd))).toEqual({ active: "caveman" });
  });

  test("off/none stay management", async () => {
    const cwd = freshCwd("pos-os-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("teacher", ctx);
    await cap.commands["output-style"]("off", ctx);
    expect(cap.userMessages).toHaveLength(0);
    expect(resolveActiveStyle(cwd)).toBeNull();
  });

  test("an unknown bare word becomes a task, not an unknown-style error", async () => {
    const cwd = freshCwd("pos-os-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("summarize", ctx);
    expect(cap.userMessages).toHaveLength(1);
    expect(cap.userMessages[0].content).toContain("summarize");
    expect(cap.notes.some(n => n.type === "error")).toBe(false);
  });
});

describe("routeStyleCommand", () => {
  const names = ["teacher", "concise", "caveman"];

  test("empty and flag-only input is management", () => {
    expect(routeStyleCommand("", names)).toEqual({ kind: "manage" });
    expect(routeStyleCommand("   ", names)).toEqual({ kind: "manage" });
    expect(routeStyleCommand("--save", names)).toEqual({ kind: "manage" });
  });

  test("off and none are management", () => {
    expect(routeStyleCommand("off", names)).toEqual({ kind: "manage" });
    expect(routeStyleCommand("NONE", names)).toEqual({ kind: "manage" });
    expect(routeStyleCommand("off --project", names)).toEqual({ kind: "manage" });
  });

  test("a single known style name, case-insensitively, is management", () => {
    expect(routeStyleCommand("teacher", names)).toEqual({ kind: "manage" });
    expect(routeStyleCommand("Teacher", names)).toEqual({ kind: "manage" });
    expect(routeStyleCommand("teacher --save", names)).toEqual({ kind: "manage" });
  });

  test("anything else is a task carrying the raw request", () => {
    expect(routeStyleCommand("review teacher", names)).toEqual({ kind: "task", request: "review teacher" });
    expect(routeStyleCommand("summarize", names)).toEqual({ kind: "task", request: "summarize" });
    expect(routeStyleCommand("创建一个 review 风格", names)).toEqual({
      kind: "task",
      request: "创建一个 review 风格",
    });
    // Two words is never management, even if the first is a style name.
    expect(routeStyleCommand("concise please", names)).toEqual({ kind: "task", request: "concise please" });
  });

  test("a request longer than one word keeps its original spacing and casing", () => {
    const request = "  Rewrite   Concise  ";
    expect(routeStyleCommand(request, names)).toEqual({ kind: "task", request: request.trim() });
  });
});

describe("/output-style while streaming", () => {
  test("mid-stream delivery uses followUp so the message is not dropped", async () => {
    const cwd = freshCwd("pos-os-");
    const { cap, ctx } = harness(cwd);
    const busy: FakeCtx = { ...ctx, isIdle: () => false };
    await cap.commands["output-style"]("rewrite the eli5 style", busy);
    expect(cap.userMessages).toHaveLength(1);
    expect(cap.userMessages[0].deliverAs).toBe("followUp");
  });
});

describe("state merge", () => {
  test("updateState preserves the key it is not changing", () => {
    const dir = mkdtempSync(join(tmpdir(), "pos-merge-"));
    const file = join(dir, "state.json");
    writeState(file, { active: "teacher", indicator: "widget" });
    updateState(file, { indicator: "off" });
    expect(readState(file)).toEqual({ active: "teacher", indicator: "off" });
    updateState(file, { active: undefined });
    expect(readState(file)).toEqual({ indicator: "off" });
  });

  test("readState drops an invalid indicator instead of trusting it", () => {
    const dir = mkdtempSync(join(tmpdir(), "pos-merge-"));
    const file = join(dir, "state.json");
    writeFileSync(file, JSON.stringify({ active: "teacher", indicator: "loud" }));
    expect(readState(file)).toEqual({ active: "teacher" });
  });
});

describe("resolveIndicator", () => {
  test("defaults to the status bar", () => {
    freshCwd("pos-ind-");
    expect(resolveIndicator(mkdtempSync(join(tmpdir(), "pos-ind-")))).toBe("status");
  });

  test("reads the user root, which is what makes it cross-session", () => {
    const cwd = freshCwd("pos-ind-");
    updateState(userStateFile(), { indicator: "widget" });
    expect(resolveIndicator(cwd)).toBe("widget");
  });

  test("the personal setting wins over a project setting, like the default style does", () => {
    const cwd = freshCwd("pos-ind-");
    updateState(userStateFile(), { indicator: "widget" });
    updateState(projectStateFile(cwd), { indicator: "off" });
    expect(resolveIndicator(cwd)).toBe("widget");
  });

  test("a project setting applies when the user has none", () => {
    const cwd = freshCwd("pos-ind-");
    updateState(projectStateFile(cwd), { indicator: "off" });
    expect(resolveIndicator(cwd)).toBe("off");
  });
});

describe("parseConfigArgs", () => {
  test("no arguments asks for the interactive flow", () => {
    expect(parseConfigArgs("")).toEqual({ key: null, value: "" });
    expect(parseConfigArgs("   ")).toEqual({ key: null, value: "" });
  });

  test("a key without a value reads back instead of writing", () => {
    expect(parseConfigArgs("default")).toEqual({ key: "default", value: "" });
    expect(parseConfigArgs("indicator")).toEqual({ key: "indicator", value: "" });
  });

  test("accepts the style alias for default", () => {
    expect(parseConfigArgs("style caveman")).toEqual({ key: "default", value: "caveman" });
  });

  test("rejects an unknown key", () => {
    expect(parseConfigArgs("colour red")).toBe(null);
  });

  test("keeps a multi-word value intact", () => {
    expect(parseConfigArgs("default some style")).toEqual({ key: "default", value: "some style" });
  });
});

describe("routeStyleCommand config routing", () => {
  const names = ["teacher"];

  test("config with no arguments routes to config", () => {
    expect(routeStyleCommand("config", names)).toEqual({ kind: "config", args: "" });
  });

  test("config carries its trailing arguments", () => {
    expect(routeStyleCommand("config indicator off", names)).toEqual({ kind: "config", args: "indicator off" });
    expect(routeStyleCommand("CONFIG default teacher", names)).toEqual({ kind: "config", args: "default teacher" });
  });

  test("words that merely start with config are not the config command", () => {
    expect(routeStyleCommand("configure this style", names)).toEqual({
      kind: "task",
      request: "configure this style",
    });
  });
});

describe("/output-style config", () => {
  test("default <name> persists a cross-session default", async () => {
    const cwd = freshCwd("pos-cfg-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("config default teacher", ctx);
    expect(readState(userStateFile())).toEqual({ active: "teacher" });
    // Cross-session: a different project with no state of its own resolves it.
    const other = mkdtempSync(join(tmpdir(), "pos-cfg-other-"));
    expect(resolveActiveName(null, readState(userStateFile()), readState(projectStateFile(other)))).toBe("teacher");
    expect(cap.userMessages).toHaveLength(0);
    expect(cap.notes.some(n => n.message.includes('Default style → "teacher"'))).toBe(true);
  });

  test("default resolves case-insensitively and rejects an unknown style", async () => {
    const cwd = freshCwd("pos-cfg-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("config default Teacher", ctx);
    expect(readState(userStateFile())).toEqual({ active: "teacher" });
    await cap.commands["output-style"]("config default nope", ctx);
    expect(readState(userStateFile())).toEqual({ active: "teacher" });
    expect(cap.notes.some(n => n.type === "error" && n.message.includes('Unknown style "nope"'))).toBe(true);
  });

  test("default off clears the default but keeps the indicator setting", async () => {
    const cwd = freshCwd("pos-cfg-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("config indicator widget", ctx);
    await cap.commands["output-style"]("config default teacher", ctx);
    await cap.commands["output-style"]("config default off", ctx);
    expect(readState(userStateFile())).toEqual({ indicator: "widget" });
  });

  test("indicator accepts only the known modes", async () => {
    const cwd = freshCwd("pos-cfg-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("config indicator loud", ctx);
    expect(readState(userStateFile())).toEqual({});
    expect(cap.notes.some(n => n.type === "error" && n.message.includes(INDICATOR_MODES.join(", ")))).toBe(true);
  });

  test("a bare key reads the current value instead of writing", async () => {
    const cwd = freshCwd("pos-cfg-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("config indicator", ctx);
    expect(readState(userStateFile())).toEqual({});
    expect(cap.notes.some(n => n.message.includes("Style indicator: status"))).toBe(true);
  });

  test("saving a default keeps the indicator setting (live-caught regression)", async () => {
    const cwd = freshCwd("pos-cfg-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("config indicator widget", ctx);
    await cap.commands["output-style"]("teacher --save", ctx);
    expect(readState(userStateFile())).toEqual({ active: "teacher", indicator: "widget" });
  });

  test("saving a project default keeps the project indicator setting", async () => {
    const cwd = freshCwd("pos-cfg-");
    const { cap, ctx } = harness(cwd);
    updateState(projectStateFile(cwd), { indicator: "off" });
    await cap.commands["output-style"]("teacher --project", ctx);
    expect(readState(projectStateFile(cwd))).toEqual({ active: "teacher", indicator: "off" });
  });

  test("an unknown key is reported, not silently ignored", async () => {
    const cwd = freshCwd("pos-cfg-");
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("config colour red", ctx);
    expect(cap.notes.some(n => n.type === "error" && n.message.includes("Config keys:"))).toBe(true);
  });

  test("no arguments opens both dialogs and saves the answers", async () => {
    const cwd = freshCwd("pos-cfg-");
    const { cap, ctx } = harness(cwd);
    cap.selectAnswers.push("teacher", "widget");
    await cap.commands["output-style"]("config", ctx);
    expect(cap.selectCalls).toHaveLength(2);
    expect(cap.selectCalls[0].options).toContain("teacher");
    expect(cap.selectCalls[1].options).toEqual(["(keep current)", ...INDICATOR_MODES]);
    expect(readState(userStateFile())).toEqual({ active: "teacher", indicator: "widget" });
  });

  test("dismissing a dialog keeps the current value", async () => {
    const cwd = freshCwd("pos-cfg-");
    const { cap, ctx } = harness(cwd);
    updateState(userStateFile(), { active: "teacher", indicator: "status" });
    cap.selectAnswers.push(undefined, undefined);
    await cap.commands["output-style"]("config", ctx);
    expect(readState(userStateFile())).toEqual({ active: "teacher", indicator: "status" });
  });

  test("(keep current) and (none) are honoured", async () => {
    const cwd = freshCwd("pos-cfg-");
    const { cap, ctx } = harness(cwd);
    updateState(userStateFile(), { active: "teacher" });
    cap.selectAnswers.push("(keep current)", "(keep current)");
    await cap.commands["output-style"]("config", ctx);
    expect(readState(userStateFile())).toEqual({ active: "teacher" });

    cap.selectAnswers.push("(none)", "(keep current)");
    await cap.commands["output-style"]("config", ctx);
    expect(readState(userStateFile())).toEqual({});
  });

  test("without a dialog UI it prints the config instead of opening dialogs", async () => {
    const cwd = freshCwd("pos-cfg-");
    const { cap, ctx } = harness(cwd);
    const headless: FakeCtx = { ...ctx, ui: { ...ctx.ui, select: undefined as never } };
    await cap.commands["output-style"]("config", headless);
    expect(cap.selectCalls).toHaveLength(0);
    expect(cap.notes.some(n => n.message.includes("Style indicator: status"))).toBe(true);
  });
});

describe("indicator rendering", () => {
  const styleName = "teacher";

  const render = async (indicator: string) => {
    const cwd = freshCwd("pos-render-");
    if (indicator !== "status") updateState(userStateFile(), { indicator: indicator as never });
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"](styleName, ctx);
    return cap;
  };

  test("status mode writes the status bar and leaves no widget", async () => {
    const cap = await render("status");
    expect(cap.statuses.at(-1)).toBe("style: teacher");
    expect(cap.widgets.filter(w => w.key === "output-styles-indicator" && w.lines)).toHaveLength(0);
  });

  test("widget mode writes an above-editor badge and clears the status bar", async () => {
    const cap = await render("widget");
    expect(cap.statuses.at(-1)).toBeUndefined();
    const badge = cap.widgets.filter(w => w.key === "output-styles-indicator" && w.lines);
    expect(badge).toHaveLength(1);
    expect(badge[0].lines).toEqual(["style: teacher"]);
    expect(badge[0].placement).toBe("aboveEditor");
  });

  test("off mode writes neither surface", async () => {
    const cap = await render("off");
    expect(cap.statuses.at(-1)).toBeUndefined();
    expect(cap.widgets.filter(w => w.key === "output-styles-indicator" && w.lines)).toHaveLength(0);
  });

  test("switching back to status clears the leftover widget", async () => {
    const cwd = freshCwd("pos-render-");
    updateState(userStateFile(), { indicator: "widget" });
    const { cap, ctx } = harness(cwd);
    await cap.commands["output-style"]("teacher", ctx);
    updateState(userStateFile(), { indicator: "status" });
    await cap.commands["output-style"]("off", ctx);
    const cleared = cap.widgets.filter(w => w.key === "output-styles-indicator" && w.lines === null);
    expect(cleared.length).toBeGreaterThan(0);
  });
});
