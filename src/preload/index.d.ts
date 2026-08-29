declare global {
  interface Window {
    jargon?: {
      platform: string
      apiBaseUrl: string
      getAuthToken?: () => Promise<string | null>
      setAuthToken?: (token: string | null) => Promise<boolean>
      openExternal?: (url: string) => Promise<boolean>
      getApiBase?: () => Promise<string>
      onDeepLink?: (handler: (url: string) => void) => () => void
    }
  }
}

export {}
