import { readFileSync } from 'node:fs';

export type MysqlConnectionConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: false | { rejectUnauthorized: true; ca?: Buffer };
};

export function getMysqlConnectionConfig(): MysqlConnectionConfig {
  const required = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'] as const;
  for (const name of required) {
    if (!process.env[name]) {
      throw new Error(`${name} is required when MASTRA_STORAGE_BACKEND=mysql.`);
    }
  }

  const port = Number(process.env.MYSQL_PORT ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MYSQL_PORT must be an integer between 1 and 65535.');
  }

  const ssl = process.env.MYSQL_SSL === 'false'
    ? false
    : {
        rejectUnauthorized: true as const,
        ...(process.env.MYSQL_SSL_CA
          ? { ca: readFileSync(process.env.MYSQL_SSL_CA) }
          : {}),
      };

  return {
    host: process.env.MYSQL_HOST!,
    port,
    database: process.env.MYSQL_DATABASE!,
    user: process.env.MYSQL_USER!,
    password: process.env.MYSQL_PASSWORD!,
    ssl,
  };
}
