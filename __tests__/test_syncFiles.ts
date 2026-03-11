import { CogneeClient, syncFiles } from "../index";
import type { DatasetSyncConfig, MemoryFile, SyncIndex } from "../index";
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
const STATE_PATH = join(homedir(), ".openclaw", "memory", "cognee", "datasets.json");

jest.mock("../index", () => ({
  CogneeClient: jest.fn(),
  syncFiles: jest.requireActual("../index").syncFiles,
}));

const mockAdd = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockCognify = jest.fn();

(CogneeClient as jest.MockedClass<typeof CogneeClient>).mockImplementation(() => ({
  add: mockAdd,
  update: mockUpdate,
  delete: mockDelete,
  cognify: mockCognify,
} as any));

describe("syncFiles", () => {
  let client: CogneeClient;
  let cfg: DatasetSyncConfig;
  let logger: { info?: jest.Mock; warn?: jest.Mock };

  const createFile = (path: string, content: string, hash?: string): MemoryFile => ({
    path,
    absPath: `/workspace/${path}`,
    content,
    hash: hash || `hash-${content}`,
    mtimeMs: 123,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFile.mockImplementation(async (path) => {
      if (path === STATE_PATH) return JSON.stringify({});
      throw Object.assign(new Error(`Unexpected file read: ${String(path)}`), { code: "ENOENT" });
    });
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    client = new CogneeClient("http://test", "key");
    cfg = {
      datasetKey: "memory",
      datasetName: "memory-ds",
      autoCognify: true,
      deleteMode: "soft",
    };
    logger = { info: jest.fn(), warn: jest.fn() };
  });

  it("adds new file and updates sync index", async () => {
    const files = [createFile("main/memory/new.md", "content")];
    const syncIndex: SyncIndex = { entries: {} };

    mockAdd.mockResolvedValue({ datasetId: "ds1", datasetName: "memory-ds", dataId: "id1" });

    const result = await syncFiles(client, files, files, syncIndex, cfg, logger);

    expect(result).toEqual({ added: 1, updated: 0, skipped: 0, errors: 0, deleted: 0, datasetId: "ds1" });
    expect(mockAdd).toHaveBeenCalledWith({
      data: `# main/memory/new.md\n\ncontent\n\n---\nMetadata: ${JSON.stringify({ path: "main/memory/new.md", source: "memory" })}`,
      datasetName: "memory-ds",
      datasetId: undefined,
    });
    expect(syncIndex.entries["main/memory/new.md"]).toEqual({ hash: "hash-content", dataId: "id1" });
    expect(mockCognify).toHaveBeenCalledWith({ datasetIds: ["ds1"] });
  });

  it("updates changed file with prior dataId", async () => {
    const files = [createFile("main/MEMORY.md", "new content")];
    const syncIndex: SyncIndex = {
      entries: { "main/MEMORY.md": { hash: "old-hash", dataId: "id1" } },
      datasetId: "ds1",
    };

    mockUpdate.mockResolvedValue({ datasetId: "ds1", datasetName: "memory-ds", dataId: "id1" });

    const result = await syncFiles(client, files, files, syncIndex, cfg, logger);

    expect(result).toEqual({ added: 0, updated: 1, skipped: 0, errors: 0, deleted: 0, datasetId: "ds1" });
    expect(mockUpdate).toHaveBeenCalledWith({
      dataId: "id1",
      datasetId: "ds1",
      data: `# main/MEMORY.md\n\nnew content\n\n---\nMetadata: ${JSON.stringify({ path: "main/MEMORY.md", source: "memory" })}`,
    });
    expect(mockCognify).not.toHaveBeenCalled();
  });

  it("falls back to add when update fails with 404", async () => {
    const files = [createFile("main/memory/replace.md", "new content")];
    const syncIndex: SyncIndex = {
      entries: { "main/memory/replace.md": { hash: "old-hash", dataId: "id1" } },
      datasetId: "ds1",
    };

    mockUpdate.mockRejectedValue(new Error("404 Not found"));
    mockAdd.mockResolvedValue({ datasetId: "ds1", datasetName: "memory-ds", dataId: "id2" });

    const result = await syncFiles(client, files, files, syncIndex, cfg, logger);

    expect(result.added).toBe(1);
    expect(syncIndex.entries["main/memory/replace.md"]).toEqual({ hash: "hash-new content", dataId: "id2" });
  });

  it("cleans deletions independently", async () => {
    const syncIndex: SyncIndex = {
      entries: {
        "main/memory/removed.md": { hash: "gone", dataId: "id1" },
        "agents/a1/memory/keep.md": { hash: "stay", dataId: "id2" },
      },
      datasetId: "ds1",
    };
    const files = [createFile("agents/a1/memory/keep.md", "still here", "stay")];

    mockDelete.mockResolvedValue({ datasetId: "ds1", dataId: "id1", deleted: true });

    const result = await syncFiles(client, [], files, syncIndex, cfg, logger);

    expect(result.deleted).toBe(1);
    expect(syncIndex.entries["main/memory/removed.md"]).toBeUndefined();
    expect(syncIndex.entries["agents/a1/memory/keep.md"]).toBeDefined();
  });
});
