# 后端地址配置

First NC 桌面端通过 `VITE_API_BASE_URL` 决定后端 API 地址。

## 默认行为

正式打包时不需要额外配置，应用默认请求：

```bash
https://api.firstnc.cn
```

也就是更新检查等 API 会访问：

```bash
https://api.firstnc.cn/api/v1/update/check
```

## 本地开发或调试

Vite 8 之后不能使用 `local` 作为 mode 名，因为它会和 `.env.local` 的特殊后缀冲突。
项目使用 `localenv` 作为本地联调 mode，显式执行 `npm run dev:local` 才会加载 `first_nc/.env.localenv`。
默认 `npm run dev` 使用 `prod` mode，仍然访问 `https://api.firstnc.cn`。

如果要临时连接指定 IP 或域名的后端，在 `first_nc/.env.localenv` 中配置：

```bash
VITE_APP_ENV=local
VITE_API_BASE_URL=http://127.0.0.1:8000
```

桌面壳本地联调使用：

```bash
npm run tauri:dev:local
```

默认桌面壳开发仍然走生产后端：

```bash
npm run tauri:dev
```

也可以指定局域网或测试域名：

```bash
VITE_API_BASE_URL=http://192.168.1.20:8000
VITE_API_BASE_URL=https://dev-api.example.com
```

`.env.localenv` 只用于本机调试，正式构建仍然使用 `prod` mode 和 `https://api.firstnc.cn`。
