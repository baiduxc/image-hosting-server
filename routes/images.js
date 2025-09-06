const express = require('express');
const { imageDB, storageDB } = require('../database');
const { authenticate, optionalAuth, requireOwnerOrAdmin } = require('../middleware/auth');
const StorageService = require('../services/storageService');

const router = express.Router();

// 获取图片列表（支持可选认证）
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', uploadType } = req.query;
    
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      search: search.toString(),
      uploadType: uploadType || null
    };

    // 如果用户已登录且不是管理员，只显示自己的图片
    if (req.user && req.user.role !== 'admin') {
      options.userId = req.user.id;
    }

    const result = await imageDB.getList(options);

    // 转换数据格式以匹配前端期望
    const formattedImages = result.images.map(image => ({
      id: image.id,
      userId: image.user_id,
      filename: image.filename,
      originalName: image.original_name,
      filePath: image.file_path,
      url: image.file_url,
      size: parseInt(image.file_size),
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
    console.error('获取图片列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取图片列表失败',
      error: error.message
    });
  }
});

// 获取单个图片信息
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const image = await imageDB.getById(parseInt(id));
    
    if (!image) {
      return res.status(404).json({
        success: false,
        message: '图片不存在'
      });
    }

    // 检查权限：管理员可以查看所有图片，普通用户只能查看自己的图片
    if (req.user && req.user.role !== 'admin' && image.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: '没有权限访问此图片'
      });
    }

    const formattedImage = {
      id: image.id,
      userId: image.user_id,
      filename: image.filename,
      originalName: image.original_name,
      filePath: image.file_path,
      url: image.file_url,
      size: parseInt(image.file_size),
      mimeType: image.mime_type,
      width: image.width,
      height: image.height,
      uploadType: image.upload_type,
      originalUrl: image.original_url,
      tags: image.tags || [],
      description: image.description,
      createdAt: image.created_at,
      updatedAt: image.updated_at
    };

    res.json({
      success: true,
      data: formattedImage
    });

  } catch (error) {
    console.error('获取图片信息错误:', error);
    res.status(500).json({
      success: false,
      message: '获取图片信息失败',
      error: error.message
    });
  }
});

// 更新图片信息
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { tags, description } = req.body;
    
    // 获取图片信息
    const image = await imageDB.getById(parseInt(id));
    if (!image) {
      return res.status(404).json({
        success: false,
        message: '图片不存在'
      });
    }

    // 检查权限：管理员可以编辑所有图片，普通用户只能编辑自己的图片
    if (req.user.role !== 'admin' && image.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: '没有权限编辑此图片'
      });
    }

    const updateData = {};
    if (tags !== undefined) updateData.tags = tags;
    if (description !== undefined) updateData.description = description;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有要更新的字段'
      });
    }

    const updatedImage = await imageDB.update(parseInt(id), updateData);

    res.json({
      success: true,
      message: '图片信息更新成功',
      data: {
        id: updatedImage.id,
        tags: updatedImage.tags,
        description: updatedImage.description,
        updatedAt: updatedImage.updated_at
      }
    });

  } catch (error) {
    console.error('更新图片信息错误:', error);
    res.status(500).json({
      success: false,
      message: '更新图片信息失败',
      error: error.message
    });
  }
});

// 删除图片
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 获取图片信息
    const image = await imageDB.getById(parseInt(id));
    if (!image) {
      return res.status(404).json({
        success: false,
        message: '图片不存在'
      });
    }

    // 检查权限：管理员可以删除所有图片，普通用户只能删除自己的图片
    if (req.user.role !== 'admin' && image.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: '没有权限删除此图片'
      });
    }

    // 删除对象存储中的文件
    let storageDeleteResult = null;
    if (image.storage_id && image.upload_type === 'storage') {
      try {
        // 获取存储配置
        const storageConfig = await storageDB.getStorage(image.storage_id);
        if (storageConfig) {
          const storageService = new StorageService();
          // 从文件URL中提取文件路径
          const fileName = extractFileNameFromUrl(image.file_url, storageConfig);
          if (fileName) {
            storageDeleteResult = await storageService.deleteFile(storageConfig, fileName);
            if (!storageDeleteResult.success) {
              console.warn(`对象存储删除失败: ${storageDeleteResult.error}`);
            }
          }
        }
      } catch (storageError) {
        console.warn('对象存储删除失败:', storageError);
        // 不阻止数据库删除，只记录警告
      }
    }

    // 删除本地物理文件（如果存在）
    if (image.upload_type === 'local') {
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(__dirname, '..', 'uploads', image.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // 软删除数据库记录
    await imageDB.delete(parseInt(id));

    res.json({
      success: true,
      message: '图片删除成功',
      storageDeleted: storageDeleteResult?.success || false
    });

  } catch (error) {
    console.error('删除图片错误:', error);
    res.status(500).json({
      success: false,
      message: '删除图片失败',
      error: error.message
    });
  }
});

// 从文件URL中提取文件名/路径的辅助函数
function extractFileNameFromUrl(fileUrl, storageConfig) {
  try {
    const url = new URL(fileUrl);
    let pathname = url.pathname;
    
    // 移除开头的斜杠
    if (pathname.startsWith('/')) {
      pathname = pathname.substring(1);
    }
    
    // 对于某些存储服务，可能需要移除bucket名称
    if (storageConfig.type === 'minio' && pathname.includes('/')) {
      const parts = pathname.split('/');
      if (parts[0] === storageConfig.config.bucket) {
        pathname = parts.slice(1).join('/');
      }
    }
    
    return pathname;
  } catch (error) {
    console.error('提取文件名失败:', error);
    return null;
  }
}

// 批量删除图片
router.delete('/', authenticate, async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供要删除的图片ID列表'
      });
    }

    const deletedImages = [];
    const errors = [];
    const storageService = new StorageService();

    for (const id of ids) {
      try {
        // 获取图片信息
        const image = await imageDB.getById(parseInt(id));
        if (!image) {
          errors.push(`图片 ${id} 不存在`);
          continue;
        }

        // 检查权限
        if (req.user.role !== 'admin' && image.user_id !== req.user.id) {
          errors.push(`没有权限删除图片 ${id}`);
          continue;
        }

        // 删除对象存储中的文件
        if (image.storage_id && image.upload_type === 'storage') {
          try {
            // 获取存储配置
            const storageConfig = await storageDB.getStorage(image.storage_id);
            if (storageConfig) {
              // 从文件URL中提取文件路径
              const fileName = extractFileNameFromUrl(image.file_url, storageConfig);
              if (fileName) {
                const storageDeleteResult = await storageService.deleteFile(storageConfig, fileName);
                if (!storageDeleteResult.success) {
                  console.warn(`图片 ${id} 对象存储删除失败: ${storageDeleteResult.error}`);
                }
              }
            }
          } catch (storageError) {
            console.warn(`图片 ${id} 对象存储删除失败:`, storageError);
            // 不阻止数据库删除，只记录警告
          }
        }

        // 删除本地物理文件（如果存在）
        if (image.upload_type === 'local') {
          const fs = require('fs');
          const path = require('path');
          const filePath = path.join(__dirname, '..', 'uploads', image.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }

        // 软删除数据库记录
        await imageDB.delete(parseInt(id));
        deletedImages.push(id);

      } catch (error) {
        errors.push(`删除图片 ${id} 失败: ${error.message}`);
      }
    }

    res.json({
      success: true,
      message: `批量删除完成：成功 ${deletedImages.length} 张，失败 ${errors.length} 张`,
      data: {
        deleted: deletedImages,
        errors: errors
      }
    });

  } catch (error) {
    console.error('批量删除图片错误:', error);
    res.status(500).json({
      success: false,
      message: '批量删除图片失败',
      error: error.message
    });
  }
});

// ==================== 硬删除相关路由 ====================

// 获取已软删除的图片列表（仅管理员）
router.get('/deleted', authenticate, async (req, res) => {
  try {
    // 只有管理员可以查看已删除的图片
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '只有管理员可以查看已删除的图片'
      });
    }

    const { page = 1, limit = 20, search = '' } = req.query;
    
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      search: search.toString()
    };

    const result = await imageDB.getDeletedImages(options);

    // 转换数据格式以匹配前端期望
    const formattedImages = result.images.map(image => ({
      id: image.id,
      userId: image.user_id,
      filename: image.filename,
      originalName: image.original_name,
      filePath: image.file_path,
      url: image.file_url,
      size: parseInt(image.file_size),
      mimeType: image.mime_type,
      width: image.width,
      height: image.height,
      uploadType: image.upload_type,
      originalUrl: image.original_url,
      tags: image.tags || [],
      description: image.description,
      createdAt: image.created_at,
      updatedAt: image.updated_at,
      deletedAt: image.updated_at // 软删除时间
    }));

    res.json({
      success: true,
      data: {
        images: formattedImages,
        pagination: result.pagination
      }
    });

  } catch (error) {
    console.error('获取已删除图片列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取已删除图片列表失败',
      error: error.message
    });
  }
});

// 恢复软删除的图片（仅管理员）
router.post('/:id/restore', authenticate, async (req, res) => {
  try {
    // 只有管理员可以恢复图片
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '只有管理员可以恢复图片'
      });
    }

    const { id } = req.params;
    
    const restoredImage = await imageDB.restore(parseInt(id));
    
    if (!restoredImage) {
      return res.status(404).json({
        success: false,
        message: '图片不存在或未被删除'
      });
    }

    res.json({
      success: true,
      message: '图片恢复成功',
      data: {
        id: restoredImage.id,
        filename: restoredImage.filename,
        originalName: restoredImage.original_name
      }
    });

  } catch (error) {
    console.error('恢复图片错误:', error);
    res.status(500).json({
      success: false,
      message: '恢复图片失败',
      error: error.message
    });
  }
});

// 硬删除图片（永久删除，仅管理员）
router.delete('/:id/permanent', authenticate, async (req, res) => {
  try {
    // 只有管理员可以永久删除图片
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '只有管理员可以永久删除图片'
      });
    }

    const { id } = req.params;
    
    // 获取图片信息（包括已软删除的）
    const image = await imageDB.getById(parseInt(id), true); // 添加参数允许获取已删除的记录
    if (!image) {
      return res.status(404).json({
        success: false,
        message: '图片不存在'
      });
    }

    // 删除对象存储中的文件（如果存在）
    let storageDeleteResult = null;
    if (image.storage_id && image.upload_type === 'storage') {
      try {
        const { storageDB } = require('../database');
        const StorageService = require('../services/storageService');
        
        const storageConfig = await storageDB.getStorage(image.storage_id);
        if (storageConfig) {
          const storageService = new StorageService();
          const fileName = extractFileNameFromUrl(image.file_url, storageConfig);
          if (fileName) {
            storageDeleteResult = await storageService.deleteFile(storageConfig, fileName);
            if (!storageDeleteResult.success) {
              console.warn(`对象存储删除失败: ${storageDeleteResult.error}`);
            }
          }
        }
      } catch (storageError) {
        console.warn('对象存储删除失败:', storageError);
      }
    }

    // 删除本地物理文件（如果存在）
    if (image.upload_type === 'local') {
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(__dirname, '..', 'uploads', image.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // 硬删除数据库记录
    const deletedImage = await imageDB.permanentDelete(parseInt(id));

    res.json({
      success: true,
      message: '图片已永久删除',
      data: {
        id: deletedImage.id,
        filename: deletedImage.filename,
        originalName: deletedImage.original_name
      },
      storageDeleted: storageDeleteResult?.success || false
    });

  } catch (error) {
    console.error('永久删除图片错误:', error);
    res.status(500).json({
      success: false,
      message: '永久删除图片失败',
      error: error.message
    });
  }
});

// 批量硬删除图片（永久删除，仅管理员）
router.delete('/permanent', authenticate, async (req, res) => {
  try {
    // 只有管理员可以批量永久删除图片
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '只有管理员可以批量永久删除图片'
      });
    }

    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供要永久删除的图片ID列表'
      });
    }

    const deletedImages = [];
    const errors = [];
    const StorageService = require('../services/storageService');
    const storageService = new StorageService();

    for (const id of ids) {
      try {
        // 获取图片信息（包括已软删除的）
        const image = await imageDB.getById(parseInt(id), true);
        if (!image) {
          errors.push(`图片 ${id} 不存在`);
          continue;
        }

        // 删除对象存储中的文件
        if (image.storage_id && image.upload_type === 'storage') {
          try {
            const { storageDB } = require('../database');
            const storageConfig = await storageDB.getStorage(image.storage_id);
            if (storageConfig) {
              const fileName = extractFileNameFromUrl(image.file_url, storageConfig);
              if (fileName) {
                const storageDeleteResult = await storageService.deleteFile(storageConfig, fileName);
                if (!storageDeleteResult.success) {
                  console.warn(`图片 ${id} 对象存储删除失败: ${storageDeleteResult.error}`);
                }
              }
            }
          } catch (storageError) {
            console.warn(`图片 ${id} 对象存储删除失败:`, storageError);
          }
        }

        // 删除本地物理文件（如果存在）
        if (image.upload_type === 'local') {
          const fs = require('fs');
          const path = require('path');
          const filePath = path.join(__dirname, '..', 'uploads', image.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }

        // 硬删除数据库记录
        const deletedImage = await imageDB.permanentDelete(parseInt(id));
        if (deletedImage) {
          deletedImages.push(id);
        }

      } catch (error) {
        errors.push(`永久删除图片 ${id} 失败: ${error.message}`);
      }
    }

    res.json({
      success: true,
      message: `批量永久删除完成：成功 ${deletedImages.length} 张，失败 ${errors.length} 张`,
      data: {
        deleted: deletedImages,
        errors: errors
      }
    });

  } catch (error) {
    console.error('批量永久删除图片错误:', error);
    res.status(500).json({
      success: false,
      message: '批量永久删除图片失败',
      error: error.message
    });
  }
});

// 清理指定天数前的软删除记录（仅管理员）
router.post('/cleanup', authenticate, async (req, res) => {
  try {
    // 只有管理员可以清理删除记录
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '只有管理员可以清理删除记录'
      });
    }

    const { daysOld = 30 } = req.body;
    
    if (daysOld < 1 || daysOld > 365) {
      return res.status(400).json({
        success: false,
        message: '清理天数必须在1-365天之间'
      });
    }

    // 获取要清理的图片列表（用于删除物理文件）
    const toCleanup = await pool.query(`
      SELECT * FROM images 
      WHERE is_deleted = TRUE 
      AND updated_at < NOW() - INTERVAL '${daysOld} days'
    `);

    const StorageService = require('../services/storageService');
    const storageService = new StorageService();
    let storageDeleteCount = 0;
    let localDeleteCount = 0;

    // 删除物理文件
    for (const image of toCleanup.rows) {
      try {
        // 删除对象存储中的文件
        if (image.storage_id && image.upload_type === 'storage') {
          const { storageDB } = require('../database');
          const storageConfig = await storageDB.getStorage(image.storage_id);
          if (storageConfig) {
            const fileName = extractFileNameFromUrl(image.file_url, storageConfig);
            if (fileName) {
              const result = await storageService.deleteFile(storageConfig, fileName);
              if (result.success) {
                storageDeleteCount++;
              }
            }
          }
        }

        // 删除本地物理文件
        if (image.upload_type === 'local') {
          const fs = require('fs');
          const path = require('path');
          const filePath = path.join(__dirname, '..', 'uploads', image.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            localDeleteCount++;
          }
        }
      } catch (error) {
        console.warn(`清理图片 ${image.id} 的物理文件失败:`, error);
      }
    }

    // 清理数据库记录
    const cleanedImages = await imageDB.cleanupDeletedImages(daysOld);

    res.json({
      success: true,
      message: `清理完成：删除了 ${cleanedImages.length} 条记录`,
      data: {
        cleanedRecords: cleanedImages.length,
        storageFilesDeleted: storageDeleteCount,
        localFilesDeleted: localDeleteCount,
        daysOld: daysOld
      }
    });

  } catch (error) {
    console.error('清理删除记录错误:', error);
    res.status(500).json({
      success: false,
      message: '清理删除记录失败',
      error: error.message
    });
  }
});

module.exports = router;