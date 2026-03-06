const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// 导入数据库模块
const { initDatabase, testConnection, imageDB, statsDB, userDB } = require('./database');
const { dbAdapter, DB_TYPE } = require('./databaseAdapter');
// 导入图片转存模块
const { transferImages, validateImageUrl } = require('./imageTransfer');
// 导入配置管理模块
const { configManager } = require('./config');
// 导入认证中间件
const { authenticate, optionalAuth, requireAdmin } = require('./middleware/auth');

// 获取用户组信息
async function getUserGroupInfo(userId) {
  try {
    const userQuery = `SELECT group_id FROM users WHERE id = ${DB_TYPE === 'sqlite' ? '?' : '$1'}`;
    const userResult = await dbAdapter.query(userQuery, [userId]);
    const groupId = userResult.rows[0]?.group_id;

    let group;
    if (groupId) {
      const groupQuery = `SELECT * FROM user_groups WHERE id = ${DB_TYPE === 'sqlite' ? '?' : '$1'}`;
      const groupResult = await dbAdapter.query(groupQuery, [groupId]);
      group = groupResult.rows[0];
    }

    if (!group) {
      const defaultGroupQuery = `SELECT * FROM user_groups WHERE is_default = ${DB_TYPE === 'sqlite' ? '1' : 'true'} LIMIT 1`;
      const defaultGroupResult = await dbAdapter.query(defaultGroupQuery);
      group = defaultGroupResult.rows[0];
    }

    return group;
  } catch (error) {
    console.error('获取用户组信息失败:', error);
    return null;
  }
}

// 检查用户上传限制
async function checkUserUploadLimit(userId, fileCount) {
  const group = await getUserGroupInfo(userId);
  if (!group) {
    return { allowed: true };
  }

  const limits = {
    daily: parseInt(group.daily_upload_limit) || 0,
    weekly: parseInt(group.weekly_upload_limit) || 0,
    monthly: parseInt(group.monthly_upload_limit) || 0,
    concurrent: parseInt(group.concurrent_uploads) || 3
  };

  // 检查批量上传数量
  if (fileCount > limits.concurrent) {
    return {
      allowed: false,
      message: `批量上传数量超过限制（最大 ${limits.concurrent} 个）`
    };
  }

  // 获取今日上传数量
  let todayCount = 0;
  if (DB_TYPE === 'sqlite') {
    const result = await dbAdapter.query(
      `SELECT COUNT(*) as count FROM images WHERE user_id = ? AND date(created_at) = date('now', '+8 hours')`,
      [userId]
    );
    todayCount = parseInt(result.rows[0].count);
  } else {
    const result = await dbAdapter.query(
      `SELECT COUNT(*) as count FROM images WHERE user_id = $1 AND DATE(created_at) = CURRENT_DATE`,
      [userId]
    );
    todayCount = parseInt(result.rows[0].count);
  }

  if (limits.daily > 0 && todayCount + fileCount > limits.daily) {
    return {
      allowed: false,
      message: `今日上传数量已达上限（${limits.daily} 张）`
    };
  }

  // 检查周限制
  let weekCount = 0;
  if (DB_TYPE === 'sqlite') {
    const result = await dbAdapter.query(
      `SELECT COUNT(*) as count FROM images WHERE user_id = ? AND date(created_at) >= date('now', '-7 days', '+8 hours')`,
      [userId]
    );
    weekCount = parseInt(result.rows[0].count);
  } else {
    const result = await dbAdapter.query(
      `SELECT COUNT(*) as count FROM images WHERE user_id = $1 AND created_at >= DATE_TRUNC('week', CURRENT_DATE)`,
      [userId]
    );
    weekCount = parseInt(result.rows[0].count);
  }

  if (limits.weekly > 0 && weekCount + fileCount > limits.weekly) {
    return {
      allowed: false,
      message: `本周上传数量已达上限（${limits.weekly} 张）`
    };
  }

  // 检查月限制
  let monthCount = 0;
  if (DB_TYPE === 'sqlite') {
    const result = await dbAdapter.query(
      `SELECT COUNT(*) as count FROM images WHERE user_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', '+8 hours')`,
      [userId]
    );
    monthCount = parseInt(result.rows[0].count);
  } else {
    const result = await dbAdapter.query(
      `SELECT COUNT(*) as count FROM images WHERE user_id = $1 AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
      [userId]
    );
    monthCount = parseInt(result.rows[0].count);
  }

  if (limits.monthly > 0 && monthCount + fileCount > limits.monthly) {
    return {
      allowed: false,
      message: `本月上传数量已达上限（${limits.monthly} 张）`
    };
  }

  return { allowed: true, limits };
}
// 导入路由
const authRoutes = require('./routes/auth');
const imageRoutes = require('./routes/images');
const userRoutes = require('./routes/users');
const configRoutes = require('./routes/config');
const storageRoutes = require('./routes/storage');
const databaseRoutes = require('./routes/database');
const apiRoutes = require('./routes/api');
const userGroupRoutes = require('./routes/userGroups');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件配置
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
// CORS配置 - 全开放设置
app.use(cors({
  origin: '*', // 允许所有来源
  credentials: false, // 图床不需要凭证
  methods: '*', // 允许所有方法
  allowedHeaders: '*', // 允许所有头部
  exposedHeaders: '*' // 暴露所有头部
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件服务 - 提供上传的图片（全开放访问）
app.use('/uploads', (req, res, next) => {
  // 完全开放的CORS设置
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  res.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
  
  next();
}, express.static(path.join(__dirname, 'uploads')));

// API路由
app.use('/api/auth', authRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/users', userRoutes);
app.use('/api/config', configRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/database', databaseRoutes);
app.use('/api/user-groups', userGroupRoutes);  // 用户组管理
app.use('/api/v1', apiRoutes);  // 公开 API v1
app.use('/api/keys', apiRoutes);  // API 密钥管理（兼容路径）

// 根路由
app.get('/', (req, res) => {
  res.json({
    message: '图床管理系统 API 服务器',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      auth: '/api/auth',
      images: '/api/images',
      users: '/api/users'
    }
  });
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 图片代理接口已移除 - 现在直接使用对象存储URL，无需代理

// 上传到对象存储接口 - 优化版本，支持异步批量上传
app.post('/api/upload-to-storage', authenticate, async (req, res) => {
  try {
    const { files, storageId } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有提供文件数据'
      });
    }

    if (!storageId) {
      return res.status(400).json({
        success: false,
        message: '请选择存储方式'
      });
    }

    // 检查用户上传限制
    const limitCheck = await checkUserUploadLimit(req.user.id, files.length);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: limitCheck.message
      });
    }

    // 获取存储配置
    const { storageDB } = require('./database');
    const StorageService = require('./services/storageService');
    const storageService = new StorageService();
    
    const storage = await storageDB.getStorage(storageId);
    
    if (!storage) {
      return res.status(400).json({
        success: false,
        message: '存储配置不存在'
      });
    }

    const today = new Date().toISOString().split('T')[0];
    let totalSize = 0;
    let successCount = 0;

    // 异步处理单个文件的函数
    const processFile = async (fileData, index) => {
      try {
        
        // 上传到对象存储
        const uploadResult = await storageService.uploadFile(
          {
            type: storage.type,
            config: storage.config
          },
          fileData,
          storage.config.pathPrefix || ''
        );

        if (uploadResult.success) {
          // 保存到数据库
          const imageRecord = await imageDB.create({
            filename: uploadResult.fileName,
            originalName: fileData.name,
            filePath: uploadResult.fileName,
            fileUrl: uploadResult.url,
            fileSize: fileData.size,
            mimeType: fileData.type,
            uploadType: 'storage',
            userId: req.user.id,
            storageId: storageId
          });


          
          return {
            id: imageRecord.id,
            originalName: fileData.name,
            filename: uploadResult.fileName,
            size: fileData.size,
            mimeType: fileData.type,
            url: uploadResult.url,
            success: true,
            index: index
          };

        } else {
 
          
          return {
            originalName: fileData.name,
            size: fileData.size,
            mimeType: fileData.type,
            error: uploadResult.error,
            success: false,
            index: index
          };
        }
      } catch (error) {

        
        return {
          originalName: fileData.name,
          size: fileData.size,
          mimeType: fileData.type,
          error: error.message,
          success: false,
          index: index
        };
      }
    };

    // 使用Promise.allSettled并发处理所有文件，但限制并发数量
    const concurrencyLimit = 3; // 限制同时处理3个文件，避免过载
    const uploadedFiles = [];
    
    // 分批处理文件
    for (let i = 0; i < files.length; i += concurrencyLimit) {
      const batch = files.slice(i, i + concurrencyLimit);
      const batchPromises = batch.map((fileData, batchIndex) => 
        processFile(fileData, i + batchIndex)
      );
      

      
      // 等待当前批次完成
      const batchResults = await Promise.allSettled(batchPromises);
      
      // 处理批次结果
      batchResults.forEach((result, batchIndex) => {
        if (result.status === 'fulfilled') {
          const fileResult = result.value;
          uploadedFiles.push(fileResult);
          
          if (fileResult.success) {
            totalSize += fileResult.size;
            successCount++;
          }
        } else {
          // Promise被拒绝的情况
          const fileData = batch[batchIndex];
          uploadedFiles.push({
            originalName: fileData.name,
            size: fileData.size,
            mimeType: fileData.type,
            error: result.reason?.message || '未知错误',
            success: false,
            index: i + batchIndex
          });
        }
      });
      
    }

    // 按原始顺序排序结果
    uploadedFiles.sort((a, b) => a.index - b.index);
    
    // 移除index字段
    uploadedFiles.forEach(file => delete file.index);

    // 更新统计数据（只计算成功上传的文件）
    if (successCount > 0) {
      await statsDB.updateDailyStats(today, successCount, totalSize, 0);
    }

    // 返回结果
    const hasFailures = uploadedFiles.some(file => file.success === false);
    

    
    res.json({
      success: successCount > 0,
      message: hasFailures 
        ? `${successCount}/${files.length} 个文件上传成功` 
        : '所有文件上传成功',
      data: uploadedFiles,
      summary: {
        total: files.length,
        success: successCount,
        failed: files.length - successCount,
        totalSize: totalSize
      }
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: '上传失败',
      error: error.message
    });
  }
});


// URL验证接口
app.post('/api/validate-urls', async (req, res) => {
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供URL列表'
      });
    }

    const results = [];
    
    // 并发验证URL，但限制并发数
    const concurrency = 5;
    const chunks = [];
    
    for (let i = 0; i < urls.length; i += concurrency) {
      chunks.push(urls.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(async (url) => {
        try {
          const validation = await validateImageUrl(url.trim());
          return {
            url: url.trim(),
            ...validation
          };
        } catch (error) {
          return {
            url: url.trim(),
            valid: false,
            error: error.message
          };
        }
      });
      
      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    const validCount = results.filter(r => r.valid).length;
    
    res.json({
      success: true,
      message: `验证完成：${validCount}/${results.length} 个有效URL`,
      data: results
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: 'URL验证失败',
      error: error.message
    });
  }
});

// 网络图片转存接口（需要认证）
app.post('/api/transfer', authenticate, async (req, res) => {
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供有效的图片URL列表'
      });
    }

    // 检查用户上传限制
    const limitCheck = await checkUserUploadLimit(req.user.id, urls.length);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: limitCheck.message
      });
    }

    // 过滤和验证URL - 改进版本，支持复杂查询参数
    const validUrls = urls.filter(url => {
      // 清理URL - 移除前后的引号和空格
      const trimmedUrl = url.toString().trim().replace(/^["']|["']$/g, '');
      
      if (trimmedUrl.length === 0) return false;
      
      // 基本格式检查 - 更宽松的验证
      if (!trimmedUrl.match(/^https?:\/\/.+/i)) return false;
      
      // 检查是否包含域名
      if (!trimmedUrl.match(/^https?:\/\/[^\s\/]+\.[^\s\/]+/i)) return false;
      
      try {
        // 尝试直接解析URL
        new URL(trimmedUrl);
        return true;
      } catch {
        try {
          // 尝试解码后再验证
          const decodedUrl = decodeURIComponent(trimmedUrl);
          new URL(decodedUrl);
          return true;
        } catch {
          // 最宽松的检查 - 只要是基本的URL格式就通过
          return true;
        }
      }
    }).map(url => url.toString().trim().replace(/^["']|["']$/g, ''));

    if (validUrls.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有有效的图片URL'
      });
    }

    // 限制批量转存数量
    if (validUrls.length > 20) {
      return res.status(400).json({
        success: false,
        message: '单次最多支持转存20张图片'
      });
    }



    // 确保上传目录存在
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // 调用转存功能
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const results = await transferImages(validUrls, uploadDir, baseUrl, req.user.id);

    // 统计结果
    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    res.json({
      success: true,
      message: `批量转存完成：成功 ${successCount} 张，失败 ${failCount} 张`,
      data: results,
      summary: {
        total: results.length,
        success: successCount,
        failed: failCount
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '图片转存失败',
      error: error.message
    });
  }
});

// 获取图片列表接口
app.get('/api/images', async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', uploadType } = req.query;
    
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      search: search.toString(),
      uploadType: uploadType || null
    };

    const result = await imageDB.getList(options);

    // 转换数据格式以匹配前端期望
    const formattedImages = result.images.map(image => ({
      id: image.id,
      filename: image.filename,
      originalName: image.original_name,
      filePath: image.file_path,
      url: image.file_url,
      size: parseInt(image.file_size), // 确保是数字类型
      mimeType: image.mime_type,
      width: image.width,
      height: image.height,
      uploadType: image.upload_type,
      originalUrl: image.original_url,
      tags: image.tags || [],
      description: image.description,
      createdAt: image.created_at,
      updatedAt: image.updated_at
    }));



    res.json({
      success: true,
      data: {
        images: formattedImages,
        pagination: result.pagination
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取图片列表失败',
      error: error.message
    });
  }
});

// 删除图片接口
app.delete('/api/images/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 先获取图片信息
    const image = await imageDB.getById(parseInt(id));
    if (!image) {
      return res.status(404).json({
        success: false,
        message: '图片不存在'
      });
    }

    // 删除物理文件
    const filePath = path.join(__dirname, 'uploads', image.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // 软删除数据库记录
    await imageDB.delete(parseInt(id));

    res.json({
      success: true,
      message: '图片删除成功'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '删除图片失败',
      error: error.message
    });
  }
});

// 批量删除图片接口
app.delete('/api/images/batch', async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供要删除的图片ID列表'
      });
    }

    // 验证和转换ID
    const validIds = [];
    for (const id of ids) {
      const numId = Number(id);
      if (isNaN(numId) || !Number.isInteger(numId) || numId <= 0) {
        return res.status(400).json({
          success: false,
          message: `无效的图片ID: ${id}`
        });
      }
      validIds.push(numId);
    }


    
    const results = [];
    const batchSize = 3; // 每批处理3个图片
    
    // 分批处理图片删除
    for (let i = 0; i < validIds.length; i += batchSize) {
      const batch = validIds.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (id) => {
        try {

          
          // 获取图片信息
          const image = await imageDB.getById(id);
          if (!image) {

            return {
              id,
              success: false,
              message: '图片不存在'
            };
          }



          // 删除物理文件
          const filePath = path.join(__dirname, 'uploads', image.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);

          }

          // 软删除数据库记录
          await imageDB.delete(id);


          return {
            id,
            success: true,
            message: '删除成功'
          };
        } catch (error) {
          return {
            id,
            success: false,
            message: error.message
          };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      // 处理批次结果
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            id: batch[index],
            success: false,
            message: result.reason?.message || '删除失败'
          });
        }
      });

      // 批次间延迟，避免过于频繁的操作
      if (i + batchSize < validIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // 统计结果
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;



    res.json({
      success: true,
      message: `批量删除完成: 成功 ${successCount} 个，失败 ${failCount} 个`,
      data: {
        total: ids.length,
        success: successCount,
        failed: failCount,
        results: results
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '批量删除图片失败',
      error: error.message
    });
  }
});

// 图片代理接口，解决CORS问题
app.get('/api/proxy-image', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        message: '缺少图片URL参数'
      });
    }


    // 使用axios获取图片
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': new URL(url).origin
      }
    });

    // 设置响应头
    res.set({
      'Content-Type': response.headers['content-type'] || 'image/jpeg',
      'Cache-Control': 'public, max-age=86400', // 缓存1天
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type'
    });

    // 管道传输图片数据
    response.data.pipe(res);

  } catch (error) {
    
    // 返回默认占位图或错误信息
    res.status(404).json({
      success: false,
      message: '图片加载失败'
    });
  }
});

// 获取统计数据接口
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await statsDB.getOverallStats();

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取统计数据失败',
      error: error.message
    });
  }
});





// 错误处理中间件
app.use((error, req, res, next) => {
  res.status(500).json({
    success: false,
    message: '服务器内部错误',
    error: process.env.NODE_ENV === 'development' ? error.message : '服务器错误'
  });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: '接口不存在'
  });
});

// 启动服务器
const startServer = async () => {
  try {
    // 测试数据库连接

    const dbConnected = await testConnection();
    
    if (dbConnected) {
      // 初始化数据库
      await initDatabase();

    } else {

    }

    // 启动HTTP服务器
    app.listen(PORT, () => {
      console.log(`🚀 图床管理系统 API 服务器运行在 http://localhost:${PORT}`);
      console.log(`🌍 环境: ${process.env.NODE_ENV || 'development'}`);
      console.log(`💾 数据库状态: ${dbConnected ? '已连接' : '未连接'}`);
      console.log(`📦 存储方式: 对象存储`);
    });

  } catch (error) {
    process.exit(1);
  }
};

// 优雅关闭处理
process.on('SIGINT', async () => {
  console.log('\n🔄 正在关闭服务器...');
  const { closeDatabase } = require('./database');
  await closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 正在关闭服务器...');
  const { closeDatabase } = require('./database');
  await closeDatabase();
  process.exit(0);
});

// 启动服务器
startServer();

module.exports = app;