import {
  collectLibraryDatasetFiles,
  collectMemoryDatasetFiles,
  computeCleanupSuggestions,
  discoverConfiguredAgentWorkspaces,
  librarySourceVirtualBase,
} from "../index";
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

function mockDirent(name: string, type: "file" | "dir") {
  return {
    name,
    isFile: () => type === "file",
    isDirectory: () => type === "dir",
  };
}

describe("workspace aggregation + library discovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFile.mockImplementation(async (path) => {
      if (path === OPENCLAW_CONFIG_PATH) {
        return JSON.stringify({
          agents: {
            defaults: { workspace: "agents/default-ws" },
            list: [
              { id: "academic-bot", workspace: "/srv/academic" },
              { id: "builder" },
            ],
          },
        });
      }
      if (String(path).endsWith("MEMORY.md")) return "root memory";
      if (String(path).endsWith("notes.md")) return "note";
      if (String(path).endsWith("guide.md")) return "guide";
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    mockFs.stat.mockImplementation((async (path) => {
      const value = String(path);
      if (
        value.endsWith("MEMORY.md") ||
        value.endsWith("notes.md") ||
        value.endsWith("guide.md")
      ) {
        return { isFile: () => true, isDirectory: () => false, mtimeMs: 100 } as any;
      }
      if (
        value.endsWith("/memory") ||
        value.endsWith("/library") ||
        value === "/srv/reference"
      ) {
        return { isFile: () => false, isDirectory: () => true, mtimeMs: 100 } as any;
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }) as any);

    mockFs.readdir.mockImplementation(async (path) => {
      const value = String(path);
      if (value.endsWith("/memory")) {
        return [mockDirent("notes.md", "file")] as any;
      }
      if (value === "/srv/reference" || value.endsWith("/library")) {
        return [mockDirent("guide.md", "file")] as any;
      }
      return [] as any;
    });
  });

  it("parses agent workspaces from ~/.openclaw/openclaw.json", async () => {
    const bindings = await discoverConfiguredAgentWorkspaces();
    expect(bindings).toEqual([
      {
        kind: "agent",
        id: "academic-bot",
        workspaceDir: "/srv/academic",
        prefix: "agents/academic-bot",
      },
      {
        kind: "agent",
        id: "builder",
        workspaceDir: join(homedir(), ".openclaw", "agents/default-ws"),
        prefix: "agents/builder",
      },
    ]);
  });

  it("aggregates memory files with stable main/ and agents/<id>/ prefixes", async () => {
    const files = await collectMemoryDatasetFiles("/workspace/main");
    expect(files.map((file) => file.path)).toEqual([
      "agents/academic-bot/MEMORY.md",
      "agents/academic-bot/memory/notes.md",
      "agents/builder/MEMORY.md",
      "agents/builder/memory/notes.md",
      "main/MEMORY.md",
      "main/memory/notes.md",
    ]);
  });

  it("discovers library files only from explicit configured paths", async () => {
    const files = await collectLibraryDatasetFiles("/workspace/main", {
      datasetName: "refs",
      paths: ["/srv/reference", "library"],
      autoIndex: false,
      autoCognify: false,
      autoRecall: false,
    });
    expect(files.map((file) => file.path)).toEqual([
      `${librarySourceVirtualBase("/workspace/main/library")}/guide.md`,
      `${librarySourceVirtualBase("/srv/reference")}/guide.md`,
    ]);
  });

  it("produces cleanup suggestions from stale ranking signals", () => {
    const suggestions = computeCleanupSuggestions(
      [
        {
          path: "main/memory/stale.md",
          absPath: "/workspace/main/memory/stale.md",
          content: "old",
          hash: "h1",
          mtimeMs: 1,
        },
      ],
      {
        entries: {
          "main/memory/stale.md": {
            recallCount: 0,
            searchHitCount: 0,
            forgetCount: 2,
            deprioritized: true,
            lastDeprioritizedAt: 1,
          },
        },
      },
      100 * 86_400_000,
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].path).toBe("main/memory/stale.md");
  });
});
