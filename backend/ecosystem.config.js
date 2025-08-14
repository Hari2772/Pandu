module.exports = {
  apps: [
    {
      name: 'nearchat-backend',
      script: 'src/server.js',
      instances: 'max', // Use all available CPU cores
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      // Production optimization settings
      max_memory_restart: '1G',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      // Logging configuration
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Cluster specific settings
      kill_timeout: 5000,
      listen_timeout: 8000,
      // Health check
      health_check_grace_period: 3000,
      // Auto restart on file changes (development)
      watch: false,
      ignore_watch: ['node_modules', 'logs', '*.log'],
      // Environment variables
      env_file: '.env',
      // Advanced clustering
      instance_var: 'INSTANCE_ID',
      // Load balancing
      load_balancing_method: 'least-connection',
      // Graceful shutdown
      kill_retry_time: 100,
      // Memory management
      node_args: '--max-old-space-size=1024',
      // Process management
      autorestart: true,
      // Monitoring
      pmx: true,
      // Metrics
      metrics: {
        http: true,
        custom: {
          'active-users': {
            type: 'counter',
            unit: 'users'
          },
          'messages-per-second': {
            type: 'meter',
            unit: 'messages'
          }
        }
      }
    }
  ],
  
  // Deployment configuration
  deploy: {
    production: {
      user: 'ubuntu',
      host: 'your-production-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:your-org/nearchat-backend.git',
      path: '/var/www/nearchat-backend',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};