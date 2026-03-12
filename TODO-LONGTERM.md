# TODO-LONGTERM

This file tracks future candidates that are intentionally out of current delivery scope.

## `memory` relation expansion candidates

- evaluate whether `memory` needs relation fields beyond `derivedFrom`, `corrects`, `correctionOf`, `supersedes`, and `supersededBy`
- keep any future `supersededBy` downranking changes internal and centralized, not user-configurable by default

## `library` semantic enrichment candidates

- consider richer `concept` / `reference` structure only if it can remain weakly typed and avoid academic-document assumptions
- consider optional `section` / `concept` helper layers only if they preserve the document-level graph as the primary model
