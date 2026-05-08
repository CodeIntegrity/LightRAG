/// <reference types="vite/client" />

interface ImportMetaEnv {
  /* ───────────── dev-server proxy ───────────── */

  /** When `true`, `bun run dev` proxies the listed endpoints to the backend. */
  readonly VITE_API_PROXY: string
  /** Comma-separated list of paths the dev server forwards to the backend. */
  readonly VITE_API_ENDPOINTS: string
  /** Backend origin the dev server forwards to (e.g. `http://localhost:9621`). */
  readonly VITE_BACKEND_URL: string

  /* ───────────── dev-time multi-site simulation ─────────────
   *
   * Optional. Lets `bun run dev` mimic a reverse-proxied deployment so the
   * SPA can be exercised under the same path prefix it will see in
   * production — without a rebuild. Both values are read by `vite.config.ts`
   * and injected into `index.html` as `window.__LIGHTRAG_CONFIG__`, mirroring
   * what the FastAPI server does at request time in production.
   *
   * Empty / unset → no prefix; the dev server behaves the same as today.
   *
   * See `lightrag_webui/env.development.smaple` and
   * `docs/MultiSiteDeployment.md` for end-to-end examples.
   */

  /** Browser-visible API prefix to simulate in dev. Must match the backend's
   *  `LIGHTRAG_API_PREFIX` if a real prefixed backend is being proxied to. */
  readonly VITE_DEV_API_PREFIX?: string

  /** Browser-visible WebUI mount path to simulate in dev. Must equal
   *  `LIGHTRAG_API_PREFIX + LIGHTRAG_WEBUI_PATH + "/"` to match the path the
   *  reverse proxy will expose in production. */
  readonly VITE_DEV_WEBUI_PREFIX?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
