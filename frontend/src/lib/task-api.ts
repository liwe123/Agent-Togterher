import type { ChatApiResponse } from "@/types/chat"

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
  const response = await fetch(`${apiBaseUrl}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })
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
