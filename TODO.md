# TODO

## Long-Term Memory Reinforcement / Decay

Goal: improve long-term memory retrieval quality without taking over OpenClaw ContextEngine responsibilities.

### Constraints

- Only affect memory retrieval ranking and observability.
- Do not implement plugin-owned context assembly, compaction, or prompt orchestration.
- Do not auto-delete memories in the first version.
- Do not rewrite user-authored memory files automatically.

### Minimal V1

- Add a local stats file for memory access signals.
  - Proposed path: `~/.openclaw/memory/cognee/memory-stats.json`
- Track per-memory lightweight signals:
  - `recallCount`
  - `searchHitCount`
  - `lastAccessedAt`
  - `createdAt`
- Update stats when:
  - a memory is selected for auto-recall
  - a memory appears in `memory_search` results
- Apply a small ranking adjustment on top of Cognee score:
  - slightly boost frequently accessed memories
  - slightly decay long-unaccessed memories
  - keep `pinned` higher priority than dynamic ranking

### Explicit Non-Goals For V1

- no automatic deletion / hard forgetting
- no automatic summarization or compaction
- no automatic memory file rewrites
- no usage inference from final model output
- no ContextEngine-style token budgeting

### Nice Follow-Ups

- expose stale / reinforced memory stats in `memory_status` and `cognee status`
- add CLI inspection for top reinforced and most stale memories
- consider a manual cleanup workflow after enough stats accumulate

## OpenClaw Memory Layer Compatibility Note

Current positioning of this plugin should remain:

- primary role: Semantic Memory backend
- secondary role: semantic-memory retrieval quality enhancements
- intended replacement for `memory-core`
- not a replacement for ContextEngine

### Compatible Boundaries

- okay:
  - file-backed long-term memory sync
  - scoped semantic-memory datasets
  - recall gating / cooldown / filtering
  - pinned-memory prioritization
  - memory search / status / store / forget tooling
  - retrieval metadata such as `path`, `scope`, `pinned`, `title`

- avoid:
  - plugin-owned context assembly pipelines
  - session compaction logic
  - episodic/session-summary memory orchestration
  - procedural-memory ownership (skills / system-prompt behavior control)
  - token budgeting / context partitioning rules

### OpenClaw Layer Mapping

- Working / transient memory:
  - owned by OpenClaw ContextEngine and runtime prompt assembly
- Episodic memory:
  - should remain session/transcript oriented, not owned by this plugin
- Semantic memory:
  - this plugin's main responsibility
- Procedural memory:
  - should remain in system prompts / skills, not migrated into Cognee memory

### Integration Risk To Watch

- future changes should prefer semantic-memory enhancements over broader prompt-management features
