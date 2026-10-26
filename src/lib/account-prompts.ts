import { atom, getDefaultStore } from 'jotai'

// The two account dialogs any button can open, mounted once in the root layout (account-dialogs.tsx): the warm
// sign-in sheet a guest sees when they try to add a song, and Request More for an account that wants more songs
// a day. Plain atoms in the default store, so code outside React (start-generation.tsx) can open them too
export const signInSheetAtom = atom(false)
export const requestMoreAtom = atom(false)

export const openSignInSheet = () => {
  getDefaultStore().set(signInSheetAtom, true)
}

export const openRequestMore = () => {
  getDefaultStore().set(requestMoreAtom, true)
}
