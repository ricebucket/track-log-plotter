# 轨迹绘图器（Track Log Plotter）

[English](README.md)

在浏览器中把 GPS 轨迹记录画在地图上。打开电脑上的 GPX 和 NMEA 文件，即可在可缩放的地图上查看，并按速度、海拔、坡度、HDOP、参与定位的卫星数或定位类型着色，同时用线条周围的光晕显示第二项数据。

**在线使用：** https://ricebucket.github.io/track-log-plotter/

## 功能

- **多条轨迹。** 最多载入 10 条，同时显示 3 条。只显示一条时使用多色渐变；显示多条时，每条轨迹各有一个色系，便于区分。
- **颜色与光晕。** 每条轨迹都可以分别选择颜色和光晕所表示的数据。光晕越接近数据的另一端越宽，一眼可以看出两项数据。
- **时间轴。** 每条显示的轨迹一条通道，共用一个光标。同时记录的轨迹按时钟对齐（例如一起携带的两个记录器）；其他时间记录的轨迹按起点对齐。
- **定位点检查。** 光标处显示该时刻的所有数值：速度、海拔、椭球高、坡度、HDOP、VDOP、PDOP、参与定位的卫星数、定位类型、航向、按键标记以及在文件中的行号。
- **损坏的记录也能载入。** 最后一行被截断、校验和不符、语句粘连、杂乱字节、时间倒退或不可能的跳变都会被跳过，并在轨迹详情页中列出。
- **无需密钥的底图。** OpenStreetMap、OpenFreeMap 浅色与深色、OpenTopoMap 以及 Esri 卫星影像（影像与影像 + 地名），并可在 Google 地图中打开同一位置。
- **时区。** 本地时间、UTC 或任意时区。
- **English 和简体中文**，一键切换。

支持 GPX 和 NMEA。

## 隐私

轨迹文件不会离开你的电脑：文件在浏览器中读取，不会上传。为了绘制地图，浏览器会请求：

- 你所选底图的地图瓦片（该服务商能看到你查看的区域），以及
- 来自 Google Fonts 的 Overpass 字体（Google 会收到你的 IP 地址和浏览器信息）。

你的设置（语言、底图、单位、时区）保存在浏览器中。没有统计分析，也不使用 Cookie。

## 底图与署名

| 底图 | 提供方 |
| --- | --- |
| OpenStreetMap | © OpenStreetMap 贡献者 |
| 浅色、深色 | OpenFreeMap，© OpenStreetMap 贡献者 |
| 地形 | © OpenTopoMap（CC-BY-SA），© OpenStreetMap 贡献者，SRTM |
| 卫星影像、影像 + 地名 | Esri World Imagery：Esri、Maxar、Earthstar Geographics 及 GIS 用户社区 |

应用会在地图上显示各提供方的署名。

## 开发

每次推送之前，请按照 [DEVELOPMENT.zh-CN.md](DEVELOPMENT.zh-CN.md) 操作：其中按顺序列出了需要运行的检查和步骤。

需要 Node.js 20 或更新版本。

```sh
npm install        # 在此文件夹中安装全部依赖
npm run dev        # http://localhost:5173/track-log-plotter/
```

构建、测试和代码检查工具也可以放在上级文件夹中，Node 会自动找到。这种情况下，在此处只需用 `npm install --omit=dev` 安装应用本身的库。

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run build` | 生成正式版本到 `dist/` |
| `npm run preview` | 预览正式版本 |
| `npm test` | 单元测试和组件测试（Vitest） |
| `npm run test:coverage` | 同上，并统计覆盖率 |
| `npm run test:e2e` | 浏览器测试（Playwright，Chromium） |
| `npm run lint` | oxlint 代码检查 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run check` | 以上全部 |
| `npm run fixtures` | 重新生成测试数据和示例骑行 |

### 测试数据

所有测试文件以及 `public/sample/` 中的示例骑行都是纽约市内的合成轨迹，由 `scripts/make-fixtures.mjs` 生成。如果仓库中有任何坐标落在纽约市以外，测试就会失败。

你自己的记录请放在 `local-tracks/` 中。Git 会忽略该文件夹，开发服务器也不会提供其中的文件。

### 添加语言

1. 复制 `src/i18n/en-US.json` 为新文件并翻译。
2. 在 `src/i18n/i18n.ts` 中注册（`LANGS`、`LOCALE` 和 `MESSAGES`）。
3. 添加该语言的 README。

测试会检查每条消息在每种语言中都存在，且占位符一致。

## 部署

- `.github/workflows/ci.yml` 在每次推送和拉取请求时运行代码检查、类型检查、测试、构建和浏览器测试。
- `.github/workflows/pages.yml` 把 `main` 分支发布到 GitHub Pages。请在仓库设置中把 Pages 设为通过 GitHub Actions 部署。

## 许可证

GPL-3.0，详见 [LICENSE](LICENSE)。
