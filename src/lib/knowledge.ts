import { getCollection, type CollectionEntry } from "astro:content";

export type KnowledgeEntry = CollectionEntry<"knowledge">;

export async function getPublishedKnowledge() {
  return getCollection("knowledge", ({ data }) => data.published && data.locale === "zh-tw");
}

export function sortKnowledge(entries: KnowledgeEntry[]) {
  return [...entries].sort((a, b) => a.data.order - b.data.order);
}
