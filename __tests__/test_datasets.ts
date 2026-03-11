import {
  adjustSearchScore,
  applyDeprioritizeSignals,
  datasetSyncIndexPath,
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

describe("ranking signals", () => {
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
      signals: { recallCount: 3, searchHitCount: 5, forgetCount: 0, lastHitAt: 2_000 },
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
      signals: { recallCount: 0, searchHitCount: 0, forgetCount: 0 },
      fileMtimeMs: 0,
      now: 120 * 86_400_000,
      cfg,
    });
    const libraryScore = adjustSearchScore({
      datasetKey: "library",
      baseScore: 0.5,
      signals: { recallCount: 0, searchHitCount: 0, forgetCount: 0 },
      fileMtimeMs: 0,
      now: 120 * 86_400_000,
      cfg,
    });

    expect(libraryScore).toBeGreaterThan(memoryScore);
  });
});
