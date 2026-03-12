# Agent Operations

This file defines operational memory behavior for agents working in this repository.

Use [GUIDE.md](/home/dongkai-claw/workspace/memory-cognee-revised/GUIDE.md) for architecture and decision rules.
Use this file for concrete operating behavior.

## Memory Operations

### On session start

1. Call vestige `session_context` with `token_budget: 800`.
2. Call cognee recall only if the topic is identifiable.
3. If cognee recall is needed, prefer `memory maxResults: 4` and `library maxResults: 2`.
4. Do not call both vestige `search` and vestige `session_context` at the same session start.

### On content update (not new entry)

After editing an existing memory file, manually trigger `cognify` on the `memory` dataset.

Reason:
- `autoCognify` dispatches on newly added entries.
- Editing an existing memory file does not automatically dispatch `cognify`.

### On error discovery

Follow the Correction Protocol in [GUIDE.md](/home/dongkai-claw/workspace/memory-cognee-revised/GUIDE.md).
When the correction target is known, prefer storing a correction note with explicit correction-chain frontmatter instead of prose-only correction text.

### On backend diagnostics

When checking Cognee/Qdrant/Neo4j backend behavior:
- prefer strict remote search (`strictRemote: true` or CLI `--strict-remote`)
- enable debug output only for that diagnostic step (`debug: true` or CLI `--debug-search`)
- do not include backend debug telemetry in normal retrieval output, prompt context, or stored memory

### High-risk agent sessions

If an agent session is configured with `memory: null` or otherwise disables the memory plugin slot:
- memory system is disabled
- do not attempt any cognee operations
- do not attempt any vestige operations

### Do not duplicate

Never write the same content to both vestige and the cognee `memory` dataset.

- vestige = abstract reusable takeaway
- cognee = source file and auditable artifact
