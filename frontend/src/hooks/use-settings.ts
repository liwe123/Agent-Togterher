"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { requestData } from "@/lib/task-api"
import type {
  ModelConfig,
  ModelTestResult,
  ProviderKeyStatus,
  ProviderStatus,
  TestState,
} from "@/types/settings"

export function useSettings() {
  const [models, setModels] = useState<ModelConfig[]>([])
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [providerKeys, setProviderKeys] = useState<ProviderKeyStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Per-model test state keyed by model name
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})

  // Prevent duplicate fetches in StrictMode
  const fetchedRef = useRef(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [modelsData, providersData, providerKeysData] = await Promise.all([
        requestData<ModelConfig[]>("/api/models/config"),
        requestData<ProviderStatus[]>("/api/models/providers/status"),
        requestData<ProviderKeyStatus[]>("/api/provider-keys"),
      ])
      setModels(modelsData)
      setProviders(providersData)
      setProviderKeys(providerKeysData)
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载设置失败")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    load()
  }, [load])

  const retry = useCallback(() => {
    fetchedRef.current = false
    load()
  }, [load])

  const testModel = useCallback(async (modelName: string) => {
    setTestStates((prev) => ({
      ...prev,
      [modelName]: { status: "testing" },
    }))
    try {
      const result = await requestData<ModelTestResult>("/api/models/test", {
        method: "POST",
        body: JSON.stringify({ model_name: modelName }),
      })
      setTestStates((prev) => ({
        ...prev,
        [modelName]: { status: "success", result },
      }))
    } catch (err) {
      setTestStates((prev) => ({
        ...prev,
        [modelName]: {
          status: "error",
          error: err instanceof Error ? err.message : "测试失败",
        },
      }))
    }
  }, [])

  const saveProviderKey = useCallback(
    async (provider: string, apiKey: string) => {
      await requestData<ProviderKeyStatus>(
        `/api/provider-keys/${provider}`,
        {
          method: "PUT",
          body: JSON.stringify({ api_key: apiKey }),
        },
      )
      setProviderKeys((prev) => {
        const exists = prev.some(
          (p) => p.provider.toLowerCase() === provider.toLowerCase(),
        )
        if (exists) {
          return prev.map((p) =>
            p.provider.toLowerCase() === provider.toLowerCase()
              ? { ...p, configured: true }
              : p,
          )
        }
        return [...prev, { provider, configured: true }]
      })
    },
    [],
  )

  const removeProviderKey = useCallback(async (provider: string) => {
    await requestData<ProviderKeyStatus>(
      `/api/provider-keys/${provider}`,
      { method: "DELETE" },
    )
    setProviderKeys((prev) =>
      prev.map((p) =>
        p.provider.toLowerCase() === provider.toLowerCase()
          ? { ...p, configured: false }
          : p,
      ),
    )
  }, [])

  return {
    models,
    providers,
    providerKeys,
    isLoading,
    error,
    retry,
    testStates,
    testModel,
    saveProviderKey,
    removeProviderKey,
  }
}
