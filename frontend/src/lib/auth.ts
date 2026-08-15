const authApiBaseUrl = (
  typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_BASE_URL
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : "http://localhost:8000"
).replace(/\/$/, "")

const ACCESS_TOKEN_KEY = "agent_console_access_token"
const REFRESH_TOKEN_KEY = "agent_console_refresh_token"

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export function isAuthenticated(): boolean {
  return getAccessToken() !== null
}

// Refresh token logic
let refreshPromise: Promise<string | null> | null = null

export async function refreshAccessToken(): Promise<string | null> {
  // Deduplicate concurrent refresh requests
  if (refreshPromise) return refreshPromise
  
  refreshPromise = (async () => {
    const refreshToken = getRefreshToken()
    if (!refreshToken) return null
    
    try {
      const response = await fetch(`${authApiBaseUrl}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      
      if (!response.ok) {
        clearTokens()
        return null
      }
      
      const result = await response.json()
      if (result.success && result.data?.access_token) {
        localStorage.setItem(ACCESS_TOKEN_KEY, result.data.access_token)
        return result.data.access_token
      }
      
      clearTokens()
      return null
    } catch {
      clearTokens()
      return null
    } finally {
      refreshPromise = null
    }
  })()
  
  return refreshPromise
}
