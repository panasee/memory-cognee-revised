# memory-cognee-revised

Cognee-backed OpenClaw memory plugin for file-backed `memory` and `library` datasets.

This plugin is a memory manager, not a context engine:

- it syncs markdown files into Cognee datasets
- it exposes dataset-aware memory tools and operator commands
- it does **not** inject memories into prompts
- it does **not** implement context orchestration

This is the intended shape for pairing with `lossless-claw`: `lossless-claw` owns runtime context assembly and session compaction, while this plugin provides external file-backed memory through `memory_search` / `memory_get` / `memory_store` / `memory_forget`.

Academic-friendly defaults are now baked in:

- `library` ranking decays more slowly than `memory`
- `library` cleanup tolerates much older untouched material than `memory`
- `reference-note` sources are treated as retained-library candidates, not normal compaction targets

## Dataset model

The plugin has two fixed dataset profiles:

- `memory`: primary OpenClaw memory dataset
- `library`: explicit external reference dataset

`memory` defaults to auto-indexing. `library` only moves when you target it explicitly unless you opt in.

## Memory dataset layout

`memory` aggregates markdown from:

- main workspace:
  - `MEMORY.md`
  - `memory/**/*.md`
- every configured agent workspace from `~/.openclaw/openclaw.json`:
  - `MEMORY.md`
  - `memory/**/*.md`

Virtual paths are stable:

- `main/MEMORY.md`
- `main/memory/2026-03-11.md`
- `agents/academic-bot/MEMORY.md`
- `agents/academic-bot/memory/notes.md`

For transient raw notes, use `openclaw cognee compact-memory <path>` to create a durable tool-managed memory artifact before deleting the source file.
By default the plugin will try to distill a true long-term summary with OpenClaw's configured primary model; if no runtime model can be resolved it falls back to a preserved-copy artifact and records the fallback reason in the note metadata.
Compaction is source-aware: daily logs, worklogs, and reference notes use different distillation prompts so durable memory stays compact instead of turning into a prettified raw dump.
Default compaction actions now differ by source type:

- `daily-log`: distill, then delete source by default
- `worklog`: distill, keep source by default
- `reference-note`: do not compact; move it to retained `library` with `import-library`
- `general`: distill, keep source by default

## Library dataset layout

`library` supports two source classes:

- mirror sources from explicit `datasets.library.paths`
- retained imports created with `openclaw cognee import-library`

Mirror sources become stable virtual roots under `sources/<name>-<hash>/...`.

Retained imports are copied into plugin-managed storage and exposed under stable virtual paths like `retained/<asset-id>/<name>.md`, so they can remain searchable after the original source file is removed.

Retained library imports now also have capacity governance:

- soft warnings for total retained bytes and asset count
- optional hard import limits for bytes and count
- cleanup suggestions for duplicates, unindexed assets, and old retained assets when over budget

## Configuration

```yaml
plugins:
  entries:
    memory-cognee-revised:
      enabled: true
      config:
        baseUrl: "http://localhost:8000"
        apiKey: "${COGNEE_API_KEY}"
        searchType: "GRAPH_COMPLETION"
        deleteMode: "hard"
        maxResults: 6
        summaryModel: "openai-codex/gpt-5.3-codex"
        summaryProvider: "openai-codex"
        summaryMaxTokens: 900
        retainedAssetWarnBytes: 536870912
        retainedAssetWarnCount: 500
        retainedAssetMaxBytes: 1073741824
        retainedAssetMaxCount: 1000
        datasets:
          memory:
            datasetName: "project-memory"
            autoIndex: true
            autoCognify: true
            autoRecall: true
          library:
            datasetName: "project-library"
            paths:
              - "./library"
              - "/srv/reference"
            autoIndex: false
            autoCognify: false
            autoRecall: false
```

`autoRecall` is accepted as dataset metadata for compatibility, but this plugin still does not inject prompt context.

## CLI

```bash
openclaw cognee index --dataset memory
openclaw cognee index --dataset library
openclaw cognee import-library ./reference/guide.md
openclaw cognee assets-audit
openclaw cognee retained-suggest
openclaw cognee retained-rebuild asset_1234567890abcdef
openclaw cognee retained-delete asset_1234567890abcdef
openclaw cognee compact-suggest
openclaw cognee compact-apply --limit 5 --delete-source
openclaw cognee compact-memory main/memory/daily/2026-03-11.md --delete-source
openclaw cognee compaction-audit
openclaw cognee compaction-rebuild compact_1234567890abcdef
openclaw cognee compaction-delete compact_1234567890abcdef
openclaw cognee status --dataset memory
openclaw cognee search "retry policy" --dataset library
openclaw cognee stats --dataset memory
openclaw cognee deprioritize main/memory/old-note.md
openclaw cognee purge-critical main/memory/bad-rule.md
openclaw cognee cleanup-suggest --dataset memory
openclaw cognee cleanup-apply --dataset memory
```

## Tools

The plugin registers dataset-aware versions of:

- `memory_search`
- `memory_status`
- `memory_get`
- `memory_store`
- `memory_forget`

All default to `dataset=memory`. `library` must be selected explicitly.

Legacy compatibility that is still preserved:

- `memory_search` still accepts `scope`, but ignores it.
- `memory_store` still accepts `title` and `pinned`; `scope` is accepted but ignored.
- `memory_store` on the `memory` dataset writes a tool-managed markdown note with frontmatter metadata.
- `memory_get` and `memory_forget` accept both new virtual paths like `main/memory/note.md` and older main-workspace relative paths like `memory/note.md` or `MEMORY.md`.
- compacted replacement notes expose `lifecycle=compacted` plus summary metadata when retrieved through `memory_search` / `memory_get`.

`memory_forget` supports:

- `delete` for tool-managed notes only
- `deprioritize`
- `purge-critical`

## Compatibility config

Preferred configuration uses `datasets.memory` and `datasets.library`.

For backward compatibility, these top-level fields are still accepted and mapped onto the `memory` dataset profile:

- `datasetName`
- `autoIndex`
- `autoCognify`
- `autoRecall`
- `pinnedPaths`
- `pinnedMaxResults`
- `memoryStoreMaxChars`
- `summaryModel`
- `summaryProvider`
- `summaryMaxTokens`
- `retainedAssetWarnBytes`
- `retainedAssetWarnCount`
- `retainedAssetMaxBytes`
- `retainedAssetMaxCount`

`autoRecall` remains metadata only. This plugin still does not inject prompt context.

## State files

- `~/.openclaw/memory/cognee/datasets.json`
- `~/.openclaw/memory/cognee/sync-indexes/memory.json`
- `~/.openclaw/memory/cognee/sync-indexes/library.json`
- `~/.openclaw/memory/cognee/ranking/memory.json`
- `~/.openclaw/memory/cognee/ranking/library.json`
- `~/.openclaw/memory/cognee/assets/library/manifest.json`
- `~/.openclaw/memory/cognee/compaction/manifest.json`

Legacy `sync-index.json` is read as a fallback for the `memory` dataset.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```
