// Cloudflare Workers 部署配置（@opennextjs/cloudflare）
// 本项目页面均为客户端取数（浏览器直连 FastAPI），不依赖 ISR/增量缓存，
// 因此未启用 R2 缓存。若后续需要缓存：
//   1) 创建 R2 bucket 并在 wrangler.jsonc 添加 r2_buckets 绑定；
//   2) 按 https://opennext.js.org/cloudflare/caching 启用 incrementalCache。
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
