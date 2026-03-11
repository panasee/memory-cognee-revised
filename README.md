# @cognee/cognee-openclaw

Cognee-backed OpenClaw memory plugin for file-backed `memory` and `library` datasets.

This plugin is a memory manager, not a context engine:

- it syncs markdown files into Cognee datasets
- it exposes dataset-aware memory tools and operator commands
- it does **not** inject memories into prompts
- it does **not** implement context orchestration

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

## Library dataset layout

`library` scans only explicit `datasets.library.paths`.

Each configured file or directory becomes a stable virtual source root under `sources/<name>-<hash>/...`.

## Configuration

```yaml
plugins:
  entries:
    cognee-openclaw:
      enabled: true
      config:
        baseUrl: "http://localhost:8000"
        apiKey: "${COGNEE_API_KEY}"
        searchType: "GRAPH_COMPLETION"
        deleteMode: "hard"
        maxResults: 6
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
- `memory_get`
- `memory_store`
- `memory_forget`

All default to `dataset=memory`. `library` must be selected explicitly.

`memory_forget` supports:

- `delete`
- `deprioritize`
- `purge-critical`

## State files

- `~/.openclaw/memory/cognee/datasets.json`
- `~/.openclaw/memory/cognee/sync-indexes/memory.json`
- `~/.openclaw/memory/cognee/sync-indexes/library.json`
- `~/.openclaw/memory/cognee/ranking/memory.json`
- `~/.openclaw/memory/cognee/ranking/library.json`

Legacy `sync-index.json` is read as a fallback for the `memory` dataset.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```
