# 开发指南

[English](DEVELOPMENT.md)

介绍如何开发轨迹绘图器（Track Log Plotter），以及每次推送到 GitHub 之前需要运行的检查。

## 准备

需要较新的 Node.js：最低版本见 package.json 中的 engines。

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
| `npm run test:coverage` | 单元测试和组件测试，并统计覆盖率（不含计时测试） |
| `npm run test:perf` | 单独运行计时测试，不统计覆盖率（CI 也是这样运行） |
| `npm run test:e2e` | 浏览器测试（Playwright），包括桌面和手机 |
| `npm run lint` | oxlint 代码检查 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run check` | 依次运行代码检查、类型检查、测试、构建和浏览器测试 |
| `npm run fixtures` | 重新生成示例轨迹，以及由 `scripts/make-fixtures.mjs` 生成的纽约市测试数据（见[测试](#测试)） |
| `npm run screenshots` | 重新生成 README 中的截图（见[截图](#截图)） |
| `npm run video` | 重新录制 README 中的演示视频（见[演示视频](#演示视频)） |

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
   - 测试数据必须是合成的，所有坐标都必须位于纽约市内；只有合成的斯坦福行车数据可以位于斯坦福。否则隐私测试会失败，所以第 1 步已经包含这项检查。

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
- **性能测试：** `tests/unit/performance.test.ts` 以及 `tests/e2e/app.spec.ts` 中的一个浏览器测试，用一个合成的 10 小时 Columbus Fusion 运动数据记录（36,000 个定位点、360,000 次读数，约 10 MB）计时：读取文件、绘制加速度时间轴、缩放，以及定位点信息卡查找读数。每项测试的耗时超过其时限就会失败。这些时限都是笔记本电脑所需时间的数倍，因此较慢的 CI 机器也能通过，但如果改动让耗时失控就会失败。慢两三倍仍能通过，所以修改这部分代码时，请比较修改前后打印出的计时。运行 `npx vitest run tests/unit/performance.test.ts --silent=false` 可以看到计时结果。
- **测试数据：** `tests/fixtures/`，全部是合成的。大部分是由 `scripts/make-fixtures.mjs` 生成的纽约市轨迹，`public/sample/` 中的示例轨迹也由它生成。曼哈顿下城的步行轨迹和斯坦福行车来自被 Git 忽略的 `track-generator/` 文件夹中的生成脚本，只提交它们写出的轨迹。
- **隐私测试：** `tests/unit/privacy.test.ts` 会读取 Git 将要提交的每个文件（包括测试数据和示例轨迹），只要其中有坐标落在纽约市以外，测试就会失败。它读取的是文件文本本身，所以没有时间的航点、文件中的范围（bounds）或被跳过的行也都算在内，每种写法都会检查：GPX 属性、`lat:` 和 `lon:` 名称、NMEA、N/S/E/W 字母以及数字对。只有斯坦福行车的测试数据及其测试可以位于斯坦福。
- **浏览器测试：** `tests/e2e/`。针对 http://localhost:4621/track-log-plotter/ 上构建好的网站运行，分为两个 Playwright 项目：`desktop`（Desktop Chrome）和 `phone`（Pixel 7）。
  - 对其他主机的请求（瓦片、样式、字体）都在本地应答，所以测试不会访问真实的服务器。
  - Chromium 通过 SwiftShader 使用 WebGL，相关参数已在 `playwright.config.ts` 中设置。
  - 测试失败后，`npx playwright show-report` 会显示出错的地方，跟踪记录保存在 `test-results/` 中。

## 截图

每个 README 都展示一张电脑截图，存放在 `docs/screenshots/`，语言与该 README 相同。截图只展示合成的示例轨迹。

界面有明显变化时：

1. 运行 `npm run screenshots`。它会构建网站，并在 4175 端口提供服务。与浏览器测试不同，它会加载真实的底图瓦片和字体，因此需要联网。
2. 提交之前，先查看这两个 PNG 文件。

## 演示视频

每个 README 都链接一段演示视频，存放在 `docs/video/`，语言与该 README 相同：1120 × 1680（竖版）。视频只展示合成的测试数据：曼哈顿下城的步行轨迹和斯坦福行车。

视频展示的内容有明显变化时：

1. 运行 `npm run video`。它会构建网站，在 4176 端口提供服务，然后按每种语言各演示一遍并录制下来。与截图一样，它会加载真实的底图瓦片和字体，因此需要联网。无需安装任何工具：H.264 由 Chromium 自己编码（WebCodecs），MP4 文件由 `tests/video/mp4.ts` 写出。
2. 提交之前，先看一遍这两段视频。

如果只想检查步骤而不生成视频，运行 `DEMO_DRY_RUN=<文件夹> npm run video`。它会每隔两秒把屏幕上的画面存到该文件夹，并列出每条字幕显示的时长。视频超过 60 秒会报错。`DEMO_BITRATE=<每秒比特数>` 可设定编码器的码率；默认取编码器所能接受的最高值，以获得最佳画质。

指针、点击处的圆环、红框和字幕都是录制时画进页面的，应用本身没有这些。

## 部署

GitHub 上运行两个 GitHub Actions 工作流：

- **CI**（`.github/workflows/ci.yml`）在每次推送和拉取请求时运行：安装依赖、代码检查、类型检查、带覆盖率的测试、计时测试、构建，然后运行浏览器测试。
- **Deploy to GitHub Pages**（`.github/workflows/pages.yml`）在每次推送到 `main` 时运行：安装依赖、单元测试和组件测试、构建，然后发布 `dist/`。

发布流程不会等待 CI。正因如此，推送前必须先在本地通过全部检查（见[每次推送之前](#每次推送之前)）。

发布需要两项仓库设置：

- 在 Settings → Pages 中，把来源设为 “GitHub Actions”。
- 在 GitHub 免费版中，Pages 只能发布公开仓库。

网站发布在 https://ricebucket.github.io/track-log-plotter/。基础路径 `/track-log-plotter/` 在 `vite.config.ts` 中设置。

## 你自己的记录

如果想在应用中试用自己的轨迹记录，请放在 `local-tracks/` 中。

- Git 会忽略该文件夹，开发服务器也不会提供其中的文件。
- 测试也会读取其中的每个记录，所以 `npm run check` 除了测试数据，也会用你的真实文件检验读取代码：
  - `npm test` 用应用本身的代码读取每个文件并检查结果：位置都在地球上、时间按顺序、推算值合理，地图数据也能生成。
  - `npm run test:e2e` 在构建好的应用中打开其中最多十个文件（仅桌面），检查能否载入并画出。
- 这些检查只报告文件名和数量，从不输出坐标。没有该文件夹时（例如在 GitHub 上），它们会自动跳过。
- 不要提交这些记录，也不要把其中的坐标复制到测试中。需要测试数据时，请扩展测试数据生成脚本，使用纽约市的合成数据。

## 添加语言

1. 复制 `src/i18n/en-US.json` 为新文件并翻译。
2. 在 `src/i18n/i18n.ts` 中注册（`LANGS`、`LOCALE` 和 `MESSAGES`）。
3. 有几处只为中文做了设置，需要让它们也认识新语言：
   - `src/i18n/i18n.ts` 中的 `initialLang()`：根据网址、保存的选择或浏览器的语言列表选出最初的语言；
   - 时钟格式：`src/time/zones.ts` 中的 `fmtClock()`，中文用 24 小时制，其他语言用 12 小时制；
   - 地图上的地名：`src/map/MapView.tsx` 中的 `applyLabels()`，把矢量底图的地名换成中文。
4. 添加该语言的 README 和开发指南。

测试会检查每条消息在每种语言中都存在，且占位符一致。
