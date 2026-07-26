import { defineKnowledgeNavigation, defineKnowledgeSite } from "@amemiyalai/wiki-center";

export const navigation = defineKnowledgeNavigation([
  {
    id: "getting-started",
    title: "開始使用",
    description: "從基礎概念開始建立你的知識庫。",
    icon: "🚀",
    color: "#45d1c8",
    articles: [
      { id: "introduction", moduleId: "getting-started", title: "範例介紹", href: "/knowledge/introduction" },
      { id: "content-model", moduleId: "getting-started", title: "內容模型", href: "/knowledge/content-model" },
    ],
  },
  {
    id: "guides",
    title: "使用指南",
    description: "可替換成你的網站分類與文章。",
    icon: "📚",
    color: "#8fb6ff",
    articles: [
      { id: "customization", moduleId: "guides", title: "網站客製化", href: "/knowledge/customization" },
    ],
  },
]);

export const site = defineKnowledgeSite({
  name: "Knowledge Starter",
  siteUrl: "https://your-domain.com",
  defaultLocale: "zh-tw",
  locales: [{ code: "zh-tw", htmlLang: "zh-TW", ogLocale: "zh_TW", label: "繁中" }],
  navigation,
  defaultSeo: {
    title: "Knowledge Starter",
    description: "以 Astro、wiki-center 與 Cloudflare 建立的可配置知識網站。",
  },
  features: { search: true, tableOfContents: true, relatedArticles: true },
  theme: {
    accent: "#45d1c8",
    contentWidth: "760px",
    sidebarBackground: "rgba(30, 30, 30, 0.72)",
    sidebarBorder: "rgba(255, 255, 255, 0.08)",
    sidebarActiveBackground: "color-mix(in srgb, var(--knowledge-accent) 14%, transparent)",
    tocMutedText: "#69717d",
  },
});
