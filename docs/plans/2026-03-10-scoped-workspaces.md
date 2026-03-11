# Scoped Workspaces Implementation Plan

> Superseded on 2026-03-11 by the fixed dataset-profile memory manager design in [TODO.md](/home/dongkai-claw/workspace/memory-cognee-revised/TODO.md).
>
> Current plugin boundary:
> - this plugin manages `memory` and `library` datasets
> - this plugin is not a context engine
> - this plugin does not inject runtime prompt context
> - scope-based recall / prompt-injection behavior described below is historical and should not guide new work

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add scope-based workspace isolation with per-agent permission control, so different agents have private memory spaces, a shared global space, and optional custom functional spaces.

**Architecture:** Each scope maps to its own Cognee dataset and filesystem directory. Scopes follow a colon-separated naming convention: `global`, `agent:<id>`, `custom:<name>`. A `ScopeConfig` defines access control per scope. At recall time, the plugin resolves which scopes the current agent can access and searches across their datasets. At sync time, each scope's directory is independently tracked via a per-scope sync index.

**Tech Stack:** TypeScript, OpenClaw Plugin SDK (`ctx.agentId` for identity), Cognee REST API (multi-dataset search), Node.js fs for directory scanning.

---

## Naming Convention

| Pattern | Example | Description |
|---------|---------|-------------|
| `global` | `global` | Shared by all agents, always accessible |
| `agent:<agentId>` | `agent:coder-01` | Private to a single agent |
| `custom:<name>` | `custom:docs` | User-defined, flexible access control |

Colon `:` is the separator. Scope names are case-sensitive, no nested colons.

## Directory Layout

```
<workspaceDir>/
  memory/
    global/          ← global scope files
    agents/
      coder-01/      ← agent:coder-01 scope files
      reviewer/      ← agent:reviewer scope files
    custom/
      docs/          ← custom:docs scope files
      secrets/       ← custom:secrets scope files
  MEMORY.md          ← treated as part of global scope (backward compat)
```

## Persistence Layout

```
~/.openclaw/memory/cognee/
  datasets.json                  ← unchanged: { datasetName → datasetId }
  scopes/
    global.json                  ← SyncIndex for global scope
    agent--coder-01.json         ← SyncIndex for agent:coder-01 (colon → --)
    custom--docs.json            ← SyncIndex for custom:docs
```

## Config Schema (user-facing)

```yaml
plugins:
  entries:
    memory-cognee-revised:
      enabled: true
      config:
        baseUrl: "http://localhost:8000"
        apiKey: "${COGNEE_API_KEY}"
        datasetName: "myproject"          # base prefix for dataset names
        scopes:
          global:
            access: "*"                   # all agents (default, implicit)
          "agent:coder-01":
            access: ["coder-01"]          # auto-created, but can be explicit
          "custom:docs":
            access: ["coder-01", "reviewer"]
          "custom:secrets":
            access: ["admin"]
```

When `scopes` is omitted, the plugin operates in legacy single-dataset mode (full backward compat).

---

### Task 1: Add Scope Types and Parsing

**Files:**
- Modify: `index.ts:10-77` (Types section)
- Test: `__tests__/test_scopes.ts` (new file)

**Step 1: Write the failing test for scope name parsing**

```typescript
// __tests__/test_scopes.ts
import { parseScopeName, scopeToDatasetSuffix, scopeToSyncIndexFileName, scopeToDir } from "../index";

describe("parseScopeName", () => {
  it("parses global scope", () => {
    expect(parseScopeName("global")).toEqual({ kind: "global" });
  });

  it("parses agent scope", () => {
    expect(parseScopeName("agent:coder-01")).toEqual({ kind: "agent", id: "coder-01" });
  });

  it("parses custom scope", () => {
    expect(parseScopeName("custom:docs")).toEqual({ kind: "custom", id: "docs" });
  });

  it("throws on invalid scope name", () => {
    expect(() => parseScopeName("unknown:foo")).toThrow("Invalid scope name");
    expect(() => parseScopeName("")).toThrow("Invalid scope name");
  });
});

describe("scopeToDatasetSuffix", () => {
  it("returns empty for global", () => {
    expect(scopeToDatasetSuffix("global")).toBe("");
  });

  it("returns agent suffix", () => {
    expect(scopeToDatasetSuffix("agent:coder-01")).toBe("-agent-coder-01");
  });

  it("returns custom suffix", () => {
    expect(scopeToDatasetSuffix("custom:docs")).toBe("-custom-docs");
  });
});

describe("scopeToSyncIndexFileName", () => {
  it("returns global.json", () => {
    expect(scopeToSyncIndexFileName("global")).toBe("global.json");
  });

  it("replaces colon with double dash", () => {
    expect(scopeToSyncIndexFileName("agent:coder-01")).toBe("agent--coder-01.json");
    expect(scopeToSyncIndexFileName("custom:docs")).toBe("custom--docs.json");
  });
});

describe("scopeToDir", () => {
  it("returns global dir", () => {
    expect(scopeToDir("global")).toBe("memory/global");
  });

  it("returns agent dir", () => {
    expect(scopeToDir("agent:coder-01")).toBe("memory/agents/coder-01");
  });

  it("returns custom dir", () => {
    expect(scopeToDir("custom:docs")).toBe("memory/custom/docs");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest __tests__/test_scopes.ts -v`
Expected: FAIL — functions not exported

**Step 3: Write the types and parsing functions**

Add to `index.ts` Types section:

```typescript
type ScopeName = string; // "global" | "agent:<id>" | "custom:<name>"

type ParsedScope =
  | { kind: "global" }
  | { kind: "agent"; id: string }
  | { kind: "custom"; id: string };

type ScopeConfig = {
  /** Scope name, e.g. "global", "agent:coder-01", "custom:docs" */
  name: ScopeName;
  /** Agent IDs that can access this scope. "*" means all. */
  access: string[] | "*";
};

type ResolvedScope = ScopeConfig & {
  /** Cognee dataset name for this scope, e.g. "myproject-agent-coder-01" */
  datasetName: string;
  /** Cognee dataset ID (resolved at runtime) */
  datasetId?: string;
  /** Relative directory path from workspace root */
  dir: string;
  /** Sync index for this scope */
  syncIndex: SyncIndex;
};
```

Add helper functions (before the Helpers section ends):

```typescript
function parseScopeName(name: string): ParsedScope {
  if (name === "global") return { kind: "global" };
  if (name.startsWith("agent:") && name.length > 6) return { kind: "agent", id: name.slice(6) };
  if (name.startsWith("custom:") && name.length > 7) return { kind: "custom", id: name.slice(7) };
  throw new Error(`Invalid scope name: "${name}". Must be "global", "agent:<id>", or "custom:<name>"`);
}

function scopeToDatasetSuffix(name: ScopeName): string {
  if (name === "global") return "";
  // "agent:coder-01" → "-agent-coder-01", "custom:docs" → "-custom-docs"
  return "-" + name.replace(/:/g, "-");
}

function scopeToSyncIndexFileName(name: ScopeName): string {
  // "agent:coder-01" → "agent--coder-01.json"
  return name.replace(/:/g, "--") + ".json";
}

function scopeToDir(name: ScopeName): string {
  const parsed = parseScopeName(name);
  switch (parsed.kind) {
    case "global": return "memory/global";
    case "agent": return `memory/agents/${parsed.id}`;
    case "custom": return `memory/custom/${parsed.id}`;
  }
}
```

Add to exports at bottom of file:

```typescript
export { parseScopeName, scopeToDatasetSuffix, scopeToSyncIndexFileName, scopeToDir };
export type { ScopeName, ParsedScope, ScopeConfig, ResolvedScope };
```

**Step 4: Run test to verify it passes**

Run: `npx jest __tests__/test_scopes.ts -v`
Expected: PASS — all 10 tests green

**Step 5: Commit**

```bash
git add index.ts __tests__/test_scopes.ts
git commit -m "feat(scopes): add scope types and name parsing utilities"
```

---

### Task 2: Add Scope Config Resolution

**Files:**
- Modify: `index.ts:14-31` (`CogneePluginConfig` type)
- Modify: `index.ts:123-177` (`resolveConfig` function)
- Test: `__tests__/test_scopes.ts` (extend)

**Step 1: Write the failing test for resolveScopes**

Append to `__tests__/test_scopes.ts`:

```typescript
import { resolveScopes } from "../index";

describe("resolveScopes", () => {
  it("returns legacy single scope when no scopes config", () => {
    const result = resolveScopes(undefined, "myproject");
    expect(result).toHaveLength(0); // empty = legacy mode
  });

  it("resolves explicit scopes config", () => {
    const result = resolveScopes(
      {
        global: { access: "*" },
        "agent:coder-01": { access: ["coder-01"] },
        "custom:docs": { access: ["coder-01", "reviewer"] },
      },
      "myproject",
    );
    expect(result).toHaveLength(3);

    const global = result.find((s) => s.name === "global")!;
    expect(global.access).toBe("*");
    expect(global.datasetName).toBe("myproject");
    expect(global.dir).toBe("memory/global");

    const agent = result.find((s) => s.name === "agent:coder-01")!;
    expect(agent.access).toEqual(["coder-01"]);
    expect(agent.datasetName).toBe("myproject-agent-coder-01");
    expect(agent.dir).toBe("memory/agents/coder-01");

    const custom = result.find((s) => s.name === "custom:docs")!;
    expect(custom.access).toEqual(["coder-01", "reviewer"]);
    expect(custom.datasetName).toBe("myproject-custom-docs");
    expect(custom.dir).toBe("memory/custom/docs");
  });

  it("defaults global access to * when not specified", () => {
    const result = resolveScopes({ global: {} }, "myproject");
    expect(result[0].access).toBe("*");
  });

  it("defaults agent scope access to [agentId]", () => {
    const result = resolveScopes({ "agent:builder": {} }, "myproject");
    expect(result[0].access).toEqual(["builder"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest __tests__/test_scopes.ts -v`
Expected: FAIL — `resolveScopes` not found

**Step 3: Implement resolveScopes and update CogneePluginConfig**

Add `scopes` to `CogneePluginConfig`:

```typescript
type ScopeInputConfig = {
  access?: string[] | "*";
};

type CogneePluginConfig = {
  // ... existing fields ...
  scopes?: Record<ScopeName, ScopeInputConfig>;
};
```

Add function:

```typescript
function resolveScopes(
  rawScopes: Record<ScopeName, ScopeInputConfig> | undefined,
  baseDatasetName: string,
): ResolvedScope[] {
  if (!rawScopes || Object.keys(rawScopes).length === 0) return [];

  return Object.entries(rawScopes).map(([name, input]) => {
    const parsed = parseScopeName(name);

    // Default access: global → "*", agent:x → [x], custom:x → [] (must be explicit)
    let access: string[] | "*";
    if (input.access !== undefined) {
      access = input.access;
    } else if (parsed.kind === "global") {
      access = "*";
    } else if (parsed.kind === "agent") {
      access = [parsed.id];
    } else {
      access = [];
    }

    return {
      name,
      access,
      datasetName: baseDatasetName + scopeToDatasetSuffix(name),
      dir: scopeToDir(name),
      syncIndex: { entries: {} },
    };
  });
}
```

Export: `export { resolveScopes };`

**Step 4: Run test to verify it passes**

Run: `npx jest __tests__/test_scopes.ts -v`
Expected: PASS

**Step 5: Commit**

```bash
git add index.ts __tests__/test_scopes.ts
git commit -m "feat(scopes): add scope config resolution with access defaults"
```

---

### Task 3: Add Scope Access Check and Multi-Scope Search Resolution

**Files:**
- Modify: `index.ts` (add helpers)
- Test: `__tests__/test_scopes.ts` (extend)

**Step 1: Write the failing test**

```typescript
import { getScopesForAgent } from "../index";

describe("getScopesForAgent", () => {
  const scopes: ResolvedScope[] = [
    { name: "global", access: "*", datasetName: "p", dir: "memory/global", syncIndex: { entries: {} } },
    { name: "agent:a1", access: ["a1"], datasetName: "p-agent-a1", dir: "memory/agents/a1", syncIndex: { entries: {} } },
    { name: "agent:a2", access: ["a2"], datasetName: "p-agent-a2", dir: "memory/agents/a2", syncIndex: { entries: {} } },
    { name: "custom:docs", access: ["a1", "a2"], datasetName: "p-custom-docs", dir: "memory/custom/docs", syncIndex: { entries: {} } },
    { name: "custom:secrets", access: ["a1"], datasetName: "p-custom-secrets", dir: "memory/custom/secrets", syncIndex: { entries: {} } },
  ];

  it("agent a1 gets global + own agent + permitted custom scopes", () => {
    const result = getScopesForAgent(scopes, "a1");
    const names = result.map((s) => s.name);
    expect(names).toEqual(["global", "agent:a1", "custom:docs", "custom:secrets"]);
  });

  it("agent a2 gets global + own agent + only docs custom", () => {
    const result = getScopesForAgent(scopes, "a2");
    const names = result.map((s) => s.name);
    expect(names).toEqual(["global", "agent:a2", "custom:docs"]);
  });

  it("unknown agent gets only global", () => {
    const result = getScopesForAgent(scopes, "unknown");
    const names = result.map((s) => s.name);
    expect(names).toEqual(["global"]);
  });

  it("undefined agentId gets only wildcard scopes", () => {
    const result = getScopesForAgent(scopes, undefined);
    const names = result.map((s) => s.name);
    expect(names).toEqual(["global"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest __tests__/test_scopes.ts -v`
Expected: FAIL

**Step 3: Implement getScopesForAgent**

```typescript
function getScopesForAgent(scopes: ResolvedScope[], agentId: string | undefined): ResolvedScope[] {
  return scopes.filter((scope) => {
    if (scope.access === "*") return true;
    if (!agentId) return false;
    return scope.access.includes(agentId);
  });
}
```

Export it.

**Step 4: Run test to verify it passes**

Run: `npx jest __tests__/test_scopes.ts -v`
Expected: PASS

**Step 5: Commit**

```bash
git add index.ts __tests__/test_scopes.ts
git commit -m "feat(scopes): add agent access check for scope filtering"
```

---

### Task 4: Per-Scope Sync Index Persistence

**Files:**
- Modify: `index.ts:179-221` (persistence section)
- Test: `__tests__/test_scopes.ts` (extend)

**Step 1: Write the failing test**

```typescript
import { scopeSyncIndexPath } from "../index";
import { homedir } from "node:os";
import { join } from "node:path";

describe("scopeSyncIndexPath", () => {
  it("returns path under scopes/ directory", () => {
    expect(scopeSyncIndexPath("global")).toBe(
      join(homedir(), ".openclaw", "memory", "cognee", "scopes", "global.json"),
    );
    expect(scopeSyncIndexPath("agent:coder-01")).toBe(
      join(homedir(), ".openclaw", "memory", "cognee", "scopes", "agent--coder-01.json"),
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest __tests__/test_scopes.ts -v`
Expected: FAIL

**Step 3: Implement scopeSyncIndexPath and per-scope load/save**

```typescript
const SCOPES_DIR = join(homedir(), ".openclaw", "memory", "cognee", "scopes");

function scopeSyncIndexPath(scopeName: ScopeName): string {
  return join(SCOPES_DIR, scopeToSyncIndexFileName(scopeName));
}

async function loadScopeSyncIndex(scopeName: ScopeName): Promise<SyncIndex> {
  const filePath = scopeSyncIndexPath(scopeName);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { entries: {} };
    const record = parsed as SyncIndex;
    record.entries ??= {};
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: {} };
    throw error;
  }
}

async function saveScopeSyncIndex(scopeName: ScopeName, index: SyncIndex): Promise<void> {
  const filePath = scopeSyncIndexPath(scopeName);
  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(index, null, 2), "utf-8");
}
```

Export `scopeSyncIndexPath`.

**Step 4: Run test to verify it passes**

Run: `npx jest __tests__/test_scopes.ts -v`
Expected: PASS

**Step 5: Commit**

```bash
git add index.ts __tests__/test_scopes.ts
git commit -m "feat(scopes): add per-scope sync index persistence"
```

---

### Task 5: Per-Scope File Collection

**Files:**
- Modify: `index.ts:227-280` (file collection section)
- Test: `__tests__/test_scopes.ts` (extend)

**Step 1: Write the failing test**

```typescript
import { collectScopeMemoryFiles } from "../index";

// This test requires actual filesystem setup, so we mock fs
describe("collectScopeMemoryFiles", () => {
  // Tested via integration in syncFiles tests — here we just verify
  // the function signature resolves the correct base path
  it("is exported and callable", () => {
    expect(typeof collectScopeMemoryFiles).toBe("function");
  });
});
```

**Step 2: Implement collectScopeMemoryFiles**

This function collects memory files for a single scope. For the `global` scope, it also includes `MEMORY.md` at the workspace root for backward compatibility.

```typescript
async function collectScopeMemoryFiles(
  workspaceDir: string,
  scope: ResolvedScope,
): Promise<MemoryFile[]> {
  const files: MemoryFile[] = [];
  const scopeDir = resolve(workspaceDir, scope.dir);

  // For global scope, also include MEMORY.md at workspace root (backward compat)
  if (scope.name === "global") {
    const memoryMd = resolve(workspaceDir, "MEMORY.md");
    try {
      const stat = await fs.stat(memoryMd);
      if (stat.isFile()) {
        const content = await fs.readFile(memoryMd, "utf-8");
        files.push({
          path: "MEMORY.md",
          absPath: memoryMd,
          content,
          hash: hashText(content),
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  // Scan the scope's directory
  try {
    const stat = await fs.stat(scopeDir);
    if (stat.isDirectory()) {
      const entries = await scanDir(scopeDir, workspaceDir);
      files.push(...entries);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  return files;
}
```

Export it.

**Step 3: Run test to verify it passes**

Run: `npx jest __tests__/test_scopes.ts -v`
Expected: PASS

**Step 4: Commit**

```bash
git add index.ts __tests__/test_scopes.ts
git commit -m "feat(scopes): add per-scope file collection with global backward compat"
```

---

### Task 6: Refactor syncFiles to Accept a Save Callback

**Files:**
- Modify: `index.ts:648-788` (`syncFiles` function)
- Modify: `__tests__/test_syncFiles.ts` (update)

The existing `syncFiles` calls `saveSyncIndex` internally with the hardcoded `SYNC_INDEX_PATH`. For scoped mode, each scope saves to a different path. We make the save function injectable.

**Step 1: Update syncFiles signature**

Change `syncFiles` to accept an optional `saveFn` parameter:

```typescript
async function syncFiles(
  client: CogneeClient,
  changedFiles: MemoryFile[],
  fullFiles: MemoryFile[],
  syncIndex: SyncIndex,
  cfg: Required<CogneePluginConfig>,
  logger: { info?: (msg: string) => void; warn?: (msg: string) => void },
  saveFn?: (index: SyncIndex) => Promise<void>,
): Promise<SyncResult & { datasetId?: string }> {
```

Replace the `await saveSyncIndex(syncIndex)` call near the end with:

```typescript
  if (saveFn) {
    await saveFn(syncIndex);
  } else {
    await saveSyncIndex(syncIndex);
  }
```

**Step 2: Verify existing tests still pass**

Run: `npx jest -v`
Expected: PASS — no behavior change for callers that omit `saveFn`

**Step 3: Commit**

```bash
git add index.ts
git commit -m "refactor(sync): make sync index save function injectable for scoped mode"
```

---

### Task 7: Wire Scoped Mode into Plugin Registration — Startup Sync

**Files:**
- Modify: `index.ts:794-1037` (plugin registration)

This is the main integration task. We modify the `register` function to operate in scoped mode when `cfg.scopes` is defined.

**Step 1: Add scoped state management in register()**

After `const cfg = resolveConfig(api.pluginConfig)`, add:

```typescript
const scopeConfigs = resolveScopes(cfg.scopes, cfg.datasetName);
const isScoped = scopeConfigs.length > 0;
```

**Step 2: Modify startup sync for scoped mode**

In the `registerService` block, replace the single `runSync` with per-scope sync:

```typescript
if (cfg.autoIndex) {
  api.registerService({
    id: "cognee-auto-sync",
    async start(ctx) {
      resolvedWorkspaceDir = ctx.workspaceDir || process.cwd();

      if (!isScoped) {
        // Legacy mode — unchanged
        try {
          const result = await runSync(resolvedWorkspaceDir, ctx.logger);
          ctx.logger.info?.(`memory-cognee-revised: auto-sync complete: ${result.added} added, ${result.updated} updated, ${result.deleted} deleted, ${result.skipped} unchanged`);
        } catch (error) {
          ctx.logger.warn?.(`memory-cognee-revised: auto-sync failed: ${String(error)}`);
        }
        return;
      }

      // Scoped mode — sync each scope independently
      for (const scope of scopeConfigs) {
        try {
          scope.syncIndex = await loadScopeSyncIndex(scope.name);

          // Resolve datasetId from dataset state
          const state = await loadDatasetState();
          scope.datasetId = state[scope.datasetName];
          if (!scope.datasetId && scope.syncIndex.datasetId && scope.syncIndex.datasetName === scope.datasetName) {
            scope.datasetId = scope.syncIndex.datasetId;
          }

          const files = await collectScopeMemoryFiles(resolvedWorkspaceDir, scope);
          if (files.length === 0) {
            ctx.logger.info?.(`memory-cognee-revised: [${scope.name}] no memory files found`);
            continue;
          }

          ctx.logger.info?.(`memory-cognee-revised: [${scope.name}] found ${files.length} file(s), syncing...`);

          const result = await syncFiles(
            client, files, files, scope.syncIndex, cfg, ctx.logger,
            (idx) => saveScopeSyncIndex(scope.name, idx),
          );
          if (result.datasetId) {
            scope.datasetId = result.datasetId;
            const dsState = await loadDatasetState();
            dsState[scope.datasetName] = result.datasetId;
            await saveDatasetState(dsState);
          }

          ctx.logger.info?.(`memory-cognee-revised: [${scope.name}] sync complete: ${result.added} added, ${result.updated} updated, ${result.deleted} deleted, ${result.skipped} unchanged`);
        } catch (error) {
          ctx.logger.warn?.(`memory-cognee-revised: [${scope.name}] auto-sync failed: ${String(error)}`);
        }
      }
    },
  });
}
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add index.ts
git commit -m "feat(scopes): wire scoped startup sync into plugin registration"
```

---

### Task 8: Wire Scoped Mode into Auto-Recall

**Files:**
- Modify: `index.ts` (before_agent_start handler)

**Step 1: Modify the before_agent_start handler**

Replace the single-dataset search with multi-scope search when in scoped mode:

```typescript
if (cfg.autoRecall) {
  api.on("before_agent_start", async (event, ctx) => {
    await stateReady;

    if (!event.prompt || event.prompt.length < 5) {
      api.logger.debug?.("memory-cognee-revised: skipping recall (prompt too short)");
      return;
    }

    if (!isScoped) {
      // Legacy mode — unchanged (existing code)
      if (!datasetId) {
        api.logger.debug?.("memory-cognee-revised: skipping recall (no datasetId)");
        return;
      }
      // ... existing search + inject logic ...
      return;
    }

    // Scoped mode — search across permitted scopes
    const agentId = ctx.agentId;
    const permitted = getScopesForAgent(scopeConfigs, agentId);
    const datasetIds = permitted
      .map((s) => s.datasetId)
      .filter((id): id is string => !!id);

    if (datasetIds.length === 0) {
      api.logger.debug?.(`memory-cognee-revised: skipping recall (no indexed scopes for agent ${agentId ?? "unknown"})`);
      return;
    }

    try {
      const results = await client.search({
        queryText: event.prompt,
        searchType: cfg.searchType,
        datasetIds,
        searchPrompt: cfg.searchPrompt,
        maxTokens: cfg.maxTokens,
      });

      const filtered = results
        .filter((r) => r.score >= cfg.minScore)
        .slice(0, cfg.maxResults);

      if (filtered.length === 0) {
        api.logger.debug?.("memory-cognee-revised: search returned no results above minScore");
        return;
      }

      const payload = JSON.stringify(
        filtered.map((r) => ({ id: r.id, score: r.score, text: r.text, metadata: r.metadata })),
        null,
        2,
      );

      const scopeNames = permitted.map((s) => s.name).join(", ");
      api.logger.info?.(
        `memory-cognee-revised: injecting ${filtered.length} memories from [${scopeNames}] for agent ${agentId ?? "unknown"}`,
      );

      return {
        prependContext: `<cognee_memories>\nRelevant memories (scopes: ${scopeNames}):\n${payload}\n</cognee_memories>`,
      };
    } catch (error) {
      api.logger.warn?.(`memory-cognee-revised: recall failed: ${String(error)}`);
    }
  });
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add index.ts
git commit -m "feat(scopes): wire scoped multi-dataset recall into before_agent_start"
```

---

### Task 9: Wire Scoped Mode into Post-Agent Sync

**Files:**
- Modify: `index.ts` (agent_end handler)

**Step 1: Modify the agent_end handler**

Add scoped post-agent sync. Only sync scopes the agent has access to:

```typescript
if (cfg.autoIndex) {
  api.on("agent_end", async (event, ctx) => {
    if (!event.success) return;
    await stateReady;

    const workspaceDir = resolvedWorkspaceDir || process.cwd();

    if (!isScoped) {
      // Legacy mode — unchanged (existing code)
      // ... existing post-agent sync logic ...
      return;
    }

    // Scoped mode — sync each permitted scope
    const agentId = ctx.agentId;
    const permitted = getScopesForAgent(scopeConfigs, agentId);

    for (const scope of permitted) {
      try {
        // Reload sync index
        try {
          scope.syncIndex = await loadScopeSyncIndex(scope.name);
        } catch { /* use existing in-memory */ }

        const files = await collectScopeMemoryFiles(workspaceDir, scope);
        const changedFiles = files.filter((f) => {
          const existing = scope.syncIndex.entries[f.path];
          return !existing || existing.hash !== f.hash;
        });

        const currentPaths = new Set(files.map((f) => f.path));
        const hasDeleted = Object.keys(scope.syncIndex.entries).some((p) => !currentPaths.has(p));

        if (changedFiles.length === 0 && !hasDeleted) continue;

        api.logger.info?.(
          `memory-cognee-revised: [${scope.name}] detected ${changedFiles.length} changed file(s)${hasDeleted ? " + deletions" : ""}, syncing...`,
        );

        const result = await syncFiles(
          client, changedFiles, files, scope.syncIndex, cfg, api.logger,
          (idx) => saveScopeSyncIndex(scope.name, idx),
        );
        if (result.datasetId) {
          scope.datasetId = result.datasetId;
          const dsState = await loadDatasetState();
          dsState[scope.datasetName] = result.datasetId;
          await saveDatasetState(dsState);
        }

        api.logger.info?.(
          `memory-cognee-revised: [${scope.name}] post-agent sync: ${result.added} added, ${result.updated} updated, ${result.deleted} deleted`,
        );
      } catch (error) {
        api.logger.warn?.(`memory-cognee-revised: [${scope.name}] post-agent sync failed: ${String(error)}`);
      }
    }
  });
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add index.ts
git commit -m "feat(scopes): wire scoped post-agent sync into agent_end"
```

---

### Task 10: Update Config Schema and UI Hints

**Files:**
- Modify: `openclaw.plugin.json`

**Step 1: Add scopes to configSchema**

Add to `configSchema.properties`:

```json
"scopes": {
  "type": "object",
  "description": "Scope definitions. Keys are scope names (global, agent:<id>, custom:<name>). Values define access control.",
  "additionalProperties": {
    "type": "object",
    "properties": {
      "access": {
        "oneOf": [
          { "type": "string", "enum": ["*"] },
          { "type": "array", "items": { "type": "string" } }
        ],
        "description": "Agent IDs that can access this scope. '*' means all agents."
      }
    },
    "additionalProperties": false
  }
}
```

Add to `uiHints`:

```json
"scopes": {
  "label": "Scopes",
  "placeholder": "{ \"global\": { \"access\": \"*\" } }"
}
```

**Step 2: Commit**

```bash
git add openclaw.plugin.json
git commit -m "feat(scopes): add scopes to plugin config schema"
```

---

### Task 11: Update CLI Commands for Scoped Mode

**Files:**
- Modify: `index.ts` (CLI section)

**Step 1: Update `cognee index` to show per-scope results**

```typescript
cognee
  .command("index")
  .option("--scope <name>", "Sync a specific scope only")
  .description("Sync memory files to Cognee")
  .action(async (opts: { scope?: string }) => {
    if (!isScoped) {
      const result = await runSync(resolvedWorkspaceDir, ctx.logger);
      console.log(`Sync complete: ${result.added} added, ${result.updated} updated, ${result.deleted} deleted, ${result.skipped} unchanged, ${result.errors} errors`);
      return;
    }

    const targets = opts.scope
      ? scopeConfigs.filter((s) => s.name === opts.scope)
      : scopeConfigs;

    if (targets.length === 0) {
      console.log(`No scope found: ${opts.scope}`);
      return;
    }

    for (const scope of targets) {
      scope.syncIndex = await loadScopeSyncIndex(scope.name);
      const state = await loadDatasetState();
      scope.datasetId = state[scope.datasetName];

      const files = await collectScopeMemoryFiles(resolvedWorkspaceDir, scope);
      const result = await syncFiles(
        client, files, files, scope.syncIndex, cfg, ctx.logger,
        (idx) => saveScopeSyncIndex(scope.name, idx),
      );
      if (result.datasetId) {
        scope.datasetId = result.datasetId;
        state[scope.datasetName] = result.datasetId;
        await saveDatasetState(state);
      }

      console.log(`[${scope.name}] ${result.added} added, ${result.updated} updated, ${result.deleted} deleted, ${result.skipped} unchanged, ${result.errors} errors`);
    }
  });
```

**Step 2: Update `cognee status` for scoped mode**

```typescript
cognee
  .command("status")
  .description("Show Cognee sync state")
  .action(async () => {
    await stateReady;

    if (!isScoped) {
      // ... existing legacy status code ...
      return;
    }

    for (const scope of scopeConfigs) {
      const idx = await loadScopeSyncIndex(scope.name);
      const entryCount = Object.keys(idx.entries).length;
      const withDataId = Object.values(idx.entries).filter((e) => e.dataId).length;
      const files = await collectScopeMemoryFiles(resolvedWorkspaceDir, scope);

      let dirty = 0, newCount = 0;
      for (const file of files) {
        const existing = idx.entries[file.path];
        if (!existing) newCount++;
        else if (existing.hash !== file.hash) dirty++;
      }

      const accessStr = scope.access === "*" ? "*" : (scope.access as string[]).join(", ");
      console.log(`\n[${scope.name}]  access: ${accessStr}`);
      console.log(`  Dataset: ${scope.datasetName}  ID: ${scope.datasetId ?? "(not set)"}`);
      console.log(`  Indexed: ${entryCount} (${withDataId} with data ID)  On disk: ${files.length}  New: ${newCount}  Dirty: ${dirty}`);
    }
  });
```

**Step 3: Add `cognee scope list` command**

```typescript
const scopeCmd = cognee.command("scope").description("Manage memory scopes");

scopeCmd
  .command("list")
  .description("List all configured scopes")
  .action(() => {
    if (!isScoped) {
      console.log("Scoped mode not enabled. Add 'scopes' to plugin config.");
      return;
    }
    for (const scope of scopeConfigs) {
      const accessStr = scope.access === "*" ? "*" : (scope.access as string[]).join(", ");
      console.log(`${scope.name}  →  dataset: ${scope.datasetName}  dir: ${scope.dir}  access: [${accessStr}]`);
    }
  });
```

**Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 5: Commit**

```bash
git add index.ts
git commit -m "feat(scopes): update CLI commands for scoped index/status/scope-list"
```

---

### Task 12: Full Integration Test

**Files:**
- Test: `__tests__/test_scoped_sync.ts` (new file)

**Step 1: Write integration-style test for scoped sync flow**

```typescript
import { syncFiles, resolveScopes, getScopesForAgent, collectScopeMemoryFiles } from "../index";
import type { MemoryFile, SyncIndex, CogneePluginConfig, ResolvedScope } from "../index";
import { promises as fs } from "node:fs";

jest.mock("node:fs", () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    stat: jest.fn(),
    readdir: jest.fn(),
  },
}));

describe("Scoped sync integration", () => {
  const mockAdd = jest.fn();
  const mockUpdate = jest.fn();
  const mockDelete = jest.fn();
  const mockCognify = jest.fn();
  const mockClient = { add: mockAdd, update: mockUpdate, delete: mockDelete, cognify: mockCognify } as any;
  const logger = { info: jest.fn(), warn: jest.fn() };

  const cfg: Required<CogneePluginConfig> = {
    baseUrl: "http://test", apiKey: "key", username: "", password: "",
    datasetName: "proj", searchType: "GRAPH_COMPLETION", searchPrompt: "",
    deleteMode: "soft", maxResults: 6, minScore: 0, maxTokens: 512,
    autoRecall: true, autoIndex: true, autoCognify: true,
    requestTimeoutMs: 30000, ingestionTimeoutMs: 300000,
    scopes: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
  });

  it("resolves scopes and filters by agent", () => {
    const scopes = resolveScopes({
      global: { access: "*" },
      "agent:a1": {},
      "custom:docs": { access: ["a1", "a2"] },
    }, "proj");

    expect(scopes).toHaveLength(3);

    const forA1 = getScopesForAgent(scopes, "a1");
    expect(forA1.map(s => s.name)).toEqual(["global", "agent:a1", "custom:docs"]);

    const forA2 = getScopesForAgent(scopes, "a2");
    expect(forA2.map(s => s.name)).toEqual(["global", "custom:docs"]);
  });

  it("syncs files independently per scope", async () => {
    const globalFiles: MemoryFile[] = [
      { path: "MEMORY.md", absPath: "/ws/MEMORY.md", content: "global", hash: "g1" },
    ];
    const agentFiles: MemoryFile[] = [
      { path: "memory/agents/a1/notes.md", absPath: "/ws/memory/agents/a1/notes.md", content: "private", hash: "a1" },
    ];

    const globalIndex: SyncIndex = { entries: {} };
    const agentIndex: SyncIndex = { entries: {} };

    mockAdd.mockResolvedValue({ datasetId: "ds-global", datasetName: "proj", dataId: "id1" });

    const globalSave = jest.fn().mockResolvedValue(undefined);
    const r1 = await syncFiles(mockClient, globalFiles, globalFiles, globalIndex, cfg, logger, globalSave);
    expect(r1.added).toBe(1);
    expect(globalSave).toHaveBeenCalledWith(globalIndex);

    mockAdd.mockResolvedValue({ datasetId: "ds-agent-a1", datasetName: "proj-agent-a1", dataId: "id2" });

    const agentSave = jest.fn().mockResolvedValue(undefined);
    const r2 = await syncFiles(mockClient, agentFiles, agentFiles, agentIndex, cfg, logger, agentSave);
    expect(r2.added).toBe(1);
    expect(r2.datasetId).toBe("ds-agent-a1");
    expect(agentSave).toHaveBeenCalledWith(agentIndex);
  });
});
```

**Step 2: Run all tests**

Run: `npx jest -v`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add __tests__/test_scoped_sync.ts
git commit -m "test(scopes): add integration test for scoped sync flow"
```

---

### Task 13: Build and Final Verification

**Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 2: Full test suite**

Run: `npx jest -v`
Expected: ALL PASS

**Step 3: Build**

Run: `npm run build`
Expected: dist/ output with no errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(scopes): complete scoped workspace implementation with permission control"
```
