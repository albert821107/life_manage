require('dotenv').config();

module.exports = {
  apps: [
    {
      name: 'life-manager',
      script: './js/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3100
      },
      error_file: './logs/server/error/error.log',
      out_file: './logs/server/out/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M'
    }
  ]
};
