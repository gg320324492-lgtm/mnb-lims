const path = require('path');

const appRoot = process.env.APP_ROOT || '/srv/lab-miniapp-mvp';
const deployEnv = process.env.DEPLOY_ENV || 'staging';
const appName = process.env.PM2_APP_NAME || `lab-miniapp-backend-${deployEnv}`;

const envByMode = {
  staging: {
    NODE_ENV: 'staging'
  },
  production: {
    NODE_ENV: 'production'
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
      env_file: '.env',
      env: {
        ...envByMode[deployEnv],
        DEPLOY_ENV: deployEnv
      }
    }
  ]
};
