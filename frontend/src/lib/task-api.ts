import type { ChatApiResponse } from "@/types/chat"
import { getAccessToken, refreshAccessToken } from "./auth"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function apiErrorMessage(result: unknown, status: number): string {
  if (isRecord(result)) {
    for (const field of ["error", "detail", "message"]) {
      const value = result[field]
      if (typeof value === "string" && value.trim()) {
        return value
      }
    }
    if (Array.isArray(result.detail) && result.detail.length > 0) {
      return result.detail
        .map((item) => (isRecord(item) ? item.msg : String(item)))
        .join("; ")
    }
  }
  return `请求失败（${status}）`
}

function isSuccessResponse<T>(
  result: unknown,
): result is Extract<ChatApiResponse<T>, { success: true }> {
  return isRecord(result) && result.success === true && "data" in result
}

export const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL && process.env.NEXT_PUBLIC_API_BASE_URL !== ""
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : "http://localhost:8000"
).replace(/\/$/, "")

export const websocketBaseUrl = apiBaseUrl.replace(/^http/, "ws")

export async function requestData<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = getAccessToken()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...init?.headers as Record<string, string>,
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    cache: "no-store",
    ...init,
    headers,
  })

  // Handle 401 Unauthorized
  if (response.status === 401) {
    const newToken = await refreshAccessToken()
    if (newToken) {
      // Retry the request with new token
      const retryResponse = await fetch(`${apiBaseUrl}${path}`, {
        cache: "no-store",
        ...init,
        headers: {
          ...headers,
          "Authorization": `Bearer ${newToken}`,
        },
      })
      return processResponse<T>(retryResponse)
    } else {
      // Redirect to login
      if (typeof window !== "undefined") {
        window.location.href = "/login"
      }
      throw new Error("登录已过期，请重新登录")
    }
  }

  return processResponse<T>(response)
}

async function processResponse<T>(response: Response): Promise<T> {
  let result: unknown = null
  try {
    result = await response.json()
  } catch {
    if (!response.ok) {
      throw new Error(`请求失败（${response.status}）`)
    }
    throw new Error("API 响应格式无效。")
  }
  if (result === null) {
    throw new Error("API 响应格式无效。")
  }

  if (!response.ok) {
    throw new Error(apiErrorMessage(result, response.status))
  }

  if (isRecord(result) && result.success === false) {
    throw new Error(apiErrorMessage(result, response.status))
  }

  if (!isSuccessResponse<T>(result)) {
    throw new Error("API 响应格式无效。")
  }

  return result.data
}
