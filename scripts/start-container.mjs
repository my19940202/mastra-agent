const required = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD', 'DEEPSEEK_API_KEY'];
const missing = required.filter(name => !process.env[name]);

if (missing.length) {
  console.error(`Container startup refused; missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

if (process.env.MASTRA_STORAGE_BACKEND !== 'mysql') {
  console.error('Container startup refused; MASTRA_STORAGE_BACKEND must be mysql.');
  process.exit(1);
}

process.env.MASTRA_HOST = '0.0.0.0';
process.env.PORT ??= '8080';

await import('../.mastra/output/index.mjs');
