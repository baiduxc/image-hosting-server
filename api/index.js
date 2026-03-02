const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const { initDatabase, testConnection } = require('../database');
const { transferImages, validateImageUrl } = require('../imageTransfer');
const { configManager } = require('../config');
const { authenticate, optionalAuth, requireAdmin } = require('../middleware/auth');

const authRoutes = require('../routes/auth');
const imageRoutes = require('../routes/images');
const userRoutes = require('../routes/users');
const configRoutes = require('../routes/config');
const storageRoutes = require('../routes/storage');
const databaseRoutes = require('../routes/database');
const apiRoutes = require('../routes/api');

const app = express();

// 中间件配置
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
  origin: '*',
  credentials: false,
  methods: '*',
  allowedHeaders: '*',
  exposedHeaders: '*'
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 数据库初始化标志
let dbInitialized = false;

// 数据库初始化中间件
app.use(async (req, res, next) => {
  if (!dbInitialized) {
    try {
      const dbConnected = await testConnection();
      if (dbConnected) {
        await initDatabase();
        dbInitialized = true;
      }
    } catch (error) {
      console.error('Database initialization error:', error);
    }
  }
  next();
});

// API路由
app.use('/api/auth', authRoutes);
app.use('/api/images', authenticate, imageRoutes);
app.use('/api/users', authenticate, userRoutes);
app.use('/api/config', authenticate, requireAdmin, configRoutes);
app.use('/api/storage', authenticate, requireAdmin, storageRoutes);
app.use('/api/database', authenticate, requireAdmin, databaseRoutes);
app.use('/api/v1', apiRoutes);
app.use('/api/keys', authenticate, apiRoutes);

// 健康检查
app.get('/api/health', async (req, res) => {
  try {
    const dbConnected = await testConnection();
    res.json({
      success: true,
      status: 'healthy',
      database: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      environment: 'vercel'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

// 根路由
app.get('/', (req, res) => {
  res.json({
    name: '图床管理系统 API',
    version: '1.0.0',
    status: 'running',
    platform: 'Vercel',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      images: '/api/images',
      docs: '/api/v1/docs'
    }
  });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = app;
