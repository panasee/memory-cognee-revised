# Tunnable Parameters

This file summarizes the parameters that are currently practical to tune in `memory-cognee-revised`.

There are two classes:

- code-level constants in `index.ts`
- plugin-config fields exposed through `openclaw.plugin.json`

## 1. Code-Level Ranking / Decay Tunables

These are not exposed as plugin config yet. Adjust them directly in `index.ts`.

### Reinforcement / decay defaults

All current defaults live near the top-level constant block in `index.ts`.

| Constant | Current value | Effect |
| --- | --- | --- |
| `DEFAULT_MEMORY_BASE_HALF_LIFE_DAYS` | `45` | Base forgetting speed for `memory`. Lower = forget faster. |
| `DEFAULT_LIBRARY_BASE_HALF_LIFE_DAYS` | `180` | Base forgetting speed for `library`. Higher = forget slower. |
| `DEFAULT_MEMORY_MIN_FRESHNESS_MULTIPLIER` | `0.6` | Lowest freshness multiplier `memory` can decay toward. Lower = stronger decay. |
| `DEFAULT_LIBRARY_MIN_FRESHNESS_MULTIPLIER` | `0.85` | Lowest freshness multiplier `library` can decay toward. |
| `DEFAULT_REINFORCEMENT_FRESHNESS_HALF_LIFE_DAYS` | `30` | How quickly old reinforcement loses strength. Lower = reinforcement fades faster. |
| `DEFAULT_MEMORY_REINFORCEMENT_FACTOR` | `0.55` | How strongly explicit reinforcement slows forgetting for `memory`. |
| `DEFAULT_LIBRARY_REINFORCEMENT_FACTOR` | `0.2` | How strongly explicit reinforcement slows forgetting for `library`. |
| `DEFAULT_MAX_HALF_LIFE_MULTIPLIER` | `3` | Hard cap on reinforcement-based half-life extension. |
| `DEFAULT_FORGET_PENALTY` | `0.12` | Per-forget ranking penalty. |
| `DEFAULT_DEPRIORITIZED_PENALTY` | `0.25` | Extra penalty when a memory is actively deprioritized. |
| `DEFAULT_MEMORY_STALE_DAYS` | `90` | `memory` stale threshold for cleanup suggestions. |
| `DEFAULT_LIBRARY_STALE_DAYS` | `365` | `library` stale threshold for cleanup suggestions. |
| `DEFAULT_MEMORY_DEPRIORITIZED_GRACE_DAYS` | `30` | Grace window before a deprioritized `memory` becomes a cleanup suggestion. |
| `DEFAULT_LIBRARY_DEPRIORITIZED_GRACE_DAYS` | `180` | Same, but for `library`. |

### Local lexical search weights

These control the local fallback scorer in `scoreLocalQuery()`.

| Constant | Current value | Effect |
| --- | --- | --- |
| `LOCAL_QUERY_CONTENT_EXACT_WEIGHT` | `0.45` | Score added when the full query appears in content. |
| `LOCAL_QUERY_PATH_EXACT_WEIGHT` | `0.35` | Score added when the full query appears in path. |
| `LOCAL_QUERY_TOKEN_OVERLAP_WEIGHT` | `0.4` | Score budget for partial token overlap. |
| `MEMORY_SUPERSEDED_SCORE_PENALTY` | `0.08` | Small downranking for `memory` items with `supersededBy`. |

### Low-signal filtering

These affect the conservative filter used before `memory_store`, `compact-memory`, and retained `library` import.

| Constant / rule | Current value | Effect |
| --- | --- | --- |
| `LOW_SIGNAL_MIN_TOKEN_COUNT` | `10` | Minimum token count before text is considered durable enough. |
| `LOW_SIGNAL_MIN_CJK_TOKEN_COUNT` | `4` | Lower minimum token count for CJK text without whitespace-heavy tokenization. |
| `GREETING_ONLY_PATTERN` | hardcoded regex | Exact greetings / thanks that should be rejected as low-signal. |

Note:

- tokenization is now CJK-aware, so compact Chinese/Japanese/Korean text is not incorrectly treated as one token just because it has no spaces

### Duplicate suppression

These affect retrieval-time duplicate collapsing.

| Constant | Current value | Effect |
| --- | --- | --- |
| `RELATION_DUPLICATE_TOKEN_CONTAINMENT_THRESHOLD` | `0.9` | Token containment needed before relation-linked results are treated as duplicates. |

Current duplicate behavior is also shaped by logic, not only constants:

- exact normalized-body duplicate collapse
- compaction-family duplicate collapse
- conservative relation-linked high-overlap duplicate collapse

## 2. Plugin-Config Tunables

These are already exposed through plugin config / `openclaw.plugin.json`.

### Global retrieval / storage knobs

| Config key | Default | Effect |
| --- | --- | --- |
| `maxResults` | `6` | Maximum returned search results. |
| `minScore` | `0` | Minimum post-ranking score needed to return a result. |
| `maxTokens` | `512` | Token cap passed to Cognee search. |
| `searchType` | `GRAPH_COMPLETION` | Default Cognee search mode. |
| `searchPrompt` | `""` | Optional system prompt for Cognee search. |
| `memoryStoreMaxChars` | `4000` | Maximum size accepted by `memory_store`. |
| `deleteMode` | `soft` | Cognee delete mode when sync removes indexed content. |

### Retained library capacity knobs

| Config key | Default | Effect |
| --- | --- | --- |
| `retainedAssetWarnBytes` | `536870912` | Soft warning threshold for retained library bytes. |
| `retainedAssetWarnCount` | `500` | Soft warning threshold for retained library asset count. |
| `retainedAssetMaxBytes` | unset | Optional hard byte limit for retained imports. |
| `retainedAssetMaxCount` | unset | Optional hard asset-count limit for retained imports. |

### Dataset-profile knobs

Both `datasets.memory` and `datasets.library` expose profile-level settings.

| Config key | Effect |
| --- | --- |
| `datasetName` | Cognee dataset name for that profile. |
| `autoIndex` | Whether to sync automatically on startup / post-agent flow. |
| `autoCognify` | Whether new sync additions dispatch `cognify`. |
| `autoRecall` | Metadata only in this plugin; does not inject runtime context. |
| `searchType` | Dataset-specific Cognee search mode. |
| `searchPrompt` | Dataset-specific Cognee search prompt. |
| `maxTokens` | Dataset-specific search token cap. |

Additional `library`-only profile key:

| Config key | Effect |
| --- | --- |
| `datasets.library.paths` | Filesystem roots mirrored into the `library` dataset. |

## 3. Practical Tuning Order

If retrieval feels wrong, adjust in this order:

1. `minScore`
2. `maxResults`
3. dataset-specific `searchType` / `searchPrompt`
4. `DEFAULT_MEMORY_BASE_HALF_LIFE_DAYS` / `DEFAULT_LIBRARY_BASE_HALF_LIFE_DAYS`
5. `DEFAULT_MEMORY_REINFORCEMENT_FACTOR` / `DEFAULT_LIBRARY_REINFORCEMENT_FACTOR`
6. `DEFAULT_MEMORY_MIN_FRESHNESS_MULTIPLIER` / `DEFAULT_LIBRARY_MIN_FRESHNESS_MULTIPLIER`
7. `LOW_SIGNAL_MIN_TOKEN_COUNT`
8. `RELATION_DUPLICATE_TOKEN_CONTAINMENT_THRESHOLD`

## 4. Current Non-Configurable But Important Behaviors

These are intentionally not surfaced as user config yet:

- explicit reinforcement is manual only
- `memory_confirm_useful` records useful-confirmation state but does not auto-reinforce
- no conversation-turn-based reinforcement exists yet
- no vector-based duplicate suppression exists yet
- no length normalization exists yet
- no two-stage threshold model exists yet
