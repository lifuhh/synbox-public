import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/components/ui/use-toast'
import { signInWithGoogle, SIGN_IN_CODES } from '@/lib/auth'
import type { GenerationRequest } from '@/lib/generation/store'
import { requestGeneration } from '@/lib/generation/store'

// Starts a generation from a button, or says at once why it can't start
export const startFromButton = async (request: GenerationRequest) => {
  const refusal = await requestGeneration(request)
  if (refusal === null) {
    return
  }
  toast({
    action: SIGN_IN_CODES.has(refusal.code) ? (
      <ToastAction
        altText='Sign In'
        onClick={() => {
          void signInWithGoogle()
        }}>
        Sign In
      </ToastAction>
    ) : undefined,
    description: refusal.message,
    title: "Can't Generate This Song",
    variant: 'destructive',
  })
}
