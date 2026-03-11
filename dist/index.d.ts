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
type CogneeSearchResult = {
    id: string;
    text: string;
    score: number;
    metadata?: Record<string, unknown>;
};
type SyncIndex = {
    datasetId?: string;
    datasetName?: string;
    entries: Record<string, {
        hash: string;
        dataId?: string;
    }>;
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
type CleanupSuggestion = {
    path: string;
    adjustedScore: number;
    reason: string;
};
declare function resolveDatasetKey(input?: string): DatasetKey;
declare function datasetSyncIndexPath(datasetKey: DatasetKey): string;
declare function datasetRankingPath(datasetKey: DatasetKey): string;
declare function applyDeprioritizeSignals(state: RankingState, path: string, now?: number): RankingSignals;
declare function adjustSearchScore(params: {
    baseScore: number;
    signals?: RankingSignals;
    fileMtimeMs?: number;
    now?: number;
}): number;
declare function extractVirtualPathFromSearchResult(result: CogneeSearchResult): string | undefined;
declare function resolveConfig(rawConfig: unknown): ResolvedCogneePluginConfig;
declare function loadDatasetSyncIndex(datasetKey: DatasetKey): Promise<SyncIndex>;
declare function saveDatasetSyncIndex(datasetKey: DatasetKey, index: SyncIndex): Promise<void>;
declare function loadRankingState(datasetKey: DatasetKey): Promise<RankingState>;
declare function saveRankingState(datasetKey: DatasetKey, state: RankingState): Promise<void>;
declare function discoverConfiguredAgentWorkspaces(): Promise<WorkspaceBinding[]>;
declare function librarySourceVirtualBase(rootPath: string): string;
declare function collectLibraryDatasetFiles(workspaceDir: string, profile: ResolvedDatasetProfile): Promise<MemoryFile[]>;
declare function collectMemoryDatasetFiles(workspaceDir: string): Promise<MemoryFile[]>;
declare function collectDatasetFiles(datasetKey: DatasetKey, workspaceDir: string, cfg: ResolvedCogneePluginConfig): Promise<MemoryFile[]>;
declare class CogneeClient {
    private readonly baseUrl;
    private readonly apiKey?;
    private readonly username?;
    private readonly password?;
    private readonly timeoutMs;
    private readonly ingestionTimeoutMs;
    private authToken;
    private loginPromise;
    constructor(baseUrl: string, apiKey?: string, username?: string, password?: string, timeoutMs?: number, ingestionTimeoutMs?: number);
    login(): Promise<void>;
    ensureAuth(): Promise<void>;
    private buildHeaders;
    private fetchJson;
    add(params: {
        data: string;
        datasetName: string;
        datasetId?: string;
    }): Promise<{
        datasetId: string;
        datasetName: string;
        dataId?: string;
    }>;
    update(params: {
        dataId: string;
        datasetId: string;
        data: string;
    }): Promise<{
        datasetId: string;
        datasetName: string;
        dataId?: string;
    }>;
    resolveDataIdFromDataset(datasetId: string, fileName: string): Promise<string | undefined>;
    delete(params: {
        dataId: string;
        datasetId: string;
        mode?: CogneeDeleteMode;
    }): Promise<{
        datasetId: string;
        dataId: string;
        deleted: boolean;
        error?: string;
    }>;
    cognify(params?: {
        datasetIds?: string[];
    }): Promise<{
        status?: string;
    }>;
    search(params: {
        queryText: string;
        searchPrompt: string;
        searchType: CogneeSearchType;
        datasetIds: string[];
        maxTokens: number;
    }): Promise<CogneeSearchResult[]>;
    private normalizeSearchResults;
    private extractDataId;
}
declare function syncFiles(client: CogneeClient, changedFiles: MemoryFile[], fullFiles: MemoryFile[], syncIndex: SyncIndex, cfg: DatasetSyncConfig, logger: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
}, saveFn?: (index: SyncIndex) => Promise<void>): Promise<SyncResult & {
    datasetId?: string;
}>;
declare function computeCleanupSuggestions(files: MemoryFile[], ranking: RankingState, now?: number): CleanupSuggestion[];
declare const memoryCogneePlugin: {
    id: string;
    name: string;
    description: string;
    kind: "memory";
    register(api: OpenClawPluginApi): void;
};
export default memoryCogneePlugin;
export { CogneeClient, syncFiles };
export { resolveConfig, resolveDatasetKey, datasetSyncIndexPath, datasetRankingPath, loadDatasetSyncIndex, saveDatasetSyncIndex, loadRankingState, saveRankingState, discoverConfiguredAgentWorkspaces, collectMemoryDatasetFiles, collectLibraryDatasetFiles, collectDatasetFiles, librarySourceVirtualBase, adjustSearchScore, applyDeprioritizeSignals, computeCleanupSuggestions, extractVirtualPathFromSearchResult, };
export type { CogneeDeleteMode, CogneePluginConfig, DatasetKey, DatasetProfileConfig, ResolvedDatasetProfile, ResolvedCogneePluginConfig, MemoryFile, SyncIndex, SyncResult, RankingSignals, RankingState, DatasetSyncConfig, WorkspaceBinding, CleanupSuggestion, };
