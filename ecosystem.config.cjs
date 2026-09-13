/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

const nextDistDir = process.env.NEXT_DIST_DIR || ".next";
const runtimeSecretKeys = [
  "ADMIN_USER",
  "ADMIN_PASS",
  "ADMIN_SESSION_SECRET",
];
// Keep retired keys in the PM2 filter so a rolling reload removes values left
// in process metadata by an older release.
const retiredSecretKeys = [
  "SUPABASE_SECRET_KEY",
  "OPENROUTER_KEY",
  "RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL",
  "RESEARCH_LAB_ALERT_RESEND_API_KEY",
  "RESEARCH_LAB_ALERT_EMAIL_FROM",
  "RESEARCH_LAB_ALERT_EMAIL_TO",
  "RESEARCH_LAB_ALERT_EMAIL_REPLY_TO",
];

module.exports = {
  apps: [
    {
      name: "subnet-dashboard",
      cwd: __dirname,
      script: path.join(__dirname, "scripts/start-production.mjs"),
      args: "start -p 3000",
      exec_mode: "cluster",
      instances: 1,
      autorestart: true,
      // The Next.js worker normally holds roughly 1 GB RSS after startup.
      // The old 700 MB limit monitored only an `npm` wrapper;
      // after migrating PM2 to the real Next.js process it caused a restart loop.
      max_memory_restart: "1400M",
      listen_timeout: 30000,
      kill_timeout: 10000,
      merge_logs: true,
      // The launcher retrieves these after PM2 creates the worker. Excluding
      // them here prevents an older CLI-injected copy from surviving in PM2's
      // process metadata or its reboot snapshot.
      filter_env: [...runtimeSecretKeys, ...retiredSecretKeys],
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=512",
        NEXT_DIST_DIR: nextDistDir,
        AWS_REGION: "us-east-1",
        AWS_DEFAULT_REGION: "us-east-1",
        SUBNET_DASHBOARD_SECRET_ID: "leadpoet/prod/subnet-dashboard/env",
      },
    },
  ],
};
