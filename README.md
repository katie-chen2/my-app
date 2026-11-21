# code-workspace

一个**双栏 AI 编程工作台**：左边和 AI Agent 对话，右边是代码编辑器。Agent 不会直接覆盖你的代码——它给出的改动会以 **Diff 视图**呈现，由你逐块决定接受还是拒绝。

基于 [`deepspace`](https://www.npmjs.com/package/deepspace) SDK 构建，部署在 Cloudflare Workers 上，线上地址：<https://code-workspace.app.space>

---

## 主要功能

### 1. 对话式改代码

左侧输入需求（重构、修 bug、加测试……），每轮对话都会把当前编辑器内容一起发给模型。回复里的代码块带一个 **Review changes** 按钮，点一下就把这段代码送进右侧的 Diff 视图。

### 2. Diff 审阅，逐块接受 / 拒绝

Agent 的改动**永远不会直接写入缓冲区**。右侧会切换成 diff 视图：

- 每个改动块（hunk）独立显示，带 `@@ −旧行 +新行 @@` 标记
- 每块可以单独 **Accept** 或 **Reject**，也可以一键全接受 / 全拒绝
- 顶部显示 `+N / −M` 统计和改动块数量

### 3. 感知你的手动编辑

`agentBaseline` 记录「Agent 上次看到的缓冲区」。如果你在等待回复期间手动改了代码，下次发送时会自动附上一份 diff，告诉模型「这些是用户手改的，请保留」。Diff 视图也会检测到这种情况并提示，可以点 **Re-diff against my edits** 重新对齐。

### 4. 选区浮动工具栏

在编辑器里选中一段代码，上方会浮出工具栏：

| 按钮 | 效果 |
| --- | --- |
| **Ask Agent** | 询问这段代码做什么、怎么改进 |
| **Refactor** | 重构，保持行为不变 |
| **Explain** | 逐步解释 |

点击后会把**选区文本 + 行号 + 文件名**打包成一条上下文提及，并把对应提示词填进左侧输入框，直接回车即可发送。

### 5. `@` 上下文提及

在输入框里打 `@` 会弹出选择器，支持四种上下文：

- `@editor.ts` — 整个文件
- `@selection` — 当前选区（带行号）
- `@greet` — 缓冲区里的任意符号（函数 / 类 / 接口 / 类型 / 箭头函数，支持 TS、Python、Go、Rust）
- `@error` — 粘贴的终端报错

键盘操作：`↑` `↓` 移动、`Enter` / `Tab` 插入、`Esc` 关闭。已选中的提及显示为可删除的 chip。

> **设计要点**：每条提及同时带 `token`（`@greet`，留在消息正文里）和 `payload`（完整文本 + 行号，追加在 `<<<MENTION_CONTEXT>>>` 标记之后发给模型）。对话记录保持可读，模型拿到完整上下文。

### 6. 其他

- 12 种语言高亮标记（TypeScript / TSX / JavaScript / Python / Go / Rust / SQL / JSON / CSS / HTML / Markdown / 纯文本）
- 行号栏与编辑区滚动同步，`Tab` 插入两个空格
- 模型选择器、新建 / 删除对话、历史对话自动恢复
- Credits 计量：余额不足时禁用发送并提示充值
- 流式输出，可随时中断

---

## 运行方法

### 环境要求

- Node.js `>=22.15.0 <23` 或 `>=24 <25` 或 `>=26 <27`
- npm `>=11.6.0`

### 1. 安装依赖

```sh
npm install
```

### 2. 登录 DeepSpace

```sh
npx deepspace auth login
```

### 3. 启动本地开发服务器

```sh
npm run dev
```

等价于 `npx deepspace dev start`，会同时启动 Vite 和 Miniflare（本地 Workers 运行时）。默认地址 <http://localhost:5173>。

### 4. 部署

```sh
npm run deploy
```

部署到 `https://<wrangler.toml 里的 name>.app.space`。

> 部署前请先提交：发布记录会绑定当前 commit，工作区有未提交改动时会拒绝部署。

---

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 本地开发服务器 |
| `npm run build` | 生产构建 |
| `npm run deploy` | 部署到 Cloudflare Workers |
| `npm run validate` | 类型检查 + 单元测试（提交前跑这个） |
| `npm run type-check` | 仅 `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test:unit` | Vitest 单元测试 |
| `npm run test:watch` | Vitest 监听模式 |
| `npm run test:smoke` | Playwright 冒烟测试 |
| `npm run test:api` | Playwright API 测试 |

---

## 项目结构

```
src/
├── pages/(app)/
│   ├── home.tsx              # 双栏工作台，持有所有跨栏状态
│   └── settings.tsx
├── components/workspace/
│   ├── AgentChat.tsx         # 左侧：流式对话、模型选择、@ 提及
│   ├── CodeEditor.tsx        # 右侧：编辑器 + 行号栏 + 选区工具栏
│   ├── DiffView.tsx          # Diff 审阅视图，逐块接受/拒绝
│   ├── SelectionToolbar.tsx  # 选区浮动工具栏
│   ├── MentionPicker.tsx     # @ 提及选择器
│   ├── chat-client.ts        # /api/ai/* 客户端，SSE 解码
│   ├── diff.ts               # 无依赖的行级 diff 算法
│   └── mentions.ts           # 提及模型：token / payload 构造
├── ai/
│   ├── agent.ts              # Agent 注册
│   ├── chat-routes.ts        # /api/ai/chats、/api/ai/chat
│   └── tools.ts              # Agent 可调用的工具
├── schemas.ts                # 集合定义（含 AI 对话历史）
└── server/                   # HTTP / 实时 / action 路由
worker.ts                     # Worker 入口
```

### 关键约束

- **`src/pages/(app)/_layout.tsx` 不要改**：它渲染 `<main className="flex-1 overflow-y-auto min-h-0">`，所以页面要用 `min-h-full` 而不是 `h-screen`，滚动由页面内部管理。
- **Agent 不直接写缓冲区**：所有改动都走 `proposal` → Diff 视图 → 用户接受。
- **`wrangler.toml` 的 `name` 只是子域名租约**，真正的身份是 `DEEPSPACE_APP_ID`（数据、密钥、协作者都绑定它）。改名只需改 `name` 后 `npx deepspace deploy --rename`，但显示名还要同步改 `src/constants.ts` 的 `APP_NAME`。

---

## 技术栈

React 19 · React Router 7 · TypeScript（strict）· Tailwind CSS 4 · Base UI · Vite · Cloudflare Workers · DeepSpace SDK · Vitest · Playwright
