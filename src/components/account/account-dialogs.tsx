import { useAtom } from 'jotai'
import { useEffect } from 'react'

import { requestMoreAtom, signInSheetAtom } from '@/lib/account-prompts'
import { syncTimeZone, useMe } from '@/lib/auth'

import { RequestMoreDialog } from './request-more-dialog'
import { SignInSheet } from './sign-in-sheet'

// Mounted once in the root layout: the sign-in sheet and Request More, opened from anywhere through
// account-prompts.ts, and the account's time zone kept in step so its day ends at the listener's midnight
const AccountDialogs = () => {
  const [signIn, setSignIn] = useAtom(signInSheetAtom)
  const [requestMore, setRequestMore] = useAtom(requestMoreAtom)
  const { data: me, refetch } = useMe()

  useEffect(() => {
    if (me === undefined) {
      return
    }
    void (async () => {
      try {
        if (await syncTimeZone(me)) {
          await refetch()
        }
      } catch {
        // Offline or an older Worker: the day stays on the zone it had, and the next open tries again
      }
    })()
  }, [me, refetch])

  return (
    <>
      <SignInSheet open={signIn} onOpenChange={setSignIn} />
      <RequestMoreDialog open={requestMore} onOpenChange={setRequestMore} />
    </>
  )
}

export default AccountDialogs
