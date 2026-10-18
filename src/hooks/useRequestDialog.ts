import { useSetAtom } from 'jotai'
import { useCallback, useState } from 'react'

import { dialogStepAtom } from '@/context/atoms'

// RequestDialog starts validating its video as soon as it mounts, so a page renders one dialog
// and points it at the chosen video; the key bump remounts it fresh for each video.
const useRequestDialog = () => {
  const [open, setOpen] = useState(false)
  const [dialogKey, setDialogKey] = useState(0)
  const [videoId, setVideoId] = useState('')
  const setDialogStep = useSetAtom(dialogStepAtom)

  const openFor = useCallback(
    (id: string) => {
      setVideoId(id)
      setDialogStep(0)
      setOpen(false)
      setDialogKey((prev) => prev + 1)
      requestAnimationFrame(() => {
        setOpen(true)
      })
    },
    [setDialogStep]
  )

  const close = useCallback(() => {
    setOpen(false)
    setDialogStep(0)
  }, [setDialogStep])

  return { close, dialogKey, handleOpenChange: setOpen, open, openFor, videoId }
}

export default useRequestDialog
