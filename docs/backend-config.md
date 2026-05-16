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

如果要临时连接指定 IP 或域名的后端，在 `first_nc/.env.local` 中配置：

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
```

也可以指定局域网或测试域名：

```bash
VITE_API_BASE_URL=http://192.168.1.20:8000
VITE_API_BASE_URL=https://dev-api.example.com
```

`.env.local` 只用于本机调试，不提交到仓库，避免把临时 IP 打进正式包。

