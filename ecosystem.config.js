/**
 * PM2 Ecosystem Configuration
 * Run with: pm2 start ecosystem.config.js
 */

module.exports = {
    apps: [{
        name: 'multisig-dashboard',
        script: './server/app.js',
        instances: 'max', // Use all available CPU cores
        exec_mode: 'cluster', // Enable cluster mode for load balancing
        
        // Environment variables
        env: {
            NODE_ENV: 'development',
            PORT: 3000
        },
        env_production: {
            NODE_ENV: 'production',
            PORT: 3000
        },
        
        // Logging
        log_file: './logs/combined.log',
        out_file: './logs/out.log',
        error_file: './logs/error.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        merge_logs: true,
        
        // Process management
        max_memory_restart: '500M', // Restart if memory exceeds 500MB
        watch: false, // Don't watch files in production
        ignore_watch: ['node_modules', 'logs', '.git'],
        
        // Restart behavior
        autorestart: true,
        max_restarts: 10,
        min_uptime: '10s',
        restart_delay: 4000,
        
        // Graceful shutdown
        kill_timeout: 5000,
        wait_ready: true,
        listen_timeout: 10000
    }]
};
