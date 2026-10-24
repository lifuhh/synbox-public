import { Client, TablesDB } from 'appwrite'

export const appwriteConfig = {
  databaseId: import.meta.env.VITE_APPWRITE_DATABASE_ID,
  projectId: import.meta.env.VITE_APPWRITE_PROJECT_ID,
  songInfoId: import.meta.env.VITE_APPWRITE_SONG_INFO_COLLECTION_ID,
  url: import.meta.env.VITE_APPWRITE_URL,
}

const client = new Client()

client.setProject(appwriteConfig.projectId)
client.setEndpoint(appwriteConfig.url)

export const tables = new TablesDB(client)
