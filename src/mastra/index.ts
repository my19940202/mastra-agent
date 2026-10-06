import { Mastra } from '@mastra/core/mastra';
import { registerApiRoute } from '@mastra/core/server';
import { askUserTool } from '@mastra/core/tools';
import { MySQLStore } from '@mastra/mysql';
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
import { evaluateLegalLeadTool } from './tools/evaluate-legal-lead-tool';
import { createLegalLeadTool } from './tools/create-legal-lead-tool';
import { startScheduleTool, stopScheduleTool } from './tools/schedule-tools';
import { legalIntakeWorkflow } from './workflows/legal-intake-workflow';
import { legalIntakeScorers } from './scorers/legal-intake-scorers';
import { getLegalLead, initializeLegalLeadSchema, listLegalLeads } from './legal-lead-store';
import { getMysqlConnectionConfig } from './mysql-config';
import { miniappAgentRoute } from './miniapp-agent-route';

const mysqlStorageEnabled = process.env.MASTRA_STORAGE_BACKEND === 'mysql';
if (process.env.NODE_ENV === 'production' && !mysqlStorageEnabled) {
  throw new Error('Production requires MASTRA_STORAGE_BACKEND=mysql; refusing ephemeral local storage.');
}

function createMysqlStorage(): MySQLStore {
  return new MySQLStore({
    id: 'mastra-mysql-storage',
    ...getMysqlConnectionConfig(),
    max: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 10),
  });
}

const storage = mysqlStorageEnabled
  ? createMysqlStorage()
  : new MastraCompositeStore({
      id: 'composite-storage',
      default: new LibSQLStore({
        id: 'mastra-storage',
        url: process.env.TURSO_DATABASE_URL || 'file:./mastra.db',
        authToken: process.env.TURSO_AUTH_TOKEN || undefined,
      }),
      domains: {
        observability: await new DuckDBStore({
          path: process.env.MASTRA_DUCKDB_PATH ?? 'mastra.duckdb',
        }).getStore('observability'),
      },
    });

if (mysqlStorageEnabled) {
  await initializeLegalLeadSchema();
}

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  // Agent 只有注册到 Mastra 实例后，才会出现在 Studio 的 Agents 页面中。
  // 保留原通用 Agent，同时加入家庭法律预咨询 Agent，便于分别测试。
  agents: { agent, familyLegalIntakeAgent },
  tools: {
    startScheduleTool,
    stopScheduleTool,
    evaluateCaseReadinessTool,
    evaluateLegalLeadTool,
    createLegalLeadTool,
    askUserTool,
  },
  workflows: { legalIntakeWorkflow },
  // 注册后 Scorer 才能被 Studio、Trace 和 Dataset Experiment 按 id 找到。
  scorers: legalIntakeScorers,
  storage,
  server: {
    host: process.env.MASTRA_HOST ?? 'localhost',
    port: Number(process.env.PORT ?? 4111),
    apiRoutes: [
      miniappAgentRoute,
      registerApiRoute('/legal-leads', {
        method: 'GET',
        requiresAuth: false,
        handler: async c => c.json({ leads: await listLegalLeads() }),
      }),
      registerApiRoute('/legal-leads/:id', {
        method: 'GET',
        requiresAuth: false,
        handler: async c => {
          const lead = await getLegalLead(c.req.param('id'));
          return lead ? c.json({ lead }) : c.json({ error: '线索不存在' }, 404);
        },
      }),
    ],
  },
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
