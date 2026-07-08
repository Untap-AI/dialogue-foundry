// pm2 config for running the demo-setup service natively on the mac-mini.
// This is the recommended way to run it, since the service spawns the local
// Python web-crawler as a subprocess.
//
//   pnpm --filter @dialogue-foundry/demo-setup build
//   pm2 start apps/demo-setup/ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'demo-setup',
      cwd: __dirname,
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
}
