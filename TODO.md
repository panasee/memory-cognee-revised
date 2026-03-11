# TODO

This TODO describes the incremental features that must be added on top of the original `memory-cognee-revised` plugin baseline.

Use the original plugin as the baseline and implement only the additional capabilities listed here.

## 1. Add Fixed Dataset Profiles

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

The original plugin uses a single sync index.

Add per-dataset-profile sync indexes:

- `~/.openclaw/memory/cognee/sync-indexes/memory.json`
- `~/.openclaw/memory/cognee/sync-indexes/library.json`

### Requirements

- `memory` sync state must be independent from `library`
- keep legacy fallback only if needed for transition

## 3. Add Multi-Workspace Aggregation For `memory`

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

The original plugin does not distinguish external reference material.

Add `library` dataset scanning for explicit configured paths only.

### Requirements

- every configured path supports:
  - `*.md`
  - `**/*.md`
- `library` is never auto-scanned unless the `library` dataset is explicitly targeted

## 5. Add Dataset-Aware CLI Routing

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

The original plugin supports delete but not weak forgetting.

Add a weak-forgetting path:

- `deprioritize`

### Intended behavior

- do not delete the file
- lower retrieval priority
- keep the memory available for later explicit use if needed

## 9. Add Critical Purge Workflow

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

The original plugin has only basic sync status.

Add richer diagnostics:

- dataset health summary
- indexed file count
- data-ID coverage
- dirty / new file counts
- ranking signal summary
- stats inspection

## 11. Add Cleanup Suggestion Workflow

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
