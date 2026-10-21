import { betterAuth } from 'better-auth'
import { admin, jwt } from 'better-auth/plugins'

export interface Env {
  DB: D1Database
  BETTER_AUTH_URL: string
  BETTER_AUTH_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  TRUSTED_ORIGINS: string
  INTERNAL_SECRET: string
  // Comma-separated; a secret, so no address is ever in the repo. These accounts are admins from their
  // first sign-in
  ADMIN_EMAILS?: string
}

const adminEmails = (env: Env) =>
  new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email !== '')
  )

export const createAuth = (env: Env) =>
  betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    database: env.DB,
    // Google verifies the address, and Google is the only way in, so the address is enough to trust
    databaseHooks: {
      user: {
        create: {
          before: async (user) =>
            await Promise.resolve({
              data: {
                ...user,
                role: adminEmails(env).has(user.email.toLowerCase())
                  ? 'admin'
                  : 'user',
              },
            }),
        },
      },
    },
    plugins: [
      admin(),
      // Cloud Run verifies these offline against /api/auth/jwks; it only needs who and what role
      jwt({
        jwt: {
          audience: 'synbox-backend',
          definePayload: ({ user }) => ({
            role: typeof user.role === 'string' ? user.role : 'user',
          }),
          issuer: env.BETTER_AUTH_URL,
        },
      }),
    ],
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: 'select_account',
      },
    },
    trustedOrigins: env.TRUSTED_ORIGINS.split(','),
  })

export type Auth = ReturnType<typeof createAuth>
