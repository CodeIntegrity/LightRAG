"""Filter-first 压测：直连 Nebula 存储，对比全量扫描 vs bounded 路径耗时。只读。"""
import asyncio
import os
import time

from dotenv import load_dotenv

load_dotenv(".env")

from lightrag.kg.nebula_impl import NebulaGraphStorage
from lightrag.api.graph_workbench import query_graph_workbench, FILTER_FIRST_SCAN_LIMIT


def _timed(label):
    class _T:
        def __enter__(self):
            self.t = time.perf_counter()
            return self
        def __exit__(self, *a):
            self.ms = (time.perf_counter() - self.t) * 1000
            print(f"  {label}: {self.ms:.0f} ms")
    return _T()


async def main():
    workspace = os.environ.get("WORKSPACE", "test")
    max_nodes = int(os.environ.get("MAX_GRAPH_NODES", "1000"))
    storage = NebulaGraphStorage(
        namespace="chunk_entity_relation",
        global_config={"max_graph_nodes": max_nodes, "working_dir": "."},
        embedding_func=None,
        workspace=workspace,
    )
    await storage._bootstrap_session_pool()  # 只读：不建 space/schema
    print(f"space=lightrag__{workspace}  max_graph_nodes={max_nodes}  scan_limit={FILTER_FIRST_SCAN_LIMIT}\n")

    try:
        with _timed("get_all_nodes") as t:
            nodes = await storage.get_all_nodes()
        node_count = len(nodes)
        with _timed("get_all_edges") as t:
            edges = await storage.get_all_edges()
        edge_count = len(edges)
        print(f"  -> nodes={node_count}  edges={edge_count}\n")

        types = await storage.get_all_entity_types()
        print(f"entity_types ({len(types)}): {types[:20]}\n")
        rare_type = types[-1] if types else "PERSON"

        print("bounded baseline get_knowledge_graph('*'):")
        with _timed("get_knowledge_graph") as t:
            await storage.get_knowledge_graph("*", max_depth=3, max_nodes=max_nodes)

        print(f"\nfilter-first query_graph_workbench(entity_types=[{rare_type!r}]):")
        with _timed("filter_first") as t:
            res = await query_graph_workbench(
                storage,
                {
                    "scope": {"label": "*", "max_depth": 3, "max_nodes": max_nodes},
                    "node_filters": {"entity_types": [rare_type]},
                },
            )
        print(f"  -> execution_mode={res['meta']['execution_mode']}  "
              f"result_nodes={len(res['data']['nodes'])}  result_edges={len(res['data']['edges'])}")
        print(f"\n结论：filter-first {t.ms:.0f}ms vs bounded 基线；扫描节点 {node_count} / 上限 {FILTER_FIRST_SCAN_LIMIT}")
    finally:
        await storage.finalize()


asyncio.run(main())
