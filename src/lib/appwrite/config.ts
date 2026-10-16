import { Client, Databases } from 'appwrite'

export const appwriteConfig = {
  projectId: import.meta.env.VITE_APPWRITE_PROJECT_ID,
  url: import.meta.env.VITE_APPWRITE_URL,
  databaseId: import.meta.env.VITE_APPWRITE_DATABASE_ID,
  lyricsId: import.meta.env.VITE_APPWRITE_LYRICS_COLLECTION_ID,
  songInfoId: import.meta.env.VITE_APPWRITE_SONG_INFO_COLLECTION_ID,
}

const client = new Client()

client.setProject(appwriteConfig.projectId)
client.setEndpoint(appwriteConfig.url)

export const databases = new Databases(client)
