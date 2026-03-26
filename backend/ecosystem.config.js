module.exports = {
  apps: [
    {
      name: 'lab-miniapp-backend',
      cwd: '/srv/lab-miniapp-mvp/backend',
      script: 'src/app.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
