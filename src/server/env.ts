/** Railway always sets RAILWAY_ENVIRONMENT; JARGON_ENV=development opts out for local runs. */
export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.JARGON_ENV === 'development') return false
  return env.JARGON_ENV === 'production' || env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT)
}
