# NebulaGraph KG load optimization - Evidence

No evidence has been recorded yet.

## EvidenceBundleDraft

- Artifact key: baseline-nebula-tests
- Type: test
- Source: ./scripts/test.sh tests/test_nebula_graph_storage.py
- Summary: After fixing a missing env precondition in an existing initialize test, Nebula storage unit baseline passes: 97 passed.
- Verifier: PYTHON=/root/project/LightRAG/.venv/bin/python ./scripts/test.sh tests/test_nebula_graph_storage.py

## EvidenceBundleDraft

- Artifact key: read-path-nebula-tests
- Type: test
- Source: ./scripts/test.sh tests/test_nebula_graph_storage.py
- Summary: After adding graph-load regression tests and read-path optimization, Nebula tests pass: 99 passed.
- Verifier: PYTHON=/root/project/LightRAG/.venv/bin/python ./scripts/test.sh tests/test_nebula_graph_storage.py

## EvidenceBundleDraft

- Artifact key: popular-cache-nebula-tests
- Type: test
- Source: ./scripts/test.sh tests/test_nebula_graph_storage.py
- Summary: Popular-label cache hit, refresh, invalidation, and direct get_all_labels behavior pass with full Nebula target file: 103 passed.
- Verifier: PYTHON=/root/project/LightRAG/.venv/bin/python ./scripts/test.sh tests/test_nebula_graph_storage.py

## EvidenceBundleDraft

- Artifact key: batch-write-nebula-tests
- Type: test
- Source: ./scripts/test.sh tests/test_nebula_graph_storage.py
- Summary: Nebula batch node and edge write overrides plus SQL-shape tests pass with full target file: 107 passed.
- Verifier: PYTHON=/root/project/LightRAG/.venv/bin/python ./scripts/test.sh tests/test_nebula_graph_storage.py

## EvidenceBundleDraft

- Artifact key: final-verification
- Type: verification
- Source: targeted tests, ruff check, docs rg, shared graph test invocation, Aegis bundle/check
- Summary: Final verification: Nebula target tests 107 passed; ruff check passed; docs rg found Nebula optimization guidance; shared graph storage test invocation skipped 8 tests under current non-integration config; proof bundle generated; workspace check still fails only on pre-existing baseline governance and historical unindexed docs.
- Verifier: PYTHON=/root/project/LightRAG/.venv/bin/python ./scripts/test.sh tests/test_nebula_graph_storage.py; /root/project/LightRAG/.venv/bin/python -m ruff check lightrag/kg/nebula_impl.py tests/test_nebula_graph_storage.py; PYTHON=/root/project/LightRAG/.venv/bin/python ./scripts/test.sh tests/kg/test_graph_storage.py; python /root/.codex/aegis/scripts/aegis-workspace.py bundle/check
