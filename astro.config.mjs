// @ts-check
import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";

export default defineConfig({
  site: "https://mail.yourdomain.com",
  output: "server",
  adapter: vercel(),
  server: {
    host: true,
    port: 1008,
  },
  vite: {
    css: {
      transformer: "lightningcss",
    },
  },
});
