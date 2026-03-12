import memoryCogneePlugin from "../index";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

jest.mock("node:fs", () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    stat: jest.fn(),
    readdir: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const OPENCLAW_CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");
const DATASETS_PATH = join(homedir(), ".openclaw", "memory", "cognee", "datasets.json");
const MEMORY_SYNC_INDEX_PATH = join(homedir(), ".openclaw", "memory", "cognee", "sync-indexes", "memory.json");
const LIBRARY_SYNC_INDEX_PATH = join(homedir(), ".openclaw", "memory", "cognee", "sync-indexes", "library.json");
const MEMORY_RANKING_PATH = join(homedir(), ".openclaw", "memory", "cognee", "ranking", "memory.json");
const LIBRARY_RANKING_PATH = join(homedir(), ".openclaw", "memory", "cognee", "ranking", "library.json");
const LIBRARY_MANIFEST_PATH = join(homedir(), ".openclaw", "memory", "cognee", "assets", "library", "manifest.json");

function mockDirent(name: string, type: "file" | "dir") {
  return {
    name,
    isFile: () => type === "file",
    isDirectory: () => type === "dir",
  };
}

describe("tool semantic details", () => {
  let datasetsState = "{}";
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    datasetsState = "{}";
    fetchMock = jest.fn();
    (globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    mockFs.readFile.mockImplementation(async (path) => {
      const value = String(path);
      if (path === OPENCLAW_CONFIG_PATH) {
        return JSON.stringify({ agents: { defaults: {}, list: [] } });
      }
      if (path === DATASETS_PATH) {
        return datasetsState;
      }
      if (path === MEMORY_SYNC_INDEX_PATH || path === LIBRARY_SYNC_INDEX_PATH) {
        return JSON.stringify({ entries: {} });
      }
      if (path === MEMORY_RANKING_PATH || path === LIBRARY_RANKING_PATH) {
        return JSON.stringify({ entries: {} });
      }
      if (path === LIBRARY_MANIFEST_PATH) {
        return JSON.stringify({
          assets: [
            {
              assetId: "asset_999",
              title: "ref",
              originalPath: "/tmp/source/ref.md",
              importedAt: "2026-03-13T00:00:00.000Z",
              contentHash: "hash-retained",
              sizeBytes: 20,
              storagePath: "/state/library/ref.md",
              virtualPath: "retained/asset_999/ref.md",
            },
          ],
        });
      }
      if (value.endsWith("/workspace/main/memory/note.md")) {
        return [
          "---",
          "kind: procedure",
          "topics: graph, retrieval",
          "source_path: main/memory/raw.md",
          "created_at: 2026-03-13T09:00:00.000Z",
          "derived_from: main/memory/raw.md",
          "corrects: main/memory/old.md",
          "correction_of: main/memory/incorrect.md",
          "supersedes: main/memory/v1.md",
          "superseded_by: main/memory/v3.md",
          "---",
          "Body about retrieval",
        ].join("\n");
      }
      if (value === "/state/library/ref.md") {
        return [
          "---",
          "source_type: personal-note",
          "url: https://notes.example/ref",
          "domain: notes.example",
          "authors: Kai",
          "publisher: Personal Archive",
          "topics: synthesis, systems",
          "---",
          "# Reference",
          "",
          "Library body",
        ].join("\n");
      }
      throw Object.assign(new Error(`ENOENT: ${value}`), { code: "ENOENT" });
    });

    mockFs.stat.mockImplementation((async (path) => {
      const value = String(path);
      if (
        value.endsWith("/workspace/main/memory") ||
        value.endsWith("/workspace/main/library")
      ) {
        return { isFile: () => false, isDirectory: () => true, mtimeMs: 100 } as any;
      }
      if (
        value.endsWith("/workspace/main/memory/note.md") ||
        value === "/state/library/ref.md"
      ) {
        return { isFile: () => true, isDirectory: () => false, mtimeMs: 100 } as any;
      }
      throw Object.assign(new Error(`ENOENT: ${value}`), { code: "ENOENT" });
    }) as any);

    mockFs.readdir.mockImplementation(async (path) => {
      const value = String(path);
      if (value.endsWith("/workspace/main/memory")) {
        return [mockDirent("note.md", "file")] as any;
      }
      if (value.endsWith("/workspace/main/library")) {
        return [] as any;
      }
      return [] as any;
    });
  });

  afterEach(() => {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
  });

  function registerTools(pluginConfig: unknown) {
    let toolFactory: ((ctx: { workspaceDir?: string }) => Array<any>) | undefined;
    memoryCogneePlugin.register({
      pluginConfig,
      logger: { info: jest.fn(), warn: jest.fn() },
      runtime: { config: { loadConfig: () => ({}) } },
      config: {},
      registerTool: jest.fn((factory: (ctx: { workspaceDir?: string }) => Array<any>) => {
        toolFactory = factory;
      }),
      registerCommand: jest.fn(),
      registerCli: jest.fn(),
      registerService: jest.fn(),
      on: jest.fn(),
    } as any);

    if (!toolFactory) {
      throw new Error("tool factory was not registered");
    }
    return toolFactory({ workspaceDir: "/workspace/main" });
  }

  it("exposes memory semantic details through memory_search", async () => {
    const tools = registerTools({});
    const memorySearch = tools.find((tool) => tool.name === "memory_search");
    expect(memorySearch).toBeDefined();

    const result = await memorySearch.execute("call-1", { query: "retrieval", dataset: "memory" });
    const first = result.details.results[0];

    expect(first).toMatchObject({
      path: "memory/note.md",
      kind: "procedure",
      originAgent: "main",
      sourcePath: "main/memory/raw.md",
      createdAt: "2026-03-13T09:00:00.000Z",
      derivedFrom: ["main/memory/raw.md"],
      corrects: ["main/memory/old.md"],
      correctionOf: ["main/memory/incorrect.md"],
      supersedes: ["main/memory/v1.md"],
      supersededBy: ["main/memory/v3.md"],
      topics: ["graph", "retrieval"],
      relations: {
        derivedFrom: ["main/memory/raw.md"],
        corrects: ["main/memory/old.md"],
        correctionOf: ["main/memory/incorrect.md"],
        supersedes: ["main/memory/v1.md"],
        supersededBy: ["main/memory/v3.md"],
      },
      displayFlags: ["correction-related", "superseded", "superseding"],
    });
    expect(result.content[0].text).toContain("relations: derivedFrom=main/memory/raw.md");
    expect(result.content[0].text).toContain("supersedes=main/memory/v1.md");
    expect(result.content[0].text).toContain("flags: correction-related, superseded, superseding");
  });

  it("exposes library provenance details through memory_get", async () => {
    const tools = registerTools({
      datasets: {
        library: {
          paths: ["./library"],
        },
      },
    });
    const memoryGet = tools.find((tool) => tool.name === "memory_get");
    expect(memoryGet).toBeDefined();

    const result = await memoryGet.execute("call-2", {
      path: "retained/asset_999/ref.md",
      dataset: "library",
    });

    expect(result.details).toMatchObject({
      path: "retained/asset_999/ref.md",
      title: "Reference",
      kind: "retained-source",
      sourceType: "personal-note",
      storageType: "retained",
      url: "https://notes.example/ref",
      domain: "notes.example",
      authors: ["Kai"],
      publisher: "Personal Archive",
      originalPath: "/tmp/source/ref.md",
      retainedAssetId: "asset_999",
      importedAt: "2026-03-13T00:00:00.000Z",
      topics: ["synthesis", "systems"],
    });
  });

  it("exposes memory correction display flags through memory_get", async () => {
    const tools = registerTools({});
    const memoryGet = tools.find((tool) => tool.name === "memory_get");
    expect(memoryGet).toBeDefined();

    const result = await memoryGet.execute("call-3", {
      path: "memory/note.md",
      dataset: "memory",
    });

    expect(result.details).toMatchObject({
      path: "memory/note.md",
      displayFlags: ["correction-related", "superseded", "superseding"],
      relations: {
        derivedFrom: ["main/memory/raw.md"],
        corrects: ["main/memory/old.md"],
        correctionOf: ["main/memory/incorrect.md"],
        supersedes: ["main/memory/v1.md"],
        supersededBy: ["main/memory/v3.md"],
      },
    });
  });

  it("keeps successful remote search output quiet by default", async () => {
    datasetsState = JSON.stringify({ project_memory: "dataset-memory" });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          id: "remote-1",
          text: "remote hit",
          score: 0.91,
          metadata: { path: "main/memory/note.md" },
        },
      ]),
    });

    const tools = registerTools({
      apiKey: "test-key",
      datasets: {
        memory: {
          datasetName: "project_memory",
        },
      },
    });
    const memorySearch = tools.find((tool) => tool.name === "memory_search");
    expect(memorySearch).toBeDefined();

    const result = await memorySearch.execute("call-4", { query: "retrieval", dataset: "memory" });

    expect(result.content[0].text).not.toContain("warning: remote Cognee search failed");
    expect(result.content[0].text).not.toContain("Search debug:");
    expect(result.details.searchDebug).toBeUndefined();
  });

  it("surfaces remote fallback diagnostics only on failure", async () => {
    datasetsState = JSON.stringify({ project_memory: "dataset-memory" });
    fetchMock.mockRejectedValue(new Error("upstream search timeout"));

    const tools = registerTools({
      apiKey: "test-key",
      datasets: {
        memory: {
          datasetName: "project_memory",
        },
      },
    });
    const memorySearch = tools.find((tool) => tool.name === "memory_search");
    expect(memorySearch).toBeDefined();

    const result = await memorySearch.execute("call-5", { query: "retrieval", dataset: "memory" });

    expect(result.content[0].text).toContain("[memory] warning: remote Cognee search failed; showing local fallback results");
    expect(result.content[0].text).not.toContain("upstream search timeout");
    expect(result.details.searchDebug).toMatchObject({
      remoteAttempted: true,
      remoteUsed: false,
      remoteHitCount: 0,
      fallbackUsed: true,
      fallbackHitCount: 1,
      strictRemote: false,
      remoteError: "upstream search timeout",
    });
  });

  it("can disable fallback during backend checks", async () => {
    datasetsState = JSON.stringify({ project_memory: "dataset-memory" });
    fetchMock.mockRejectedValue(new Error("upstream search timeout"));

    const tools = registerTools({
      apiKey: "test-key",
      datasets: {
        memory: {
          datasetName: "project_memory",
        },
      },
    });
    const memorySearch = tools.find((tool) => tool.name === "memory_search");
    expect(memorySearch).toBeDefined();

    await expect(
      memorySearch.execute("call-6", {
        query: "retrieval",
        dataset: "memory",
        strictRemote: true,
      }),
    ).rejects.toThrow("Remote Cognee search failed: upstream search timeout");
  });
});
