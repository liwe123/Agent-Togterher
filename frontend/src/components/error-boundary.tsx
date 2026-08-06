"use client"

import { Component, type ReactNode } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-lg border border-[oklch(0.31_0.018_70)] bg-[oklch(0.16_0.013_70)] p-8">
          <AlertTriangle className="size-10 text-[oklch(0.65_0.2_28)]" />
          <p className="text-sm text-[oklch(0.72_0.015_70)]">
            页面组件发生意外错误，请尝试刷新。
          </p>
          <p className="max-w-md truncate text-xs text-[oklch(0.72_0.015_70)]">
            {this.state.error?.message ?? "未知错误"}
          </p>
          <Button variant="outline" size="sm" onClick={this.handleRetry}>
            重试
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
