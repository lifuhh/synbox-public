import { StatusPage } from '@/components/shared/status-page'

// What someone without access sees on an admin-only page
const Forbidden = () => (
  <StatusPage title='Access Forbidden' line='Sign in with an admin account'>
    <title>Access Forbidden · Synbox</title>
  </StatusPage>
)

export default Forbidden
