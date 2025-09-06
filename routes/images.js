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

module.exports = router;