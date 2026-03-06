const express = require('express');
const { dbAdapter, DB_TYPE } = require('../databaseAdapter');
const { authenticate, requireAdmin } = require('../middleware/auth');
const crypto = require('crypto');

const router = express.Router();

// 工具函数：生成随机密钥
function generateKey() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

// 工具函数：获取当前时间字符串
function getNowString() {
  if (DB_TYPE === 'sqlite') {
    return new Date().toISOString();
  }
  return new Date().toISOString();
}

// ========== 用户组管理（管理员） ==========

// 获取所有用户组
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    let query = 'SELECT * FROM user_groups ORDER BY created_at DESC';
    const result = await dbAdapter.query(query);
    
    // 获取每个用户组的用户数量
    const groupsWithCount = await Promise.all(
      result.rows.map(async (group) => {
        const countQuery = `SELECT COUNT(*) as count FROM users WHERE group_id = ${DB_TYPE === 'sqlite' ? '?' : '$1'}`;
        const countResult = await dbAdapter.query(countQuery, [group.id]);
        return {
          ...group,
          userCount: parseInt(countResult.rows[0].count)
        };
      })
    );
    
    res.json({
      success: true,
      data: groupsWithCount
    });
  } catch (error) {
    console.error('获取用户组列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取用户组列表失败',
      error: error.message
    });
  }
});

// 创建用户组
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      name,
      description,
      daily_upload_limit = 50,
      weekly_upload_limit = 300,
      monthly_upload_limit = 1000,
      max_file_size = 10,
      concurrent_uploads = 3,
      storage_space = 100,
      is_default = false
    } = req.body;
    
    // 转换数值字段
    const numDailyLimit = parseInt(daily_upload_limit, 10) || 50;
    const numWeeklyLimit = parseInt(weekly_upload_limit, 10) || 300;
    const numMonthlyLimit = parseInt(monthly_upload_limit, 10) || 1000;
    const numMaxFileSize = parseInt(max_file_size, 10) || 10;
    const numConcurrent = parseInt(concurrent_uploads, 10) || 3;
    const numStorage = parseInt(storage_space, 10) || 100;
    const numIsDefault = is_default ? 1 : 0;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: '用户组名称不能为空'
      });
    }

    // 检查名称是否已存在
    const checkQuery = `SELECT id FROM user_groups WHERE name = ${DB_TYPE === 'sqlite' ? '?' : '$1'}`;
    const checkResult = await dbAdapter.query(checkQuery, [name]);
    if (checkResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: '用户组名称已存在'
      });
    }

    // 如果设置为默认，先取消其他默认组
    if (numIsDefault) {
      if (DB_TYPE === 'sqlite') {
        const db = dbAdapter.getConnection();
        db.prepare("UPDATE user_groups SET is_default = 0 WHERE is_default = 1").run();
      } else {
        await dbAdapter.run("UPDATE user_groups SET is_default = FALSE WHERE is_default = TRUE");
      }
    }

    let result;
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const info = db.prepare(`
        INSERT INTO user_groups (name, description, daily_upload_limit, weekly_upload_limit, 
          monthly_upload_limit, max_file_size, concurrent_uploads, storage_space, is_default)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, description, numDailyLimit, numWeeklyLimit, 
        numMonthlyLimit, numMaxFileSize, numConcurrent, numStorage, numIsDefault);
      result = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(info.lastInsertRowid);
    } else {
      const query = `
        INSERT INTO user_groups (name, description, daily_upload_limit, weekly_upload_limit, 
          monthly_upload_limit, max_file_size, concurrent_uploads, storage_space, is_default)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;
      const insertResult = await dbAdapter.query(query, [
        name, description, numDailyLimit, numWeeklyLimit,
        numMonthlyLimit, numMaxFileSize, numConcurrent, numStorage, !!is_default
      ]);
      result = insertResult.rows[0];
    }

    res.json({
      success: true,
      message: '用户组创建成功',
      data: result
    });
  } catch (error) {
    console.error('创建用户组错误:', error);
    res.status(500).json({
      success: false,
      message: '创建用户组失败',
      error: error.message
    });
  }
});

// 更新用户组
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // URL 参数 id 转换为整数
    const numId = parseInt(id, 10);
    
    // 检查用户组是否存在
    const checkQuery = `SELECT id FROM user_groups WHERE id = ${DB_TYPE === 'sqlite' ? '?' : '$1'}`;
    const checkResult = await dbAdapter.query(checkQuery, [numId]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户组不存在'
      });
    }

    // 如果修改名称，检查是否与其他组冲突
    if (updateData.name) {
      const nameCheckQuery = `SELECT id FROM user_groups WHERE name = ${DB_TYPE === 'sqlite' ? '?' : '$1'} AND id != ${DB_TYPE === 'sqlite' ? '?' : '$2'}`;
      const nameCheckResult = await dbAdapter.query(nameCheckQuery, [updateData.name, numId]);
      if (nameCheckResult.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: '用户组名称已存在'
        });
      }
    }

    // 如果设置为默认，先取消其他默认组
    if (updateData.is_default) {
      if (DB_TYPE === 'sqlite') {
        const db = dbAdapter.getConnection();
        db.prepare("UPDATE user_groups SET is_default = 0 WHERE is_default = 1").run();
      } else {
        await dbAdapter.run("UPDATE user_groups SET is_default = FALSE WHERE is_default = TRUE");
      }
    }

    const fields = [];
    const values = [];
    let paramIndex = 1;

    const allowedFields = ['name', 'description', 'daily_upload_limit', 'weekly_upload_limit', 
      'monthly_upload_limit', 'max_file_size', 'concurrent_uploads', 'storage_space', 'is_default'];
    
    // 数值字段列表
    const numericFields = ['daily_upload_limit', 'weekly_upload_limit', 'monthly_upload_limit', 
      'max_file_size', 'concurrent_uploads', 'storage_space'];
    
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined && updateData[field] !== null && updateData[field] !== '') {
        fields.push(`${field} = ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`}`);
        // 数值字段转换为整数
        if (numericFields.includes(field)) {
          const numValue = parseInt(updateData[field], 10);
          values.push(isNaN(numValue) ? 0 : numValue);
        } else if (field === 'is_default') {
          // 布尔值处理：转换 true/false 为 1/0
          values.push(updateData[field] ? 1 : 0);
        } else {
          values.push(updateData[field]);
        }
        paramIndex++;
      }
    });

    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有要更新的字段'
      });
    }

    // 添加更新时间
    if (DB_TYPE === 'sqlite') {
      fields.push(`updated_at = datetime('now', '+8 hours')`);
    } else {
      fields.push(`updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'`);
    }

    values.push(numId);

    let result;
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare(`
        UPDATE user_groups SET ${fields.join(', ')} WHERE id = ?
      `).run(...values);
      result = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(numId);
    } else {
      const query = `
        UPDATE user_groups SET ${fields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;
      const updateResult = await dbAdapter.query(query, values);
      result = updateResult.rows[0];
    }

    res.json({
      success: true,
      message: '用户组更新成功',
      data: result
    });
  } catch (error) {
    console.error('更新用户组错误:', error);
    res.status(500).json({
      success: false,
      message: '更新用户组失败',
      error: error.message
    });
  }
});

// 删除用户组
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // 检查用户组是否存在
    const checkQuery = `SELECT * FROM user_groups WHERE id = ${DB_TYPE === 'sqlite' ? '?' : '$1'}`;
    const checkResult = await dbAdapter.query(checkQuery, [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户组不存在'
      });
    }

    const group = checkResult.rows[0];
    const isDefault = DB_TYPE === 'sqlite' ? group.is_default === 1 : group.is_default;

    // 不能删除默认用户组
    if (isDefault) {
      return res.status(400).json({
        success: false,
        message: '不能删除默认用户组，请先设置其他组为默认'
      });
    }

    // 获取默认用户组ID，用于迁移用户
    const defaultGroupQuery = `SELECT id FROM user_groups WHERE is_default = ${DB_TYPE === 'sqlite' ? '1' : 'true'} LIMIT 1`;
    const defaultGroupResult = await dbAdapter.query(defaultGroupQuery);
    const defaultGroupId = defaultGroupResult.rows[0]?.id;

    // 将该组用户迁移到默认组
    if (defaultGroupId) {
      await dbAdapter.query(
        `UPDATE users SET group_id = ${DB_TYPE === 'sqlite' ? '?' : '$1'} WHERE group_id = ${DB_TYPE === 'sqlite' ? '?' : '$2'}`,
        [defaultGroupId, id]
      );
    } else {
      // 如果没有默认组，将用户group_id设为NULL
      await dbAdapter.query(
        `UPDATE users SET group_id = NULL WHERE group_id = ${DB_TYPE === 'sqlite' ? '?' : '$1'}`,
        [id]
      );
    }

    // 删除用户组
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare('DELETE FROM user_groups WHERE id = ?').run(id);
    } else {
      await dbAdapter.run('DELETE FROM user_groups WHERE id = $1', [id]);
    }

    res.json({
      success: true,
      message: '用户组删除成功，相关用户已迁移到默认组'
    });
  } catch (error) {
    console.error('删除用户组错误:', error);
    res.status(500).json({
      success: false,
      message: '删除用户组失败',
      error: error.message
    });
  }
});

// ========== 密钥管理（管理员） ==========

// 获取所有密钥
router.get('/keys', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, group_id, is_used } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const queryParams = [];
    let paramIndex = 1;

    if (group_id) {
      whereClause += ` AND k.group_id = ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`}`;
      queryParams.push(group_id);
      paramIndex++;
    }

    if (is_used !== undefined && is_used !== '') {
      whereClause += ` AND k.is_used = ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`}`;
      queryParams.push(is_used === 'true' || is_used === '1' ? 1 : 0);
      paramIndex++;
    }

    // 查询总数
    const countQuery = `SELECT COUNT(*) as count FROM user_group_keys k ${whereClause}`;
    const countResult = await dbAdapter.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].count);

    // 查询数据
    const dataQuery = `
      SELECT k.*, g.name as group_name, u.username as used_by_username
      FROM user_group_keys k
      LEFT JOIN user_groups g ON k.group_id = g.id
      LEFT JOIN users u ON k.used_by = u.id
      ${whereClause}
      ORDER BY k.created_at DESC
      LIMIT ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`} OFFSET ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex + 1}`}
    `;
    queryParams.push(parseInt(limit), offset);

    const dataResult = await dbAdapter.query(dataQuery, queryParams);

    res.json({
      success: true,
      data: {
        list: dataResult.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('获取密钥列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取密钥列表失败',
      error: error.message
    });
  }
});

// 生成密钥
router.post('/keys', authenticate, requireAdmin, async (req, res) => {
  try {
    const { group_id, count = 1, expires_at } = req.body;

    if (!group_id) {
      return res.status(400).json({
        success: false,
        message: '请选择用户组'
      });
    }

    // 检查用户组是否存在
    const groupQuery = `SELECT id, name FROM user_groups WHERE id = ${DB_TYPE === 'sqlite' ? '?' : '$1'}`;
    const groupResult = await dbAdapter.query(groupQuery, [group_id]);
    if (groupResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户组不存在'
      });
    }

    const group = groupResult.rows[0];
    const keys = [];
    const now = getNowString();

    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const insertStmt = db.prepare(`
        INSERT INTO user_group_keys (group_id, key, expires_at, created_at)
        VALUES (?, ?, ?, datetime('now', '+8 hours'))
      `);

      for (let i = 0; i < count; i++) {
        const key = generateKey();
        insertStmt.run(group_id, key, expires_at || null);
        keys.push({
          key,
          group_id,
          group_name: group.name,
          is_used: 0,
          used_by: null,
          used_at: null,
          expires_at: expires_at || null,
          created_at: now
        });
      }
    } else {
      const query = `
        INSERT INTO user_group_keys (group_id, key, expires_at, created_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '8 hours')
        RETURNING *
      `;

      for (let i = 0; i < count; i++) {
        const key = generateKey();
        const result = await dbAdapter.query(query, [group_id, key, expires_at || null]);
        keys.push({
          ...result.rows[0],
          group_name: group.name
        });
      }
    }

    res.json({
      success: true,
      message: `成功生成 ${count} 个密钥`,
      data: keys
    });
  } catch (error) {
    console.error('生成密钥错误:', error);
    res.status(500).json({
      success: false,
      message: '生成密钥失败',
      error: error.message
    });
  }
});

// 删除密钥
router.delete('/keys/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare('DELETE FROM user_group_keys WHERE id = ?').run(id);
    } else {
      await dbAdapter.run('DELETE FROM user_group_keys WHERE id = $1', [id]);
    }

    res.json({
      success: true,
      message: '密钥删除成功'
    });
  } catch (error) {
    console.error('删除密钥错误:', error);
    res.status(500).json({
      success: false,
      message: '删除密钥失败',
      error: error.message
    });
  }
});

// ========== 用户功能 ==========

// 获取当前用户组信息
router.get('/my-group', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // 获取用户信息
    const userQuery = `SELECT group_id FROM users WHERE id = ${DB_TYPE === 'sqlite' ? '?' : '$1'}`;
    const userResult = await dbAdapter.query(userQuery, [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const groupId = userResult.rows[0].group_id;

    // 获取用户组信息
    let group;
    if (groupId) {
      const groupQuery = `SELECT * FROM user_groups WHERE id = ${DB_TYPE === 'sqlite' ? '?' : '$1'}`;
      const groupResult = await dbAdapter.query(groupQuery, [groupId]);
      group = groupResult.rows[0];
    }

    // 如果没有用户组或用户组不存在，获取默认组
    if (!group) {
      const defaultGroupQuery = `SELECT * FROM user_groups WHERE is_default = ${DB_TYPE === 'sqlite' ? '1' : 'true'} LIMIT 1`;
      const defaultGroupResult = await dbAdapter.query(defaultGroupQuery);
      group = defaultGroupResult.rows[0];
    }

    // 获取用户使用统计
    const today = new Date().toISOString().split('T')[0];
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date();
    monthStart.setDate(1);

    let dailyCount = 0;
    let weeklyCount = 0;
    let monthlyCount = 0;

    if (DB_TYPE === 'sqlite') {
      // 今日上传数
      const dailyResult = await dbAdapter.query(
        `SELECT COUNT(*) as count FROM images WHERE user_id = ? AND date(created_at) = date('now', '+8 hours')`,
        [userId]
      );
      dailyCount = parseInt(dailyResult.rows[0].count);

      // 本周上传数
      const weeklyResult = await dbAdapter.query(
        `SELECT COUNT(*) as count FROM images WHERE user_id = ? AND date(created_at) >= date('now', '-7 days', '+8 hours')`,
        [userId]
      );
      weeklyCount = parseInt(weeklyResult.rows[0].count);

      // 本月上传数
      const monthlyResult = await dbAdapter.query(
        `SELECT COUNT(*) as count FROM images WHERE user_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', '+8 hours')`,
        [userId]
      );
      monthlyCount = parseInt(monthlyResult.rows[0].count);
    } else {
      // 今日上传数
      const dailyResult = await dbAdapter.query(
        `SELECT COUNT(*) as count FROM images WHERE user_id = $1 AND DATE(created_at) = CURRENT_DATE`,
        [userId]
      );
      dailyCount = parseInt(dailyResult.rows[0].count);

      // 本周上传数
      const weeklyResult = await dbAdapter.query(
        `SELECT COUNT(*) as count FROM images WHERE user_id = $1 AND created_at >= DATE_TRUNC('week', CURRENT_DATE)`,
        [userId]
      );
      weeklyCount = parseInt(weeklyResult.rows[0].count);

      // 本月上传数
      const monthlyResult = await dbAdapter.query(
        `SELECT COUNT(*) as count FROM images WHERE user_id = $1 AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
        [userId]
      );
      monthlyCount = parseInt(monthlyResult.rows[0].count);
    }

    res.json({
      success: true,
      data: {
        group: {
          ...group,
          daily_upload_limit: parseInt(group.daily_upload_limit) || 0,
          weekly_upload_limit: parseInt(group.weekly_upload_limit) || 0,
          monthly_upload_limit: parseInt(group.monthly_upload_limit) || 0,
          max_file_size: parseInt(group.max_file_size) || 0,
          concurrent_uploads: parseInt(group.concurrent_uploads) || 0,
          storage_space: parseInt(group.storage_space) || 100
        },
        usage: {
          daily: dailyCount,
          weekly: weeklyCount,
          monthly: monthlyCount
        }
      }
    });
  } catch (error) {
    console.error('获取用户组信息错误:', error);
    res.status(500).json({
      success: false,
      message: '获取用户组信息失败',
      error: error.message
    });
  }
});

// 兑换密钥
router.post('/redeem', authenticate, async (req, res) => {
  try {
    const { key } = req.body;
    const userId = req.user.id;

    if (!key) {
      return res.status(400).json({
        success: false,
        message: '请输入密钥'
      });
    }

    // 查询密钥
    const keyQuery = `SELECT * FROM user_group_keys WHERE key = ${DB_TYPE === 'sqlite' ? '?' : '$1'}`;
    const keyResult = await dbAdapter.query(keyQuery, [key.trim().toUpperCase()]);

    if (keyResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: '密钥不存在'
      });
    }

    const keyRecord = keyResult.rows[0];
    const isUsed = DB_TYPE === 'sqlite' ? keyRecord.is_used === 1 : keyRecord.is_used;

    // 检查是否已使用
    if (isUsed) {
      return res.status(400).json({
        success: false,
        message: '密钥已被使用'
      });
    }

    // 检查是否过期
    if (keyRecord.expires_at) {
      const expiresAt = new Date(keyRecord.expires_at);
      if (expiresAt < new Date()) {
        return res.status(400).json({
          success: false,
          message: '密钥已过期'
        });
      }
    }

    // 获取密钥对应的用户组
    const groupQuery = `SELECT * FROM user_groups WHERE id = ${DB_TYPE === 'sqlite' ? '?' : '$1'}`;
    const groupResult = await dbAdapter.query(groupQuery, [keyRecord.group_id]);

    if (groupResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: '密钥对应的用户组不存在'
      });
    }

    const group = groupResult.rows[0];

    // 更新用户组
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare('UPDATE users SET group_id = ? WHERE id = ?').run(keyRecord.group_id, userId);
    } else {
      await dbAdapter.run('UPDATE users SET group_id = $1 WHERE id = $2', [keyRecord.group_id, userId]);
    }

    // 标记密钥为已使用
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare(`UPDATE user_group_keys SET is_used = 1, used_by = ?, used_at = datetime('now', '+8 hours') WHERE id = ?`).run(userId, keyRecord.id);
    } else {
      await dbAdapter.run(`UPDATE user_group_keys SET is_used = TRUE, used_by = $1, used_at = CURRENT_TIMESTAMP + INTERVAL '8 hours' WHERE id = $2`, [userId, keyRecord.id]);
    }

    res.json({
      success: true,
      message: `恭喜！您已成功升级到「${group.name}」`,
      data: {
        group: {
          ...group,
          daily_upload_limit: parseInt(group.daily_upload_limit) || 0,
          weekly_upload_limit: parseInt(group.weekly_upload_limit) || 0,
          monthly_upload_limit: parseInt(group.monthly_upload_limit) || 0,
          max_file_size: parseInt(group.max_file_size) || 0,
          concurrent_uploads: parseInt(group.concurrent_uploads) || 0,
          storage_space: parseInt(group.storage_space) || 100
        }
      }
    });
  } catch (error) {
    console.error('兑换密钥错误:', error);
    res.status(500).json({
      success: false,
      message: '兑换密钥失败',
      error: error.message
    });
  }
});

// ========== 上传限制检查（内部使用） ==========

// 检查用户上传限制
router.get('/check-limit/:type', authenticate, async (req, res) => {
  try {
    const { type } = req.params; // 'daily', 'weekly', 'monthly'
    const userId = req.user.id;

    // 获取用户组信息
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

    let currentCount = 0;
    let limit = 0;

    if (type === 'daily') {
      limit = parseInt(group.daily_upload_limit) || 0;
      if (DB_TYPE === 'sqlite') {
        const result = await dbAdapter.query(
          `SELECT COUNT(*) as count FROM images WHERE user_id = ? AND date(created_at) = date('now', '+8 hours')`,
          [userId]
        );
        currentCount = parseInt(result.rows[0].count);
      } else {
        const result = await dbAdapter.query(
          `SELECT COUNT(*) as count FROM images WHERE user_id = $1 AND DATE(created_at) = CURRENT_DATE`,
          [userId]
        );
        currentCount = parseInt(result.rows[0].count);
      }
    } else if (type === 'weekly') {
      limit = parseInt(group.weekly_upload_limit) || 0;
      if (DB_TYPE === 'sqlite') {
        const result = await dbAdapter.query(
          `SELECT COUNT(*) as count FROM images WHERE user_id = ? AND date(created_at) >= date('now', '-7 days', '+8 hours')`,
          [userId]
        );
        currentCount = parseInt(result.rows[0].count);
      } else {
        const result = await dbAdapter.query(
          `SELECT COUNT(*) as count FROM images WHERE user_id = $1 AND created_at >= DATE_TRUNC('week', CURRENT_DATE)`,
          [userId]
        );
        currentCount = parseInt(result.rows[0].count);
      }
    } else if (type === 'monthly') {
      limit = parseInt(group.monthly_upload_limit) || 0;
      if (DB_TYPE === 'sqlite') {
        const result = await dbAdapter.query(
          `SELECT COUNT(*) as count FROM images WHERE user_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', '+8 hours')`,
          [userId]
        );
        currentCount = parseInt(result.rows[0].count);
      } else {
        const result = await dbAdapter.query(
          `SELECT COUNT(*) as count FROM images WHERE user_id = $1 AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
          [userId]
        );
        currentCount = parseInt(result.rows[0].count);
      }
    }

    res.json({
      success: true,
      data: {
        type,
        current: currentCount,
        limit,
        remaining: Math.max(0, limit - currentCount),
        exceeded: currentCount >= limit
      }
    });
  } catch (error) {
    console.error('检查上传限制错误:', error);
    res.status(500).json({
      success: false,
      message: '检查上传限制失败',
      error: error.message
    });
  }
});

module.exports = router;
