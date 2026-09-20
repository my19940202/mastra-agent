# Mastra 基础概念学习笔记

这份笔记记录学习 Mastra 时最先需要建立的概念，并对照本仓库说明它们落在哪里。内容依据当前安装的 `@mastra/core@1.66.0` 嵌入文档，以及 [Mastra 官方文档](https://mastra.ai/docs)。

Mastra 是一个用 TypeScript 构建 AI Agent 应用的框架。它把 Agent、Tool、Workflow、Memory、Storage、Studio 和观测能力放在同一套运行时里，适合从本地原型做到可部署服务。

API 更新很快。写代码前优先查本仓库的 `node_modules/@mastra/core/dist/docs/`，或打开 [https://mastra.ai/llms.txt](https://mastra.ai/llms.txt)。

## 1. 先建立一张总图

一个 Mastra 应用可以先理解成：

```text
用户 / Studio / 前端
        │
        ▼
   Mastra 实例（src/mastra/index.ts）
        │
        ├── Agent：决定说什么、何时调用工具
        ├── Tool：做确定的事情（查 API、写文件、跑函数）
        ├── Workflow：按固定步骤执行
        ├── Memory：记住对话和结构化状态
        └── Storage：把记忆、工作流快照、追踪数据存下来
```

本项目已经有两个 Agent：

- 模板自带的通用 `agent`：带工具、工作区和记忆。
- 家庭法律预咨询 `familyLegalIntakeAgent`：几乎不靠工具，主要靠 `instructions` 和 Working Memory。

## 2. Mastra 实例

`new Mastra({...})` 是应用入口。Agent、Tool、Workflow、Scorer 只有注册到这里，才会出现在 Studio，并共享 storage、logger、observability。

本项目入口是 `src/mastra/index.ts`。当前注册了：

- `agents`：通用 Agent 和法律 Agent
- `tools`：定时任务相关工具
- `storage`：LibSQL 存业务状态，DuckDB 存观测数据
- `observability`：追踪导出

调用时尽量用 `mastra.getAgentById('...')`，不要直接 import 一个未接入实例的 Agent。前者才能用上共享的 storage 和观测。

本仓库约定：所有 agents、tools、workflows、scorers 都注册到 `src/mastra/index.ts`。

## 3. Agent

Agent 适合**步骤事先不确定**的开放任务。它会根据目标决定是否调用工具、调用几次、何时停止。

创建时最关键的字段：

| 字段 | 作用 |
| --- | --- |
| `id` | 稳定标识，代码里用它查找 |
| `name` | Studio 中显示的名字 |
| `instructions` | 长期工作手册：身份、边界、提问方式 |
| `model` | 使用的大模型 |
| `tools` | 可调用的工具 |
| `memory` | 对话记忆和结构化状态 |
| `agents` | 可委派的子 Agent |

调用方式：

- `.generate()`：等完整结果再返回，适合脚本和批处理。
- `.stream()`：边生成边输出，适合聊天界面。

法律 Agent 的问题树写在 `instructions` 里，案件字段写在 Working Memory schema 里。改流程时先改这两处，而不是先拆成多个 Agent。

详细流程见 [`family-legal-agent-guide.md`](./family-legal-agent-guide.md)。

## 4. Model Router

模型写成 `'provider/model-name'` 字符串，例如：

- `google/gemini-3.5-flash`
- `deepseek/deepseek-chat`

不要写成 `openai:gpt-...`，也不要自己传入 provider 对象。Mastra 会按 provider 去读对应环境变量，例如：

- OpenAI：`OPENAI_API_KEY`
- Google：`GOOGLE_API_KEY` 或本项目使用的 `GOOGLE_GENERATIVE_AI_API_KEY`
- DeepSeek：`DEEPSEEK_API_KEY`

完整列表见 [Models](https://mastra.ai/models) 和 [Environment Variables](https://mastra.ai/models/environment-variables)。

## 5. Tool

Tool 让 Agent 做模型自己做不好的事：请求 API、读写数据库、执行本地函数、调用 MCP。

必须用 `createTool()` 定义。普通对象看起来像工具，但运行时可能不会执行。当前签名是：

```ts
execute(inputData, context)
```

- 第一个参数：经过 `inputSchema` 校验的输入
- 第二个参数：运行时上下文，含 `requestContext`、`tracingContext`、`abortSignal`

`description` 和 schema 字段名会直接影响模型是否调用这个工具。Agent 的 `instructions` 里也要写清什么时候用、什么时候不用。

本项目的通用 Agent 使用了网页搜索、抓取页面、询问用户、启停定时任务等工具。法律 Agent 首版没有业务 Tool，是为了降低误操作和隐私风险。

## 6. Workflow

Workflow 适合**步骤事先明确**的流程：审批、ETL、固定管道、可暂停再继续的业务。

核心写法：

1. `createStep()` 定义一步，带 `inputSchema`、`outputSchema` 和 `execute`
2. `createWorkflow()` 组合步骤，用 `.then()` 等控制流，最后 `.commit()`
3. 注册到 `mastra.workflows`
4. `createRun()` 后调用 `.start()` 或 `.stream()`

Workflow 能做顺序、并行、条件、循环、嵌套、暂停/恢复。Studio 的 Workflows 页可以看图、填输入、逐步跑。

Agent 和 Workflow 怎么选：

| 更适合 Agent | 更适合 Workflow |
| --- | --- |
| 用户会跳答、改口、中途提问 | 输入输出和步骤顺序稳定 |
| 需要模型自己决定下一步 | 需要精确控制每一步数据怎么传 |
| 咨询、研究、开放对话 | 审批、批处理、固定业务管道 |

法律预咨询目前用 Agent + Working Memory，而不是 Workflow，因为用户路径不固定。

## 7. Memory

Memory 让 Agent 看见之前的消息和状态。没有 Memory 时，每一轮都像第一次见面。

调用时通常要带：

- `resource`：用户或实体的稳定 ID
- `thread`：一次对话/案件的 ID

同一 `resource + thread` 才能续上同一段记忆。Studio 里新建对话会开新 thread。

Memory 有几层：

| 能力 | 记住什么 | 什么时候用 |
| --- | --- | --- |
| Message History | 最近 N 条原始消息 | 多轮对话的默认基础 |
| Working Memory | 结构化的用户/案件信息表 | 需要稳定字段，例如姓名、目标、案件事实 |
| Observational Memory | 把旧对话压缩成观察记录 | 对话很长，原始历史会撑爆上下文 |
| Semantic Recall | 按语义检索更早的消息 | 需要跨很多轮找回相关内容 |

Working Memory 有两种范围：

- `resource`：同一用户的所有对话共享。适合偏好、档案。
- `thread`：只在当前对话有效。适合单次案件。

法律 Agent 使用 **thread 级 Structured Working Memory**。新建 thread 等于开始一份新案件，不会带上上一份隐私信息。

通用 Agent 开启了 Observational Memory，更适合长时间、多工具的探索任务。

## 8. Storage

Storage 是持久层。进程重启后，记忆、工作流快照、追踪、评测、定时任务都靠它还在。

数据按 domain 划分，常见包括：

- `memory`：消息、thread、Working Memory
- `workflows`：可恢复的工作流快照
- `observability`：trace、span、日志、反馈
- `scores` / `datasets` / `experiments`：评测数据
- `schedules` / `backgroundTasks` / `threadState`：长期运行状态

本项目用 `MastraCompositeStore`：

- 默认：LibSQL（本地 `mastra.db`，也可换成 Turso）
- `observability`：DuckDB，适合分析追踪数据

本地开发用文件数据库即可。生产环境通常改成 PostgreSQL 这类托管数据库，并把高流量的 observability 单独拆出去。

## 9. Studio

Studio 是本地面板，用来聊 Agent、跑 Workflow、看工具调用和追踪。

本项目启动方式：

```bash
npm run dev
```

然后打开 [http://localhost:4111](http://localhost:4111)。

常用入口：

- **Agents**：对话、看工具调用、看 Working Memory
- **Workflows**：看步骤图并逐步执行
- **Observability**：看一次请求经过了哪些模型调用和工具
- **Swagger**：`http://localhost:4111/swagger-ui`

改 `src/mastra/` 后开发服务器会自动重启。

## 10. 接着再学的概念

这些不是第一天就必须写进代码，但很快会用到。

### Processors 和 Guardrails

Processor 在消息到达模型前（`inputProcessors`）或返回用户前（`outputProcessors`）拦截、改写、拦截危险内容。常见用途：内容审核、PII 脱敏、限制 token、防 prompt injection。

### Observability

一次 Agent 调用会留下 trace。打开 Studio 的 Observability，可以看到模型实际吃到了哪些 memory、调用了哪些工具。调试“它为什么又问了一遍婚龄”时，先看 trace，再改 instructions。

### Evals / Scorers

模型输出不稳定，普通单元测试不够。Scorer 用规则或另一个模型给回答打分，可在线上抽样，也可放进 CI。法律 Agent 以后可以先评：有没有重复提问、有没有越权给确定性法律结论、安全风险是否被优先处理。

### Subagents

一个 supervisor Agent 可以把任务委派给更专业的子 Agent。适合领域变多之后，例如离婚、继承、劳动争议各自一个专家。首版不必上；拆分成本主要在路由和记忆隔离。

### Harness

Harness 管的是“一次请求之后还要继续干活”：断线可恢复、后台任务、定时、外部信号、长期目标。本项目通用 Agent 已经用了 workspace、schedules 和 signals。法律 Agent 目前不需要这些。

### RequestContext

按请求注入运行时信息，例如用户等级、租户、语言。可用来动态换模型、换 memory、换 instructions，而不把这些写死在 Agent 构造函数里。

## 11. 建议学习顺序

按这个顺序学，不容易被功能清单淹没：

1. **Studio + Mastra 实例**：能启动，能在面板里看到已注册的 Agent。
2. **Agent 的 `instructions` 和 `model`**：改一句话，观察回复如何变。
3. **Memory**：先搞清 thread / resource，再看 Working Memory。
4. **Tool**：给 Agent 加一个确定的能力，并在 Studio 里看 tool call。
5. **Storage**：理解数据存在哪，重启后对话是否还在。
6. **Workflow**：当你已经能说清“这三步顺序不能乱”时再学。
7. **Processors、Evals、Observability**：开始认真打磨质量和安全时再学。
8. **Subagents / Harness**：任务变长、变多、需要委派或长期运行时再学。

配套官方入口：

- [Get started](https://mastra.ai/docs)
- [Agents](https://mastra.ai/docs/agents/overview)
- [Tools](https://mastra.ai/docs/agents/tools)
- [Workflows](https://mastra.ai/docs/workflows/overview)
- [Memory](https://mastra.ai/docs/memory/overview)
- [Storage](https://mastra.ai/docs/storage)
- [Studio](https://mastra.ai/docs/studio/overview)

## 12. 和本仓库的对照

| 概念 | 本仓库位置 |
| --- | --- |
| Mastra 实例 | `src/mastra/index.ts` |
| 通用 Agent | `src/mastra/agents/agent.ts` |
| 法律 Agent | `src/mastra/agents/family-legal-intake-agent.ts` |
| Tool | `src/mastra/tools/schedule-tools.ts`，以及通用 Agent 引用的内置工具 |
| Memory | 两个 Agent 各自的 `new Memory({...})` |
| Storage | `src/mastra/index.ts` 里的 `MastraCompositeStore` |
| 法律流程设计 | [`family-legal-agent-guide.md`](./family-legal-agent-guide.md) |

如果只学一个最小闭环：改法律 Agent 的 `instructions` 或 Working Memory schema，然后在 Studio 新建 thread 验证。这已经覆盖了 Mastra 最核心的 Agent、Memory、Studio 三条线。
