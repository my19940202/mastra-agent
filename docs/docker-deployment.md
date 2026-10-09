# Docker 部署

当前镜像面向微信云托管 `run` 模式，也可在本地 Docker 中启动。

## 构建镜像

在 `my-mastra-app` 项目目录执行：

```sh
docker build -t family-legal-agent:local .
```

镜像基于 Node 22 Debian slim，多阶段构建 Mastra 应用；运行容器以非 root 用户启动，在 `0.0.0.0:8080` 提供服务。

## 配置数据库

先在 MySQL 实例中创建 `family_legal_agent` 数据库和专用应用账号 `mastra_app`。不要使用 `root` 运行应用。启动账号需要在该数据库内创建 Mastra 存储表和应用线索表，并对这些表执行日常读写；不要授予全实例管理权限。

在云托管环境的密钥配置中设置：

| 变量 | 用途 |
| --- | --- |
| `MYSQL_HOST` | MySQL 主机名 |
| `MYSQL_PORT` | MySQL 端口 |
| `MYSQL_DATABASE` | 数据库名，默认建议 `family_legal_agent` |
| `MYSQL_USER` | 专用应用账号 |
| `MYSQL_PASSWORD` | 专用账号密码 |
| `MYSQL_SSL` | 默认 `true`，按数据库 TLS 配置提供 CA/证书要求 |
| `MYSQL_SSL_CA` | 可选，容器内挂载的数据库 CA 证书路径 |
| `MYSQL_CONNECTION_LIMIT` | 每个容器的连接池上限，默认 `10` |
| `DEEPSEEK_API_KEY` | Agent 模型密钥 |
| `MASTRA_PLATFORM_ACCESS_TOKEN` | 可选；Mastra Platform Observability 项目访问令牌，用于在托管 Studio 查看部署 traces |
| `MASTRA_PROJECT_ID` | 可选；对应的 Mastra Platform 项目 ID，配置平台观测时必填 |

不要把这些值写进 Dockerfile、镜像、版本库或聊天记录。确保微信云托管容器的网络出口可访问 MySQL，并在数据库访问控制中只放行所需来源。若云托管出口地址不固定，先按云平台支持的网络连接方式配置，不要将数据库开放给任意公网来源。

TLS 默认开启并校验证书；若数据库使用自定义 CA，需要将 CA 证书安全挂载到容器，并设置 `MYSQL_SSL_CA` 指向该文件。只有确认网络隔离且为本地开发时，才设置 `MYSQL_SSL=false`。

### 部署耗时观测

应用已配置 Mastra Platform exporter 和 `family-legal-agent` 服务名。要在 Mastra Platform 的 Studio/Observability 页面查看云托管请求 traces，请在云托管环境变量中设置 `MASTRA_PLATFORM_ACCESS_TOKEN` 和 `MASTRA_PROJECT_ID`。令牌应使用云托管密钥配置，不要写入 Dockerfile、镜像或版本库。没有配置这两个变量时，部署端不会将 traces 上传到 Mastra Platform。

小程序 `/legal-agent/generate` trace 会显示请求解析、Agent 生成、可选联系卡评估和响应组装阶段的耗时；Agent、模型及工具 spans 会作为同一 trace 的子项显示。为避免把案件内容发送到观测平台，Agent trace 隐藏输入与输出，路由阶段 span 只记录成功状态，不记录请求或案件字段。

## 本地启动

准备本地未提交的 `.env`，填入上述变量后运行：

```sh
docker run --rm --env-file .env -p 8080:8080 family-legal-agent:local
```

访问 `http://localhost:8080`。容器启动时会连接 MySQL，运行线索表版本迁移；Mastra MySQL 存储会初始化自身表。数据库凭据错误、网络不可达或账号缺少初始化权限时，容器应启动失败。

## 本地开发

`npm run dev` 继续使用项目原有的本地 libSQL/SQLite 与 DuckDB。只有设置 `MASTRA_STORAGE_BACKEND=mysql` 才启用 MySQL 存储和线索表。

首次部署的 MySQL 数据库从空库初始化；不会自动导入本机 SQLite/DuckDB 开发数据。执行 `docker build` 与本地虚构数据验收前，确认配置的是测试数据库，不要使用真实用户线索。
