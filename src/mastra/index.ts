import './debug-instrumentation';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import {
  MastraStorageExporter,
  MastraPlatformExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';
import { agent } from './agents/agent';
import { familyLegalIntakeAgent } from './agents/family-legal-intake-agent';
import { evaluateCaseReadinessTool } from './tools/evaluate-case-readiness-tool';
import { startScheduleTool, stopScheduleTool } from './tools/schedule-tools';
import { legalIntakeWorkflow } from './workflows/legal-intake-workflow';
import { legalIntakeScorers } from './scorers/legal-intake-scorers';

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  // Agent 只有注册到 Mastra 实例后，才会出现在 Studio 的 Agents 页面中。
  // 保留原通用 Agent，同时加入家庭法律预咨询 Agent，便于分别测试。
  agents: { agent, familyLegalIntakeAgent },
  tools: { startScheduleTool, stopScheduleTool, evaluateCaseReadinessTool },
  workflows: { legalIntakeWorkflow },
  // 注册后 Scorer 才能被 Studio、Trace 和 Dataset Experiment 按 id 找到。
  scorers: legalIntakeScorers,
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: process.env.TURSO_DATABASE_URL || 'file:./mastra.db',
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
