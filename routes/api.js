const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { imageDB, apiKeyDB, storageDB } = require('../database');
const { dbAdapter, DB_TYPE } = require('../databaseAdapter');

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
const { authenticate, authenticateApiKey, requireApiPermission } = require('../middleware/auth');
const { uploadToStorage, deleteFromStorage } = require('../services/storageService');

const router = express.Router();

// 检查用户上传限制
async function checkUploadLimit(userId, fileCount, fileSize) {
  const group = await getUserGroupInfo(userId);
  if (!group) {
    return { allowed: true }; // 如果无法获取组信息，允许上传
  }

  const limits = {
    daily: parseInt(group.daily_upload_limit) || 0,
    weekly: parseInt(group.weekly_upload_limit) || 0,
    monthly: parseInt(group.monthly_upload_limit) || 0,
    maxFileSize: parseInt(group.max_file_size) || 10,
    concurrent: parseInt(group.concurrent_uploads) || 3
  };

  // 检查单文件大小限制
  if (fileSize > limits.maxFileSize * 1024 * 1024) {
    return {
      allowed: false,
      message: `单文件大小超过限制（最大 ${limits.maxFileSize}MB）`
    };
  }

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

  // 检查日限制
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

  return { allowed: true };
}

// 配置 multer 用于文件上传
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
    files: 20
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型'), false);
    }
  }
});

// ==================== API 密钥管理接口 ====================

// 获取用户的所有 API 密钥
router.get('/', authenticate, async (req, res) => {
  try {
    const keys = await apiKeyDB.getApiKeysByUserId(req.user.id);
    
    // 隐藏完整的 API 密钥，只显示前缀
    const safeKeys = keys.map(key => ({
      ...key,
      api_key: key.api_key.substring(0, 10) + '...' + key.api_key.substring(key.api_key.length - 4)
    }));
    
    res.json({
      success: true,
      data: safeKeys
    });
  } catch (error) {
    console.error('获取 API 密钥列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取 API 密钥列表失败'
    });
  }
});

// 创建新的 API 密钥
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, permissions = ['upload', 'view'], expiresAt } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供密钥名称'
      });
    }

    // 验证权限值
    const validPermissions = ['upload', 'view', 'delete', 'manage', 'all'];
    const filteredPermissions = permissions.filter(p => validPermissions.includes(p));
    
    if (filteredPermissions.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请至少选择一个有效权限'
      });
    }

    const newKey = await apiKeyDB.createApiKey(
      req.user.id,
      name.trim(),
      filteredPermissions,
      expiresAt || null
    );
    
    res.json({
      success: true,
      message: 'API 密钥创建成功，请妥善保管',
      data: newKey
    });
  } catch (error) {
    console.error('创建 API 密钥失败:', error);
    res.status(500).json({
      success: false,
      message: '创建 API 密钥失败'
    });
  }
});

// 更新 API 密钥
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, permissions } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供密钥名称'
      });
    }

    const validPermissions = ['upload', 'view', 'delete', 'manage', 'all'];
    const filteredPermissions = (permissions || []).filter(p => validPermissions.includes(p));

    const updated = await apiKeyDB.updateApiKey(id, req.user.id, {
      name: name.trim(),
      permissions: filteredPermissions.length > 0 ? filteredPermissions : ['upload', 'view']
    });
    
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'API 密钥不存在或无权操作'
      });
    }

    res.json({
      success: true,
      message: 'API 密钥更新成功',
      data: {
        ...updated,
        api_key: updated.api_key.substring(0, 10) + '...' + updated.api_key.substring(updated.api_key.length - 4)
      }
    });
  } catch (error) {
    console.error('更新 API 密钥失败:', error);
    res.status(500).json({
      success: false,
      message: '更新 API 密钥失败'
    });
  }
});

// 切换 API 密钥状态
router.patch('/:id/toggle', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const updated = await apiKeyDB.toggleApiKey(id, req.user.id);
    
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'API 密钥不存在或无权操作'
      });
    }

    res.json({
      success: true,
      message: updated.is_active ? 'API 密钥已启用' : 'API 密钥已禁用',
      data: {
        ...updated,
        api_key: updated.api_key.substring(0, 10) + '...' + updated.api_key.substring(updated.api_key.length - 4)
      }
    });
  } catch (error) {
    console.error('切换 API 密钥状态失败:', error);
    res.status(500).json({
      success: false,
      message: '切换 API 密钥状态失败'
    });
  }
});

// 删除 API 密钥
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const deleted = await apiKeyDB.deleteApiKey(id, req.user.id);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'API 密钥不存在或无权操作'
      });
    }

    res.json({
      success: true,
      message: 'API 密钥已删除'
    });
  } catch (error) {
    console.error('删除 API 密钥失败:', error);
    res.status(500).json({
      success: false,
      message: '删除 API 密钥失败'
    });
  }
});

// ==================== 公开 API 接口 ====================

// 上传图片
router.post('/upload', authenticateApiKey, requireApiPermission('upload'), upload.array('images', 20), async (req, res) => {
  try {
    const files = req.files;
    
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'NO_FILES',
        message: '请上传至少一个图片文件'
      });
    }

    // 检查上传限制
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const limitCheck = await checkUploadLimit(req.user.id, files.length, totalSize / files.length);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        success: false,
        code: 'LIMIT_EXCEEDED',
        message: limitCheck.message
      });
    }

    // 获取默认存储或指定存储
    const storageId = req.body.storage_id || req.query.storage_id;
    let storageConfig;
    
    if (storageId) {
      storageConfig = await storageDB.getStorage(storageId);
    } else {
      storageConfig = await storageDB.getDefaultStorage();
    }

    if (!storageConfig) {
      return res.status(500).json({
        success: false,
        code: 'NO_STORAGE',
        message: '未配置可用的存储服务'
      });
    }

    const results = [];
    const errors = [];

    for (const file of files) {
      try {
        // 生成唯一文件名
        const ext = path.extname(file.originalname).toLowerCase() || '.png';
        const hash = crypto.createHash('md5').update(file.buffer).digest('hex').substring(0, 8);
        const timestamp = Date.now();
        const filename = `${timestamp}_${hash}${ext}`;

        // 上传到存储服务
        const uploadResult = await uploadToStorage(storageConfig, file.buffer, filename, file.mimetype);

        // 保存到数据库
        const imageData = {
          user_id: req.user.id,
          filename: filename,
          original_name: file.originalname,
          file_path: uploadResult.path,
          file_url: uploadResult.url,
          file_size: file.size,
          mime_type: file.mimetype,
          width: null,
          height: null,
          upload_type: 'api',
          storage_id: storageConfig.id
        };

        const savedImage = await imageDB.create(imageData);
        
        results.push({
          id: savedImage.id,
          filename: savedImage.filename,
          original_name: savedImage.original_name,
          url: savedImage.file_url,
          size: savedImage.file_size,
          mime_type: savedImage.mime_type
        });
      } catch (uploadError) {
        console.error('上传文件失败:', file.originalname, uploadError);
        errors.push({
          filename: file.originalname,
          error: uploadError.message
        });
      }
    }

    res.json({
      success: true,
      code: 'UPLOAD_SUCCESS',
      message: `成功上传 ${results.length} 个文件${errors.length > 0 ? `，${errors.length} 个失败` : ''}`,
      data: {
        uploaded: results,
        failed: errors
      }
    });
  } catch (error) {
    console.error('API 上传失败:', error);
    res.status(500).json({
      success: false,
      code: 'UPLOAD_ERROR',
      message: '上传过程发生错误',
      error: error.message
    });
  }
});

// 获取图片列表
router.get('/images', authenticateApiKey, requireApiPermission('view'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const result = await imageDB.getByUserId(req.user.id, limit, offset);
    
    res.json({
      success: true,
      code: 'SUCCESS',
      data: {
        images: result.images.map(img => ({
          id: img.id,
          filename: img.filename,
          original_name: img.original_name,
          url: img.file_url,
          size: img.file_size,
          mime_type: img.mime_type,
          width: img.width,
          height: img.height,
          created_at: img.created_at
        })),
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit)
        }
      }
    });
  } catch (error) {
    console.error('API 获取图片列表失败:', error);
    res.status(500).json({
      success: false,
      code: 'LIST_ERROR',
      message: '获取图片列表失败'
    });
  }
});

// 获取单张图片信息
router.get('/images/:id', authenticateApiKey, requireApiPermission('view'), async (req, res) => {
  try {
    const { id } = req.params;
    const image = await imageDB.getById(id);
    
    if (!image) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: '图片不存在'
      });
    }

    // 检查权限（只能查看自己的图片）
    if (image.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: '无权查看此图片'
      });
    }

    res.json({
      success: true,
      code: 'SUCCESS',
      data: {
        id: image.id,
        filename: image.filename,
        original_name: image.original_name,
        url: image.file_url,
        size: image.file_size,
        mime_type: image.mime_type,
        width: image.width,
        height: image.height,
        created_at: image.created_at
      }
    });
  } catch (error) {
    console.error('API 获取图片信息失败:', error);
    res.status(500).json({
      success: false,
      code: 'GET_ERROR',
      message: '获取图片信息失败'
    });
  }
});

// 删除图片
router.delete('/images/:id', authenticateApiKey, requireApiPermission('delete'), async (req, res) => {
  try {
    const { id } = req.params;
    const image = await imageDB.getById(id);
    
    if (!image) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: '图片不存在'
      });
    }

    // 检查权限（只能删除自己的图片）
    if (image.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: '无权删除此图片'
      });
    }

    // 从存储服务删除
    if (image.storage_id) {
      const storageConfig = await storageDB.getStorage(image.storage_id);
      if (storageConfig) {
        try {
          await deleteFromStorage(storageConfig, image.file_path);
        } catch (deleteError) {
          console.error('从存储删除文件失败:', deleteError);
        }
      }
    }

    // 从数据库删除（软删除）
    await imageDB.softDelete(id);

    res.json({
      success: true,
      code: 'DELETE_SUCCESS',
      message: '图片已删除'
    });
  } catch (error) {
    console.error('API 删除图片失败:', error);
    res.status(500).json({
      success: false,
      code: 'DELETE_ERROR',
      message: '删除图片失败'
    });
  }
});

// 批量删除图片
router.post('/images/batch-delete', authenticateApiKey, requireApiPermission('delete'), async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_IDS',
        message: '请提供要删除的图片 ID 列表'
      });
    }

    const results = { deleted: [], failed: [] };

    for (const id of ids) {
      try {
        const image = await imageDB.getById(id);
        
        if (!image) {
          results.failed.push({ id, reason: '图片不存在' });
          continue;
        }

        if (image.user_id !== req.user.id && req.user.role !== 'admin') {
          results.failed.push({ id, reason: '无权删除' });
          continue;
        }

        // 从存储删除
        if (image.storage_id) {
          const storageConfig = await storageDB.getStorage(image.storage_id);
          if (storageConfig) {
            try {
              await deleteFromStorage(storageConfig, image.file_path);
            } catch (e) {
              console.error('从存储删除失败:', e);
            }
          }
        }

        await imageDB.softDelete(id);
        results.deleted.push(id);
      } catch (e) {
        results.failed.push({ id, reason: e.message });
      }
    }

    res.json({
      success: true,
      code: 'BATCH_DELETE_COMPLETE',
      message: `成功删除 ${results.deleted.length} 个，失败 ${results.failed.length} 个`,
      data: results
    });
  } catch (error) {
    console.error('API 批量删除失败:', error);
    res.status(500).json({
      success: false,
      code: 'BATCH_DELETE_ERROR',
      message: '批量删除失败'
    });
  }
});

// 获取用户统计信息
router.get('/stats', authenticateApiKey, requireApiPermission('view'), async (req, res) => {
  try {
    const stats = await imageDB.getUserStats(req.user.id);
    
    res.json({
      success: true,
      code: 'SUCCESS',
      data: {
        total_images: stats.totalImages || 0,
        total_size: stats.totalSize || 0,
        today_uploads: stats.todayUploads || 0
      }
    });
  } catch (error) {
    console.error('API 获取统计信息失败:', error);
    res.status(500).json({
      success: false,
      code: 'STATS_ERROR',
      message: '获取统计信息失败'
    });
  }
});

// API 文档端点
router.get('/docs', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}/api/v1`;
  
  res.json({
    success: true,
    data: {
      name: '图床 API',
      version: 'v1',
      baseUrl,
      authentication: {
        type: 'API Key',
        header: 'X-API-Key',
        description: '在请求头中添加 X-API-Key: your_api_key，或在查询参数中添加 ?api_key=your_api_key'
      },
      permissions: [
        { name: 'upload', description: '上传图片权限' },
        { name: 'view', description: '查看图片权限' },
        { name: 'delete', description: '删除图片权限' },
        { name: 'manage', description: '管理图片权限（更新信息等）' },
        { name: 'all', description: '所有权限' }
      ],
      endpoints: [
        {
          method: 'POST',
          path: '/upload',
          description: '上传图片',
          permission: 'upload',
          parameters: {
            body: {
              images: '(multipart/form-data) 图片文件，支持多文件上传',
              storage_id: '(可选) 指定存储配置 ID'
            }
          },
          response: {
            uploaded: '成功上传的图片列表',
            failed: '上传失败的文件列表'
          }
        },
        {
          method: 'GET',
          path: '/images',
          description: '获取图片列表',
          permission: 'view',
          parameters: {
            query: {
              page: '页码，默认 1',
              limit: '每页数量，默认 20，最大 100'
            }
          }
        },
        {
          method: 'GET',
          path: '/images/:id',
          description: '获取单张图片信息',
          permission: 'view'
        },
        {
          method: 'DELETE',
          path: '/images/:id',
          description: '删除单张图片',
          permission: 'delete'
        },
        {
          method: 'POST',
          path: '/images/batch-delete',
          description: '批量删除图片',
          permission: 'delete',
          parameters: {
            body: {
              ids: '要删除的图片 ID 数组'
            }
          }
        },
        {
          method: 'GET',
          path: '/stats',
          description: '获取用户统计信息',
          permission: 'view'
        }
      ],
      errorCodes: [
        { code: 'NO_API_KEY', message: '未提供 API 密钥' },
        { code: 'INVALID_API_KEY', message: 'API 密钥无效或已被禁用' },
        { code: 'API_KEY_EXPIRED', message: 'API 密钥已过期' },
        { code: 'PERMISSION_DENIED', message: '权限不足' },
        { code: 'NOT_FOUND', message: '资源不存在' },
        { code: 'FORBIDDEN', message: '无权访问' }
      ]
    }
  });
});

module.exports = router;
