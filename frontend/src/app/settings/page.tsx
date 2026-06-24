import type { Metadata } from "next"

import { SettingsPage } from "@/components/settings/settings-page"

export const metadata: Metadata = {
  title: "设置 · Agent Console",
  description: "查看模型配置、Provider 状态和测试模型连通性。",
}

export default function SettingsRoute() {
  return <SettingsPage />
}
