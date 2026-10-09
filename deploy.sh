DEPLOY_DIR="/tmp/mastra-agent-deploy.Pabgcm"

rsync -a \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.mastra/' \
  --exclude='tests/' \
  --exclude='docs/' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='*.db' \
  --exclude='*.db-*' \
  --exclude='*.sqlite*' \
  --exclude='*.duckdb*' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  --exclude='src/mastra/public/' \
  /Users/xishengbo/Desktop/git-repo/mastra-ai-project/my-mastra-app/ \
  "$DEPLOY_DIR/"

du -sh "$DEPLOY_DIR"
test -f "$DEPLOY_DIR/Dockerfile"
test -f "$DEPLOY_DIR/pnpm-lock.yaml"
test -f "$DEPLOY_DIR/scripts/start-container.mjs"
test ! -d "$DEPLOY_DIR/node_modules"
test ! -d "$DEPLOY_DIR/.mastra"
