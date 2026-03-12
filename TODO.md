# TODO

This TODO describes the incremental features that must be added on top of the original `memory-cognee-revised` plugin baseline.

Use the original plugin as the baseline and implement only the additional capabilities listed here.

Sections are kept for implementation history.
When a section is already landed, it is marked with an explicit status instead of being silently removed.

## 1. Add Fixed Dataset Profiles

Status: completed

The original plugin has a single dataset-oriented configuration model.

Add support for two fixed dataset profiles:

- `memory`
- `library`

### New config additions

- `datasets.memory.datasetName`
- `datasets.memory.autoIndex`
- `datasets.memory.autoCognify`
- `datasets.memory.autoRecall`
- `datasets.library.datasetName`
- `datasets.library.paths`
- `datasets.library.autoIndex`
- `datasets.library.autoCognify`
- `datasets.library.autoRecall`

### Intended behavior

- `memory` is the primary OpenClaw memory dataset
- `library` is the external reference dataset
- `library` must not auto-index, auto-cognify, or auto-recall unless explicitly targeted

## 2. Add Dataset-Specific Sync Indexes

Status: completed

The original plugin uses a single sync index.

Add per-dataset-profile sync indexes:

- `~/.openclaw/memory/cognee/sync-indexes/memory.json`
- `~/.openclaw/memory/cognee/sync-indexes/library.json`

### Requirements

- `memory` sync state must be independent from `library`
- keep legacy fallback only if needed for transition

## 3. Add Multi-Workspace Aggregation For `memory`

Status: completed

The original plugin scans only one workspace.

Extend it so the `memory` dataset aggregates:

- main workspace:
  - `MEMORY.md`
  - `memory/*.md`
  - `memory/**/*.md`
- every configured agent workspace:
  - `MEMORY.md`
  - `memory/*.md`
  - `memory/**/*.md`

### Workspace discovery

Read workspaces from:

- `~/.openclaw/openclaw.json`
- `agents.defaults.workspace`
- `agents.list[].workspace`

Do not hardcode the folder naming pattern.

### Virtual path requirement

To avoid path collisions, add stable virtual prefixes:

- `main/...`
- `agents/<agentId>/...`

Examples:

- `main/MEMORY.md`
- `main/memory/2026-03-11.md`
- `agents/academic-bot/MEMORY.md`
- `agents/academic-bot/memory/notes.md`

## 4. Add Explicit `library` Dataset Scanning

Status: completed

The original plugin does not distinguish external reference material.

Add `library` dataset scanning for explicit configured paths only.

### Requirements

- every configured path supports:
  - `*.md`
  - `**/*.md`
- `library` is never auto-scanned unless the `library` dataset is explicitly targeted

## 5. Add Dataset-Aware CLI Routing

Status: completed

Keep `openclaw cognee ...` as the operator entrypoint and extend it with dataset targeting.

### Commands that must understand dataset selection

- `openclaw cognee status`
- `openclaw cognee index`
- `openclaw cognee search`
- `openclaw cognee cognify`

### Required flags

- `--dataset memory`
- `--dataset library`

### Defaults

- default operator target is `memory`
- `library` moves only when explicitly selected

## 6. Add Dataset-Aware Tool Routing

Status: completed

The original plugin tools assume a single active dataset.

Extend tools so they can work against dataset profiles.

### Tools to extend

- `memory_search`
- `memory_get`
- `memory_store`
- `memory_forget`

### Default behavior

- default tool target is `memory`
- `library` must only be used when explicitly requested

## 7. Add Lightweight Ranking Signals

Status: completed

The original plugin does not provide local retrieval reinforcement / decay.

Add local ranking signals:

- `recallCount`
- `searchHitCount`
- time decay
- `forgetCount`
- adjusted score output

### Requirements

- stats are tracked per dataset
- signals affect retrieval ordering, not stored file content

## 8. Add Deprioritize Workflow

Status: completed

The original plugin supports delete but not weak forgetting.

Add a weak-forgetting path:

- `deprioritize`

### Intended behavior

- do not delete the file
- lower retrieval priority
- keep the memory available for later explicit use if needed

## 9. Add Critical Purge Workflow

Status: completed

The original plugin supports ordinary deletion, but not a heavy “must disappear” path.

Add:

- `purge-critical`

### Intended behavior

- delete the target file
- rebuild the affected dataset from remaining file-backed truth

### Intended usage

Use for:

- wrong rules
- invalid policies
- dangerous misinformation

## 10. Add Diagnostics And Operator Visibility

Status: completed

The original plugin has only basic sync status.

Add richer diagnostics:

- dataset health summary
- indexed file count
- data-ID coverage
- dirty / new file counts
- ranking signal summary
- stats inspection

## 11. Add Cleanup Suggestion Workflow

Status: completed

The original plugin has no maintenance workflow for stale memory.

Add:

- stats inspection
- cleanup suggestions
- optional explicit cleanup apply flow

### Important behavior

- suggestions should be read-only by default
- explicit apply is allowed
- no automatic silent cleanup

## 12. Add Tests For New Features

Status: completed

The original test suite does not cover the new dataset-profile model.

Add tests for:

- dataset profile config parsing
- dataset-specific sync index loading/saving
- workspace map parsing from OpenClaw config
- aggregated `memory` path prefixing
- `library` path discovery
- dataset-targeted CLI behavior
- ranking signal behavior
- deprioritize behavior
- purge-critical behavior

## 13. Split `memory` And `library` Into Distinct Knowledge Models

Status: completed

The current plugin differentiates dataset lifecycle and routing, but still treats both datasets too much like the same text-ingestion surface.

That is too weak for the intended architecture:

- `memory` = internal durable knowledge that should be distilled, corrected, and kept high-signal
- `library` = external reference graph that should preserve document-level provenance and natural cross-domain links

### Required design direction

- do not keep a single shared blob-oriented ingestion model for both datasets
- keep graph-oriented retrieval for both datasets
- avoid forcing cross-domain mixing at search time; let cross-domain links emerge from the indexed structure itself

## 14. Make `memory` A Distilled Durable-Memory Graph

Status: completed

`memory` should optimize for durable internal knowledge, not raw file mirroring alone.

### Intended behavior

- treat raw daily/worklog/scratch notes as transient inputs, not ideal long-term retrieval units
- use compaction outputs as the primary durable retrieval surface for transient material
- preserve handwritten stable notes, policies, and curated memory files as mirror-backed truth
- strengthen correction trails so incorrect memory can be explicitly superseded, not only deprioritized

### Target node shapes

- `decision`
- `procedure`
- `durable_fact`
- `constraint`
- `correction`
- `open_thread`

### Metadata to add or strengthen

- `kind`
- `originAgent`
- `sourcePath`
- `derivedFrom`
- `corrects`
- `topics`
- `createdAt`

### Retrieval direction

- default `memory` retrieval should remain graph-oriented
- prefer compact, high-signal note units over large raw note bodies
- keep result sets small and high density

## 15. Make `library` A Document-Level Reference Graph

Status: completed

`library` should optimize for external reference discovery and document-level provenance, not chunk-first retrieval.

### Intended behavior

- treat the document/article/website/file as the main evidence unit
- preserve natural graph links across external sources
- keep section/chunk structure optional or auxiliary, not the default retrieval surface
- retain strong source provenance for mirror and retained assets

### Target node shapes

- `document`
- optional `section`
- optional `concept`

### Metadata to add or strengthen

- `title`
- `sourceType`
- `originalPath`
- `authors`
- `publisher`
- `domain`
- `topics`
- `summary`
- `importedAt`
- `contentHash`

### Retrieval direction

- default `library` retrieval should remain graph-oriented
- evidence precision only needs to resolve to the document/source level unless later requirements change
- do not degrade `library` into a pure chunk store

## 16. Add Dataset-Specific Ingestion And Search Profiles

Status: completed

The plugin currently exposes global search settings such as `searchType`, `searchPrompt`, and `maxTokens`.

Add dataset-specific profiles so `memory` and `library` can evolve independently.

### New config additions

- `datasets.memory.searchType`
- `datasets.library.searchType`
- `datasets.memory.searchPrompt`
- `datasets.library.searchPrompt`
- `datasets.memory.maxTokens`
- `datasets.library.maxTokens`
- `datasets.memory.ingestMode`
- `datasets.library.ingestMode`

### Intended defaults

- `memory.searchType` should default to graph-oriented retrieval
- `library.searchType` should default to graph-oriented retrieval
- `memory.ingestMode` should prefer distilled durable-note ingestion
- `library.ingestMode` should prefer document-graph ingestion

## 17. Split Dataset Serialization Paths

Status: completed

The current plugin uses a shared serialization pattern when building Cognee payload text.

Add separate dataset serializers instead of a single shared `buildMemoryData()` shape.

### Required behavior

- add a dedicated serializer for `memory`
- add a dedicated serializer for `library`
- preserve stable path/source provenance in both
- allow each dataset serializer to emit different metadata emphasis and structural formatting

### Implementation note

Likely direction:

- `buildMemoryDatasetData(file, metadata)`
- `buildLibraryDatasetData(file, metadata)`

## 18. Add Tests For Dataset-Specific Knowledge Models

Status: completed

Add tests for:

- dataset-specific config parsing for search and ingest profiles
- `memory` serializer output shape
- `library` serializer output shape
- compaction artifacts becoming primary `memory` retrieval units
- document-level provenance preservation in `library`
- `memory` correction-chain metadata handling
- `library` retained/mirror metadata handling

## 19. Add Explicit User-Led Reinforcement Primitives

Status: completed

The plugin previously used simple retrieval counters inside ranking.

Add explicit user-led reinforcement primitives without depending on runtime conversation-turn tracking.

### Landed behavior

- add `memory_reinforce` tool for explicit reinforcement
- add `openclaw cognee reinforce` CLI command
- add `memory_confirm_useful` tool for explicit "this recalled memory was useful" recording
- add `openclaw cognee confirm-useful` CLI command

### Important boundary

- only explicit operator or tool actions can reinforce memory today
- `searchHitCount` and `recallCount` remain telemetry signals
- confirmation-of-usefulness does not auto-reinforce by itself
- no conversation-turn-dependent auto-reinforcement is implemented in the current plugin

## 20. Replace Linear Retrieval Boosting With Unified Decay Controls

Status: completed

The plugin previously used linear boost terms from hit and recall counters.

Replace that with a unified decay / reinforcement model whose constants can be adjusted directly in code.

### Landed parameter set

- `baseHalfLifeDays`
- `minFreshnessMultiplier`
- `reinforcementFreshnessHalfLifeDays`
- `reinforcementFactor`
- `maxHalfLifeMultiplier`
- `forgetPenalty`
- `deprioritizedPenalty`

### Landed behavior

- reinforcement slows forgetting instead of directly stacking score boosts
- reinforcement has a cap
- reinforcement decays in strength when not refreshed
- `memory` and `library` use separate defaults
- operator-visible ranking diagnostics include reinforcement counts

## 21. Add Conservative Low-Signal Input Filtering

Status: completed

The plugin previously accepted low-signal notes too easily.

Add a deliberately narrow filter before durable write/import actions.

### Landed behavior

- reject greeting-like text
- reject texts shorter than 10 tokens
- apply the filter to `memory_store`
- apply the filter to `compact-memory`
- apply the filter to retained `library` import

### Explicit non-goals for the landed version

- do not yet filter generic boilerplate blocks
- do not attempt broad semantic junk detection
- keep filtering narrow until real false-positive/false-negative behavior is observed

## 22. Add Relation-Aware And Compaction-Aware Duplicate Suppression

Status: completed

The plugin previously only had narrow write-time duplicate checking.

Add stricter duplicate suppression while keeping retrieval semantics intact.

### Landed behavior

- keep write-time body-normalized duplicate detection for `memory_store`
- collapse exact-body duplicate search results
- collapse duplicate results from the same compaction family
- suppress highly overlapping relation-linked duplicates conservatively
- expose confirmation / reinforcement counters without automatically changing relation behavior

### Explicit limits of the landed version

- no heavy embedding MMR is used
- no vector-based duplicate suppression is active yet
- relation handling remains conservative to avoid hiding distinct but related memories
