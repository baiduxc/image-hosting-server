const express = require('express');
const { userDB, imageDB, statsDB } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// 获取用户统计信息
router.get('/stats', authenticate, async (req, res) => {
  try {
    let stats;
    
    if (req.user.role === 'admin') {
      // 管理员可以查看全局统计
      stats = await statsDB.getOverallStats();
      
      // 添加用户统计
      const userCount = await userDB.pool.query('SELECT COUNT(*) FROM users WHERE is_disabled = FALSE');
      stats.totalUsers = parseInt(userCount.rows[0].count);
      
    } else {
      // 普通用户只能查看自己的统计
      const userImages = await imageDB.pool.query(`
        SELECT 
          COUNT(*) as total_images,
          COALESCE(SUM(file_size), 0) as total_size
        FROM images 
        WHERE user_id = $1 AND is_deleted = FALSE
      `, [req.user.id]);
      
      const monthlyImages = await imageDB.pool.query(`
        SELECT COUNT(*) as monthly_uploads 
        FROM images 
        WHERE user_id = $1 AND is_deleted = FALSE 
        AND created_at >= date_trunc('month', CURRENT_DATE)
      `, [req.user.id]);

      // 计算活跃天数（用户注册到现在的天数）
      const userInfo = await userDB.getById(req.user.id);
      const daysActive = userInfo ? Math.ceil((Date.now() - new Date(userInfo.created_at).getTime()) / (1000 * 60 * 60 * 24)) : 0;
      
      stats = {
        totalImages: parseInt(userImages.rows[0].total_images),
        totalSize: parseInt(userImages.rows[0].total_size),
        monthlyUploads: parseInt(monthlyImages.rows[0].monthly_uploads),
        totalTraffic: parseInt(userImages.rows[0].total_size) * 2, // 简化计算
        daysActive: daysActive
      };
    }

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('获取用户统计错误:', error);
    res.status(500).json({
      success: false,
      message: '获取统计信息失败',
      error: error.message
    });
  }
});

// 获取用户的图片列表
router.get('/:id/images', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20, search = '', uploadType } = req.query;
    
    // 检查权限：管理员可以查看所有用户的图片，普通用户只能查看自己的
    if (req.user.role !== 'admin' && parseInt(id) !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: '没有权限查看此用户的图片'
      });
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      search: search.toString(),
      uploadType: uploadType || null,
      userId: parseInt(id)
    };

    const result = await imageDB.getList(options);

    // 转换数据格式
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
    console.error('获取用户图片列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取用户图片列表失败',
      error: error.message
    });
  }
});

// 获取用户个人资料
router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await userDB.getById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 移除敏感信息
    const { password_hash, ...userProfile } = user;

    res.json({
      success: true,
      data: userProfile
    });
  } catch (error) {
    console.error('获取用户资料失败:', error);
    res.status(500).json({
      success: false,
      message: '获取用户资料失败',
      error: error.message
    });
  }
});

// 更新用户个人资料
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: '请提供邮箱'
      });
    }

    // 检查邮箱是否已被其他用户使用
    const existingUser = await userDB.getByEmail(email);
    if (existingUser && existingUser.id !== req.user.id) {
      return res.status(400).json({
        success: false,
        message: '该邮箱已被其他用户使用'
      });
    }

    const updatedUser = await userDB.updateProfile(req.user.id, { email });
    
    // 移除敏感信息
    const { password_hash, ...userProfile } = updatedUser;

    res.json({
      success: true,
      data: userProfile,
      message: '个人资料更新成功'
    });
  } catch (error) {
    console.error('更新用户资料失败:', error);
    res.status(500).json({
      success: false,
      message: '更新用户资料失败',
      error: error.message
    });
  }
});

// 修改密码
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: '请提供当前密码和新密码'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: '新密码长度至少6位'
      });
    }

    const result = await userDB.changePassword(req.user.id, currentPassword, newPassword);
    
    if (!result) {
      return res.status(400).json({
        success: false,
        message: '当前密码错误'
      });
    }

    res.json({
      success: true,
      message: '密码修改成功'
    });
  } catch (error) {
    console.error('修改密码失败:', error);
    res.status(500).json({
      success: false,
      message: '修改密码失败',
      error: error.message
    });
  }
});

// 获取用户详细信息（管理员功能）
router.get('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await userDB.getById(parseInt(id));
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 获取用户的图片统计
    const imageStats = await imageDB.pool.query(`
      SELECT 
        COUNT(*) as total_images,
        COALESCE(SUM(file_size), 0) as total_size,
        COUNT(CASE WHEN upload_type = 'local' THEN 1 END) as local_uploads,
        COUNT(CASE WHEN upload_type = 'transfer' THEN 1 END) as transfer_uploads
      FROM images 
      WHERE user_id = $1 AND is_deleted = FALSE
    `, [parseInt(id)]);

    const stats = imageStats.rows[0];

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          avatarUrl: user.avatar_url,
          isDisabled: user.is_disabled,
          lastLoginAt: user.last_login_at,
          createdAt: user.created_at,
          updatedAt: user.updated_at
        },
        stats: {
          totalImages: parseInt(stats.total_images),
          totalSize: parseInt(stats.total_size),
          localUploads: parseInt(stats.local_uploads),
          transferUploads: parseInt(stats.transfer_uploads)
        }
      }
    });

  } catch (error) {
    console.error('获取用户详细信息错误:', error);
    res.status(500).json({
      success: false,
      message: '获取用户详细信息失败',
      error: error.message
    });
  }
});

// 更新用户角色（管理员功能）
router.put('/:id/role', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    
    // 验证角色
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: '无效的用户角色'
      });
    }

    // 不能修改自己的角色
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: '不能修改自己的角色'
      });
    }

    const updatedUser = await userDB.update(parseInt(id), { role });
    
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    res.json({
      success: true,
      message: '用户角色更新成功',
      data: {
        id: updatedUser.id,
        username: updatedUser.username,
        role: updatedUser.role
      }
    });

  } catch (error) {
    console.error('更新用户角色错误:', error);
    res.status(500).json({
      success: false,
      message: '更新用户角色失败',
      error: error.message
    });
  }
});

// 重置用户密码（管理员功能）
router.post('/:id/reset-password', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: '新密码长度至少6位'
      });
    }

    // 不能重置自己的密码（应该通过修改个人信息）
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: '不能通过此接口重置自己的密码'
      });
    }

    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    
    const updatedUser = await userDB.update(parseInt(id), { password_hash: passwordHash });
    
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    res.json({
      success: true,
      message: '用户密码重置成功',
      data: {
        id: updatedUser.id,
        username: updatedUser.username
      }
    });

  } catch (error) {
    console.error('重置用户密码错误:', error);
    res.status(500).json({
      success: false,
      message: '重置用户密码失败',
      error: error.message
    });
  }
});

// 获取系统概览（管理员功能）
router.get('/admin/overview', authenticate, requireAdmin, async (req, res) => {
  try {
    // 获取用户统计
    const userStats = await userDB.pool.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_count,
        COUNT(CASE WHEN role = 'user' THEN 1 END) as user_count,
        COUNT(CASE WHEN is_disabled = TRUE THEN 1 END) as disabled_count,
        COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as new_users_week
      FROM users
    `);

    // 获取图片统计
    const imageStats = await imageDB.pool.query(`
      SELECT 
        COUNT(*) as total_images,
        COALESCE(SUM(file_size), 0) as total_size,
        COUNT(CASE WHEN upload_type = 'local' THEN 1 END) as local_uploads,
        COUNT(CASE WHEN upload_type = 'transfer' THEN 1 END) as transfer_uploads,
        COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as today_uploads
      FROM images 
      WHERE is_deleted = FALSE
    `);

    // 获取最近活跃用户
    const recentUsers = await userDB.pool.query(`
      SELECT id, username, email, role, last_login_at, created_at
      FROM users 
      WHERE is_disabled = FALSE
      ORDER BY last_login_at DESC NULLS LAST
      LIMIT 10
    `);

    // 获取最近上传的图片
    const recentImages = await imageDB.pool.query(`
      SELECT i.id, i.filename, i.original_name, i.file_size, i.upload_type, i.created_at,
             u.username
      FROM images i
      LEFT JOIN users u ON i.user_id = u.id
      WHERE i.is_deleted = FALSE
      ORDER BY i.created_at DESC
      LIMIT 10
    `);

    const userStatsData = userStats.rows[0];
    const imageStatsData = imageStats.rows[0];

    res.json({
      success: true,
      data: {
        userStats: {
          totalUsers: parseInt(userStatsData.total_users),
          adminCount: parseInt(userStatsData.admin_count),
          userCount: parseInt(userStatsData.user_count),
          disabledCount: parseInt(userStatsData.disabled_count),
          newUsersWeek: parseInt(userStatsData.new_users_week)
        },
        imageStats: {
          totalImages: parseInt(imageStatsData.total_images),
          totalSize: parseInt(imageStatsData.total_size),
          localUploads: parseInt(imageStatsData.local_uploads),
          transferUploads: parseInt(imageStatsData.transfer_uploads),
          todayUploads: parseInt(imageStatsData.today_uploads)
        },
        recentUsers: recentUsers.rows,
        recentImages: recentImages.rows.map(img => ({
          id: img.id,
          filename: img.filename,
          originalName: img.original_name,
          fileSize: parseInt(img.file_size),
          uploadType: img.upload_type,
          username: img.username,
          createdAt: img.created_at
        }))
      }
    });

  } catch (error) {
    console.error('获取系统概览错误:', error);
    res.status(500).json({
      success: false,
      message: '获取系统概览失败',
      error: error.message
    });
  }
});

module.exports = router;