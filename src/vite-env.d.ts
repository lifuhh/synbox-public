/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_APPWRITE_DATABASE_ID: string
  readonly VITE_APPWRITE_LYRICS_COLLECTION_ID: string
  readonly VITE_APPWRITE_PROJECT_ID: string
  readonly VITE_APPWRITE_SONG_INFO_COLLECTION_ID: string
  readonly VITE_APPWRITE_URL: string
  readonly VITE_GOOGLE_API_KEY: string
  // Local runs without one leave Sentry disabled
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SYNBOX_BE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
