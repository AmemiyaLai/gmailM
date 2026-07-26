import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const knowledge = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/knowledge" }),
  schema: z.object({
    contentId: z.string().min(1),
    slug: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    locale: z.enum(["zh-tw", "zh-cn", "en", "ja"]),
    moduleId: z.string().min(1),
    order: z.number().int().nonnegative(),
    published: z.boolean().default(true),
    relatedIds: z.array(z.string()).default([]),
    contentVersion: z.number().int().positive().default(1),
  }),
});

export const collections = { knowledge };
