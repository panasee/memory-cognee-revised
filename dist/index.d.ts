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
    pinnedPaths?: string[];
    pinnedMaxResults?: number;
    memoryStoreMaxChars?: number;
    requestTimeoutMs?: number;
    ingestionTimeoutMs?: number;
    summaryModel?: string;
    summaryProvider?: string;
    summaryMaxTokens?: number;
    retainedAssetWarnBytes?: number;
    retainedAssetWarnCount?: number;
    retainedAssetMaxBytes?: number;
    retainedAssetMaxCount?: number;
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
    pinnedPaths: string[];
    pinnedMaxResults: number;
    memoryStoreMaxChars: number;
    summaryModel: string;
    summaryProvider: string;
    summaryMaxTokens: number;
    retainedAssetWarnBytes: number;
    retainedAssetWarnCount: number;
    retainedAssetMaxBytes?: number;
    retainedAssetMaxCount?: number;
    rankingPolicies: Record<DatasetKey, {
        dailyDecay: number;
        maxDecay: number;
        staleDays: number;
        deprioritizedGraceDays: number;
    }>;
    compactionPolicies: Record<CompactionProfile, {
        defaultDeleteSource: boolean;
        strategy: "distill-delete" | "distill-keep" | "retained-import" | "skip";
    }>;
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
type RetainedLibraryAsset = {
    assetId: string;
    title: string;
    originalPath?: string;
    importedAt: string;
    contentHash: string;
    sizeBytes?: number;
    storagePath: string;
    virtualPath: string;
};
type RetainedLibraryManifest = {
    assets: RetainedLibraryAsset[];
};
type CompactionArtifact = {
    artifactId: string;
    sourcePath: string;
    sourceHash: string;
    createdAt: string;
    replacementPath: string;
    replacementKind: "distilled-memory";
    status: "ready" | "applied";
    summaryMode?: "llm-distilled" | "preserved-copy";
    summaryModelRef?: string;
    lastRebuiltAt?: string;
};
type CompactionManifest = {
    artifacts: CompactionArtifact[];
};
type CleanupSuggestion = {
    path: string;
    adjustedScore: number;
    reason: string;
};
type CompactSuggestion = {
    path: string;
    reason: string;
};
type CompactionProfile = "daily-log" | "worklog" | "reference-note" | "general";
type RetainedCapacitySummary = {
    assetCount: number;
    totalBytes: number;
    warnCountExceeded: boolean;
    warnBytesExceeded: boolean;
    maxCountExceeded: boolean;
    maxBytesExceeded: boolean;
};
type RetainedCleanupSuggestion = {
    assetId: string;
    virtualPath: string;
    title: string;
    sizeBytes: number;
    reason: string;
};
declare function classifyCompactionProfile(file: MemoryFile): CompactionProfile;
declare function buildCompactionSystemPrompt(profile: CompactionProfile): string;
declare function computeCompactSuggestions(files: MemoryFile[], manifest: CompactionManifest, cfg: Pick<ResolvedCogneePluginConfig, "compactionPolicies">, now?: number): CompactSuggestion[];
declare function resolveDatasetKey(input?: string): DatasetKey;
declare function datasetSyncIndexPath(datasetKey: DatasetKey): string;
declare function datasetRankingPath(datasetKey: DatasetKey): string;
declare function applyDeprioritizeSignals(state: RankingState, path: string, now?: number): RankingSignals;
declare function adjustSearchScore(params: {
    datasetKey: DatasetKey;
    baseScore: number;
    signals?: RankingSignals;
    fileMtimeMs?: number;
    now?: number;
    cfg: Pick<ResolvedCogneePluginConfig, "rankingPolicies">;
}): number;
declare function extractVirtualPathFromSearchResult(result: CogneeSearchResult): string | undefined;
declare function resolveConfig(rawConfig: unknown): ResolvedCogneePluginConfig;
declare function loadDatasetSyncIndex(datasetKey: DatasetKey): Promise<SyncIndex>;
declare function saveDatasetSyncIndex(datasetKey: DatasetKey, index: SyncIndex): Promise<void>;
declare function loadRankingState(datasetKey: DatasetKey): Promise<RankingState>;
declare function saveRankingState(datasetKey: DatasetKey, state: RankingState): Promise<void>;
declare function summarizeRetainedCapacity(manifest: RetainedLibraryManifest, cfg: Pick<ResolvedCogneePluginConfig, "retainedAssetWarnBytes" | "retainedAssetWarnCount" | "retainedAssetMaxBytes" | "retainedAssetMaxCount">): RetainedCapacitySummary;
declare function buildRetainedCapacityLines(summary: RetainedCapacitySummary): string[];
declare function computeRetainedCleanupSuggestions(manifest: RetainedLibraryManifest, syncIndex: SyncIndex, cfg: Pick<ResolvedCogneePluginConfig, "retainedAssetWarnBytes" | "retainedAssetWarnCount" | "retainedAssetMaxBytes" | "retainedAssetMaxCount">, limit?: number): RetainedCleanupSuggestion[];
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
declare function computeCleanupSuggestions(datasetKey: DatasetKey, files: MemoryFile[], ranking: RankingState, cfg: Pick<ResolvedCogneePluginConfig, "rankingPolicies">, now?: number): CleanupSuggestion[];
declare function importRetainedLibraryAsset(params: {
    workspaceDir: string;
    sourcePath: string;
    title?: string;
    cfg: Pick<ResolvedCogneePluginConfig, "retainedAssetWarnBytes" | "retainedAssetWarnCount" | "retainedAssetMaxBytes" | "retainedAssetMaxCount">;
}): Promise<RetainedLibraryAsset>;
declare const memoryCogneePlugin: {
    id: string;
    name: string;
    description: string;
    kind: "memory";
    register(api: OpenClawPluginApi): void;
};
export default memoryCogneePlugin;
export { CogneeClient, syncFiles };
export { resolveConfig, resolveDatasetKey, datasetSyncIndexPath, datasetRankingPath, loadDatasetSyncIndex, saveDatasetSyncIndex, loadRankingState, saveRankingState, discoverConfiguredAgentWorkspaces, collectMemoryDatasetFiles, collectLibraryDatasetFiles, collectDatasetFiles, librarySourceVirtualBase, adjustSearchScore, applyDeprioritizeSignals, computeCleanupSuggestions, classifyCompactionProfile, buildCompactionSystemPrompt, summarizeRetainedCapacity, buildRetainedCapacityLines, computeRetainedCleanupSuggestions, computeCompactSuggestions, importRetainedLibraryAsset, extractVirtualPathFromSearchResult, };
export type { CogneeDeleteMode, CogneePluginConfig, DatasetKey, DatasetProfileConfig, ResolvedDatasetProfile, ResolvedCogneePluginConfig, MemoryFile, SyncIndex, SyncResult, RankingSignals, RankingState, DatasetSyncConfig, WorkspaceBinding, CleanupSuggestion, RetainedCapacitySummary, RetainedCleanupSuggestion, };
