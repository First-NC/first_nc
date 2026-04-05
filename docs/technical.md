# First NC 技术文档

## 架构

First NC 采用 Tauri 双层架构：

- 前端：`React + TypeScript`
- 桌面层：`Rust + Tauri`

前端负责 UI、编辑器、3D 交互和状态管理；Rust 负责本地文件访问、系统集成和桌面打包。

## 主要模块

- `src/App.tsx`：主界面、布局、持久化状态、快捷键
- `src/components/Viewer3D.tsx`：3D 路径显示与交互
- `src/lib/*.ts`：解析、主题、启动、布局与兼容逻辑
- `src-tauri/src/lib.rs`：Tauri 命令、窗口控制、启动流程
- `src-tauri/tauri.conf.json`：应用元数据与打包配置

## 数据流

1. 用户打开 `.nc/.anc` 文件
2. Rust 读取文件内容并返回前端
3. 前端解析为 `FrameState[]`
4. 编辑器、进度条和 3D 视图围绕同一帧索引联动

## 命名规范

- 仓库目录：`first_nc`
- npm / Rust package：`first-nc`
- Rust crate：`first_nc_lib`
- 应用显示名：`First NC`
- 可执行文件：`FirstNC`
