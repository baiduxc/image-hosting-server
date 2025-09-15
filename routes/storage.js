const express = require('express');
const { storageDB } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// 获取所有存储配置（管理员）
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const storages = await storageDB.getAllStorages();
    
    res.json({
      success: true,
      data: storages
    });
  } catch (error) {
    console.error('获取存储配置失败:', error);
    res.status(500).json({
      success: false,
      message: '获取存储配置失败',
      error: error.message
    });
  }
});

// 获取可用存储配置列表（所有认证用户）
router.get('/available', authenticate, async (req, res) => {
  try {
    const storages = await storageDB.getAllStorages();
    
    // 只返回必要的信息，隐藏敏感配置
    const availableStorages = storages.map(storage => ({
      id: storage.id,
      name: storage.name,
      type: storage.type,
      isDefault: storage.is_default,
      isActive: storage.is_active
    }));
    
    res.json({
      success: true,
      data: availableStorages
    });
  } catch (error) {
    console.error('获取可用存储配置失败:', error);
    res.status(500).json({
      success: false,
      message: '获取可用存储配置失败',
      error: error.message
    });
  }
});

// 获取默认存储配置（所有用户）
router.get('/default/info', authenticate, async (req, res) => {
  try {
    const storage = await storageDB.getDefaultStorage();
    
    if (!storage) {
      return res.status(404).json({
        success: false,
        message: '未配置默认存储'
      });
    }
    
    // 只返回必要的信息，不暴露敏感配置
    res.json({
      success: true,
      data: {
        id: storage.id,
        name: storage.name,
        type: storage.type,
        isDefault: true
      }
    });
  } catch (error) {
    console.error('获取默认存储失败:', error);
    res.status(500).json({
      success: false,
      message: '获取默认存储失败',
      error: error.message
    });
  }
});

// 获取特定存储配置（管理员）
router.get('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const storage = await storageDB.getStorage(id);
    
    if (!storage) {
      return res.status(404).json({
        success: false,
        message: '存储配置不存在'
      });
    }
    
    res.json({
      success: true,
      data: storage
    });
  } catch (error) {
    console.error('获取存储配置失败:', error);
    res.status(500).json({
      success: false,
      message: '获取存储配置失败',
      error: error.message
    });
  }
});

// 创建存储配置（管理员）
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, type, config } = req.body;
    
    if (!name || !type || !config) {
      return res.status(400).json({
        success: false,
        message: '请提供完整的存储配置信息'
      });
    }

    const storage = await storageDB.createStorage(name, type, config);
    
    res.json({
      success: true,
      message: '存储配置创建成功',
      data: storage
    });
  } catch (error) {
    console.error('创建存储配置失败:', error);
    res.status(500).json({
      success: false,
      message: '创建存储配置失败',
      error: error.message
    });
  }
});

// 更新存储配置（管理员）
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, config } = req.body;
    
    if (!name || !type || !config) {
      return res.status(400).json({
        success: false,
        message: '请提供完整的存储配置信息'
      });
    }

    const storage = await storageDB.updateStorage(id, name, type, config);
    
    if (!storage) {
      return res.status(404).json({
        success: false,
        message: '存储配置不存在'
      });
    }
    
    res.json({
      success: true,
      message: '存储配置更新成功',
      data: storage
    });
  } catch (error) {
    console.error('更新存储配置失败:', error);
    res.status(500).json({
      success: false,
      message: '更新存储配置失败',
      error: error.message
    });
  }
});

// 设置默认存储（管理员）
router.put('/:id/default', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const storage = await storageDB.setDefaultStorage(id);
    
    if (!storage) {
      return res.status(404).json({
        success: false,
        message: '存储配置不存在或已被禁用'
      });
    }
    
    res.json({
      success: true,
      message: '默认存储设置成功',
      data: storage
    });
  } catch (error) {
    console.error('设置默认存储失败:', error);
    res.status(500).json({
      success: false,
      message: '设置默认存储失败',
      error: error.message
    });
  }
});

// 删除存储配置（管理员）
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const storage = await storageDB.deleteStorage(id);
    
    if (!storage) {
      return res.status(404).json({
        success: false,
        message: '存储配置不存在或为默认存储'
      });
    }
    
    res.json({
      success: true,
      message: '存储配置删除成功'
    });
  } catch (error) {
    console.error('删除存储配置失败:', error);
    res.status(500).json({
      success: false,
      message: '删除存储配置失败',
      error: error.message
    });
  }
});

module.exports = router;
