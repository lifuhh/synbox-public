/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />

declare const __BUILD_ID__: string

interface ImportMetaEnv {
  readonly VITE_APPWRITE_DATABASE_ID: string
  readonly VITE_APPWRITE_PROJECT_ID: string
  readonly VITE_APPWRITE_SONG_INFO_COLLECTION_ID: string
  readonly VITE_APPWRITE_URL: string
  // Local runs without one leave Sentry disabled
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SYNBOX_BE_URL: string
  // The auth Worker, which serves lyrics and karaoke timing; unset sends them to this origin (Vite's dev proxy)
  readonly VITE_SYNBOX_API_URL?: string
  // The backend's lookup service; unset sends its reads to VITE_SYNBOX_BE_URL
  readonly VITE_SYNBOX_LOOKUP_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
