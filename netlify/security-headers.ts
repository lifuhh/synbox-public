// The security headers every page carries. netlify.toml's [[headers]] for "/*" sets them on files Netlify
// serves itself; a URL an Edge Function answers gets none of those (Netlify docs, Custom headers ›
// Limitations), so page-head.ts sets these on every page. security-headers.test.ts fails when the two differ.
// What each source in the policy is for is written beside the rule in netlify.toml.

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://www.youtube.com https://browser.sentry-cdn.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.ytimg.com https://*.googleusercontent.com https://*.ggpht.com",
    "connect-src 'self' https://cloud.appwrite.io https://synbox-lookup-1045990822048.asia-southeast1.run.app https://api.synbox.io https://*.ingest.us.sentry.io https://www.youtube.com https://i.ytimg.com https://fonts.googleapis.com https://fonts.gstatic.com https://lh3.googleusercontent.com",
    'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

export const withSecurityHeaders = (response: Response) => {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value)
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}
