# Long-Term Memory Lifecycle Plan

**Status:** Proposed on 2026-03-11

**Problem statement**

The current plugin treats local markdown files as the durable source of truth for both `memory` and `library`.

That is too weak for two important long-term memory cases:

1. short-lived raw notes such as daily markdown files
2. very large external reference material that should not remain pinned to local disk forever

Under the current design:

- if a file disappears locally, the next sync deletes its Cognee record
- `library` only exists while `datasets.library.paths` remain locally readable

This is acceptable for file-mirror workflows, but not for durable long-term memory.

## Goals

- Preserve durable memory after local source cleanup when that cleanup is intentional.
- Allow `library` material to be imported and retained without requiring the original file to remain on disk.
- Keep the plugin a memory manager, not a context engine.
- Keep existing file-mirror behavior for users who want the current model.
- Make lifecycle differences explicit instead of hiding them behind deletion side effects.

## Non-goals

- Reintroducing automatic prompt injection.
- Replacing `lossless-claw` conversation compaction.
- Turning Cognee into the only source of truth for all memory content.

## Current Failure Modes

### Daily memory compaction

Raw daily files are often transient. Users may want:

- write daily notes
- extract durable facts / decisions
- delete or compact raw daily files later

Current behavior does not support this. Deleting the raw file eventually deletes its indexed memory as well.

### Large library retention

External reference material may be:

- huge
- imported from temporary locations
- staged for indexing only

Current `library` behavior is still "file mirror". If the source path is removed, the next sync drops the memory.

## Proposed Lifecycle Model

Each memory asset should belong to one lifecycle class.

### 1. `mirror`

Definition:
- local file remains the source of truth
- delete file -> remove indexed memory on next sync

Best for:
- handwritten stable memory files
- policy notes
- curated markdown that should remain editable on disk

Applies by default to:
- current `memory` files
- current file-backed `library` paths

### 2. `compactable`

Definition:
- raw file is not itself the durable memory
- before cleanup, plugin materializes a durable replacement memory artifact
- raw file can then be removed without losing the durable summary/decision memory

Best for:
- daily notes
- work logs
- scratch memory
- transient session notes that later become stable distilled knowledge

Key rule:
- raw file deletion must not happen until compaction emits a replacement durable memory artifact

### 3. `retained`

Definition:
- imported content is copied into plugin-managed durable storage
- original source file becomes optional after import
- retained asset remains searchable and retrievable even if original path disappears

Best for:
- external reference documents
- large imported manuals
- temporary export files
- staged research material

Key rule:
- retained assets are plugin-owned memory artifacts, not live mirrors of the original source path

## Proposed Dataset Semantics

### `memory`

`memory` should support both:

- `mirror` files
- `compactable` files

Recommended default interpretation:

- `MEMORY.md` and curated notes remain `mirror`
- daily / transient notes can opt into `compactable`

### `library`

`library` should support both:

- `mirror` sources
- `retained` imports

Recommended default interpretation:

- existing `datasets.library.paths` remain `mirror`
- add a new explicit import workflow for `retained` assets

## New Persistent State

### Retained asset manifest

Add a new durable manifest area, for example:

```text
~/.openclaw/memory/cognee/assets/
  library/
    manifest.json
    blobs/
      <asset-id>.md
```

Each retained asset entry should store:

- `assetId`
- `datasetKey`
- `kind` (`retained`)
- `title`
- `originalPath` if known
- `importedAt`
- `contentHash`
- `storagePath`
- `virtualPath`
- `dataId`
- optional tags / metadata

### Compaction artifact manifest

Add a compacted-memory registry, for example:

```text
~/.openclaw/memory/cognee/compaction/
  manifest.json
```

Each entry should store:

- `artifactId`
- `sourcePath`
- `sourceHash`
- `createdAt`
- `replacementPath`
- `replacementKind` (`summary`, `distilled-memory`, etc.)
- optional status (`pending`, `ready`, `applied`)

This registry prevents accidental loss during cleanup and makes compaction auditable.

## Proposed Operations

### A. Compactable memory flow

Add an explicit workflow such as:

1. select a raw memory file
2. generate a durable distilled memory note
3. store that distilled note as a tool-managed durable artifact in `memory`
4. record the source -> artifact relation
5. only then allow raw source cleanup

Candidate operator commands:

- `openclaw cognee compact-memory <path>`
- `openclaw cognee compact-memory --suggest`

Candidate tool workflow:

- separate from `memory_forget`
- do not overload ordinary deletion

Important:
- the durable artifact should be written as plugin-managed memory, not only left inside Cognee without a local durable representation

### B. Retained library import flow

Add an explicit import path such as:

- `openclaw cognee import-library <path>`

Behavior:

1. resolve local file
2. copy content into plugin-managed durable storage
3. assign stable retained virtual path, e.g. `retained/<asset-id>/<name>.md`
4. index into `library`
5. persist retained manifest entry
6. allow original file to disappear later without deleting retained memory

Optional future variants:

- directory import
- URL import
- chunked non-markdown import

## Search And Retrieval Rules

Search should become lifecycle-aware.

### Search

- `mirror` assets: search current local file content plus Cognee results
- `compactable` artifacts: search the durable replacement artifact, not deleted raw files
- `retained` assets: search plugin-managed stored content even when the original file is gone

### Get

`memory_get` / `memory_search` should expose lifecycle metadata in details:

- `lifecycle: mirror | compactable | retained`
- `originPath`
- `managed: true | false`

This lets agents and operators understand whether a hit depends on a live local file.

## Deletion Rules

Deletion should depend on lifecycle.

### `mirror`

- current behavior stays: file deletion means memory deletion on sync

### `compactable`

- raw file deletion should be denied unless a replacement artifact exists
- cleanup should prefer a dedicated compact/apply workflow

### `retained`

- deleting the original source path does nothing after import
- deleting retained memory must target the retained asset itself

## Migration Strategy

### Phase 1: add lifecycle metadata without changing defaults

- keep all current files as `mirror`
- introduce retained manifests and compactable registries
- no breaking change to existing sync behavior

### Phase 2: add explicit retained import for `library`

- support `retained` library assets
- keep `datasets.library.paths` mirror-based for backward compatibility

### Phase 3: add compactable memory flow

- add distillation workflow for daily notes
- only then allow safe cleanup of transient raw memory

### Phase 4: optional policy defaults

Potential later additions:

- path-based lifecycle rules
- naming-based defaults for daily notes
- cleanup suggestions that understand lifecycle class

## Recommended Minimal Implementation Order

### First

Implement retained `library` imports.

Reason:
- it solves the cleanest structural bug first
- it does not require changing ordinary memory deletion semantics
- it creates the first plugin-owned durable storage path

### Second

Implement compactable `memory` distillation.

Reason:
- it requires a stronger UX and safety model
- it should not be rushed into `memory_forget`

## Open Questions

1. Should retained library assets store full raw content locally, or only a normalized markdown extraction?
2. Should compacted memory artifacts be generated via Cognee search/summary, direct LLM summarization, or deterministic local condensation first?
3. Should lifecycle be configured per path pattern, per command, or both?
4. Should retained assets be editable after import, or treated as immutable snapshots?
5. Do we want a distinct tool for durable import, or extend `memory_store` / `library` writes with lifecycle flags?

## Practical Direction

For the current repository, the recommended path is:

- keep `lossless-claw` responsible for conversation context
- keep this plugin responsible for durable external memory
- extend this plugin with lifecycle-aware persistence so long-term memory does not disappear merely because raw source files are cleaned up
