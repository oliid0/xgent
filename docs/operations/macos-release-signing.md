# macOS 可选签名与公证配置

Xgent 的 macOS 包不要求 Developer ID 才能构建或发布。默认 workflow 使用 ad-hoc identity `-` 生成 DMG；用户首次打开时可在“系统设置 → 隐私与安全性”中授权。只有希望 Gatekeeper 显示已验证开发者、完成 Apple 公证并启用签名 updater 时，才需要本页配置并设置 `sign=true`。

## Apple 证书在哪里

`Developer ID Application` 证书由 Apple Developer 后台签发，不在 GitHub 或仓库中。它用于在 Mac App Store 之外签名分发应用。需要有效的 Apple Developer Program 会员，并由团队 Account Holder 创建。

Apple 官方入口：

- [创建 CSR](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request)
- [创建 Developer ID 证书](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
- [查看 Team ID](https://developer.apple.com/help/glossary/team-id/)
- [生成 App 专用密码](https://support.apple.com/zh-cn/102654)

## 创建可供 GitHub Actions 使用的 `.p12`

1. 在受信任的 Mac 打开“钥匙串访问”。
2. 选择“钥匙串访问 → 证书助理 → 从证书颁发机构请求证书”。填写 Apple Developer 邮箱和 Common Name，CA 邮箱留空，选择“存储到磁盘”，得到 `.certSigningRequest`。
3. 登录 [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list)，点击 `+`，选择 `Developer ID` → **Developer ID Application**，上传 CSR 并下载 `.cer`。
4. 双击 `.cer` 安装。在“钥匙串访问 → 登录 → 我的证书”找到 `Developer ID Application: … (TEAMID)`；展开后必须能看到私钥。
5. 右键证书条目导出 `.p12` 并设置强密码。`.cer` 本身不含私钥，不能直接给 CI 使用。
6. 将 `.p12` 转为单行 base64：

   ```bash
   openssl base64 -A -in Xgent-Developer-ID.p12 -out Xgent-Developer-ID.p12.base64
   ```

Workflow 会从 `.p12` 自动识别唯一的 `Developer ID Application` identity，无需手填 `APPLE_SIGNING_IDENTITY`。不要把 `.p12`、base64 文件或密码提交到 Git。

## Apple 公证信息

1. 在 Apple Developer 的 Membership details 获取 10 位 Team ID。
2. 确认 Apple Account 已启用双重认证。
3. 登录 [account.apple.com](https://account.apple.com/)，在“登录与安全 → App 专用密码”生成 `Xgent GitHub Release` 密码。不要使用 Apple Account 主密码。

## GitHub 配置

仓库 **Settings → Secrets and variables → Actions → Secrets**：

| Secret | 值 |
|---|---|
| `APPLE_CERTIFICATE_P12_BASE64` | base64 文件的完整单行内容 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple Account App 专用密码 |

仓库 **Settings → Secrets and variables → Actions → Variables**：

| Variable | 值 |
|---|---|
| `APPLE_ID` | Apple Developer 账号邮箱 |
| `APPLE_TEAM_ID` | Membership details 中的 10 位 Team ID |

GitHub 官方入口：[Creating secrets for a repository](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets#creating-secrets-for-a-repository)。

签名 Release 还需要 Tauri updater 密钥，详见 [部署与发布](./deployment.md#可选的签名-release-配置)。全部配置完成后，手动运行 `Desktop Release` 并设置 `sign=true`；Preflight 会在平台构建前一次性列出仍缺少的配置。若只需要可下载的无证书 DMG，保持 `sign=false` 即可。
