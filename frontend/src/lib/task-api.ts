import type { ChatApiResponse } from "@/types/chat"

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
  let result: ChatApiResponse<T> | null = null
  try {
    result = (await response.json()) as ChatApiResponse<T>
  } catch {
    if (!response.ok) {
      throw new Error(`请求失败（${response.status}）`)
    }
    throw new Error("API 响应格式无效。")
  }
  if (result === null) {
    throw new Error("API 响应格式无效。")
  }

  if (!response.ok || !result.success) {
    throw new Error(
      result.success ? `请求失败（${response.status}）` : result.error,
    )
  }

  return result.data
}
