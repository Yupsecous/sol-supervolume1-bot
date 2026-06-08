module.exports = {
  apps: [
    {
      name: "sol-supervolume-bot",
      script: "src/index.ts",
      cwd: "d:/Solana/sol-supervolume-bot-master/sol-supervolume-bot-master",
      // Run the TypeScript entry directly via ts-node (transpile-only, see tsconfig.json)
      interpreter: "node",
      interpreter_args: "-r ts-node/register",
      // Telegram long-polling requires exactly ONE instance — never use cluster mode here.
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "20s",
      restart_delay: 5000,
      time: true,
      env: {
        NODE_ENV: "production",
        TS_NODE_TRANSPILE_ONLY: "true",
      },
    },
  ],
};
