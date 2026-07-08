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
      // The queue worker runs DEMO_WORKER_CONCURRENCY demos at once, each
      // spawning Chrome twice (shallow scrape, then deep crawl). 512M tripped
      // mid-crawl, and a restart kills in-flight browsers.
      max_memory_restart: '2G',
      // Give shutdown time to kill crawl subprocesses and hand queue rows back
      // before pm2 escalates to SIGKILL.
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
}
