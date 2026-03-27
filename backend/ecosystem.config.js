const path = require('path');

const appRoot = process.env.APP_ROOT || '/srv/lab-miniapp-mvp';
const deployEnv = process.env.DEPLOY_ENV || 'staging';
const appName = process.env.PM2_APP_NAME || `lab-miniapp-backend-${deployEnv}`;

const envByMode = {
  staging: {
    NODE_ENV: 'staging',
    PORT: 3001,
    USE_MYSQL: 'true'
  },
  production: {
    NODE_ENV: 'production',
    PORT: 3000,
    USE_MYSQL: 'true'
  }
};

module.exports = {
  apps: [
    {
      name: appName,
      cwd: path.join(appRoot, 'backend'),
      script: 'src/app.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 2000,
      env_file: '.env',
      log_type: 'json',
      merge_logs: true,
      time: true,
      env: {
        ...envByMode[deployEnv],
        DEPLOY_ENV: deployEnv
      }
    }
  ]
};
