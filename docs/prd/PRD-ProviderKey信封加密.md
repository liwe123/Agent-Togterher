# PRD：Provider Key 信封加密

> 类型：新需求（Requirement）｜状态：已完成（2026-08-27 上线）｜目标：将 `provider_credentials.api_key` 从明文存库改为信封加密存储，消除数据库泄露即泄露全部模型厂商密钥的风险；对存量明文密钥保持向后兼容，解密链路对上层调用透明。

---

## 1. 背景与问题

当前 `provider_credentials.api_key` 以**明文**写入数据库（`backend/app/models/provider_credential.py` 的 `Text` 列）。API 层虽已在回传时掩码（仅尾 4 位），但：

- 数据库备份、只读副本、运维直连或拖库场景下，所有厂商 API Key 一次性全部暴露。
- API Key 可直接产生费用（调用 LLM），泄露后果是**直接经济损失**，属于高敏感凭据。
- 项目已引入 Alembic 与 PostgreSQL，但密钥静态加密（at-rest encryption）一直是空缺项。

本需求补齐**静态加密**这一环，使「拿到数据库」不再等于「拿到可用密钥」。

---

## 2. 用户故事

- 作为**平台运维**，我希望即使数据库文件/备份被拷走，攻击者也无法直接拿到可用的模型 API Key。
- 作为**已存量用户**，我希望升级后我此前填入的明文 Key 仍然可用，无需重新填写。
- 作为**管理员**，我在设置页查看某个 Provider Key 时，仍能看到正确的掩码（尾 4 位），体验不变。

---

## 3. 功能需求（FR）

- **FR1 写入加密**：`PUT /provider-keys/{provider}` 存储前用信封加密，落库值为 `v1:` 前缀 + Fernet 密文。
- **FR2 读取解密**：模型调用链路（`litellm_service.get_db_api_keys`）读取时自动解密，返回明文供 LiteLLM 使用。
- **FR3 存量兼容**：无 `v1:` 前缀的历史明文值按原样返回，不报错、不强制迁移（渐进式，重新保存时自动转为密文）。
- **FR4 掩码正确**：`GET /provider-keys/{provider}` 的 `masked_key` 基于**解密后的明文**取尾 4 位，避免展示密文尾部。
- **FR5 主密钥派生**：加密主密钥由应用 JWT 密钥（`jwt_secret_key`，缺省回退链与认证一致）经 PBKDF2-HMAC-SHA256 派生，不复用原始 JWT 密钥本身。
- **FR6 失败显性**：密文无法解密（主密钥变更/数据损坏）时抛出清晰错误，而不是静默返回错误密钥。

---

## 4. 验收标准（AC）

- **AC1**：新写入的 Key 在数据库中为 `v1:` 前缀密文，直接读取不可还原。
- **AC2**：加密→解密回环一致（`decrypt(encrypt(x)) == x`）。
- **AC3**：存量明文 Key 升级后可被正常解密（透传）并用于模型调用。
- **AC4**：`masked_key` 显示真实密钥尾 4 位，而非密文尾部。
- **AC5**：`get_db_api_keys` 返回明文映射，模型调用不受影响。
- **AC6**：后端测试套件无回归（168 passed 基线），新增加解密测试全部通过。

---

## 5. 数据模型

- 复用现有 `provider_credentials` 表，`api_key` 已是 `Text` 列，**无需 Alembic 迁移、无需加列**：`v1:` 前缀 + Fernet 密文（约百余字符）直接存入 `Text`。
- 版本前缀 `v1:` 为后续更换算法/密钥轮换预留判别位。

---

## 6. 后端设计

- 新增 `backend/app/core/crypto.py`：
  - `encrypt_api_key(plaintext) -> "v1:" + Fernet 密文`
  - `decrypt_api_key(stored)`：有前缀则解密，否则原样返回（明文兼容）；解密失败抛清晰 `ValueError`
  - `is_encrypted(stored)`：前缀判别
  - 主密钥：`PBKDF2-HMAC-SHA256(master=JWT 密钥, salt=固定上下文, 100k 轮) → 32B → Fernet key`，Fernet 实例进程内缓存。
- 接入点：
  - `provider_keys.py` PUT：写入前 `encrypt_api_key`。
  - `provider_keys.py` GET：掩码前 `decrypt_api_key`。
  - `litellm_service.get_db_api_keys`：逐项 `decrypt_api_key`；单条解密失败记日志跳过，避免一条坏 Key 拖垮全部 Provider。
  - 存在性检查（`list` / `is_provider_configured_async` / `providers/status`）仅判非空，密文非空即视为已配置，无需解密，不改。
- `requirements.txt` 新增 `cryptography`。

## 7. 前端

- 无改动。设置页 API Key 管理只与掩码值交互，解密对前端透明。

---

## 8. 安全与运维约束

- **生产必须显式配置 `jwt_secret_key`**：否则主密钥回退到开发默认值，加密强度等同虚设（仅防明文拖库，不防拿到代码的人）。
- **轮换 `jwt_secret_key` 会导致既有密文不可解密**：需重新在设置页填写各 Provider Key。此为刻意约束，换来主密钥不落库。
- Fernet 自带 HMAC 完整性校验，篡改密文会被检出并拒绝解密。
- 本方案为**静态加密（at-rest）**，不改变传输层（HTTPS）与访问控制（RBAC）既有保障。

---

## 9. 里程碑

| 阶段 | 内容 | 产出 |
|------|------|------|
| M1 | crypto.py 加解密模块 + 主密钥派生 | 可回环的加解密能力 |
| M2 | provider_keys / litellm_service 接入 | 写加密、读解密、掩码正确 |
| M3 | 测试 + requirements 登记 | 回环/明文兼容/掩码三类测试通过 |

---

## 10. 风险与待定项

- **风险**：解密链路异常会中断模型调用——以明文兼容兜底 + 单条失败跳过 + 测试覆盖缓解。
- **风险**：Docker 镜像需重建以纳入 `cryptography`（含编译依赖，官方 wheel 覆盖主流平台）。
- **待定**：是否引入独立密钥管理（KMS / 环境变量独立主密钥）以解耦 JWT 密钥——当前复用 JWT 密钥派生以降低配置面，留作后续安全增强。

---

## 11. 与现有系统的关系

- 建立在 C-006/C-015（API Key 管理）与「后端访问控制」的掩码回传基础上，补齐静态加密。
- 与 Alembic/PostgreSQL 迁移（C-140）正交：本需求不改表结构。
