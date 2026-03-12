import {
  adjustSearchScore,
  applySemanticSearchAdjustments,
  applyDeprioritizeSignals,
  buildFileSemanticDetails,
  buildMemoryDisplayFlags,
  buildLibraryDatasetData,
  buildMemoryDatasetData,
  datasetSyncIndexPath,
  isLowSignalMemoryText,
  loadDatasetSyncIndex,
  resolveConfig,
  resolveDatasetKey,
} from "../index";
import type { RankingState } from "../index";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

jest.mock("node:fs", () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const LEGACY_SYNC_INDEX_PATH = join(homedir(), ".openclaw", "memory", "cognee", "sync-index.json");

describe("dataset config + persistence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves fixed memory/library dataset profiles", () => {
    const cfg = resolveConfig({
      datasetName: "legacy-base",
      autoIndex: false,
      datasets: {
        memory: { autoIndex: true },
        library: {
          datasetName: "refs",
          paths: ["docs", "/srv/knowledge"],
          autoIndex: false,
          autoCognify: false,
        },
      },
    });

    expect(cfg.datasets.memory.datasetName).toBe("legacy-base");
    expect(cfg.datasets.memory.autoIndex).toBe(true);
    expect(cfg.datasets.library.datasetName).toBe("refs");
    expect(cfg.datasets.library.paths).toEqual(["docs", "/srv/knowledge"]);
    expect(cfg.datasets.library.autoIndex).toBe(false);
    expect(cfg.datasets.library.autoCognify).toBe(false);
    expect(cfg.datasets.memory.searchType).toBe("GRAPH_COMPLETION");
    expect(cfg.datasets.memory.ingestMode).toBe("distilled-note-first");
    expect(cfg.datasets.library.ingestMode).toBe("document-graph-first");
  });

  it("resolves dataset-specific search and ingest profiles", () => {
    const cfg = resolveConfig({
      searchType: "SUMMARIES",
      searchPrompt: "global",
      maxTokens: 321,
      datasets: {
        memory: {
          searchType: "GRAPH_COMPLETION",
          searchPrompt: "memory-only",
          maxTokens: 111,
          ingestMode: "distilled-memory-graph",
        },
        library: {
          searchType: "CHUNKS",
          searchPrompt: "library-only",
          maxTokens: 999,
          ingestMode: "document-graph",
        },
      },
    });

    expect(cfg.datasets.memory.searchType).toBe("GRAPH_COMPLETION");
    expect(cfg.datasets.memory.searchPrompt).toBe("memory-only");
    expect(cfg.datasets.memory.maxTokens).toBe(111);
    expect(cfg.datasets.memory.ingestMode).toBe("distilled-memory-graph");
    expect(cfg.datasets.library.searchType).toBe("CHUNKS");
    expect(cfg.datasets.library.searchPrompt).toBe("library-only");
    expect(cfg.datasets.library.maxTokens).toBe(999);
    expect(cfg.datasets.library.ingestMode).toBe("document-graph");
  });

  it("defaults operator dataset selection to memory", () => {
    expect(resolveDatasetKey()).toBe("memory");
    expect(resolveDatasetKey("memory")).toBe("memory");
    expect(resolveDatasetKey("library")).toBe("library");
    expect(resolveDatasetKey("unknown")).toBe("memory");
  });

  it("uses dataset-specific sync index paths", () => {
    expect(datasetSyncIndexPath("memory")).toBe(
      join(homedir(), ".openclaw", "memory", "cognee", "sync-indexes", "memory.json"),
    );
    expect(datasetSyncIndexPath("library")).toBe(
      join(homedir(), ".openclaw", "memory", "cognee", "sync-indexes", "library.json"),
    );
  });

  it("falls back to legacy sync index for memory dataset", async () => {
    mockFs.readFile.mockImplementation(async (path) => {
      if (String(path).endsWith("sync-indexes/memory.json")) {
        return JSON.stringify({ entries: {} });
      }
      if (path === LEGACY_SYNC_INDEX_PATH) {
        return JSON.stringify({
          datasetName: "legacy",
          datasetId: "ds-legacy",
          entries: { "main/MEMORY.md": { hash: "h1", dataId: "id1" } },
        });
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const index = await loadDatasetSyncIndex("memory");
    expect(index.datasetId).toBe("ds-legacy");
    expect(index.entries["main/MEMORY.md"]).toEqual({ hash: "h1", dataId: "id1" });
  });
});

describe("dataset serializers", () => {
  it("treats compact CJK sentences as token-bearing text for low-signal filtering", () => {
    expect(isLowSignalMemoryText("记住这个部署流程")).toBe(false);
    expect(isLowSignalMemoryText("你好")).toBe(true);
  });

  it("emphasizes distilled memory metadata for memory dataset payloads", () => {
    const cfg = resolveConfig({});
    const payload = buildMemoryDatasetData({
      path: "main/memory/note.md",
      absPath: "/workspace/main/memory/note.md",
      content: "---\ntitle: Repo Workflow\ntopics: git, monorepo\n---\nUse sparse checkout for huge repos.",
      hash: "h1",
      mtimeMs: 123,
    }, cfg.datasets.memory);

    expect(payload).toContain("Dataset: memory");
    expect(payload).toContain("Title: Repo Workflow");
    expect(payload).toContain("Origin agent: main");
    expect(payload).toContain("Topics: git, monorepo");
    expect(payload).toContain("Knowledge summary:");
    expect(payload).toContain("Ingest mode: distilled-note-first");
    expect(payload).toContain("\"source\":\"memory\"");
    expect(payload).toContain("\"title\":\"Repo Workflow\"");
    expect(payload).toContain("\"originAgent\":\"main\"");
  });

  it("lets frontmatter override inferred kind, source_type, and topics", () => {
    const cfg = resolveConfig({});
    const memoryPayload = buildMemoryDatasetData({
      path: "main/memory/2026-03-13.md",
      absPath: "/workspace/main/memory/2026-03-13.md",
      content: "---\nkind: procedure\nsource_type: field-note\ntopics: ops, cli\n---\nBody",
      hash: "h-override-memory",
      mtimeMs: 100,
    }, cfg.datasets.memory);
    const libraryPayload = buildLibraryDatasetData({
      path: "sources/personal-123/note.md",
      absPath: "/workspace/sources/personal-123/note.md",
      content: "---\nkind: personal-knowledge\nsource_type: personal-note\ntopics: synthesis, systems\n---\nBody",
      hash: "h-override-library",
      mtimeMs: 100,
    }, cfg.datasets.library);

    expect(memoryPayload).toContain("Knowledge kind: procedure");
    expect(memoryPayload).toContain("Source type: field-note");
    expect(memoryPayload).toContain("Topics: ops, cli");
    expect(memoryPayload).toContain("\"kind\":\"procedure\"");
    expect(memoryPayload).toContain("\"sourceType\":\"field-note\"");

    expect(libraryPayload).toContain("Knowledge kind: personal-knowledge");
    expect(libraryPayload).toContain("Source type: personal-note");
    expect(libraryPayload).toContain("Topics: synthesis, systems");
    expect(libraryPayload).toContain("\"kind\":\"personal-knowledge\"");
    expect(libraryPayload).toContain("\"sourceType\":\"personal-note\"");
  });

  it("includes weak memory relationship fields when provided", () => {
    const cfg = resolveConfig({});
    const payload = buildMemoryDatasetData({
      path: "main/memory/correction.md",
      absPath: "/workspace/main/memory/correction.md",
      content: [
        "---",
        "kind: correction",
        "source_path: main/memory/raw-note.md",
        "created_at: 2026-03-13T10:00:00.000Z",
        "derived_from: main/memory/raw-note.md; main/memory/meeting.md",
        "corrects: main/memory/old-rule.md",
        "correction_of: main/memory/bad-summary.md",
        "supersedes: main/memory/v1.md",
        "superseded_by: main/memory/v3.md",
        "---",
        "Correction body",
      ].join("\n"),
      hash: "h-relationship-memory",
      mtimeMs: 100,
    }, cfg.datasets.memory);

    expect(payload).toContain("Source path: main/memory/raw-note.md");
    expect(payload).toContain("Created at: 2026-03-13T10:00:00.000Z");
    expect(payload).toContain("Derived from: main/memory/raw-note.md, main/memory/meeting.md");
    expect(payload).toContain("Corrects: main/memory/old-rule.md");
    expect(payload).toContain("Correction of: main/memory/bad-summary.md");
    expect(payload).toContain("Supersedes: main/memory/v1.md");
    expect(payload).toContain("Superseded by: main/memory/v3.md");
    expect(payload).toContain("\"sourcePath\":\"main/memory/raw-note.md\"");
    expect(payload).toContain("\"createdAt\":\"2026-03-13T10:00:00.000Z\"");
  });

  it("keeps library metadata flexible and source-oriented", () => {
    const cfg = resolveConfig({});
    const payload = buildLibraryDatasetData({
      path: "sources/docs-1234/paper.md",
      absPath: "/workspace/sources/docs-1234/paper.md",
      content: [
        "---",
        "tags: systems, adaptation",
        "url: https://example.com/adaptive-systems",
        "domain: example.com",
        "authors: Alice; Bob",
        "publisher: Example Press",
        "---",
        "# A Survey of Adaptive Systems",
        "",
        "Document body",
      ].join("\n"),
      hash: "h2",
      mtimeMs: 456,
    }, cfg.datasets.library);

    expect(payload).toContain("Dataset: library");
    expect(payload).toContain("Title: A Survey of Adaptive Systems");
    expect(payload).toContain("Storage type: mirror");
    expect(payload).toContain("URL: https://example.com/adaptive-systems");
    expect(payload).toContain("Domain: example.com");
    expect(payload).toContain("Authors: Alice, Bob");
    expect(payload).toContain("Publisher: Example Press");
    expect(payload).toContain("Topics: systems, adaptation");
    expect(payload).toContain("Knowledge summary:");
    expect(payload).toContain("Ingest mode: document-graph-first");
    expect(payload).toContain("\"source\":\"library\"");
    expect(payload).toContain("\"storageType\":\"mirror\"");
    expect(payload).toContain("\"url\":\"https://example.com/adaptive-systems\"");
    expect(payload).toContain("\"domain\":\"example.com\"");
    expect(payload).toContain("\"kind\":\"mirror-source\"");
  });

  it("includes retained library provenance when available", () => {
    const cfg = resolveConfig({});
    const payload = buildLibraryDatasetData({
      path: "retained/asset_1234/notes.md",
      absPath: "/workspace/.openclaw/assets/library/asset_1234-notes.md",
      content: "# Notes\n\nBody",
      hash: "h-retained",
      mtimeMs: 789,
      sourceMetadata: {
        originalPath: "/tmp/original/notes.md",
        storageType: "retained",
        retainedAssetId: "asset_1234",
        importedAt: "2026-03-13T00:00:00.000Z",
      },
    }, cfg.datasets.library);

    expect(payload).toContain("Storage type: retained");
    expect(payload).toContain("Original path: /tmp/original/notes.md");
    expect(payload).toContain("Retained asset: asset_1234");
    expect(payload).toContain("Imported at: 2026-03-13T00:00:00.000Z");
    expect(payload).toContain("\"originalPath\":\"/tmp/original/notes.md\"");
    expect(payload).toContain("\"retainedAssetId\":\"asset_1234\"");
  });

  it("builds semantic details for memory files", () => {
    const details = buildFileSemanticDetails({
      path: "agents/researcher/memory/note.md",
      absPath: "/workspace/agents/researcher/memory/note.md",
      content: [
        "---",
        "kind: procedure",
        "topics: graph, retrieval",
        "source_path: agents/researcher/memory/raw.md",
        "created_at: 2026-03-13T09:00:00.000Z",
        "derived_from: agents/researcher/memory/raw.md",
        "corrects: agents/researcher/memory/old.md",
        "correction_of: agents/researcher/memory/incorrect.md",
        "supersedes: agents/researcher/memory/v1.md",
        "superseded_by: agents/researcher/memory/v3.md",
        "---",
        "Body",
      ].join("\n"),
      hash: "h-semantic-memory",
      mtimeMs: 1,
    }, "memory");

    expect(details).toMatchObject({
      title: "note",
      kind: "procedure",
      originAgent: "researcher",
      topics: ["graph", "retrieval"],
      sourcePath: "agents/researcher/memory/raw.md",
      createdAt: "2026-03-13T09:00:00.000Z",
      derivedFrom: ["agents/researcher/memory/raw.md"],
      corrects: ["agents/researcher/memory/old.md"],
      correctionOf: ["agents/researcher/memory/incorrect.md"],
      supersedes: ["agents/researcher/memory/v1.md"],
      supersededBy: ["agents/researcher/memory/v3.md"],
    });
    expect(buildMemoryDisplayFlags(details)).toEqual(["correction-related", "superseded", "superseding"]);
  });

  it("builds semantic details for library files with provenance", () => {
    const details = buildFileSemanticDetails({
      path: "retained/asset_999/ref.md",
      absPath: "/workspace/.openclaw/assets/library/ref.md",
      content: [
        "---",
        "source_type: personal-note",
        "url: https://notes.example/ref",
        "domain: notes.example",
        "authors: Kai",
        "publisher: Personal Archive",
        "---",
        "# Reference",
        "",
        "Body",
      ].join("\n"),
      hash: "h-semantic-library",
      mtimeMs: 1,
      sourceMetadata: {
        storageType: "retained",
        originalPath: "/tmp/ref.md",
        retainedAssetId: "asset_999",
        importedAt: "2026-03-13T00:00:00.000Z",
      },
    }, "library");

    expect(details).toMatchObject({
      title: "Reference",
      kind: "retained-source",
      sourceType: "personal-note",
      storageType: "retained",
      url: "https://notes.example/ref",
      domain: "notes.example",
      authors: ["Kai"],
      publisher: "Personal Archive",
      originalPath: "/tmp/ref.md",
      retainedAssetId: "asset_999",
      importedAt: "2026-03-13T00:00:00.000Z",
    });
  });
});

describe("ranking signals", () => {
  it("only lightly lowers semantic search score for superseded memory items", () => {
    const supersededDetails = {
      supersededBy: ["main/memory/v3.md"],
      supersedes: ["main/memory/v1.md"],
    };
    const currentDetails = {
      supersedes: ["main/memory/v1.md"],
    };

    expect(applySemanticSearchAdjustments("memory", supersededDetails, 0.6)).toBe(0.52);
    expect(applySemanticSearchAdjustments("memory", currentDetails, 0.6)).toBe(0.6);
    expect(applySemanticSearchAdjustments("library", supersededDetails, 0.6)).toBe(0.6);
  });

  it("deprioritize increases forget count and lowers ranking", () => {
    const ranking: RankingState = { entries: {} };
    applyDeprioritizeSignals(ranking, "main/memory/stale.md", 1_000);

    expect(ranking.entries["main/memory/stale.md"]).toMatchObject({
      forgetCount: 1,
      deprioritized: true,
      lastForgotAt: 1_000,
      lastDeprioritizedAt: 1_000,
    });

    const boosted = adjustSearchScore({
      datasetKey: "memory",
      baseScore: 0.6,
      signals: {
        recallCount: 3,
        searchHitCount: 5,
        reinforcementCount: 1,
        confirmedUsefulCount: 0,
        forgetCount: 0,
        lastReinforcedAt: 2_000,
      },
      fileMtimeMs: 2_000,
      now: 2_500,
      cfg: resolveConfig({}),
    });
    const deprioritized = adjustSearchScore({
      datasetKey: "memory",
      baseScore: 0.6,
      signals: ranking.entries["main/memory/stale.md"],
      fileMtimeMs: 2_000,
      now: 2_500,
      cfg: resolveConfig({}),
    });

    expect(boosted).toBeGreaterThan(deprioritized);
  });

  it("decays library ranking more slowly than memory", () => {
    const cfg = resolveConfig({});
    const memoryScore = adjustSearchScore({
      datasetKey: "memory",
      baseScore: 0.5,
      signals: { recallCount: 0, searchHitCount: 0, reinforcementCount: 0, confirmedUsefulCount: 0, forgetCount: 0 },
      fileMtimeMs: 0,
      now: 120 * 86_400_000,
      cfg,
    });
    const libraryScore = adjustSearchScore({
      datasetKey: "library",
      baseScore: 0.5,
      signals: { recallCount: 0, searchHitCount: 0, reinforcementCount: 0, confirmedUsefulCount: 0, forgetCount: 0 },
      fileMtimeMs: 0,
      now: 120 * 86_400_000,
      cfg,
    });

    expect(libraryScore).toBeGreaterThan(memoryScore);
  });

  it("uses explicit reinforcement to slow decay without making hits alone stronger", () => {
    const cfg = resolveConfig({});
    const withHitsOnly = adjustSearchScore({
      datasetKey: "memory",
      baseScore: 0.55,
      signals: {
        recallCount: 4,
        searchHitCount: 6,
        reinforcementCount: 0,
        confirmedUsefulCount: 0,
        forgetCount: 0,
        lastHitAt: 30 * 86_400_000,
        lastRecallAt: 30 * 86_400_000,
      },
      fileMtimeMs: 0,
      now: 120 * 86_400_000,
      cfg,
    });
    const reinforced = adjustSearchScore({
      datasetKey: "memory",
      baseScore: 0.55,
      signals: {
        recallCount: 1,
        searchHitCount: 1,
        reinforcementCount: 2,
        confirmedUsefulCount: 0,
        forgetCount: 0,
        lastReinforcedAt: 110 * 86_400_000,
      },
      fileMtimeMs: 0,
      now: 120 * 86_400_000,
      cfg,
    });

    expect(reinforced).toBeGreaterThan(withHitsOnly);
  });
});
