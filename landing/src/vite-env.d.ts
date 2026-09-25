/// <reference types="vite/client" />

declare module 'virtual:changelog' {
  interface ChangelogRelease {
    version: string
    titles: string[]
  }
  const releases: ChangelogRelease[]
  export default releases
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_PORTAL_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
