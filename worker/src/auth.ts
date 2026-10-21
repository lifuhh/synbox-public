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
}

export const createAuth = (env: Env) =>
  betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    database: env.DB,
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
