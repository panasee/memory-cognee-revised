# Compatibility Gaps

This file tracks behavior that existed in the pre-dataset plugin but is still missing or intentionally changed in the current `memory-cognee-revised` implementation.

It is meant to support later merge work and compatibility follow-up.

## Restored Compatibility

These older behaviors have already been restored and should not be treated as current gaps:

- `memory_status` tool is registered again.
- `memory_store` again accepts legacy `title` and `pinned`, enforces `memoryStoreMaxChars`, performs duplicate detection, and writes tool-managed notes with frontmatter.
- `memory_get` and `memory_forget` again accept old main-workspace relative paths like `MEMORY.md` and `memory/foo.md`.
- `memory_forget` default `delete` behavior is again limited to tool-managed notes.
- Legacy top-level config fields `datasetName`, `autoIndex`, `autoCognify`, `autoRecall`, `pinnedPaths`, `pinnedMaxResults`, and `memoryStoreMaxChars` are accepted again.

## Remaining Gaps

### 1. Legacy Scope Semantics Are Not Preserved

Status: open

Old plugin behavior:
- `memory_search` could target scope-aware recall.
- `memory_store` could write into a resolved scope.

Current behavior:
- `memory_search.scope` is accepted but ignored.
- `memory_store.scope` is accepted but ignored.
- The plugin now routes by fixed datasets (`memory` / `library`) instead of legacy scopes.

Current references:
- [index.ts](/home/dongkai-claw/workspace/memory-cognee-revised/index.ts#L1689)
- [index.ts](/home/dongkai-claw/workspace/memory-cognee-revised/index.ts#L1735)
- [index.ts](/home/dongkai-claw/workspace/memory-cognee-revised/index.ts#L1834)
- [README.md](/home/dongkai-claw/workspace/memory-cognee-revised/README.md#L107)

Impact:
- Older agents or scripts that relied on scope-specific memory selection no longer get equivalent behavior.

### 2. Legacy Scope CLI Surface Is Missing

Status: open

Old plugin behavior:
- `openclaw cognee index --scope <name>`
- `openclaw cognee scope list`

Current behavior:
- CLI only exposes dataset-oriented commands with `--dataset`.
- There is no `scope` subcommand.

Current references:
- [index.ts](/home/dongkai-claw/workspace/memory-cognee-revised/index.ts#L1934)

Impact:
- Existing shell scripts or docs that use scope-oriented commands will break.

### 3. Legacy Scope/Recall Config Surface Is Missing From Manifest

Status: open

Old plugin config included fields such as:
- `scopes`
- `defaultRecallScopes`
- `recallMinPromptChars`
- `recallCooldownTurns`
- `filterLowSignalResults`
- `resultMinTextChars`

Current behavior:
- These fields are not exposed in [openclaw.plugin.json](/home/dongkai-claw/workspace/memory-cognee-revised/openclaw.plugin.json#L1).
- The current manifest only documents dataset-oriented config plus a limited set of restored legacy top-level fields.

Impact:
- Old config files using these keys are no longer represented by the current plugin schema/UI contract.
- Even where behavior is intentionally retired, the compatibility state is not surfaced explicitly in schema form.

### 4. `autoRecall` Runtime Injection Was Removed

Status: intentional change, not currently planned for restoration

Old plugin behavior:
- `autoRecall` searched Cognee during `before_agent_start` and prepended `<cognee_memories>` into runtime context.

Current behavior:
- `autoRecall` is accepted as compatibility metadata only.
- The plugin does not inject runtime prompt context.

Current references:
- [openclaw.plugin.json](/home/dongkai-claw/workspace/memory-cognee-revised/openclaw.plugin.json#L38)
- [README.md](/home/dongkai-claw/workspace/memory-cognee-revised/README.md#L76)

Reason for current status:
- This plugin is being positioned as a memory manager, not a context engine.
- When paired with `lossless-claw`, runtime context assembly should remain in the context engine, while this plugin provides external memory tools such as `memory_search`.

Impact:
- Workflows depending on automatic prompt injection will not behave like the old plugin.
- Tool-based recall remains available; automatic recall injection does not.

## Notes For Future Merge Work

- Do not treat every gap above as a bug of equal priority.
- `scope` compatibility is the main unresolved old-surface regression.
- `autoRecall` is a deliberate architectural change unless OpenClaw later introduces a context-engine-to-memory recall contract that requires a different integration model.
