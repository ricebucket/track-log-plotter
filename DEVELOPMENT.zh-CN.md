# 开发指南

[English](DEVELOPMENT.md)

介绍如何开发轨迹绘图器（Track Log Plotter），以及每次推送到 GitHub 之前需要运行的检查。

## 准备

需要 Node.js 20 或更新版本。

- **全部依赖装在此文件夹中：** 运行 `npm install`。
- **构建、测试和代码检查工具放在上级文件夹中：** Node 会在那里找到它们。在此处只用 `npm install --omit=dev` 安装应用本身的库，工具则装在上级文件夹中：

  ```sh
  npm install vite @preact/preset-vite vitest @vitest/coverage-v8 happy-dom @testing-library/preact fast-check oxlint typescript @playwright/test @axe-core/playwright @types/node
  ```

- **浏览器测试用的浏览器：** 每个 Playwright 版本运行一次 `npx playwright install chromium`。

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器，地址为 http://localhost:5173/track-log-plotter/ |
| `npm run build` | 生成正式版本到 `dist/` |
| `npm run preview` | 预览正式版本 |
| `npm test` | 单元测试和组件测试（Vitest） |
| `npm run test:watch` | 同上，每次修改后自动重新运行 |
| `npm run test:coverage` | 单元测试和组件测试，并统计覆盖率 |
| `npm run test:e2e` | 浏览器测试（Playwright），包括桌面和手机 |
| `npm run lint` | oxlint 代码检查 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run check` | 依次运行代码检查、类型检查、测试、构建和浏览器测试 |
| `npm run fixtures` | 重新生成测试数据和示例骑行 |
| `npm run screenshots` | 重新生成 README 中的截图（见[截图](#截图)） |

## 每次推送之前

推送之前，下面每一步都必须通过。

每次推送到 `main` 时，GitHub 都会运行同样的检查。但发布到 GitHub Pages 的流程在发布前只运行单元测试和构建。只有浏览器测试才能发现的问题仍可能被发布上线，所以请先在本地运行全部检查。例如在本项目中，曾经单元测试全部通过，构建出的地图却是坏的，只有浏览器测试发现了问题。

1. **运行全部检查：**

   ```sh
   npm run check
   ```

   遇到第一个失败就会停止。修好之后，从头再运行一次。全部通过时：

   - 代码检查没有任何输出，也没有报错退出
   - 类型检查没有任何输出
   - Vitest 报告所有测试文件都已通过
   - Vite 报告构建完成
   - Playwright 报告所有桌面和手机测试都已通过

2. **检查覆盖率：** 运行 `npm run test:coverage`，留意覆盖率下降的文件。

3. **重新生成测试数据**（如果修改了 `scripts/make-fixtures.mjs`）：

   1. 运行 `npm run fixtures`。
   2. 再运行一次第 1 步。
   3. 提交 `tests/fixtures/` 和 `public/sample/` 中重新生成的文件。

4. **不要提交个人数据：**

   - `git status` 中不能出现 `local-tracks/` 里的任何文件，也不能有你自己的其他轨迹文件。
   - 测试数据必须是合成的，所有坐标都必须位于纽约市内。否则隐私测试会失败，所以第 1 步已经包含这项检查。

5. **检查改动：** 运行 `git status` 和 `git diff --stat`，并阅读改动内容。

6. **在 `main` 上提交并推送。** 本项目只使用 `main`，不建分支。

   ```sh
   git add -A
   git commit
   git push origin main
   ```

7. **查看 GitHub：** 打开 Actions 页面。每次推送到 `main` 都会运行 **CI** 和 **Deploy to GitHub Pages**。如果有失败，请立即在 `main` 上修复。

## 测试

- **单元测试：** `tests/unit/`。
- **组件测试：** `tests/component/`。在 happy-dom 中运行，地图用替身代替。
- **测试数据：** `tests/fixtures/`。都是由 `scripts/make-fixtures.mjs` 生成的纽约市合成轨迹，`public/sample/` 中的示例骑行也是。如果仓库中有任何坐标落在纽约市以外，隐私测试就会失败。
- **浏览器测试：** `tests/e2e/`。针对 http://localhost:4173/track-log-plotter/ 上构建好的网站运行，分为两个 Playwright 项目：`desktop`（Desktop Chrome）和 `phone`（Pixel 7）。
  - 对其他主机的请求（瓦片、样式、字体）都在本地应答，所以测试不会访问真实的服务器。
  - Chromium 通过 SwiftShader 使用 WebGL，相关参数已在 `playwright.config.ts` 中设置。
  - 测试失败后，`npx playwright show-report` 会显示出错的地方，跟踪记录保存在 `test-results/` 中。

## 截图

每个 README 都展示一张电脑截图，存放在 `docs/screenshots/`，语言与该 README 相同。截图只展示合成的示例骑行。

界面有明显变化时：

1. 运行 `npm run screenshots`。它会构建网站，并在 4175 端口提供服务。与浏览器测试不同，它会加载真实的底图瓦片和字体，因此需要联网。
2. 提交之前，先查看这两个 PNG 文件。

## 部署

GitHub 上运行两个 GitHub Actions 工作流：

- **CI**（`.github/workflows/ci.yml`）在每次推送和拉取请求时运行：安装依赖、代码检查、类型检查、带覆盖率的测试、构建，然后运行浏览器测试。
- **Deploy to GitHub Pages**（`.github/workflows/pages.yml`）在每次推送到 `main` 时运行：安装依赖、单元测试和组件测试、构建，然后发布 `dist/`。

发布流程不会等待 CI。正因如此，推送前必须先在本地通过全部检查（见[每次推送之前](#每次推送之前)）。

发布需要两项仓库设置：

- 在 Settings → Pages 中，把来源设为 “GitHub Actions”。
- 在 GitHub 免费版中，Pages 只能发布公开仓库。

网站发布在 https://ricebucket.github.io/track-log-plotter/。基础路径 `/track-log-plotter/` 在 `vite.config.ts` 中设置。

## 你自己的记录

如果想在应用中试用自己的轨迹记录，请放在 `local-tracks/` 中。

- Git 会忽略该文件夹，开发服务器也不会提供其中的文件。
- 不要提交这些记录，也不要把其中的坐标复制到测试中。需要测试数据时，请扩展测试数据生成脚本，使用纽约市的合成数据。

## 添加语言

1. 复制 `src/i18n/en-US.json` 为新文件并翻译。
2. 在 `src/i18n/i18n.ts` 中注册（`LANGS`、`LOCALE` 和 `MESSAGES`）。
3. 添加该语言的 README 和开发指南。

测试会检查每条消息在每种语言中都存在，且占位符一致。
