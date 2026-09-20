# my-mastra-app

Welcome to your new [Mastra](https://mastra.ai) project! We're excited to see what you build.

## 第一次使用 Mastra

这个项目现在包含两个 Agent：

- **Agent**：Mastra 模板自带的通用助手。
- **家庭法律预咨询助手**：逐轮梳理离婚、继承与家庭财产问题，并生成律师咨询摘要。

可以先把 Mastra 理解成下面四个部分：

- `Agent`：决定助手的身份、模型和对话行为。
- `instructions`：Agent 长期遵守的工作手册，家庭法律问题树也写在这里。
- `Memory`：保存聊天历史和当前案件的结构化信息。
- `Mastra`：应用入口；Agent 注册到这里之后，才会显示在 Studio 中。

本项目的重要位置：

```text
src/mastra/agents/family-legal-intake-agent.ts  法律 Agent、问题树和记忆结构
src/mastra/agents/agent.ts                      原通用 Agent
src/mastra/index.ts                             Mastra 入口和 Agent 注册
docs/mastra-core-concepts.md                    Mastra 基础概念学习笔记
docs/family-legal-agent-guide.md                流程设计与测试教程
```

### 配置并启动

法律 Agent 使用 DeepSeek。创建 `.env` 并填写密钥：

```shell
cp .env.example .env
```

```dotenv
DEEPSEEK_API_KEY=你的密钥
```

`.env` 已被 Git 忽略，不要把密钥写进 TypeScript、README 或提交记录。

启动 Studio：

```shell
npm run dev
```

然后打开 [http://localhost:4111](http://localhost:4111)，进入 **Agents**，选择 **家庭法律预咨询助手**，新建对话即可测试。

第一次可以输入：

```text
我想离婚，但不知道应该先考虑哪些问题。
```

Agent 每轮只会询问一个关键问题，并把回答保存到当前 thread 的 Structured Working Memory。新建 thread 相当于开始一份新的案件梳理，不会继承上一份案件信息。

### 修改对话流程

打开 `src/mastra/agents/family-legal-intake-agent.ts`：

- 修改 `instructions` 可以调整语气、问题顺序和完成条件。
- 修改 `familyLegalIntakeMemorySchema` 可以增加需要记录的案件字段。
- 修改 `metadata.suggestedPrompts` 可以调整 Studio 中显示的示例问题。

Mastra 基础概念见 [`docs/mastra-core-concepts.md`](docs/mastra-core-concepts.md)。详细设计、数据流和完整测试脚本见 [`docs/family-legal-agent-guide.md`](docs/family-legal-agent-guide.md)。

This starter provides you with a general-purpose Mastra agent that can research current information, manage multi-step tasks, work with local files, run approved shell commands, and create recurring schedules.

## Features

- A project-level `workspace/` for files and command execution
- Approval gates for file changes, deletions, and shell commands
- Conversation memory, generated thread titles, and task tracking
- Built-in web search and direct web page fetching
- Recurring schedules that persist across restarts
- Local libSQL storage and DuckDB observability, with optional Turso storage
- A bundled Mastra skill that helps coding agents use current Mastra APIs

## Get started

To use the original general-purpose agent, set `GOOGLE_GENERATIVE_AI_API_KEY` in `.env`. The family legal intake agent uses `DEEPSEEK_API_KEY`. Then run:

```shell
npm run dev
```

Open [http://localhost:4111](http://localhost:4111) in your browser to access [Mastra Studio](https://mastra.ai/docs/studio/overview).

Select **Agent** in Mastra Studio and try one of these prompts:

- `Get the weather forecast for Austin this weekend.`
- `Create a landing page for a Japanese sakura festival.`
- `Check the SPCX stock price now, then check it every minute.`

The agent asks for approval before it changes files or runs commands. When it creates a schedule, it returns an ID that you can use to pause the schedule.

## Workspace safety

The local filesystem tools stay inside the project-level `workspace/` directory. Shell commands start in that directory, but `LocalSandbox` does not provide operating-system isolation by default. Review command approvals carefully, and do not expose this template through an unauthenticated public server.

## Storage

The default `file:./mastra.db` database stores agent memory, tasks, and schedules locally. To use Turso, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env`.

Recurring schedules continue to use model tokens until you pause them. Ask the agent to pause a schedule with the ID returned by `start_schedule`.

## Making it yours

- Edit `src/mastra/agents/agent.ts` to change the model, instructions, memory, workspace, or approval policy.
- Edit `src/mastra/tools/` to customize scheduling.
- Edit `src/mastra/index.ts` to change storage and observability.
- Add files or reusable skills under `workspace/` for the agent to use.

## Learn more

To learn more about Mastra, visit our [documentation](https://mastra.ai/docs/). If you're new to AI agents, check out our [course](https://mastra.ai/learn) and [YouTube videos](https://youtube.com/@mastra-ai). You can also join our [Discord](https://discord.gg/mastra-ai) community to get help and share your projects.

## Deploy to the Mastra platform

The [Mastra platform](https://projects.mastra.ai) provides two products for deploying and managing AI applications built with the Mastra framework. Learn more in the [Mastra platform documentation](https://mastra.ai/docs/mastra-platform/overview).
