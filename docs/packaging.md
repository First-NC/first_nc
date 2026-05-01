# First NC 打包文档

本文档统一说明两类打包方式：

- 本地打包：在对应操作系统主机上执行单条命令，产出该系统安装包
- GitHub Actions 打包：一次触发，同时产出 Windows、Ubuntu、macOS 安装包

## 1. 支持的产物

- Windows x64：`NSIS` + `MSI`
- Ubuntu x64：`AppImage` + `DEB`
- macOS Apple Silicon：`app` + `dmg`
- macOS Intel：`app` + `dmg`

同时，所有桌面平台都会额外产出一个应用内更新包：

- `first-nc-<version>-windows-x64-in-app-update.tar.gz`
- `first-nc-<version>-ubuntu-x64-in-app-update.tar.gz`
- `first-nc-<version>-macos-aarch64-in-app-update.tar.gz`
- `first-nc-<version>-macos-x64-in-app-update.tar.gz`

## 2. 统一命令入口

仓库使用以下统一打包命令：

```bash
npm run package:linux
npm run package:mac
npm run package:mac:intel
npm run package:win
```

对应关系如下：

- `package:linux` -> `x86_64-unknown-linux-gnu` + `appimage,deb`
- `package:mac` -> `aarch64-apple-darwin` + `app,dmg`
- `package:mac:intel` -> `x86_64-apple-darwin` + `app,dmg`
- `package:win` -> `x86_64-pc-windows-msvc` + `nsis,msi`

说明：

- `macOS` 默认命令是 `npm run package:mac`
- 每个命令都要求在对应操作系统主机上执行

## 3. 本地打包前准备

在仓库根目录执行：

```bash
npm ci
```

并确认以下工具可用：

- `node -v`
- `npm -v`
- `cargo --version`

项目打包入口在 [`package.json`](/Users/reddyfan/code/first_nc/package.json)，具体分发逻辑在 [`scripts/package-platform.mjs`](/Users/reddyfan/code/first_nc/scripts/package-platform.mjs)。

## 4. 本地打包

### 4.1 Ubuntu x64

推荐在 Ubuntu 22.04 或兼容环境执行。

安装系统依赖：

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

构建命令：

```bash
npm ci
npm run package:linux
```

产物目录：

- `src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage`
- `src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb`
- `src-tauri/target/x86_64-unknown-linux-gnu/release/artifacts`

### 4.2 macOS Apple Silicon

```bash
npm ci
npm run package:mac
```

产物目录：

- `src-tauri/target/aarch64-apple-darwin/release/bundle`
- `src-tauri/target/aarch64-apple-darwin/release/artifacts`

### 4.3 macOS Intel

```bash
npm ci
npm run package:mac:intel
```

产物目录：

- `src-tauri/target/x86_64-apple-darwin/release/bundle`
- `src-tauri/target/x86_64-apple-darwin/release/artifacts`

### 4.4 Windows x64

```powershell
npm ci
npm run package:win
```

产物目录：

- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle`
- `src-tauri/target/x86_64-pc-windows-msvc/release/artifacts`

## 5. 本地打包限制

- Linux 包请在 Linux 主机上打
- macOS 包请在 macOS 主机上打
- Windows 包请在 Windows 主机上打

如果在错误的平台上执行命令，[`scripts/package-platform.mjs`](/Users/reddyfan/code/first_nc/scripts/package-platform.mjs) 会直接报错并退出。

## 6. GitHub Actions 全平台打包

工作流文件：

- [`.github/workflows/desktop-build.yml`](/Users/reddyfan/code/first_nc/.github/workflows/desktop-build.yml)

上传的 artifact 名称：

- `first-nc-windows-x64`
- `first-nc-linux-x64`
- `first-nc-macos-apple-silicon`

说明：

- 安装包原始 bundle 仍位于 `release/bundle`
- 版本化后的安装包和 `in-app-update.tar.gz` 位于 `release/artifacts`
- CI 现在会同时上传 `bundle` 和 `artifacts`

关键约束：

- CI 与本地共用同一套 npm 打包入口
- Tauri target 与 bundle 参数只在 [`scripts/package-platform.mjs`](/Users/reddyfan/code/first_nc/scripts/package-platform.mjs) 定义
- Linux CI 使用 [`docker/linux-builder-jammy.Dockerfile`](/Users/reddyfan/code/first_nc/docker/linux-builder-jammy.Dockerfile)

## 7. Ubuntu Docker 构建

```powershell
powershell -ExecutionPolicy Bypass -File .\docker\build-linux-in-docker.ps1
```

对应文件：

- [`docker/build-linux-in-docker.ps1`](/Users/reddyfan/code/first_nc/docker/build-linux-in-docker.ps1)
- [`docker/linux-builder.Dockerfile`](/Users/reddyfan/code/first_nc/docker/linux-builder.Dockerfile)

## 8. 常见问题

### 8.1 Windows 打包报文件占用错误

若出现类似 `failed to remove ... FirstNC.exe (os error 5)`：

- 先关闭正在运行的 First NC
- 必要时结束相关进程
- 然后重新执行 `npm run package:win`

### 8.2 Ubuntu 安装 DEB 时依赖报错

```bash
sudo dpkg --configure -a
sudo apt -f install
sudo apt install ./first-nc_0.1.0_amd64.deb
```

## 9. 验证建议

打包后建议先用 `demo_nc/` 下的 `.nc/.anc` 文件做冷启动验证，至少检查：

- 文件打开与文件切换
- 代码编辑器和 3D 联动
- 进度条拖动与播放
- 网格开关
- 主题与语言切换
