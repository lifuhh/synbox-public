import { createContext, useContext, useMemo, useState } from 'react'

interface AppContextType {
  processingStage: number
  setProcessingStage: (stage: number) => void
}

const AppContext = createContext<AppContextType>({
  processingStage: 1,
  setProcessingStage: () => {},
})

const AppProvider = ({ children }: { children: React.ReactNode }) => {
  const [processingStage, setProcessingStage] = useState<number>(1)
  const value = useMemo(
    () => ({ processingStage, setProcessingStage }),
    [processingStage]
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export default AppProvider

export const useAppContext = () => useContext(AppContext)
