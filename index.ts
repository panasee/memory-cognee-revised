import { randomUUID, createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

type CogneeSearchType = "GRAPH_COMPLETION" | "CHUNKS" | "SUMMARIES";
type CogneeDeleteMode = "soft" | "hard";
type DatasetKey = "memory" | "library";

type DatasetProfileConfig = {
  datasetName?: string;
  paths?: string[];
  autoIndex?: boolean;
  autoCognify?: boolean;
  autoRecall?: boolean;
};

type ResolvedDatasetProfile = {
  datasetName: string;
  paths: string[];
  autoIndex: boolean;
  autoCognify: boolean;
  autoRecall: boolean;
};

type CogneePluginConfig = {
  baseUrl?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  datasetName?: string;
  searchType?: CogneeSearchType;
  searchPrompt?: string;
  deleteMode?: CogneeDeleteMode;
  maxResults?: number;
  minScore?: number;
  maxTokens?: number;
  autoRecall?: boolean;
  autoIndex?: boolean;
  autoCognify?: boolean;
  requestTimeoutMs?: number;
  ingestionTimeoutMs?: number;
  datasets?: Partial<Record<DatasetKey, DatasetProfileConfig>>;
};

type ResolvedCogneePluginConfig = {
  baseUrl: string;
  apiKey: string;
  username: string;
  password: string;
  searchType: CogneeSearchType;
  searchPrompt: string;
  deleteMode: CogneeDeleteMode;
  maxResults: number;
  minScore: number;
  maxTokens: number;
  requestTimeoutMs: number;
  ingestionTimeoutMs: number;
  datasets: Record<DatasetKey, ResolvedDatasetProfile>;
};

type CogneeAddResponse = {
  dataset_id: string;
  dataset_name: string;
  message: string;
  data_id?: unknown;
  data_ingestion_info?: unknown;
};

type CogneeSearchResult = {
  id: string;
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
};

type DatasetState = Record<string, string>;

type SyncIndex = {
  datasetId?: string;
  datasetName?: string;
  entries: Record<string, { hash: string; dataId?: string }>;
};

type RankingSignals = {
  recallCount: number;
  searchHitCount: number;
  forgetCount: number;
  lastHitAt?: number;
  lastRecallAt?: number;
  lastForgotAt?: number;
  lastStoredAt?: number;
  lastDeprioritizedAt?: number;
  deprioritized?: boolean;
};

type RankingState = {
  entries: Record<string, RankingSignals>;
};

type MemoryFile = {
  path: string;
  absPath: string;
  content: string;
  hash: string;
  mtimeMs: number;
};

type SyncResult = {
  added: number;
  updated: number;
  skipped: number;
  errors: number;
  deleted: number;
};

type DatasetSyncConfig = {
  datasetKey: DatasetKey;
  datasetName: string;
  autoCognify: boolean;
  deleteMode: CogneeDeleteMode;
};

type WorkspaceBinding = {
  kind: "main" | "agent";
  id: string;
  workspaceDir: string;
  prefix: string;
};

type LibrarySource = {
  rootPath: string;
  virtualBase: string;
  isFile: boolean;
};

type RankedSearchResult = {
  dataset: DatasetKey;
  path: string;
  absPath?: string;
  text: string;
  baseScore: number;
  adjustedScore: number;
  signals: RankingSignals;
};

type CleanupSuggestion = {
  path: string;
  adjustedScore: number;
  reason: string;
};

const DEFAULT_BASE_URL = "http://localhost:8000";
const DEFAULT_MEMORY_DATASET_NAME = "openclaw-memory";
const DEFAULT_LIBRARY_DATASET_NAME = "openclaw-library";
const DEFAULT_SEARCH_TYPE: CogneeSearchType = "GRAPH_COMPLETION";
const DEFAULT_SEARCH_PROMPT = "";
const DEFAULT_DELETE_MODE: CogneeDeleteMode = "soft";
const DEFAULT_MAX_RESULTS = 6;
const DEFAULT_MIN_SCORE = 0;
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_INGESTION_TIMEOUT_MS = 300_000;
const DEFAULT_MEMORY_AUTO_INDEX = true;
const DEFAULT_MEMORY_AUTO_COGNIFY = true;
const DEFAULT_MEMORY_AUTO_RECALL = true;
const DEFAULT_LIBRARY_AUTO_INDEX = false;
const DEFAULT_LIBRARY_AUTO_COGNIFY = false;
const DEFAULT_LIBRARY_AUTO_RECALL = false;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 3_000;

const COGNEE_ROOT = join(homedir(), ".openclaw", "memory", "cognee");
const STATE_PATH = join(COGNEE_ROOT, "datasets.json");
const LEGACY_SYNC_INDEX_PATH = join(COGNEE_ROOT, "sync-index.json");
const SYNC_INDEX_DIR = join(COGNEE_ROOT, "sync-indexes");
const RANKING_DIR = join(COGNEE_ROOT, "ranking");
const OPENCLAW_CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizeDatasetPath(value: string): string {
  return toPosixPath(value).replace(/^\.\/+/, "").replace(/\/+/g, "/");
}

function resolveDatasetKey(input?: string): DatasetKey {
  return input === "library" ? "library" : "memory";
}

function datasetSyncIndexPath(datasetKey: DatasetKey): string {
  return join(SYNC_INDEX_DIR, `${datasetKey}.json`);
}

function datasetRankingPath(datasetKey: DatasetKey): string {
  return join(RANKING_DIR, `${datasetKey}.json`);
}

function defaultSignals(): RankingSignals {
  return { recallCount: 0, searchHitCount: 0, forgetCount: 0 };
}

function getSignals(state: RankingState, path: string): RankingSignals {
  const existing = state.entries[path];
  if (existing) return existing;
  const created = defaultSignals();
  state.entries[path] = created;
  return created;
}

function applyDeprioritizeSignals(state: RankingState, path: string, now = Date.now()): RankingSignals {
  const entry = getSignals(state, path);
  entry.forgetCount += 1;
  entry.lastForgotAt = now;
  entry.lastDeprioritizedAt = now;
  entry.deprioritized = true;
  return entry;
}

function clearMissingRankingEntries(state: RankingState, files: MemoryFile[]): void {
  const live = new Set(files.map((file) => file.path));
  for (const path of Object.keys(state.entries)) {
    if (!live.has(path)) {
      delete state.entries[path];
    }
  }
}

function summarizeRanking(state: RankingState): {
  tracked: number;
  searchHits: number;
  recalls: number;
  forgets: number;
  deprioritized: number;
} {
  const values = Object.values(state.entries);
  return {
    tracked: values.length,
    searchHits: values.reduce((sum, entry) => sum + entry.searchHitCount, 0),
    recalls: values.reduce((sum, entry) => sum + entry.recallCount, 0),
    forgets: values.reduce((sum, entry) => sum + entry.forgetCount, 0),
    deprioritized: values.filter((entry) => entry.deprioritized).length,
  };
}

function adjustSearchScore(params: {
  baseScore: number;
  signals?: RankingSignals;
  fileMtimeMs?: number;
  now?: number;
}): number {
  const signals = params.signals ?? defaultSignals();
  const now = params.now ?? Date.now();
  const freshness = Math.max(
    params.fileMtimeMs ?? 0,
    signals.lastHitAt ?? 0,
    signals.lastRecallAt ?? 0,
    signals.lastStoredAt ?? 0,
  );
  const ageDays = freshness > 0 ? (now - freshness) / 86_400_000 : 365;
  const decay = Math.min(0.4, Math.max(0, ageDays) * 0.01);
  const boost = signals.searchHitCount * 0.03 + signals.recallCount * 0.05;
  const penalty = signals.forgetCount * 0.12 + (signals.deprioritized ? 0.25 : 0);
  return Number((params.baseScore + boost - penalty - decay).toFixed(6));
}

function scoreLocalQuery(query: string, file: MemoryFile): number {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return 0;
  const content = file.content.toLowerCase();
  const path = file.path.toLowerCase();
  let score = 0;
  if (content.includes(trimmed)) score += 0.45;
  if (path.includes(trimmed)) score += 0.35;
  const tokens = trimmed.split(/[^a-z0-9]+/i).filter(Boolean);
  if (tokens.length > 0) {
    const overlap = tokens.filter((token) => content.includes(token) || path.includes(token)).length;
    score += (overlap / tokens.length) * 0.4;
  }
  return Number(Math.min(score, 1).toFixed(6));
}

function extractVirtualPathFromSearchResult(result: CogneeSearchResult): string | undefined {
  const metadataPath = result.metadata?.path;
  if (typeof metadataPath === "string" && metadataPath.length > 0) {
    return normalizeDatasetPath(metadataPath);
  }
  const match = result.text.match(/^# ([^\n]+)\n/);
  if (match) {
    return normalizeDatasetPath(match[1]);
  }
  return undefined;
}

function renderToolText(
  lines: string[],
  details: Record<string, unknown> = {},
): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
  return { content: [{ type: "text", text: lines.join("\n") }], details };
}

function buildMemoryData(file: MemoryFile, datasetKey: DatasetKey): string {
  return `# ${file.path}\n\n${file.content}\n\n---\nMetadata: ${JSON.stringify({ path: file.path, source: datasetKey })}`;
}

function resolveConfig(rawConfig: unknown): ResolvedCogneePluginConfig {
  const raw =
    rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? (rawConfig as CogneePluginConfig)
      : {};

  const apiKey =
    raw.apiKey && raw.apiKey.length > 0
      ? resolveEnvVars(raw.apiKey)
      : process.env.COGNEE_API_KEY || "";

  const legacyDatasetName = raw.datasetName?.trim();
  const legacyAutoIndex = typeof raw.autoIndex === "boolean" ? raw.autoIndex : undefined;
  const legacyAutoCognify = typeof raw.autoCognify === "boolean" ? raw.autoCognify : undefined;
  const legacyAutoRecall = typeof raw.autoRecall === "boolean" ? raw.autoRecall : undefined;

  const memoryRaw = raw.datasets?.memory ?? {};
  const libraryRaw = raw.datasets?.library ?? {};

  return {
    baseUrl: raw.baseUrl?.trim() || DEFAULT_BASE_URL,
    apiKey,
    username: raw.username?.trim() || process.env.COGNEE_USERNAME || "",
    password: raw.password?.trim() || process.env.COGNEE_PASSWORD || "",
    searchType: raw.searchType || DEFAULT_SEARCH_TYPE,
    searchPrompt: raw.searchPrompt || DEFAULT_SEARCH_PROMPT,
    deleteMode: raw.deleteMode === "hard" ? "hard" : DEFAULT_DELETE_MODE,
    maxResults: typeof raw.maxResults === "number" ? raw.maxResults : DEFAULT_MAX_RESULTS,
    minScore: typeof raw.minScore === "number" ? raw.minScore : DEFAULT_MIN_SCORE,
    maxTokens: typeof raw.maxTokens === "number" ? raw.maxTokens : DEFAULT_MAX_TOKENS,
    requestTimeoutMs:
      typeof raw.requestTimeoutMs === "number" ? raw.requestTimeoutMs : DEFAULT_REQUEST_TIMEOUT_MS,
    ingestionTimeoutMs:
      typeof raw.ingestionTimeoutMs === "number"
        ? raw.ingestionTimeoutMs
        : DEFAULT_INGESTION_TIMEOUT_MS,
    datasets: {
      memory: {
        datasetName:
          memoryRaw.datasetName?.trim() ||
          legacyDatasetName ||
          DEFAULT_MEMORY_DATASET_NAME,
        paths: [],
        autoIndex:
          typeof memoryRaw.autoIndex === "boolean"
            ? memoryRaw.autoIndex
            : legacyAutoIndex ?? DEFAULT_MEMORY_AUTO_INDEX,
        autoCognify:
          typeof memoryRaw.autoCognify === "boolean"
            ? memoryRaw.autoCognify
            : legacyAutoCognify ?? DEFAULT_MEMORY_AUTO_COGNIFY,
        autoRecall:
          typeof memoryRaw.autoRecall === "boolean"
            ? memoryRaw.autoRecall
            : legacyAutoRecall ?? DEFAULT_MEMORY_AUTO_RECALL,
      },
      library: {
        datasetName: libraryRaw.datasetName?.trim() || DEFAULT_LIBRARY_DATASET_NAME,
        paths: (libraryRaw.paths ?? []).filter((value): value is string => typeof value === "string" && value.trim().length > 0),
        autoIndex:
          typeof libraryRaw.autoIndex === "boolean"
            ? libraryRaw.autoIndex
            : DEFAULT_LIBRARY_AUTO_INDEX,
        autoCognify:
          typeof libraryRaw.autoCognify === "boolean"
            ? libraryRaw.autoCognify
            : DEFAULT_LIBRARY_AUTO_COGNIFY,
        autoRecall:
          typeof libraryRaw.autoRecall === "boolean"
            ? libraryRaw.autoRecall
            : DEFAULT_LIBRARY_AUTO_RECALL,
      },
    },
  };
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") {
      return fallback;
    }
    return parsed as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function loadDatasetState(): Promise<DatasetState> {
  return readJsonFile<DatasetState>(STATE_PATH, {});
}

async function saveDatasetState(state: DatasetState): Promise<void> {
  await fs.mkdir(dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

async function loadDatasetSyncIndex(datasetKey: DatasetKey): Promise<SyncIndex> {
  const path = datasetSyncIndexPath(datasetKey);
  const fallback: SyncIndex = { entries: {} };

  if (datasetKey === "memory") {
    try {
      const current = await readJsonFile<SyncIndex>(path, fallback);
      current.entries ??= {};
      if (Object.keys(current.entries).length > 0 || current.datasetId || current.datasetName) {
        return current;
      }
    } catch {
      // fall through to legacy
    }

    try {
      const legacy = await readJsonFile<SyncIndex>(LEGACY_SYNC_INDEX_PATH, fallback);
      legacy.entries ??= {};
      return legacy;
    } catch {
      return fallback;
    }
  }

  const current = await readJsonFile<SyncIndex>(path, fallback);
  current.entries ??= {};
  return current;
}

async function saveDatasetSyncIndex(datasetKey: DatasetKey, index: SyncIndex): Promise<void> {
  const path = datasetSyncIndexPath(datasetKey);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(index, null, 2), "utf-8");
}

async function loadRankingState(datasetKey: DatasetKey): Promise<RankingState> {
  const state = await readJsonFile<RankingState>(datasetRankingPath(datasetKey), { entries: {} });
  state.entries ??= {};
  return state;
}

async function saveRankingState(datasetKey: DatasetKey, state: RankingState): Promise<void> {
  const path = datasetRankingPath(datasetKey);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(state, null, 2), "utf-8");
}

function resolveUserPath(input: string, baseDir: string): string {
  if (input.startsWith("~/")) {
    return join(homedir(), input.slice(2));
  }
  if (isAbsolute(input)) {
    return input;
  }
  return resolve(baseDir, input);
}

async function discoverConfiguredAgentWorkspaces(): Promise<WorkspaceBinding[]> {
  const config = await readJsonFile<Record<string, unknown>>(OPENCLAW_CONFIG_PATH, {});
  const agents = (config.agents ?? {}) as Record<string, unknown>;
  const defaults = (agents.defaults ?? {}) as Record<string, unknown>;
  const defaultWorkspace = typeof defaults.workspace === "string" ? defaults.workspace : undefined;
  const list = Array.isArray(agents.list) ? agents.list : [];
  const baseDir = dirname(OPENCLAW_CONFIG_PATH);
  const bindings: WorkspaceBinding[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const agent = entry as Record<string, unknown>;
    const id = typeof agent.id === "string" ? agent.id.trim() : "";
    if (!id) continue;
    const workspaceInput =
      typeof agent.workspace === "string" ? agent.workspace : defaultWorkspace;
    if (!workspaceInput) continue;
    bindings.push({
      kind: "agent",
      id,
      workspaceDir: resolveUserPath(workspaceInput, baseDir),
      prefix: `agents/${id}`,
    });
  }

  return bindings;
}

async function readMarkdownFile(absPath: string, virtualPath: string): Promise<MemoryFile> {
  const stat = await fs.stat(absPath);
  const content = await fs.readFile(absPath, "utf-8");
  return {
    path: normalizeDatasetPath(virtualPath),
    absPath,
    content,
    hash: hashText(content),
    mtimeMs: stat.mtimeMs,
  };
}

async function scanMarkdownDir(
  rootDir: string,
  mapVirtualPath: (absPath: string) => string,
): Promise<MemoryFile[]> {
  const files: MemoryFile[] = [];
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = (await fs.readdir(rootDir, { withFileTypes: true })) as Array<{
      name: string;
      isDirectory: () => boolean;
      isFile: () => boolean;
    }>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return files;
    }
    throw error;
  }

  for (const entry of entries) {
    const absPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await scanMarkdownDir(absPath, mapVirtualPath)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    files.push(await readMarkdownFile(absPath, mapVirtualPath(absPath)));
  }

  return files;
}

async function collectWorkspaceMemoryFiles(binding: WorkspaceBinding): Promise<MemoryFile[]> {
  const files: MemoryFile[] = [];
  const memoryMd = resolve(binding.workspaceDir, "MEMORY.md");
  try {
    const stat = await fs.stat(memoryMd);
    if (stat.isFile()) {
      files.push(await readMarkdownFile(memoryMd, `${binding.prefix}/MEMORY.md`));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const memoryDir = resolve(binding.workspaceDir, "memory");
  files.push(
    ...(await scanMarkdownDir(memoryDir, (absPath) =>
      `${binding.prefix}/${normalizeDatasetPath(relative(binding.workspaceDir, absPath))}`,
    )),
  );

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function librarySourceVirtualBase(rootPath: string): string {
  const name = basename(rootPath) || "root";
  const suffix = hashText(rootPath).slice(0, 8);
  return `sources/${name}-${suffix}`;
}

async function resolveLibrarySources(
  workspaceDir: string,
  profile: ResolvedDatasetProfile,
): Promise<LibrarySource[]> {
  const sources: LibrarySource[] = [];
  for (const configuredPath of profile.paths) {
    const rootPath = resolveUserPath(configuredPath, workspaceDir);
    try {
      const stat = await fs.stat(rootPath);
      sources.push({
        rootPath,
        virtualBase: librarySourceVirtualBase(rootPath),
        isFile: stat.isFile(),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return sources;
}

async function collectLibraryDatasetFiles(
  workspaceDir: string,
  profile: ResolvedDatasetProfile,
): Promise<MemoryFile[]> {
  const files: MemoryFile[] = [];
  const sources = await resolveLibrarySources(workspaceDir, profile);
  for (const source of sources) {
    if (source.isFile) {
      if (!source.rootPath.endsWith(".md")) continue;
      files.push(await readMarkdownFile(source.rootPath, `${source.virtualBase}/${basename(source.rootPath)}`));
      continue;
    }
    files.push(
      ...(await scanMarkdownDir(source.rootPath, (absPath) =>
        `${source.virtualBase}/${normalizeDatasetPath(relative(source.rootPath, absPath))}`,
      )),
    );
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function collectMemoryDatasetFiles(workspaceDir: string): Promise<MemoryFile[]> {
  const mainBinding: WorkspaceBinding = {
    kind: "main",
    id: "main",
    workspaceDir,
    prefix: "main",
  };
  const agentBindings = await discoverConfiguredAgentWorkspaces();
  const files = await Promise.all([collectWorkspaceMemoryFiles(mainBinding), ...agentBindings.map(collectWorkspaceMemoryFiles)]);
  return files.flat().sort((a, b) => a.path.localeCompare(b.path));
}

async function collectDatasetFiles(
  datasetKey: DatasetKey,
  workspaceDir: string,
  cfg: ResolvedCogneePluginConfig,
): Promise<MemoryFile[]> {
  if (datasetKey === "memory") {
    return collectMemoryDatasetFiles(workspaceDir);
  }
  return collectLibraryDatasetFiles(workspaceDir, cfg.datasets.library);
}

class CogneeClient {
  private authToken: string | undefined;
  private loginPromise: Promise<void> | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly username?: string,
    private readonly password?: string,
    private readonly timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    private readonly ingestionTimeoutMs = DEFAULT_INGESTION_TIMEOUT_MS,
  ) {}

  async login(): Promise<void> {
    const user = this.username || "default_user@example.com";
    const pass = this.password || "default_password";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: user, password: pass }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Cognee login failed (${response.status}): ${await response.text()}`);
      }
      const data = (await response.json()) as { access_token?: string; token?: string };
      this.authToken = data.access_token ?? data.token;
      if (!this.authToken) {
        throw new Error("Cognee login succeeded but no token in response");
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async ensureAuth(): Promise<void> {
    if (this.authToken || this.apiKey) return;
    if (!this.loginPromise) {
      this.loginPromise = this.login().catch((error) => {
        this.loginPromise = undefined;
        throw error;
      });
    }
    return this.loginPromise;
  }

  private buildHeaders(): Record<string, string> {
    if (this.apiKey) {
      return {
        Authorization: `Bearer ${this.apiKey}`,
        "X-Api-Key": this.apiKey,
      };
    }
    if (this.authToken) {
      return { Authorization: `Bearer ${this.authToken}` };
    }
    return {};
  }

  private async fetchJson<T>(
    path: string,
    init: RequestInit,
    timeoutMs = this.timeoutMs,
    retries = MAX_RETRIES,
  ): Promise<T> {
    await this.ensureAuth();

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          headers: { ...this.buildHeaders(), ...(init.headers as Record<string, string>) },
          signal: controller.signal,
        });

        if (response.status === 401 && !this.apiKey) {
          clearTimeout(timer);
          this.authToken = undefined;
          this.loginPromise = undefined;
          await this.ensureAuth();
          continue;
        }

        if (!response.ok) {
          throw new Error(`Cognee request failed (${response.status}): ${await response.text()}`);
        }

        return (await response.json()) as T;
      } catch (error) {
        clearTimeout(timer);
        const isTimeout =
          error instanceof DOMException ||
          (error instanceof Error && error.name === "AbortError");
        if (isTimeout && attempt < retries) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }

  async add(params: {
    data: string;
    datasetName: string;
    datasetId?: string;
  }): Promise<{ datasetId: string; datasetName: string; dataId?: string }> {
    const formData = new FormData();
    const hash8 = hashText(params.data).slice(0, 8);
    const fileName = `openclaw-memory-${hash8}.txt`;
    formData.append("data", new Blob([params.data], { type: "text/plain" }), fileName);
    formData.append("datasetName", params.datasetName);
    if (params.datasetId) {
      formData.append("datasetId", params.datasetId);
    }

    const data = await this.fetchJson<CogneeAddResponse>(
      "/api/v1/add",
      { method: "POST", body: formData },
      this.ingestionTimeoutMs,
    );

    let dataId = this.extractDataId(data.data_id ?? data.data_ingestion_info);
    if (!dataId && data.dataset_id) {
      dataId = await this.resolveDataIdFromDataset(data.dataset_id, fileName);
    }

    return { datasetId: data.dataset_id, datasetName: data.dataset_name, dataId };
  }

  async update(params: {
    dataId: string;
    datasetId: string;
    data: string;
  }): Promise<{ datasetId: string; datasetName: string; dataId?: string }> {
    const query = new URLSearchParams({
      data_id: params.dataId,
      dataset_id: params.datasetId,
    });

    const formData = new FormData();
    const hash8 = hashText(params.data).slice(0, 8);
    const fileName = `openclaw-memory-${hash8}.txt`;
    formData.append("data", new Blob([params.data], { type: "text/plain" }), fileName);

    const data = await this.fetchJson<CogneeAddResponse>(
      `/api/v1/update?${query.toString()}`,
      { method: "PATCH", body: formData },
      this.ingestionTimeoutMs,
    );

    let dataId = this.extractDataId(data.data_id ?? data.data_ingestion_info);
    if (!dataId) {
      dataId = await this.resolveDataIdFromDataset(params.datasetId, fileName);
    }
    return { datasetId: data.dataset_id, datasetName: data.dataset_name, dataId };
  }

  async resolveDataIdFromDataset(datasetId: string, fileName: string): Promise<string | undefined> {
    try {
      type DataItem = { id: string; name: string };
      const items = await this.fetchJson<DataItem[]>(`/api/v1/datasets/${datasetId}/data`, { method: "GET" });
      const match = items.find((item) => item.name === fileName.replace(/\.txt$/, ""));
      return match?.id;
    } catch {
      return undefined;
    }
  }

  async delete(params: {
    dataId: string;
    datasetId: string;
    mode?: CogneeDeleteMode;
  }): Promise<{ datasetId: string; dataId: string; deleted: boolean; error?: string }> {
    try {
      const query = new URLSearchParams({
        data_id: params.dataId,
        dataset_id: params.datasetId,
        mode: params.mode ?? "soft",
      });
      await this.fetchJson<unknown>(`/api/v1/delete?${query.toString()}`, { method: "DELETE" });
      return { datasetId: params.datasetId, dataId: params.dataId, deleted: true };
    } catch (error) {
      return {
        datasetId: params.datasetId,
        dataId: params.dataId,
        deleted: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async cognify(params: { datasetIds?: string[] } = {}): Promise<{ status?: string }> {
    return this.fetchJson<{ status?: string }>("/api/v1/cognify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datasetIds: params.datasetIds, runInBackground: true }),
    });
  }

  async search(params: {
    queryText: string;
    searchPrompt: string;
    searchType: CogneeSearchType;
    datasetIds: string[];
    maxTokens: number;
  }): Promise<CogneeSearchResult[]> {
    const data = await this.fetchJson<unknown>("/api/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: params.queryText,
        searchType: params.searchType,
        datasetIds: params.datasetIds,
        max_tokens: params.maxTokens,
        ...(params.searchPrompt ? { systemPrompt: params.searchPrompt } : {}),
      }),
    });
    return this.normalizeSearchResults(data);
  }

  private normalizeSearchResults(data: unknown): CogneeSearchResult[] {
    if (Array.isArray(data)) {
      return data.map((item, index) => {
        if (typeof item === "string") {
          return { id: `result-${index}`, text: item, score: 1 };
        }
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          return {
            id: typeof record.id === "string" ? record.id : `result-${index}`,
            text: typeof record.text === "string" ? record.text : JSON.stringify(record),
            score: typeof record.score === "number" ? record.score : 1,
            metadata: record.metadata as Record<string, unknown> | undefined,
          };
        }
        return { id: `result-${index}`, text: String(item), score: 1 };
      });
    }
    if (data && typeof data === "object" && "results" in data) {
      return this.normalizeSearchResults((data as { results: unknown }).results);
    }
    return [];
  }

  private extractDataId(value: unknown): string | undefined {
    if (!value) return undefined;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const id = this.extractDataId(entry);
        if (id) return id;
      }
      return undefined;
    }
    if (typeof value !== "object") return undefined;
    const record = value as { data_id?: unknown; data_ingestion_info?: unknown };
    if (typeof record.data_id === "string") return record.data_id;
    return this.extractDataId(record.data_ingestion_info);
  }
}

async function syncFiles(
  client: CogneeClient,
  changedFiles: MemoryFile[],
  fullFiles: MemoryFile[],
  syncIndex: SyncIndex,
  cfg: DatasetSyncConfig,
  logger: { info?: (msg: string) => void; warn?: (msg: string) => void },
  saveFn?: (index: SyncIndex) => Promise<void>,
): Promise<SyncResult & { datasetId?: string }> {
  const result: SyncResult = { added: 0, updated: 0, skipped: 0, errors: 0, deleted: 0 };
  let datasetId = syncIndex.datasetId;
  let needsCognify = false;

  for (const file of changedFiles) {
    const existing = syncIndex.entries[file.path];
    if (existing && existing.hash === file.hash) {
      result.skipped++;
      continue;
    }

    const dataWithMetadata = buildMemoryData(file, cfg.datasetKey);

    try {
      if (existing?.dataId && datasetId) {
        try {
          const updateResponse = await client.update({
            dataId: existing.dataId,
            datasetId,
            data: dataWithMetadata,
          });
          syncIndex.entries[file.path] = { hash: file.hash, dataId: updateResponse.dataId };
          syncIndex.datasetId = datasetId;
          syncIndex.datasetName = cfg.datasetName;
          result.updated++;
          logger.info?.(`cognee-openclaw: [${cfg.datasetKey}] updated ${file.path}`);
          continue;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!(message.includes("404") || message.includes("409") || message.includes("not found"))) {
            throw error;
          }
          logger.info?.(`cognee-openclaw: [${cfg.datasetKey}] update failed for ${file.path}, falling back to add`);
          delete existing.dataId;
        }
      }

      const response = await client.add({
        data: dataWithMetadata,
        datasetName: cfg.datasetName,
        datasetId,
      });

      if (response.datasetId && response.datasetId !== datasetId) {
        datasetId = response.datasetId;
        const state = await loadDatasetState();
        state[cfg.datasetName] = response.datasetId;
        await saveDatasetState(state);
      }

      syncIndex.entries[file.path] = { hash: file.hash, dataId: response.dataId };
      syncIndex.datasetId = datasetId;
      syncIndex.datasetName = cfg.datasetName;
      needsCognify = true;
      result.added++;
      logger.info?.(`cognee-openclaw: [${cfg.datasetKey}] added ${file.path}`);
    } catch (error) {
      result.errors++;
      logger.warn?.(`cognee-openclaw: [${cfg.datasetKey}] failed to sync ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const currentPaths = new Set(fullFiles.map((file) => file.path));
  for (const [path, entry] of Object.entries(syncIndex.entries)) {
    if (currentPaths.has(path)) continue;
    if (!entry.dataId || !datasetId) {
      delete syncIndex.entries[path];
      result.deleted++;
      logger.info?.(`cognee-openclaw: [${cfg.datasetKey}] cleaned up orphan index entry ${path}`);
      continue;
    }
    const deleteResult = await client.delete({
      dataId: entry.dataId,
      datasetId,
      mode: cfg.deleteMode,
    });
    if (deleteResult.deleted) {
      delete syncIndex.entries[path];
      result.deleted++;
      logger.info?.(`cognee-openclaw: [${cfg.datasetKey}] deleted ${path}`);
      continue;
    }
    const isNotFound =
      deleteResult.error &&
      (deleteResult.error.includes("404") ||
        deleteResult.error.includes("409") ||
        deleteResult.error.includes("not found"));
    if (isNotFound) {
      delete syncIndex.entries[path];
      result.deleted++;
      logger.info?.(`cognee-openclaw: [${cfg.datasetKey}] deleted ${path} (already removed from Cognee)`);
      continue;
    }
    result.errors++;
    logger.warn?.(`cognee-openclaw: [${cfg.datasetKey}] failed to delete ${path}${deleteResult.error ? `: ${deleteResult.error}` : ""}`);
  }

  if (needsCognify && cfg.autoCognify && datasetId) {
    try {
      await client.cognify({ datasetIds: [datasetId] });
      logger.info?.(`cognee-openclaw: [${cfg.datasetKey}] cognify dispatched`);
    } catch (error) {
      logger.warn?.(`cognee-openclaw: [${cfg.datasetKey}] cognify failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (saveFn) {
    await saveFn(syncIndex);
  } else {
    await saveDatasetSyncIndex(cfg.datasetKey, syncIndex);
  }

  return { ...result, datasetId };
}

function computeCleanupSuggestions(
  files: MemoryFile[],
  ranking: RankingState,
  now = Date.now(),
): CleanupSuggestion[] {
  return files
    .map((file) => {
      const signals = ranking.entries[file.path] ?? defaultSignals();
      const adjustedScore = adjustSearchScore({
        baseScore: 0.25,
        signals,
        fileMtimeMs: file.mtimeMs,
        now,
      });
      let reason = "";
      if (signals.deprioritized && (signals.lastHitAt ?? 0) < now - 30 * 86_400_000) {
        reason = "already deprioritized and not recalled recently";
      } else if (signals.forgetCount >= 2) {
        reason = "repeatedly forgotten";
      } else if (signals.searchHitCount === 0 && file.mtimeMs < now - 90 * 86_400_000) {
        reason = "stale and never retrieved";
      }
      return { path: file.path, adjustedScore, reason };
    })
    .filter((item) => item.reason.length > 0)
    .sort((a, b) => a.adjustedScore - b.adjustedScore);
}

function buildDatasetHealthSummary(params: {
  datasetKey: DatasetKey;
  datasetName: string;
  datasetId?: string;
  syncIndex: SyncIndex;
  files: MemoryFile[];
  ranking: RankingState;
}): string[] {
  let dirty = 0;
  let newCount = 0;
  for (const file of params.files) {
    const existing = params.syncIndex.entries[file.path];
    if (!existing) {
      newCount++;
    } else if (existing.hash !== file.hash) {
      dirty++;
    }
  }

  const indexed = Object.keys(params.syncIndex.entries).length;
  const withDataId = Object.values(params.syncIndex.entries).filter((entry) => entry.dataId).length;
  const deleted = Object.keys(params.syncIndex.entries).filter((path) => !params.files.some((file) => file.path === path)).length;
  const rankingSummary = summarizeRanking(params.ranking);

  return [
    `Dataset: ${params.datasetKey}`,
    `Dataset Name: ${params.datasetName}`,
    `Dataset ID: ${params.datasetId ?? params.syncIndex.datasetId ?? "(not set)"}`,
    `Indexed files: ${indexed}`,
    `Data-ID coverage: ${withDataId}/${indexed}`,
    `Workspace files: ${params.files.length}`,
    `New files: ${newCount}`,
    `Dirty files: ${dirty}`,
    `Deleted from disk: ${deleted}`,
    `Ranking tracked: ${rankingSummary.tracked}`,
    `Ranking hits: ${rankingSummary.searchHits}`,
    `Ranking recalls: ${rankingSummary.recalls}`,
    `Ranking forgets: ${rankingSummary.forgets}`,
    `Deprioritized: ${rankingSummary.deprioritized}`,
    `Sync index: ${datasetSyncIndexPath(params.datasetKey)}`,
  ];
}

function datasetCfgForSync(cfg: ResolvedCogneePluginConfig, datasetKey: DatasetKey): DatasetSyncConfig {
  const profile = cfg.datasets[datasetKey];
  return {
    datasetKey,
    datasetName: profile.datasetName,
    autoCognify: profile.autoCognify,
    deleteMode: cfg.deleteMode,
  };
}

async function resolveWritableMemoryTarget(pathInput: string | undefined, workspaceDir: string): Promise<{ absPath: string; virtualPath: string }> {
  if (!pathInput || pathInput.trim().length === 0) {
    const slug = new Date().toISOString().replace(/[:.]/g, "-");
    const relPath = `memory/${slug}-${randomUUID().slice(0, 8)}.md`;
    return {
      absPath: resolve(workspaceDir, relPath),
      virtualPath: `main/${relPath}`,
    };
  }

  let normalized = normalizeDatasetPath(pathInput.trim());
  if (normalized.startsWith("main/")) {
    normalized = normalized.slice(5);
  }
  if (normalized.startsWith("agents/")) {
    throw new Error("memory dataset writes are restricted to the main workspace; agent workspaces are read-only here");
  }
  if (normalized !== "MEMORY.md" && !normalized.startsWith("memory/")) {
    throw new Error('memory dataset writes must target "MEMORY.md" or "memory/*.md" under the main workspace');
  }
  return {
    absPath: resolve(workspaceDir, normalized),
    virtualPath: `main/${normalized}`,
  };
}

function pathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function resolveWritableLibraryTarget(
  pathInput: string | undefined,
  workspaceDir: string,
  profile: ResolvedDatasetProfile,
): Promise<{ absPath: string; virtualPath: string }> {
  if (!pathInput || pathInput.trim().length === 0) {
    throw new Error("library dataset writes require an explicit filesystem path");
  }
  const absPath = resolveUserPath(pathInput.trim(), workspaceDir);
  const sources = await resolveLibrarySources(workspaceDir, profile);
  for (const source of sources) {
    if (source.isFile) {
      if (absPath === source.rootPath) {
        return { absPath, virtualPath: `${source.virtualBase}/${basename(absPath)}` };
      }
      continue;
    }
    if (pathInside(source.rootPath, absPath)) {
      return {
        absPath,
        virtualPath: `${source.virtualBase}/${normalizeDatasetPath(relative(source.rootPath, absPath))}`,
      };
    }
  }
  throw new Error("library dataset writes must stay inside configured library.paths");
}

async function searchDataset(params: {
  client: CogneeClient;
  cfg: ResolvedCogneePluginConfig;
  datasetKey: DatasetKey;
  datasetId?: string;
  workspaceDir: string;
  syncIndex: SyncIndex;
  ranking: RankingState;
  query: string;
  limit?: number;
}): Promise<RankedSearchResult[]> {
  const files = await collectDatasetFiles(params.datasetKey, params.workspaceDir, params.cfg);
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const merged = new Map<string, RankedSearchResult>();
  const limit = params.limit ?? params.cfg.maxResults;

  for (const file of files) {
    const baseScore = scoreLocalQuery(params.query, file);
    if (baseScore <= 0) continue;
    const signals = params.ranking.entries[file.path] ?? defaultSignals();
    merged.set(file.path, {
      dataset: params.datasetKey,
      path: file.path,
      absPath: file.absPath,
      text: file.content,
      baseScore,
      adjustedScore: adjustSearchScore({ baseScore, signals, fileMtimeMs: file.mtimeMs }),
      signals: { ...signals },
    });
  }

  if (params.datasetId) {
    try {
      const remoteResults = await params.client.search({
        queryText: params.query,
        searchPrompt: params.cfg.searchPrompt,
        searchType: params.cfg.searchType,
        datasetIds: [params.datasetId],
        maxTokens: params.cfg.maxTokens,
      });
      for (const result of remoteResults) {
        const path = extractVirtualPathFromSearchResult(result);
        if (!path) continue;
        const file = fileByPath.get(path);
        const signals = params.ranking.entries[path] ?? defaultSignals();
        const existing = merged.get(path);
        const adjustedScore = adjustSearchScore({
          baseScore: result.score,
          signals,
          fileMtimeMs: file?.mtimeMs,
        });
        merged.set(path, {
          dataset: params.datasetKey,
          path,
          absPath: file?.absPath,
          text: file?.content ?? result.text,
          baseScore: existing ? Math.max(existing.baseScore, result.score) : result.score,
          adjustedScore: existing ? Math.max(existing.adjustedScore, adjustedScore) : adjustedScore,
          signals: { ...signals },
        });
      }
    } catch {
      // local search fallback is enough
    }
  }

  return [...merged.values()]
    .filter((item) => item.adjustedScore >= params.cfg.minScore)
    .sort((a, b) => b.adjustedScore - a.adjustedScore)
    .slice(0, limit);
}

const memoryCogneePlugin = {
  id: "cognee-openclaw",
  name: "Memory (Cognee)",
  description: "Cognee-backed memory dataset manager for file-backed memory and library indexes. This plugin does not inject context or implement a context engine.",
  kind: "memory" as const,
  register(api: OpenClawPluginApi) {
    const cfg = resolveConfig(api.pluginConfig);
    const client = new CogneeClient(
      cfg.baseUrl,
      cfg.apiKey,
      cfg.username,
      cfg.password,
      cfg.requestTimeoutMs,
      cfg.ingestionTimeoutMs,
    );

    const datasetIds: Partial<Record<DatasetKey, string>> = {};
    const syncIndexes: Partial<Record<DatasetKey, SyncIndex>> = {};
    const rankingStates: Partial<Record<DatasetKey, RankingState>> = {};
    let stateReady = loadDatasetState()
      .then((state) => {
        datasetIds.memory = state[cfg.datasets.memory.datasetName];
        datasetIds.library = state[cfg.datasets.library.datasetName];
      })
      .catch((error) => {
        api.logger.warn?.(`cognee-openclaw: failed to load dataset state: ${String(error)}`);
      });

    async function ensureDatasetLoaded(datasetKey: DatasetKey): Promise<void> {
      await stateReady;
      if (!syncIndexes[datasetKey]) {
        syncIndexes[datasetKey] = await loadDatasetSyncIndex(datasetKey);
        if (!datasetIds[datasetKey]) {
          const profile = cfg.datasets[datasetKey];
          const syncIndex = syncIndexes[datasetKey]!;
          if (syncIndex.datasetName === profile.datasetName && syncIndex.datasetId) {
            datasetIds[datasetKey] = syncIndex.datasetId;
          }
        }
      }
      if (!rankingStates[datasetKey]) {
        rankingStates[datasetKey] = await loadRankingState(datasetKey);
      }
    }

    async function refreshDatasetLoaded(datasetKey: DatasetKey): Promise<void> {
      syncIndexes[datasetKey] = await loadDatasetSyncIndex(datasetKey);
      rankingStates[datasetKey] = await loadRankingState(datasetKey);
      const state = await loadDatasetState();
      datasetIds[datasetKey] = state[cfg.datasets[datasetKey].datasetName] ?? syncIndexes[datasetKey]?.datasetId;
    }

    async function persistDatasetId(datasetKey: DatasetKey, datasetId: string): Promise<void> {
      datasetIds[datasetKey] = datasetId;
      const state = await loadDatasetState();
      state[cfg.datasets[datasetKey].datasetName] = datasetId;
      await saveDatasetState(state);
    }

    async function syncDataset(
      datasetKey: DatasetKey,
      workspaceDir: string,
      logger: { info?: (msg: string) => void; warn?: (msg: string) => void },
      opts?: { changedOnly?: boolean },
    ): Promise<SyncResult & { datasetId?: string }> {
      await ensureDatasetLoaded(datasetKey);
      const profile = cfg.datasets[datasetKey];
      const syncIndex = syncIndexes[datasetKey]!;
      const ranking = rankingStates[datasetKey]!;
      const files = await collectDatasetFiles(datasetKey, workspaceDir, cfg);
      clearMissingRankingEntries(ranking, files);
      const changedFiles = opts?.changedOnly
        ? files.filter((file) => {
            const existing = syncIndex.entries[file.path];
            return !existing || existing.hash !== file.hash;
          })
        : files;
      const hasDeletedFiles = Object.keys(syncIndex.entries).some((path) => !files.some((file) => file.path === path));

      if (changedFiles.length === 0 && !hasDeletedFiles) {
        await saveRankingState(datasetKey, ranking);
        return { added: 0, updated: 0, skipped: 0, errors: 0, deleted: 0, datasetId: datasetIds[datasetKey] };
      }

      const result = await syncFiles(
        client,
        changedFiles,
        files,
        syncIndex,
        datasetCfgForSync(cfg, datasetKey),
        logger,
        async (index) => {
          syncIndexes[datasetKey] = index;
          await saveDatasetSyncIndex(datasetKey, index);
        },
      );

      if (result.datasetId) {
        await persistDatasetId(datasetKey, result.datasetId);
      }

      await saveRankingState(datasetKey, ranking);
      return result;
    }

    async function rebuildDataset(
      datasetKey: DatasetKey,
      workspaceDir: string,
      logger: { info?: (msg: string) => void; warn?: (msg: string) => void },
    ): Promise<SyncResult & { datasetId?: string }> {
      await ensureDatasetLoaded(datasetKey);
      const syncIndex = syncIndexes[datasetKey]!;
      const datasetId = datasetIds[datasetKey] ?? syncIndex.datasetId;
      if (datasetId) {
        for (const entry of Object.values(syncIndex.entries)) {
          if (!entry.dataId) continue;
          await client.delete({ dataId: entry.dataId, datasetId, mode: "hard" });
        }
      }
      syncIndexes[datasetKey] = { datasetId, datasetName: cfg.datasets[datasetKey].datasetName, entries: {} };
      await saveDatasetSyncIndex(datasetKey, syncIndexes[datasetKey]!);
      return syncDataset(datasetKey, workspaceDir, logger);
    }

    async function markSearchHits(datasetKey: DatasetKey, results: RankedSearchResult[]): Promise<void> {
      await ensureDatasetLoaded(datasetKey);
      const ranking = rankingStates[datasetKey]!;
      const now = Date.now();
      for (const result of results) {
        const signals = getSignals(ranking, result.path);
        signals.searchHitCount += 1;
        signals.lastHitAt = now;
      }
      await saveRankingState(datasetKey, ranking);
    }

    async function markRecall(datasetKey: DatasetKey, path: string): Promise<void> {
      await ensureDatasetLoaded(datasetKey);
      const ranking = rankingStates[datasetKey]!;
      const signals = getSignals(ranking, path);
      signals.recallCount += 1;
      signals.lastRecallAt = Date.now();
      signals.deprioritized = false;
      await saveRankingState(datasetKey, ranking);
    }

    async function storeMemory(params: {
      datasetKey: DatasetKey;
      workspaceDir: string;
      text: string;
      path?: string;
    }): Promise<{ path: string; sync: SyncResult & { datasetId?: string } }> {
      const target =
        params.datasetKey === "memory"
          ? await resolveWritableMemoryTarget(params.path, params.workspaceDir)
          : await resolveWritableLibraryTarget(params.path, params.workspaceDir, cfg.datasets.library);
      await fs.mkdir(dirname(target.absPath), { recursive: true });
      await fs.writeFile(target.absPath, params.text.endsWith("\n") ? params.text : `${params.text}\n`, "utf-8");
      await ensureDatasetLoaded(params.datasetKey);
      const ranking = rankingStates[params.datasetKey]!;
      const signals = getSignals(ranking, normalizeDatasetPath(target.virtualPath));
      signals.lastStoredAt = Date.now();
      signals.deprioritized = false;
      await saveRankingState(params.datasetKey, ranking);
      const sync = await syncDataset(params.datasetKey, params.workspaceDir, api.logger);
      return { path: normalizeDatasetPath(target.virtualPath), sync };
    }

    async function resolveFileTarget(
      datasetKey: DatasetKey,
      workspaceDir: string,
      params: { path?: string; query?: string },
    ): Promise<MemoryFile | undefined> {
      const files = await collectDatasetFiles(datasetKey, workspaceDir, cfg);
      if (params.path) {
        const requested = normalizeDatasetPath(params.path);
        return files.find((file) => file.path === requested);
      }
      if (!params.query) return undefined;
      await ensureDatasetLoaded(datasetKey);
      const results = await searchDataset({
        client,
        cfg,
        datasetKey,
        datasetId: datasetIds[datasetKey],
        workspaceDir,
        syncIndex: syncIndexes[datasetKey]!,
        ranking: rankingStates[datasetKey]!,
        query: params.query,
        limit: 1,
      });
      return results[0]?.absPath ? files.find((file) => file.path === results[0].path) : undefined;
    }

    async function forgetMemory(params: {
      datasetKey: DatasetKey;
      workspaceDir: string;
      path?: string;
      query?: string;
      mode: "delete" | "deprioritize" | "purge-critical";
    }): Promise<{ action: string; path?: string; sync?: SyncResult & { datasetId?: string } }> {
      const file = await resolveFileTarget(params.datasetKey, params.workspaceDir, {
        path: params.path,
        query: params.query,
      });
      if (!file) {
        throw new Error("No matching memory file found");
      }

      await ensureDatasetLoaded(params.datasetKey);
      const ranking = rankingStates[params.datasetKey]!;

      if (params.mode === "deprioritize") {
        applyDeprioritizeSignals(ranking, file.path);
        await saveRankingState(params.datasetKey, ranking);
        return { action: "deprioritized", path: file.path };
      }

      await fs.unlink(file.absPath);
      delete ranking.entries[file.path];
      await saveRankingState(params.datasetKey, ranking);

      if (params.mode === "purge-critical") {
        const sync = await rebuildDataset(params.datasetKey, params.workspaceDir, api.logger);
        return { action: "purged", path: file.path, sync };
      }

      const sync = await syncDataset(params.datasetKey, params.workspaceDir, api.logger);
      return { action: "deleted", path: file.path, sync };
    }

    function resolveToolWorkspace(ctx: { workspaceDir?: string }): string {
      return ctx.workspaceDir || process.cwd();
    }

    api.registerTool(
      (ctx) => {
        const workspaceDir = resolveToolWorkspace(ctx);
        return [
          {
            name: "memory_search",
            label: "Memory Search",
            description:
              "Search Cognee-backed memory datasets. This is memory retrieval only; it does not manage prompt context injection.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search query" },
                dataset: { type: "string", enum: ["memory", "library"], description: "Target dataset (default: memory)" },
                limit: { type: "number", description: "Maximum results" },
              },
              required: ["query"],
              additionalProperties: false,
            },
            async execute(_toolCallId: string, params: { query: string; dataset?: string; limit?: number }) {
              const datasetKey = resolveDatasetKey(params.dataset);
              await ensureDatasetLoaded(datasetKey);
              const results = await searchDataset({
                client,
                cfg,
                datasetKey,
                datasetId: datasetIds[datasetKey],
                workspaceDir,
                syncIndex: syncIndexes[datasetKey]!,
                ranking: rankingStates[datasetKey]!,
                query: params.query,
                limit: params.limit,
              });

              if (results.length === 0) {
                return renderToolText([`No results found in dataset "${datasetKey}".`]);
              }

              await markSearchHits(datasetKey, results);
              return {
                content: [
                  {
                    type: "text" as const,
                    text: results
                      .map(
                        (result, index) =>
                          `${index + 1}. ${result.path} (score=${result.adjustedScore.toFixed(3)}, base=${result.baseScore.toFixed(3)})`,
                      )
                      .join("\n"),
                  },
                ],
                details: {
                  dataset: datasetKey,
                  results: results.map((result) => ({
                    path: result.path,
                    adjustedScore: result.adjustedScore,
                    baseScore: result.baseScore,
                    signals: result.signals,
                  })),
                },
              };
            },
          },
          {
            name: "memory_get",
            label: "Memory Get",
            description:
              "Read a file-backed memory entry from the selected dataset by exact path or by query.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Exact virtual path to read" },
                query: { type: "string", description: "Query used to resolve the top matching file" },
                dataset: { type: "string", enum: ["memory", "library"], description: "Target dataset (default: memory)" },
              },
              additionalProperties: false,
            },
            async execute(_toolCallId: string, params: { path?: string; query?: string; dataset?: string }) {
              const datasetKey = resolveDatasetKey(params.dataset);
              const file = await resolveFileTarget(datasetKey, workspaceDir, params);
              if (!file) {
                return renderToolText([`No file found in dataset "${datasetKey}".`]);
              }
              await markRecall(datasetKey, file.path);
              return {
                content: [{ type: "text" as const, text: file.content }],
                details: { dataset: datasetKey, path: file.path, absPath: file.absPath },
              };
            },
          },
          {
            name: "memory_store",
            label: "Memory Store",
            description:
              "Persist file-backed memory into the selected Cognee dataset. Default dataset is memory. This stores memory, not prompt context.",
            parameters: {
              type: "object",
              properties: {
                text: { type: "string", description: "Markdown content to store" },
                path: { type: "string", description: "Optional target path. memory writes default to main/memory/*.md; library writes require an explicit configured path." },
                dataset: { type: "string", enum: ["memory", "library"], description: "Target dataset (default: memory)" },
              },
              required: ["text"],
              additionalProperties: false,
            },
            async execute(_toolCallId: string, params: { text: string; path?: string; dataset?: string }) {
              const datasetKey = resolveDatasetKey(params.dataset);
              const stored = await storeMemory({
                datasetKey,
                workspaceDir,
                text: params.text,
                path: params.path,
              });
              return {
                content: [{ type: "text" as const, text: `Stored ${stored.path} in dataset "${datasetKey}".` }],
                details: { dataset: datasetKey, path: stored.path, sync: stored.sync },
              };
            },
          },
          {
            name: "memory_forget",
            label: "Memory Forget",
            description:
              "Forget a memory file by deleting it, deprioritizing it, or purging it critically. Default dataset is memory.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Exact virtual path to forget" },
                query: { type: "string", description: "Query used to resolve the target file" },
                dataset: { type: "string", enum: ["memory", "library"], description: "Target dataset (default: memory)" },
                mode: {
                  type: "string",
                  enum: ["delete", "deprioritize", "purge-critical"],
                  description: "Forget mode (default: delete)",
                },
              },
              additionalProperties: false,
            },
            async execute(
              _toolCallId: string,
              params: { path?: string; query?: string; dataset?: string; mode?: "delete" | "deprioritize" | "purge-critical" },
            ) {
              const datasetKey = resolveDatasetKey(params.dataset);
              const result = await forgetMemory({
                datasetKey,
                workspaceDir,
                path: params.path,
                query: params.query,
                mode: params.mode ?? "delete",
              });
              return {
                content: [{ type: "text" as const, text: `${result.action}: ${result.path ?? "(unknown)"}` }],
                details: { dataset: datasetKey, ...result },
              };
            },
          },
        ];
      },
      { names: ["memory_search", "memory_get", "memory_store", "memory_forget"] },
    );

    api.registerCli((ctx) => {
      const workspaceDir = ctx.workspaceDir || process.cwd();
      const cognee = ctx.program.command("cognee").description("Cognee memory dataset management (not a context engine)");

      cognee
        .command("index")
        .description("Sync file-backed memories to the selected dataset")
        .option("--dataset <dataset>", "Target dataset (memory|library)", "memory")
        .action(async (opts: { dataset?: string }) => {
          const datasetKey = resolveDatasetKey(opts.dataset);
          const result = await syncDataset(datasetKey, workspaceDir, ctx.logger);
          console.log(
            `[${datasetKey}] ${result.added} added, ${result.updated} updated, ${result.deleted} deleted, ${result.skipped} unchanged, ${result.errors} errors`,
          );
        });

      cognee
        .command("status")
        .description("Show dataset health, sync coverage, and ranking summary")
        .option("--dataset <dataset>", "Target dataset (memory|library)", "memory")
        .action(async (opts: { dataset?: string }) => {
          const datasetKey = resolveDatasetKey(opts.dataset);
          await ensureDatasetLoaded(datasetKey);
          const files = await collectDatasetFiles(datasetKey, workspaceDir, cfg);
          const lines = buildDatasetHealthSummary({
            datasetKey,
            datasetName: cfg.datasets[datasetKey].datasetName,
            datasetId: datasetIds[datasetKey],
            syncIndex: syncIndexes[datasetKey]!,
            files,
            ranking: rankingStates[datasetKey]!,
          });
          console.log(lines.join("\n"));
        });

      cognee
        .command("search")
        .description("Search a specific dataset without injecting context")
        .argument("<query>", "Search query")
        .option("--dataset <dataset>", "Target dataset (memory|library)", "memory")
        .option("--limit <n>", "Maximum results", String(DEFAULT_MAX_RESULTS))
        .action(async (query: string, opts: { dataset?: string; limit?: string }) => {
          const datasetKey = resolveDatasetKey(opts.dataset);
          await ensureDatasetLoaded(datasetKey);
          const results = await searchDataset({
            client,
            cfg,
            datasetKey,
            datasetId: datasetIds[datasetKey],
            workspaceDir,
            syncIndex: syncIndexes[datasetKey]!,
            ranking: rankingStates[datasetKey]!,
            query,
            limit: opts.limit ? Number.parseInt(opts.limit, 10) : undefined,
          });
          if (results.length === 0) {
            console.log(`[${datasetKey}] no results`);
            return;
          }
          await markSearchHits(datasetKey, results);
          for (const result of results) {
            console.log(`${result.path}\t${result.adjustedScore.toFixed(3)}`);
          }
        });

      cognee
        .command("cognify")
        .description("Dispatch cognify for the selected dataset")
        .option("--dataset <dataset>", "Target dataset (memory|library)", "memory")
        .action(async (opts: { dataset?: string }) => {
          const datasetKey = resolveDatasetKey(opts.dataset);
          await ensureDatasetLoaded(datasetKey);
          const datasetId = datasetIds[datasetKey];
          if (!datasetId) {
            console.log(`[${datasetKey}] dataset has not been indexed yet`);
            return;
          }
          await client.cognify({ datasetIds: [datasetId] });
          console.log(`[${datasetKey}] cognify dispatched`);
        });

      cognee
        .command("stats")
        .description("Inspect ranking stats for a dataset")
        .option("--dataset <dataset>", "Target dataset (memory|library)", "memory")
        .option("--top <n>", "Rows to show", "10")
        .action(async (opts: { dataset?: string; top?: string }) => {
          const datasetKey = resolveDatasetKey(opts.dataset);
          await ensureDatasetLoaded(datasetKey);
          const files = await collectDatasetFiles(datasetKey, workspaceDir, cfg);
          const top = Number.parseInt(opts.top ?? "10", 10);
          const rows = files
            .map((file) => ({
              path: file.path,
              adjustedScore: adjustSearchScore({
                baseScore: 0.25,
                signals: rankingStates[datasetKey]!.entries[file.path] ?? defaultSignals(),
                fileMtimeMs: file.mtimeMs,
              }),
              signals: rankingStates[datasetKey]!.entries[file.path] ?? defaultSignals(),
            }))
            .sort((a, b) => b.adjustedScore - a.adjustedScore)
            .slice(0, top);
          for (const row of rows) {
            console.log(
              `${row.path}\tscore=${row.adjustedScore.toFixed(3)}\thits=${row.signals.searchHitCount}\trecalls=${row.signals.recallCount}\tforgets=${row.signals.forgetCount}`,
            );
          }
        });

      cognee
        .command("deprioritize")
        .description("Lower retrieval priority without deleting the file")
        .argument("<path>", "Virtual dataset path")
        .option("--dataset <dataset>", "Target dataset (memory|library)", "memory")
        .action(async (path: string, opts: { dataset?: string }) => {
          const datasetKey = resolveDatasetKey(opts.dataset);
          await ensureDatasetLoaded(datasetKey);
          applyDeprioritizeSignals(rankingStates[datasetKey]!, normalizeDatasetPath(path));
          await saveRankingState(datasetKey, rankingStates[datasetKey]!);
          console.log(`[${datasetKey}] deprioritized ${normalizeDatasetPath(path)}`);
        });

      cognee
        .command("purge-critical")
        .description("Delete a file-backed memory and rebuild the dataset from remaining truth")
        .argument("<path>", "Virtual dataset path")
        .option("--dataset <dataset>", "Target dataset (memory|library)", "memory")
        .action(async (path: string, opts: { dataset?: string }) => {
          const datasetKey = resolveDatasetKey(opts.dataset);
          const result = await forgetMemory({
            datasetKey,
            workspaceDir,
            path: normalizeDatasetPath(path),
            mode: "purge-critical",
          });
          console.log(`[${datasetKey}] ${result.action} ${result.path}`);
        });

      cognee
        .command("cleanup-suggest")
        .description("Read-only stale-memory suggestions")
        .option("--dataset <dataset>", "Target dataset (memory|library)", "memory")
        .option("--limit <n>", "Maximum suggestions", "10")
        .action(async (opts: { dataset?: string; limit?: string }) => {
          const datasetKey = resolveDatasetKey(opts.dataset);
          await ensureDatasetLoaded(datasetKey);
          const files = await collectDatasetFiles(datasetKey, workspaceDir, cfg);
          const suggestions = computeCleanupSuggestions(files, rankingStates[datasetKey]!)
            .slice(0, Number.parseInt(opts.limit ?? "10", 10));
          if (suggestions.length === 0) {
            console.log(`[${datasetKey}] no cleanup suggestions`);
            return;
          }
          for (const suggestion of suggestions) {
            console.log(`${suggestion.path}\t${suggestion.adjustedScore.toFixed(3)}\t${suggestion.reason}`);
          }
        });

      cognee
        .command("cleanup-apply")
        .description("Explicitly apply cleanup by deprioritizing suggested entries")
        .option("--dataset <dataset>", "Target dataset (memory|library)", "memory")
        .option("--limit <n>", "How many suggestions to apply", "5")
        .action(async (opts: { dataset?: string; limit?: string }) => {
          const datasetKey = resolveDatasetKey(opts.dataset);
          await ensureDatasetLoaded(datasetKey);
          const files = await collectDatasetFiles(datasetKey, workspaceDir, cfg);
          const suggestions = computeCleanupSuggestions(files, rankingStates[datasetKey]!)
            .slice(0, Number.parseInt(opts.limit ?? "5", 10));
          for (const suggestion of suggestions) {
            applyDeprioritizeSignals(rankingStates[datasetKey]!, suggestion.path);
          }
          await saveRankingState(datasetKey, rankingStates[datasetKey]!);
          console.log(`[${datasetKey}] applied cleanup to ${suggestions.length} entr${suggestions.length === 1 ? "y" : "ies"}`);
        });
    }, { commands: ["cognee"] });

    api.registerService({
      id: "cognee-memory-auto-sync",
      async start(ctx) {
        const workspaceDir = ctx.workspaceDir || process.cwd();
        for (const datasetKey of ["memory", "library"] as DatasetKey[]) {
          const profile = cfg.datasets[datasetKey];
          if (!profile.autoIndex) continue;
          try {
            const result = await syncDataset(datasetKey, workspaceDir, ctx.logger);
            ctx.logger.info?.(
              `cognee-openclaw: [${datasetKey}] auto-sync complete: ${result.added} added, ${result.updated} updated, ${result.deleted} deleted, ${result.skipped} unchanged`,
            );
          } catch (error) {
            ctx.logger.warn?.(`cognee-openclaw: [${datasetKey}] auto-sync failed: ${String(error)}`);
          }
        }
      },
    });

    api.on("agent_end", async (event, ctx) => {
      if (!event.success) return;
      const workspaceDir = ctx.workspaceDir || process.cwd();
      for (const datasetKey of ["memory", "library"] as DatasetKey[]) {
        if (!cfg.datasets[datasetKey].autoIndex) continue;
        try {
          await refreshDatasetLoaded(datasetKey);
          const result = await syncDataset(datasetKey, workspaceDir, api.logger, { changedOnly: true });
          if (result.added || result.updated || result.deleted) {
            api.logger.info?.(
              `cognee-openclaw: [${datasetKey}] post-agent sync: ${result.added} added, ${result.updated} updated, ${result.deleted} deleted`,
            );
          }
        } catch (error) {
          api.logger.warn?.(`cognee-openclaw: [${datasetKey}] post-agent sync failed: ${String(error)}`);
        }
      }
    });

    if (cfg.datasets.memory.autoRecall || cfg.datasets.library.autoRecall) {
      api.logger.info?.(
        "cognee-openclaw: autoRecall flags are treated as metadata only; this plugin manages memory datasets and does not inject runtime context.",
      );
    }
  },
};

export default memoryCogneePlugin;

export { CogneeClient, syncFiles };
export {
  resolveConfig,
  resolveDatasetKey,
  datasetSyncIndexPath,
  datasetRankingPath,
  loadDatasetSyncIndex,
  saveDatasetSyncIndex,
  loadRankingState,
  saveRankingState,
  discoverConfiguredAgentWorkspaces,
  collectMemoryDatasetFiles,
  collectLibraryDatasetFiles,
  collectDatasetFiles,
  librarySourceVirtualBase,
  adjustSearchScore,
  applyDeprioritizeSignals,
  computeCleanupSuggestions,
  extractVirtualPathFromSearchResult,
};
export type {
  CogneeDeleteMode,
  CogneePluginConfig,
  DatasetKey,
  DatasetProfileConfig,
  ResolvedDatasetProfile,
  ResolvedCogneePluginConfig,
  MemoryFile,
  SyncIndex,
  SyncResult,
  RankingSignals,
  RankingState,
  DatasetSyncConfig,
  WorkspaceBinding,
  CleanupSuggestion,
};
