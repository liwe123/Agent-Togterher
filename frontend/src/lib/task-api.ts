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
  const result = (await response.json()) as ChatApiResponse<T>

  if (!response.ok || !result.success) {
    throw new Error(
      result.success ? `请求失败（${response.status}）` : result.error,
    )
  }

  return result.data
}
