# Context Protocol SoT

## Bootstrap artifacts

For every session Wharness creates:

1. a ZIP snapshot of eligible project files for local audit/reproducibility;
2. a manifest with paths, sizes, hashes, exclusions, and truncation metadata;
3. a safe textual context export used by the V1 planner adapter.

## Why the AI adapter uses a text export

ZIP is the canonical local snapshot, but model file-input support does not imply arbitrary archive extraction. Therefore V1 uploads a text context export by default while retaining the ZIP locally. A future provider may support archive-aware ingestion.

## Exclusions

Credentials, VCS internals, dependencies, generated output, database dumps, private keys, local harness state, and configured ignore paths are excluded.

## Secret detection

Known secret paths are skipped. Text files containing private-key markers or obvious credential assignments are excluded and recorded in the manifest.
