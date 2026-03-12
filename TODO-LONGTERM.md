# TODO-LONGTERM

This file tracks future candidates that are intentionally out of current delivery scope.

## `memory` relation expansion candidates

- evaluate whether `memory` needs relation fields beyond `derivedFrom`, `corrects`, `correctionOf`, `supersedes`, and `supersededBy`
- keep any future `supersededBy` downranking changes internal and centralized, not user-configurable by default
- if new correction-chain metadata is added later, extend retrieval-layer tests for `memory_search` / `memory_get` at the same time

## `library` semantic enrichment candidates

- consider richer `concept` / `reference` structure only if it can remain weakly typed and avoid academic-document assumptions
- consider optional `section` / `concept` helper layers only if they preserve the document-level graph as the primary model

## Cold-memory behavior candidates

- defer any "cold memory fuzzing" work until current ranking and recall behavior has been observed in real use for a while
- if explored later, keep cold-memory fuzzing in retrieval/display behavior first; do not rewrite source files or auto-replace durable memory content by default
- treat deep-forgotten memories as candidates for lower-detail recall surfaces, not autonomous lifecycle upgrades, compaction, or content mutation

## Ranking refinement candidates after observation

- consider very mild length normalization for especially long retained `library` documents only after current duplicate suppression and reinforcement behavior have been observed
- consider a two-stage threshold model later: broad initial candidate acceptance, then stricter post-ranking cutoff after relation/duplicate handling
- consider replacing abstract memory `weight` concepts with explicit auditable states such as `confirmed_useful`, `corrected`, `deprioritized`, and `pinned` if stronger human-guided reinforcement is still needed later

## User-led reinforcement completion candidates

- complete the intended user-led reinforcement flow only after reliable conversation-turn history is available inside this plugin or via a stable host API
- intended full condition remains:
  - a memory was recalled
  - that recalled memory was adopted / confirmed useful
  - the user refers to that memory again within the next 3 conversation turns
  - only then should an automatic reinforcement increment be recorded
- keep the current landed layer as a partial compatibility scaffold:
  - `memory_confirm_useful` records explicit usefulness confirmation
  - `memory_reinforce` performs explicit manual reinforcement
  - neither of these currently inspects turn windows
  - neither of these should silently auto-chain into the 3-turn rule without a real turn-history source
- when turn-history support exists later, prefer adding a small pending-confirmation state machine instead of rewriting ranking logic:
  - open a short-lived "candidate reinforcement window" after recall + confirmed-useful
  - bind that window to the exact memory path / virtual path
  - expire it after 3 user turns or session end
  - only convert it into reinforcement if the later user mention resolves back to the same memory candidate
- keep the completed implementation boundary:
  - search hits and recalls remain telemetry only
  - useful-confirmation remains auditable state
  - reinforcement remains explicit unless the full 3-turn confirmation path becomes implementable
