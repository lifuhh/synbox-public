// The auth Worker answered an /api/admin call with an error status: told apart from a request that never got an
// answer (src/lib/admin.ts › call)
export class AdminApiError extends Error {
  override name = 'AdminApiError'
  readonly status: number
  constructor(status: number) {
    super(`The admin API answered ${status}`)
    this.status = status
  }
}
