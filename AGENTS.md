## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Testing & Coverage

- Run tests: `npm run test:unit`
- Run with coverage: `npm run test:unit:coverage`
- Coverage thresholds are in `vitest.config.ts` (currently 60%).
- Coverage stats are tracked in `COVERAGE.md` — update after adding new tests.
- CI enforces coverage via `check:all` (includes `vitest run --coverage`).

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## Directory Guidelines

- **禁止在頂層目錄生成檔案與創建非必要文件**。
- 臨時憑證、測試或敏感金鑰（例如 `client_secret.json`）一律放入 `scripts/credentials/` 下，並確保列在 `.gitignore` 中。
- 設計說明、計畫書或非代碼文件（例如 `plan.md`）一律放入 `scripts/docs/` 目錄中。
- 所有本機日誌或調試檔案必須命名為 `*.log` 或包含在 `dev_*.log` 中，並已被 `.gitignore` 排除。
