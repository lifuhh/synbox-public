import { atom, getDefaultStore } from 'jotai'

// The two account dialogs any button can open, mounted once in the root layout (account-dialogs.tsx): the warm
// sign-in sheet a guest sees when they try to add a song, and Request More for an account that wants more songs
// a day. Plain atoms in the default store, so code outside React (start-generation.tsx) can open them too
export const signInSheetAtom = atom(false)
export const requestMoreAtom = atom(false)

// This guest's one free song went to a generation just now, or the proxy said it already had: the app knows before
// the next ask of the proxy answers (auth.ts › useAccess)
export const guestSongSpentAtom = atom(false)

export const markGuestSongSpent = () => {
  getDefaultStore().set(guestSongSpentAtom, true)
}

export const openSignInSheet = () => {
  getDefaultStore().set(signInSheetAtom, true)
}

export const openRequestMore = () => {
  getDefaultStore().set(requestMoreAtom, true)
}
