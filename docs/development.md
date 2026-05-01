# First NC 开发文档

## 环境要求

- Node.js 20+
- npm 10+
- Rust stable
- Tauri CLI 2.x

## 常用命令

```bash
npm ci
npm run dev
npm run build
npm run tauri:dev
cd src-tauri && cargo check
```

## 环境模式

桌面端通过 Vite `mode` 区分三套环境：

- `local` -> [`.env.local`](/Users/reddyfan/code/FNC/first_nc/.env.local)
- `dev` -> [`.env.dev`](/Users/reddyfan/code/FNC/first_nc/.env.dev)
- `prod` -> [`.env.prod`](/Users/reddyfan/code/FNC/first_nc/.env.prod)

对应后端地址：

- `local` -> `http://127.0.0.1:8000`
- `dev` -> `https://test-api.firstnc.cn`
- `prod` -> `https://api.firstnc.cn`

常用命令：

```bash
npm run dev:local
npm run dev:dev
npm run dev:prod

npm run build:local
npm run build:dev
npm run build:prod
```

## 开发约定

- 前端使用 TypeScript 和 ESLint
- Rust 变更至少通过 `cargo check`
- UI 变更需要验证浅色和深色主题
- 新增持久化配置时同步维护 `src/lib/storageKeys.ts`

## 调试重点

- 文件打开链路
- 编辑器与 3D 视图联动
- 启动页与主题恢复
- 桌面打包与文件关联
