import { createContext, useContext, useMemo, useState } from 'react'

interface AppContextType {
  volume: number
  processingStage: number
  setProcessingStage: (stage: number) => void
  playerControlsVisible: boolean
  setPlayerControlsVisible: (visibility: boolean) => void
  playerOverlayVisible: boolean
  playerOverlayVisibleHandler: {
    open: () => void
    close: () => void
  }
}

const INITIAL_STATE = {
  volume: 0,
  processingStage: 1,
  playerControlsVisible: true,
  setProcessingStage: () => {},
  setPlayerControlsVisible: () => {},
  playerOverlayVisible: false,
  playerOverlayVisibleHandler: {
    open: () => {},
    close: () => {},
  },
}
const AppContext = createContext<AppContextType>(INITIAL_STATE)

const AppProvider = ({ children }: { children: React.ReactNode }) => {
  const [playerControlsVisible, setPlayerControlsVisible] =
    useState<boolean>(true)

  const volume = 0.3
  const [processingStage, setProcessingStage] = useState<number>(1)

  const [playerOverlayVisible, setPlayerOverlayVisible] = useState(false)
  const playerOverlayVisibleHandler = useMemo(
    () => ({
      open: () => {
        setPlayerOverlayVisible(true)
      },
      close: () => {
        setPlayerOverlayVisible(false)
      },
    }),
    []
  )

  const value = {
    processingStage,
    setProcessingStage,
    volume,
    playerControlsVisible,
    setPlayerControlsVisible,
    playerOverlayVisible,
    playerOverlayVisibleHandler,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export default AppProvider

export const useAppContext = () => useContext(AppContext)
