import asyncio
import os
from lightrag import LightRAG
from lightrag.llm.openai import gpt_4o_mini_complete

#########
# Uncomment the below two lines if running in a jupyter notebook to handle the async nature of rag.insert()
# import nest_asyncio
# nest_asyncio.apply()
#########

WORKING_DIR = "./custom_kg"

if not os.path.exists(WORKING_DIR):
    os.mkdir(WORKING_DIR)


custom_kg = {
    "entities": [
        {
            "entity_name": "CompanyA",
            "name": "Company A, Inc.",
            "entity_type": "Organization",
            "description": "A major technology company",
            "source_id": "Source1",
            "ticker": "CMPA",
        },
        {
            "entity_name": "ProductX",
            "entity_type": "Product",
            "description": "A popular product developed by CompanyA",
            "source_id": "Source1",
            "custom_properties": {"release_year": 2024},
        },
        {
            "entity_name": "PersonA",
            "entity_type": "Person",
            "description": "A renowned researcher in AI",
            "source_id": "Source2",
            "custom_properties": {"country": "US"},
        },
        {
            "entity_name": "UniversityB",
            "entity_type": "Organization",
            "description": "A leading university specializing in technology and sciences",
            "source_id": "Source2",
        },
        {
            "entity_name": "CityC",
            "entity_type": "Location",
            "description": "A large metropolitan city known for its culture and economy",
            "source_id": "Source3",
        },
        {
            "entity_name": "EventY",
            "entity_type": "Event",
            "description": "An annual technology conference held in CityC",
            "source_id": "Source3",
        },
    ],
    "relationships": [
        {
            "src_id": "CompanyA",
            "tgt_id": "ProductX",
            "description": "CompanyA develops ProductX",
            "keywords": "develop, produce",
            "weight": 1.0,
            "source_id": "Source1",
            "confidence": 0.97,
        },
        {
            "src_id": "PersonA",
            "tgt_id": "UniversityB",
            "description": "PersonA works at UniversityB",
            "keywords": "employment, affiliation",
            "weight": 0.9,
            "source_id": "Source2",
            "custom_properties": {"evidence_type": "manual"},
        },
        {
            "src_id": "CityC",
            "tgt_id": "EventY",
            "description": "EventY is hosted in CityC",
            "keywords": "host, location",
            "weight": 0.8,
            "source_id": "Source3",
        },
    ],
    "chunks": [
        {
            "content": "ProductX, developed by CompanyA, has revolutionized the market with its cutting-edge features.",
            "source_id": "Source1",
            "chunk_order_index": 0,
        },
        {
            "content": "One outstanding feature of ProductX is its advanced AI capabilities.",
            "source_id": "Source1",
            "chunk_order_index": 1,
        },
        {
            "content": "PersonA is a prominent researcher at UniversityB, focusing on artificial intelligence and machine learning.",
            "source_id": "Source2",
            "chunk_order_index": 0,
        },
        {
            "content": "EventY, held in CityC, attracts technology enthusiasts and companies from around the globe.",
            "source_id": "Source3",
            "chunk_order_index": 0,
        },
    ],
}


async def main() -> None:
    rag = LightRAG(
        working_dir=WORKING_DIR,
        llm_model_func=gpt_4o_mini_complete,
    )
    await rag.initialize_storages()
    try:
        # Pass an explicit full_doc_id so the imported KG is visible in the
        # WebUI document list and can be cleanly removed via adelete_by_doc_id.
        result = await rag.ainsert_custom_kg(
            custom_kg,
            full_doc_id="doc-custom-kg-example",
        )
        # ainsert_custom_kg() returns a summary dict. Useful fields:
        #   full_doc_id        — required to call adelete_by_doc_id later
        #   track_id           — correlates with doc_status entries / WebUI
        #   chunk_count        — number of chunks actually written
        #   entity_count       — declared + placeholder nodes
        #   relationship_count — number of edges written
        print("Custom KG import summary:")
        print(f"  full_doc_id        = {result['full_doc_id']}")
        print(f"  track_id           = {result['track_id']}")
        print(f"  chunk_count        = {result['chunk_count']}")
        print(f"  entity_count       = {result['entity_count']}")
        print(f"  relationship_count = {result['relationship_count']}")
    finally:
        await rag.finalize_storages()


if __name__ == "__main__":
    asyncio.run(main())
