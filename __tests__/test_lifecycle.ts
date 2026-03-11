import {
  buildCompactionSystemPrompt,
  buildRetainedCapacityLines,
  classifyCompactionProfile,
  computeRetainedCleanupSuggestions,
  importRetainedLibraryAsset,
  summarizeRetainedCapacity,
} from "../index";
import { promises as fs } from "node:fs";

jest.mock("node:fs", () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    stat: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe("compaction lifecycle helpers", () => {
  it("classifies daily/worklog/reference/general memory sources", () => {
    expect(
      classifyCompactionProfile({
        path: "main/memory/daily/2026-03-11.md",
        absPath: "/workspace/main/memory/daily/2026-03-11.md",
        content: "daily",
        hash: "h1",
        mtimeMs: 1,
      }),
    ).toBe("daily-log");

    expect(
      classifyCompactionProfile({
        path: "main/memory/worklog/feature-x.md",
        absPath: "/workspace/main/memory/worklog/feature-x.md",
        content: "work",
        hash: "h2",
        mtimeMs: 1,
      }),
    ).toBe("worklog");

    expect(
      classifyCompactionProfile({
        path: "main/memory/reference/api-notes.md",
        absPath: "/workspace/main/memory/reference/api-notes.md",
        content: "ref",
        hash: "h3",
        mtimeMs: 1,
      }),
    ).toBe("reference-note");

    expect(
      classifyCompactionProfile({
        path: "main/memory/misc.md",
        absPath: "/workspace/main/memory/misc.md",
        content: "misc",
        hash: "h4",
        mtimeMs: 1,
      }),
    ).toBe("general");
  });

  it("builds source-aware compaction prompts", () => {
    expect(buildCompactionSystemPrompt("daily-log")).toContain("daily log or transient work journal");
    expect(buildCompactionSystemPrompt("worklog")).toContain("execution log, meeting note, or scratchpad");
    expect(buildCompactionSystemPrompt("reference-note")).toContain("reference or research note");
    expect(buildCompactionSystemPrompt("general")).toContain("stable facts, decisions, procedures");
  });
});

describe("retained library capacity governance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("summarizes retained capacity and emits warning lines", () => {
    const summary = summarizeRetainedCapacity(
      {
        assets: [
          {
            assetId: "asset-a",
            title: "A",
            importedAt: "2026-03-10T00:00:00.000Z",
            contentHash: "hash-a",
            sizeBytes: 700,
            storagePath: "/state/a.md",
            virtualPath: "retained/asset-a/a.md",
          },
          {
            assetId: "asset-b",
            title: "B",
            importedAt: "2026-03-11T00:00:00.000Z",
            contentHash: "hash-b",
            sizeBytes: 500,
            storagePath: "/state/b.md",
            virtualPath: "retained/asset-b/b.md",
          },
        ],
      },
      {
        retainedAssetWarnBytes: 1_000,
        retainedAssetWarnCount: 1,
        retainedAssetMaxBytes: 1_100,
        retainedAssetMaxCount: 5,
      },
    );

    expect(summary).toMatchObject({
      assetCount: 2,
      totalBytes: 1_200,
      warnCountExceeded: true,
      warnBytesExceeded: true,
      maxBytesExceeded: true,
      maxCountExceeded: false,
    });
    expect(buildRetainedCapacityLines(summary)).toEqual([
      "Retained bytes: 1.2 KB",
      "Retained budget warning: exceeded soft capacity threshold",
      "Retained budget violation: exceeded hard capacity limit",
    ]);
  });

  it("suggests retained cleanup for duplicates, missing index entries, and budget pressure", () => {
    const suggestions = computeRetainedCleanupSuggestions(
      {
        assets: [
          {
            assetId: "asset-old",
            title: "Old",
            importedAt: "2026-02-01T00:00:00.000Z",
            contentHash: "dup",
            sizeBytes: 100,
            storagePath: "/state/old.md",
            virtualPath: "retained/asset-old/old.md",
          },
          {
            assetId: "asset-dup",
            title: "Dup",
            importedAt: "2026-02-02T00:00:00.000Z",
            contentHash: "dup",
            sizeBytes: 120,
            storagePath: "/state/dup.md",
            virtualPath: "retained/asset-dup/dup.md",
          },
          {
            assetId: "asset-unindexed",
            title: "Unindexed",
            importedAt: "2026-02-03T00:00:00.000Z",
            contentHash: "uniq",
            sizeBytes: 130,
            storagePath: "/state/unindexed.md",
            virtualPath: "retained/asset-unindexed/unindexed.md",
          },
        ],
      },
      {
        entries: {
          "retained/asset-old/old.md": { hash: "h1", dataId: "d1" },
        },
      },
      {
        retainedAssetWarnBytes: 200,
        retainedAssetWarnCount: 2,
        retainedAssetMaxBytes: undefined,
        retainedAssetMaxCount: undefined,
      },
      5,
    );

    expect(suggestions.map((item) => item.assetId)).toEqual([
      "asset-old",
      "asset-dup",
      "asset-unindexed",
    ]);
    expect(suggestions[0]?.reason).toContain("duplicate content hash");
    expect(suggestions[2]?.reason).toContain("not indexed");
  });

  it("rejects retained imports when hard byte budget would be exceeded", async () => {
    const content = "x".repeat(50);
    mockFs.stat.mockResolvedValue({ isFile: () => true } as any);
    mockFs.readFile.mockImplementation(async (path) => {
      if (path === "/workspace/guide.md") {
        return content;
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    await expect(
      importRetainedLibraryAsset({
        workspaceDir: "/workspace",
        sourcePath: "/workspace/guide.md",
        cfg: {
          retainedAssetWarnBytes: 10,
          retainedAssetWarnCount: 1,
          retainedAssetMaxBytes: 40,
          retainedAssetMaxCount: undefined,
        },
      }),
    ).rejects.toThrow("retained library byte budget exceeded");

    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });
});
