"use client"

import { useEffect, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import { isAuthenticated } from "@/lib/auth"

const PUBLIC_PATHS = ["/login", "/register"]

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const didRedirect = useRef(false)

  useEffect(() => {
    if (!PUBLIC_PATHS.includes(pathname) && !isAuthenticated()) {
      didRedirect.current = true
      router.replace("/login")
    }
  }, [pathname, router])

  // On public paths, always render children
  if (PUBLIC_PATHS.includes(pathname)) {
    return <>{children}</>
  }

  // On protected paths, only render if authenticated
  if (!isAuthenticated()) {
    return null
  }

  return <>{children}</>
}
