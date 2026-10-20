import { useEffect } from 'react'

const useKeyboardNavigation = () => {
  useEffect(() => {
    const handleFirstTab = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        document.body.classList.add('user-is-tabbing')
        window.removeEventListener('keydown', handleFirstTab)
      }
    }

    window.addEventListener('keydown', handleFirstTab)

    return () => {
      window.removeEventListener('keydown', handleFirstTab)
    }
  }, [])
}

export default useKeyboardNavigation
