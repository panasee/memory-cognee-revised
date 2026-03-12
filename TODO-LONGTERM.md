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
