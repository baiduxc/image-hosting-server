const { dbAdapter, DB_TYPE } = require('./databaseAdapter');
const bcrypt = require('bcryptjs');

// 工具函数：处理 PostgreSQL 和 SQLite 的差异
const buildParameterPlaceholders = (startIndex, count) => {
  if (DB_TYPE === 'sqlite') {
    return Array(count).fill('?').join(', ');
  } else {
    return Array(count).fill(0).map((_, i) => `$${startIndex + i}`).join(', ');
  }
};

// 工具函数：转换布尔值
const toBool = (value) => {
  if (DB_TYPE === 'sqlite') {
    return value ? 1 : 0;
  }
  return value;
};

// 工具函数：从布尔值转换
const fromBool = (value) => {
  if (DB_TYPE === 'sqlite') {
    return value === 1 || value === true;
  }
  return value === true;
};

// 工具函数：转换 JSON
const toJSON = (value) => {
  if (DB_TYPE === 'sqlite') {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  return value;
};

// 工具函数：从 JSON 转换
const fromJSON = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

// 工具函数：获取当前北京时间（数据库使用）
const getBeijingTime = () => {
  if (DB_TYPE === 'sqlite') {
    return "datetime('now', '+8 hours')";
  } else {
    return "CURRENT_TIMESTAMP + INTERVAL '8 hours'";
  }
};

// 图片数据库操作
const imageDB = {
  // 插入新图片记录
  async create(imageData) {
    const {
      filename,
      originalName,
      filePath,
      fileUrl,
      fileSize,
      mimeType,
      width = null,
      height = null,
      uploadType = 'local',
      originalUrl = null,
      tags = [],
      description = null,
      userId = null,
      storageId = null
    } = imageData;

    // 处理 tags (PostgreSQL 使用数组，SQLite 使用 JSON)
    const tagsValue = DB_TYPE === 'sqlite' ? JSON.stringify(tags) : tags;

    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const info = db.prepare(`
        INSERT INTO images (
          user_id, filename, original_name, file_path, file_url, file_size, 
          mime_type, width, height, upload_type, original_url, tags, description, storage_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId, filename, originalName, filePath, fileUrl, fileSize,
        mimeType, width, height, uploadType, originalUrl, tagsValue, description, storageId
      );
      
      // 获取插入的行
      const row = db.prepare('SELECT * FROM images WHERE id = ?').get(info.lastInsertRowid);
      return row;
    } else {
      const query = `
        INSERT INTO images (
          user_id, filename, original_name, file_path, file_url, file_size, 
          mime_type, width, height, upload_type, original_url, tags, description, storage_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
      `;

      const values = [
        userId, filename, originalName, filePath, fileUrl, fileSize,
        mimeType, width, height, uploadType, originalUrl, tagsValue, description, storageId
      ];

      const result = await dbAdapter.query(query, values);
      return result.rows[0];
    }
  },

  // 获取图片列表
  async getList(options = {}) {
    const {
      page = 1,
      limit = 20,
      search = '',
      uploadType = null,
      userId = null,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = options;

    const offset = (page - 1) * limit;
    let whereClause = DB_TYPE === 'sqlite' ? 'WHERE is_deleted = 0' : 'WHERE is_deleted = FALSE';
    const queryParams = [];
    let paramIndex = 1;

    // 用户筛选
    if (userId) {
      whereClause += ` AND user_id = ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`}`;
      queryParams.push(userId);
      paramIndex++;
    }

    // 搜索条件
    if (search) {
      const likeOp = DB_TYPE === 'sqlite' ? 'LIKE' : 'ILIKE';
      whereClause += ` AND (original_name ${likeOp} ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`} OR description ${likeOp} ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`})`;
      queryParams.push(`%${search}%`);
      if (DB_TYPE === 'postgres') {
        queryParams.push(`%${search}%`);
        paramIndex++;
      }
      paramIndex++;
    }

    // 上传类型筛选
    if (uploadType) {
      whereClause += ` AND upload_type = ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`}`;
      queryParams.push(uploadType);
      paramIndex++;
    }

    // 查询总数
    const countQuery = `SELECT COUNT(*) as count FROM images ${whereClause}`;
    const countResult = await dbAdapter.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].count);

    // 查询数据
    const dataQuery = `
      SELECT * FROM images 
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`} OFFSET ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex + 1}`}
    `;
    queryParams.push(limit, offset);

    const dataResult = await dbAdapter.query(dataQuery, queryParams);

    return {
      images: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  // 根据ID获取图片
  async getById(id, includeDeleted = false) {
    let query;
    if (includeDeleted) {
      query = 'SELECT * FROM images WHERE id = ' + (DB_TYPE === 'sqlite' ? '?' : '$1');
    } else {
      const deletedCheck = DB_TYPE === 'sqlite' ? 'is_deleted = 0' : 'is_deleted = FALSE';
      query = `SELECT * FROM images WHERE id = ${DB_TYPE === 'sqlite' ? '?' : '$1'} AND ${deletedCheck}`;
    }
    const result = await dbAdapter.query(query, [id]);
    return result.rows[0];
  },

  // 更新图片信息
  async update(id, updateData) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        fields.push(`${key} = ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`}`);
        values.push(updateData[key]);
        paramIndex++;
      }
    });

    if (fields.length === 0) {
      throw new Error('没有要更新的字段');
    }

    const now = DB_TYPE === 'sqlite' ? "datetime('now', '+8 hours')" : "CURRENT_TIMESTAMP + INTERVAL '8 hours'";
    fields.push(`updated_at = ${now}`);
    values.push(id);

    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const query = `
        UPDATE images 
        SET ${fields.join(', ')}
        WHERE id = ? AND is_deleted = 0
      `;
      db.prepare(query).run(...values);
      return db.prepare('SELECT * FROM images WHERE id = ?').get(id);
    } else {
      const deletedCheck = 'is_deleted = FALSE';
      const query = `
        UPDATE images 
        SET ${fields.join(', ')}
        WHERE id = $${paramIndex} AND ${deletedCheck}
        RETURNING *
      `;
      const result = await dbAdapter.query(query, values);
      return result.rows[0];
    }
  },

  // 软删除图片
  async delete(id) {
    const deletedVal = toBool(true);
    const now = DB_TYPE === 'sqlite' ? "datetime('now', '+8 hours')" : "CURRENT_TIMESTAMP + INTERVAL '8 hours'";
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare(`
        UPDATE images 
        SET is_deleted = ?, updated_at = ${now}
        WHERE id = ? AND is_deleted = 0
      `).run(deletedVal, id);
      return db.prepare('SELECT * FROM images WHERE id = ?').get(id);
    } else {
      const query = `
        UPDATE images 
        SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
        WHERE id = $1 AND is_deleted = FALSE
        RETURNING *
      `;
      const result = await dbAdapter.query(query, [id]);
      return result.rows[0];
    }
  },

  // 批量删除图片
  async batchDelete(ids) {
    if (!ids || ids.length === 0) return [];
    
    const deletedVal = toBool(true);
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`
        UPDATE images 
        SET is_deleted = ?, updated_at = datetime('now', '+8 hours')
        WHERE id IN (${placeholders}) AND is_deleted = 0
      `).run(deletedVal, ...ids);
      
      const rows = db.prepare(`SELECT * FROM images WHERE id IN (${placeholders})`).all(...ids);
      return rows;
    } else {
      const query = `
        UPDATE images 
        SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
        WHERE id = ANY($1) AND is_deleted = FALSE
        RETURNING *
      `;
      const result = await dbAdapter.query(query, [ids]);
      return result.rows;
    }
  },

  // 硬删除图片
  async permanentDelete(id) {
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const row = db.prepare('SELECT * FROM images WHERE id = ?').get(id);
      db.prepare('DELETE FROM images WHERE id = ?').run(id);
      return row;
    } else {
      const query = 'DELETE FROM images WHERE id = $1 RETURNING *';
      const result = await dbAdapter.query(query, [id]);
      return result.rows[0];
    }
  },

  // 批量硬删除图片
  async batchPermanentDelete(ids) {
    if (!ids || ids.length === 0) return [];
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const placeholders = ids.map(() => '?').join(',');
      const rows = db.prepare(`SELECT * FROM images WHERE id IN (${placeholders})`).all(...ids);
      db.prepare(`DELETE FROM images WHERE id IN (${placeholders})`).run(...ids);
      return rows;
    } else {
      const query = 'DELETE FROM images WHERE id = ANY($1) RETURNING *';
      const result = await dbAdapter.query(query, [ids]);
      return result.rows;
    }
  }
};

// 用户数据库操作
const userDB = {
  // 创建新用户（使用北京时间 UTC+8）
  async create(userData) {
    const {
      username,
      email,
      passwordHash,
      role = 'user',
      avatarUrl = null
    } = userData;

    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const info = db.prepare(`
        INSERT INTO users (username, email, password_hash, role, avatar_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
      `).run(username, email, passwordHash, role, avatarUrl);
      
      return db.prepare('SELECT id, username, email, role, avatar_url, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
    } else {
      const query = `
        INSERT INTO users (username, email, password_hash, role, avatar_url, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + INTERVAL '8 hours', CURRENT_TIMESTAMP + INTERVAL '8 hours')
        RETURNING id, username, email, role, avatar_url, created_at
      `;
      const values = [username, email, passwordHash, role, avatarUrl];
      const result = await dbAdapter.query(query, values);
      return result.rows[0];
    }
  },

  // 检查用户名是否存在
  async usernameExists(username) {
    const user = await this.getByUsername(username);
    return !!user;
  },

  // 检查邮箱是否存在（可选排除指定用户ID）
  async emailExists(email, excludeUserId = null) {
    const query = excludeUserId
      ? 'SELECT id FROM users WHERE email = $1 AND id != $2'
      : 'SELECT id FROM users WHERE email = $1';
    const values = excludeUserId ? [email, excludeUserId] : [email];
    const result = await dbAdapter.query(query, values);
    return result.rows.length > 0;
  },

  // 根据用户名查找用户
  async getByUsername(username) {
    const disabledCheck = DB_TYPE === 'sqlite' ? 'is_disabled = 0' : 'is_disabled = FALSE';
    const query = `SELECT * FROM users WHERE username = ${DB_TYPE === 'sqlite' ? '?' : '$1'} AND ${disabledCheck}`;
    const result = await dbAdapter.query(query, [username]);
    return result.rows[0];
  },

  // 根据邮箱查找用户
  async getByEmail(email) {
    const disabledCheck = DB_TYPE === 'sqlite' ? 'is_disabled = 0' : 'is_disabled = FALSE';
    const query = `SELECT * FROM users WHERE email = ${DB_TYPE === 'sqlite' ? '?' : '$1'} AND ${disabledCheck}`;
    const result = await dbAdapter.query(query, [email]);
    return result.rows[0];
  },

  // 根据ID查找用户
  async getById(id) {
    const disabledCheck = DB_TYPE === 'sqlite' ? 'is_disabled = 0' : 'is_disabled = FALSE';
    const query = `SELECT * FROM users WHERE id = ${DB_TYPE === 'sqlite' ? '?' : '$1'} AND ${disabledCheck}`;
    const result = await dbAdapter.query(query, [id]);
    return result.rows[0];
  },

  // 更新最后登录时间（使用北京时间 UTC+8）
  async updateLastLogin(id) {
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare(`
        UPDATE users 
        SET last_login_at = datetime('now', '+8 hours'), updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `).run(id);
      return db.prepare('SELECT last_login_at FROM users WHERE id = ?').get(id);
    } else {
      const query = `
        UPDATE users 
        SET last_login_at = CURRENT_TIMESTAMP + INTERVAL '8 hours', 
            updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
        WHERE id = $1
        RETURNING last_login_at
      `;
      const result = await dbAdapter.query(query, [id]);
      return result.rows[0];
    }
  },

  // 更新用户个人资料
  async updateProfile(id, profileData) {
    const { email } = profileData;
    const now = DB_TYPE === 'sqlite' ? "datetime('now', '+8 hours')" : "CURRENT_TIMESTAMP + INTERVAL '8 hours'";
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare(`
        UPDATE users 
        SET email = ?, updated_at = ${now}
        WHERE id = ?
      `).run(email, id);
      return db.prepare('SELECT id, username, email, role, avatar_url, created_at, updated_at FROM users WHERE id = ?').get(id);
    } else {
      const query = `
        UPDATE users 
        SET email = $2, updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
        WHERE id = $1
        RETURNING id, username, email, role, avatar_url, created_at, updated_at
      `;
      const result = await dbAdapter.query(query, [id, email]);
      return result.rows[0];
    }
  },

  // 修改密码
  async changePassword(id, currentPassword, newPassword) {
    // 先获取用户当前密码hash
    const user = await this.getById(id);
    if (!user) {
      return false;
    }

    // 验证当前密码
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isCurrentPasswordValid) {
      return false;
    }

    // 生成新密码hash
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    // 更新密码
    const now = DB_TYPE === 'sqlite' ? "datetime('now', '+8 hours')" : "CURRENT_TIMESTAMP + INTERVAL '8 hours'";
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const info = db.prepare(`
        UPDATE users 
        SET password_hash = ?, updated_at = ${now}
        WHERE id = ?
      `).run(newPasswordHash, id);
      return info.changes > 0;
    } else {
      const query = `
        UPDATE users 
        SET password_hash = $2, updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
        WHERE id = $1
        RETURNING id
      `;
      const result = await dbAdapter.query(query, [id, newPasswordHash]);
      return result.rows.length > 0;
    }
  },

  // 设置邮箱验证令牌
  async setEmailVerificationToken(id, token) {
    const now = DB_TYPE === 'sqlite' ? "datetime('now', '+8 hours')" : "CURRENT_TIMESTAMP + INTERVAL '8 hours'";
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare(`
        UPDATE users 
        SET email_verification_token = ?, email_verification_sent_at = ${now}
        WHERE id = ?
      `).run(token, id);
      return true;
    } else {
      const query = `
        UPDATE users 
        SET email_verification_token = $2, email_verification_sent_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
        WHERE id = $1
      `;
      await dbAdapter.query(query, [id, token]);
      return true;
    }
  },

  // 根据验证令牌查找用户
  async getByVerificationToken(token) {
    const query = `SELECT * FROM users WHERE email_verification_token = ${DB_TYPE === 'sqlite' ? '?' : '$1'}`;
    const result = await dbAdapter.query(query, [token]);
    return result.rows[0];
  },

  // 验证邮箱
  async verifyEmail(token) {
    const now = DB_TYPE === 'sqlite' ? "datetime('now', '+8 hours')" : "CURRENT_TIMESTAMP + INTERVAL '8 hours'";
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const info = db.prepare(`
        UPDATE users 
        SET email_verified = 1, email_verification_token = NULL, updated_at = ${now}
        WHERE email_verification_token = ?
      `).run(token);
      return info.changes > 0;
    } else {
      const query = `
        UPDATE users 
        SET email_verified = TRUE, email_verification_token = NULL, updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
        WHERE email_verification_token = $1
        RETURNING id
      `;
      const result = await dbAdapter.query(query, [token]);
      return result.rows.length > 0;
    }
  },

  // 重新发送验证邮件（清除旧令牌）
  async clearVerificationToken(id) {
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare(`
        UPDATE users 
        SET email_verification_token = NULL, email_verification_sent_at = NULL
        WHERE id = ?
      `).run(id);
      return true;
    } else {
      const query = `
        UPDATE users 
        SET email_verification_token = NULL, email_verification_sent_at = NULL
        WHERE id = $1
      `;
      await dbAdapter.query(query, [id]);
      return true;
    }
  },

  // 获取用户列表（管理员）
  async getList(options = {}) {
    const { page = 1, limit = 20, search = '', role = null } = options;
    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE 1=1';
    const queryParams = [];
    let paramIndex = 1;
    
    // 角色筛选
    if (role) {
      whereClause += ` AND role = ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`}`;
      queryParams.push(role);
      paramIndex++;
    }
    
    // 搜索条件
    if (search) {
      const likeOp = DB_TYPE === 'sqlite' ? 'LIKE' : 'ILIKE';
      whereClause += ` AND (username ${likeOp} ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`} OR email ${likeOp} ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`})`;
      queryParams.push(`%${search}%`);
      if (DB_TYPE === 'postgres') {
        queryParams.push(`%${search}%`);
        paramIndex++;
      }
      paramIndex++;
    }
    
    // 查询总数
    const countQuery = `SELECT COUNT(*) as count FROM users ${whereClause}`;
    const countResult = await dbAdapter.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].count);
    
    // 查询用户数据
    const dataQuery = `
      SELECT id, username, email, role, avatar_url, is_disabled, 
             email_verified, last_login_at, created_at, updated_at
      FROM users 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`} OFFSET ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex + 1}`}
    `;
    queryParams.push(limit, offset);
    
    const dataResult = await dbAdapter.query(dataQuery, queryParams);
    
    // 获取每个用户的图片数量，并转换字段名为驼峰命名
    const usersWithImageCount = await Promise.all(
      dataResult.rows.map(async (user) => {
        const imageCount = await this.getImageCount(user.id);
        return {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          avatarUrl: user.avatar_url,
          imageCount,
          isDisabled: DB_TYPE === 'sqlite' ? user.is_disabled === 1 : user.is_disabled,
          emailVerified: DB_TYPE === 'sqlite' ? user.email_verified === 1 : user.email_verified,
          lastLoginAt: user.last_login_at,
          createdAt: user.created_at,
          updatedAt: user.updated_at
        };
      })
    );
    
    return {
      list: usersWithImageCount,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  // 获取用户图片数量
  async getImageCount(userId) {
    const deletedCheck = DB_TYPE === 'sqlite' ? 'is_deleted = 0' : 'is_deleted = FALSE';
    const query = `SELECT COUNT(*) as count FROM images WHERE user_id = ${DB_TYPE === 'sqlite' ? '?' : '$1'} AND ${deletedCheck}`;
    const result = await dbAdapter.query(query, [userId]);
    return parseInt(result.rows[0].count);
  },

  // 获取用户统计
  async getStats() {
    // 总用户数
    const totalQuery = 'SELECT COUNT(*) as count FROM users';
    const totalResult = await dbAdapter.query(totalQuery);
    const total = parseInt(totalResult.rows[0].count);
    
    // 活跃用户（未禁用）
    const activeCheck = DB_TYPE === 'sqlite' ? 'is_disabled = 0' : 'is_disabled = FALSE';
    const activeQuery = `SELECT COUNT(*) as count FROM users WHERE ${activeCheck}`;
    const activeResult = await dbAdapter.query(activeQuery);
    const active = parseInt(activeResult.rows[0].count);
    
    // 已禁用用户
    const disabledCheck = DB_TYPE === 'sqlite' ? 'is_disabled = 1' : 'is_disabled = TRUE';
    const disabledQuery = `SELECT COUNT(*) as count FROM users WHERE ${disabledCheck}`;
    const disabledResult = await dbAdapter.query(disabledQuery);
    const disabled = parseInt(disabledResult.rows[0].count);
    
    // 管理员数量
    const adminQuery = "SELECT COUNT(*) as count FROM users WHERE role = 'admin'";
    const adminResult = await dbAdapter.query(adminQuery);
    const admin = parseInt(adminResult.rows[0].count);
    
    return { total, active, disabled, admin };
  },

  // 更新用户信息（管理员）
  async update(id, updateData) {
    const { email, role, isDisabled } = updateData;
    const now = DB_TYPE === 'sqlite' ? "datetime('now', '+8 hours')" : "CURRENT_TIMESTAMP + INTERVAL '8 hours'";
    
    const fields = [];
    const values = [];
    let paramIndex = 1;
    
    if (email !== undefined) {
      fields.push(`email = ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`}`);
      values.push(email);
      paramIndex++;
    }
    
    if (role !== undefined) {
      fields.push(`role = ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`}`);
      values.push(role);
      paramIndex++;
    }
    
    if (isDisabled !== undefined) {
      fields.push(`is_disabled = ${DB_TYPE === 'sqlite' ? '?' : `$${paramIndex}`}`);
      values.push(DB_TYPE === 'sqlite' ? (isDisabled ? 1 : 0) : isDisabled);
      paramIndex++;
    }
    
    if (fields.length === 0) return null;
    
    fields.push(`updated_at = ${now}`);
    values.push(id);
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare(`
        UPDATE users 
        SET ${fields.join(', ')}
        WHERE id = ?
      `).run(...values);
      
      return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    } else {
      const query = `
        UPDATE users 
        SET ${fields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;
      const result = await dbAdapter.query(query, values);
      return result.rows[0];
    }
  },

  // 禁用用户
  async disable(id) {
    return this.update(id, { isDisabled: true });
  },

  // 启用用户
  async enable(id) {
    return this.update(id, { isDisabled: false });
  },

  // 删除用户
  async delete(id) {
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const info = db.prepare('DELETE FROM users WHERE id = ?').run(id);
      return info.changes > 0;
    } else {
      const query = 'DELETE FROM users WHERE id = $1 RETURNING id';
      const result = await dbAdapter.query(query, [id]);
      return result.rows.length > 0;
    }
  }
};

// 统计数据库操作
const statsDB = {
  // 更新每日统计
  async updateDailyStats(date, uploadCount = 0, totalSize = 0, transferCount = 0) {
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const existing = db.prepare('SELECT id FROM upload_stats WHERE date = ?').get(date);
      
      if (existing) {
        db.prepare(`
          UPDATE upload_stats 
          SET upload_count = upload_count + ?,
              total_size = total_size + ?,
              transfer_count = transfer_count + ?,
              updated_at = datetime('now', '+8 hours')
          WHERE date = ?
        `).run(uploadCount, totalSize, transferCount, date);
      } else {
        db.prepare(`
          INSERT INTO upload_stats (date, upload_count, total_size, transfer_count)
          VALUES (?, ?, ?, ?)
        `).run(date, uploadCount, totalSize, transferCount);
      }
      
      return db.prepare('SELECT * FROM upload_stats WHERE date = ?').get(date);
    } else {
      const query = `
        INSERT INTO upload_stats (date, upload_count, total_size, transfer_count)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (date) 
        DO UPDATE SET 
          upload_count = upload_stats.upload_count + $2,
          total_size = upload_stats.total_size + $3,
          transfer_count = upload_stats.transfer_count + $4,
          updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
        RETURNING *
      `;
      const result = await dbAdapter.query(query, [date, uploadCount, totalSize, transferCount]);
      return result.rows[0];
    }
  },

  // 获取总体统计
  async getOverallStats() {
    const deletedCheck = DB_TYPE === 'sqlite' ? 'is_deleted = 0' : 'is_deleted = FALSE';
    
    const queries = [
      `SELECT COUNT(*) as total_images FROM images WHERE ${deletedCheck}`,
      `SELECT COALESCE(SUM(file_size), 0) as total_size FROM images WHERE ${deletedCheck}`,
      DB_TYPE === 'sqlite' 
        ? `SELECT COUNT(*) as monthly_uploads FROM images WHERE ${deletedCheck} AND created_at >= date('now', 'start of month')`
        : `SELECT COUNT(*) as monthly_uploads FROM images WHERE ${deletedCheck} AND created_at >= date_trunc('month', CURRENT_DATE)`,
      `SELECT COALESCE(SUM(file_size), 0) * 2 as total_traffic FROM images WHERE ${deletedCheck}`
    ];

    const results = await Promise.all(
      queries.map(query => dbAdapter.query(query))
    );

    return {
      totalImages: parseInt(results[0].rows[0].total_images),
      totalSize: parseInt(results[1].rows[0].total_size),
      monthlyUploads: parseInt(results[2].rows[0].monthly_uploads),
      totalTraffic: parseInt(results[3].rows[0].total_traffic)
    };
  },

  // 获取上传趋势数据
  async getUploadTrend(days = 30) {
    const query = DB_TYPE === 'sqlite'
      ? `SELECT date, upload_count, total_size, transfer_count
         FROM upload_stats 
         WHERE date >= date('now', '-${days} days')
         ORDER BY date DESC`
      : `SELECT date, upload_count, total_size, transfer_count
         FROM upload_stats 
         WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
         ORDER BY date DESC`;
    
    const result = await dbAdapter.query(query);
    return result.rows;
  }
};

// 系统配置数据库操作
const configDB = {
  // 获取配置
  async getConfig(key) {
    const query = `SELECT config_value FROM system_configs WHERE config_key = ${DB_TYPE === 'sqlite' ? '?' : '$1'}`;
    const result = await dbAdapter.query(query, [key]);
    const value = result.rows[0]?.config_value || null;
    return this._normalizeToCamelCase(fromJSON(value));
  },

  // 将下划线命名转换为驼峰命名
  _normalizeToCamelCase(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const camelCaseMap = {
      // 系统配置
      'site_title': 'siteName',
      'site_logo': 'siteLogo',
      'site_description': 'siteDescription',
      'site_keywords': 'siteKeywords',
      'site_icon': 'siteIcon',
      'max_file_size': 'maxFileSize',
      'max_batch_count': 'maxBatchCount',
      'compress_quality': 'compressQuality',
      'allowed_types': 'allowedTypes',
      'auto_compress': 'autoCompress',
      'generate_thumbnail': 'generateThumbnail',
      'allow_register': 'allowRegistration',
      // 安全配置
      'require_email_verify': 'requireEmailVerification',
      'jwt_expire_hours': 'jwtExpiration',
      'max_login_attempts': 'maxLoginAttempts',
      // 邮件配置
      'smtp_host': 'smtpHost',
      'smtp_port': 'smtpPort',
      'smtp_secure': 'smtpSecure',
      'from_email': 'fromEmail',
      'smtp_user': 'smtpUser',
      'smtp_pass': 'smtpPass',
      // 存储配置
      'secret_id': 'secretId',
      'secret_key': 'secretKey',
      'access_key': 'accessKey',
      'access_key_id': 'accessKeyId',
      'access_key_secret': 'accessKeySecret',
      'secret_access_key': 'secretAccessKey',
      'use_ssl': 'useSSL',
      'use_cdn': 'useCDN',
      'cdn_domain': 'cdnDomain',
      'base_path': 'basePath',
      'storage_type': 'storageType',
      'custom_endpoint': 'customEndpoint',
      'is_default': 'isDefault',
      'created_at': 'createdAt',
      'updated_at': 'updatedAt'
    };
    
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      // 如果已经是驼峰命名，保留；如果是下划线，转换
      const normalizedKey = camelCaseMap[key] || key;
      // 如果驼峰命名的键已存在，优先使用它（新数据覆盖旧数据）
      if (result[normalizedKey] === undefined) {
        result[normalizedKey] = val;
      }
    }
    return result;
  },

  // 设置配置
  async setConfig(key, value, description = null) {
    // 规范化字段命名，统一使用驼峰
    const normalizedValue = this._normalizeToCamelCase(value);
    const configValue = JSON.stringify(normalizedValue || {});
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const existing = db.prepare('SELECT id FROM system_configs WHERE config_key = ?').get(key);
      
      if (existing) {
        db.prepare(`
          UPDATE system_configs 
          SET config_value = ?, description = COALESCE(?, description), updated_at = datetime('now', '+8 hours')
          WHERE config_key = ?
        `).run(configValue, description, key);
      } else {
        db.prepare(`
          INSERT INTO system_configs (config_key, config_value, description)
          VALUES (?, ?, ?)
        `).run(key, configValue, description);
      }
      
      return db.prepare('SELECT * FROM system_configs WHERE config_key = ?').get(key);
    } else {
      const query = `
        INSERT INTO system_configs (config_key, config_value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (config_key) 
        DO UPDATE SET 
          config_value = $2,
          description = COALESCE($3, system_configs.description),
          updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
        RETURNING *
      `;
      const result = await dbAdapter.query(query, [key, configValue, description]);
      return result.rows[0];
    }
  },

  // 获取所有配置
  async getAllConfigs() {
    const query = 'SELECT config_key, config_value, description FROM system_configs ORDER BY config_key';
    const result = await dbAdapter.query(query);
    const configs = {};
    result.rows.forEach(row => {
      configs[row.config_key] = this._normalizeToCamelCase(fromJSON(row.config_value));
    });
    return configs;
  },

  // 批量设置配置
  async setConfigs(configs) {
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const transaction = db.transaction((configsToSet) => {
        for (const [key, value] of Object.entries(configsToSet)) {
          const configValue = JSON.stringify(value);
          const existing = db.prepare('SELECT id FROM system_configs WHERE config_key = ?').get(key);
          
          if (existing) {
            db.prepare(`
              UPDATE system_configs 
              SET config_value = ?, updated_at = datetime('now', '+8 hours')
              WHERE config_key = ?
            `).run(configValue, key);
          } else {
            db.prepare(`
              INSERT INTO system_configs (config_key, config_value)
              VALUES (?, ?)
            `).run(key, configValue);
          }
        }
      });
      
      transaction(configs);
      return true;
    } else {
      const pool = dbAdapter.getConnection();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        for (const [key, value] of Object.entries(configs)) {
          await client.query(`
            INSERT INTO system_configs (config_key, config_value)
            VALUES ($1, $2)
            ON CONFLICT (config_key) 
            DO UPDATE SET 
              config_value = $2,
              updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
          `, [key, JSON.stringify(value)]);
        }
        
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  }
};

// 存储配置数据库操作
const storageDB = {
  // 获取所有存储配置
  async getAllStorages() {
    const activeCheck = DB_TYPE === 'sqlite' ? 'is_active = 1' : 'is_active = true';
    const query = `SELECT * FROM storage_configs WHERE ${activeCheck} ORDER BY is_default DESC, created_at ASC`;
    const result = await dbAdapter.query(query);
    
    // 转换为驼峰命名
    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type,
      config: fromJSON(row.config),
      isDefault: fromBool(row.is_default),
      isActive: fromBool(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  },

  // 获取存储配置
  async getStorage(id) {
    const activeCheck = DB_TYPE === 'sqlite' ? 'is_active = 1' : 'is_active = true';
    const query = `SELECT * FROM storage_configs WHERE id = ${DB_TYPE === 'sqlite' ? '?' : '$1'} AND ${activeCheck}`;
    const result = await dbAdapter.query(query, [id]);
    
    if (result.rows[0]) {
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        config: fromJSON(row.config),
        isDefault: fromBool(row.is_default),
        isActive: fromBool(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }
    return null;
  },

  // 获取默认存储配置
  async getDefaultStorage() {
    const checks = DB_TYPE === 'sqlite' ? 'is_default = 1 AND is_active = 1' : 'is_default = true AND is_active = true';
    const query = `SELECT * FROM storage_configs WHERE ${checks}`;
    const result = await dbAdapter.query(query);
    
    if (result.rows[0]) {
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        config: fromJSON(row.config),
        isDefault: fromBool(row.is_default),
        isActive: fromBool(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        config: fromJSON(result.rows[0].config),
        is_default: fromBool(result.rows[0].is_default),
        is_active: fromBool(result.rows[0].is_active)
      };
    }
    return null;
  },

  // 创建存储配置
  async createStorage(name, type, config) {
    const configValue = JSON.stringify(config);
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const info = db.prepare(`
        INSERT INTO storage_configs (name, type, config)
        VALUES (?, ?, ?)
      `).run(name, type, configValue);
      
      const row = db.prepare('SELECT * FROM storage_configs WHERE id = ?').get(info.lastInsertRowid);
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        config: fromJSON(row.config),
        isDefault: fromBool(row.is_default),
        isActive: fromBool(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } else {
      const query = `
        INSERT INTO storage_configs (name, type, config)
        VALUES ($1, $2, $3)
        RETURNING *
      `;
      const result = await dbAdapter.query(query, [name, type, configValue]);
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        config: fromJSON(row.config),
        isDefault: fromBool(row.is_default),
        isActive: fromBool(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }
  },

  // 更新存储配置
  async updateStorage(id, name, type, config) {
    const configValue = JSON.stringify(config);
    const now = DB_TYPE === 'sqlite' ? "datetime('now', '+8 hours')" : "CURRENT_TIMESTAMP + INTERVAL '8 hours'";
    const activeCheck = DB_TYPE === 'sqlite' ? 'is_active = 1' : 'is_active = true';
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare(`
        UPDATE storage_configs 
        SET name = ?, type = ?, config = ?, updated_at = ${now}
        WHERE id = ? AND ${activeCheck}
      `).run(name, type, configValue, id);
      
      const row = db.prepare('SELECT * FROM storage_configs WHERE id = ?').get(id);
      return row ? {
        id: row.id,
        name: row.name,
        type: row.type,
        config: fromJSON(row.config),
        isDefault: fromBool(row.is_default),
        isActive: fromBool(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      } : null;
    } else {
      const query = `
        UPDATE storage_configs 
        SET name = $2, type = $3, config = $4, updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
        WHERE id = $1 AND is_active = true
        RETURNING *
      `;
      const result = await dbAdapter.query(query, [id, name, type, configValue]);
      if (!result.rows[0]) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        config: fromJSON(row.config),
        isDefault: fromBool(row.is_default),
        isActive: fromBool(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }
  },

  // 设置默认存储
  async setDefaultStorage(id) {
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const transaction = db.transaction(() => {
        // 先取消所有默认设置
        db.prepare(`
          UPDATE storage_configs 
          SET is_default = 0, updated_at = datetime('now', '+8 hours')
          WHERE is_default = 1
        `).run();
        
        // 设置新的默认存储
        const info = db.prepare(`
          UPDATE storage_configs 
          SET is_default = 1, updated_at = datetime('now', '+8 hours')
          WHERE id = ? AND is_active = 1
        `).run(id);
        
        if (info.changes === 0) {
          throw new Error(`存储配置 ID ${id} 不存在或已被禁用`);
        }
      });
      
      transaction();
      const row = db.prepare('SELECT * FROM storage_configs WHERE id = ?').get(id);
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        config: fromJSON(row.config),
        isDefault: fromBool(row.is_default),
        isActive: fromBool(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } else {
      const pool = dbAdapter.getConnection();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        // 先取消所有默认设置
        await client.query(`
          UPDATE storage_configs 
          SET is_default = false, updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
          WHERE is_default = true
        `);
        
        // 设置新的默认存储
        const result = await client.query(`
          UPDATE storage_configs 
          SET is_default = true, updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
          WHERE id = $1 AND is_active = true
          RETURNING *
        `, [id]);
        
        if (result.rows.length === 0) {
          throw new Error(`存储配置 ID ${id} 不存在或已被禁用`);
        }
        
        await client.query('COMMIT');
        const row = result.rows[0];
        return {
          id: row.id,
          name: row.name,
          type: row.type,
          config: fromJSON(row.config),
          isDefault: fromBool(row.is_default),
          isActive: fromBool(row.is_active),
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  },

  // 删除存储配置（软删除）
  async deleteStorage(id) {
    const now = DB_TYPE === 'sqlite' ? "datetime('now', '+8 hours')" : "CURRENT_TIMESTAMP + INTERVAL '8 hours'";
    const defaultCheck = DB_TYPE === 'sqlite' ? 'is_default = 0' : 'is_default = false';
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare(`
        UPDATE storage_configs 
        SET is_active = 0, updated_at = ${now}
        WHERE id = ? AND ${defaultCheck}
      `).run(id);
      
      return db.prepare('SELECT * FROM storage_configs WHERE id = ?').get(id);
    } else {
      const query = `
        UPDATE storage_configs 
        SET is_active = false, updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
        WHERE id = $1 AND is_default = false
        RETURNING *
      `;
      const result = await dbAdapter.query(query, [id]);
      return result.rows[0];
    }
  }
};

// API 密钥数据库操作
const apiKeyDB = {
  // 生成随机 API 密钥
  generateApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = 'sk_';
    for (let i = 0; i < 48; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
  },

  // 创建 API 密钥
  async createApiKey(userId, name, permissions = ['upload', 'view'], expiresAt = null) {
    const apiKey = this.generateApiKey();
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const result = db.prepare(`
        INSERT INTO api_keys (user_id, name, api_key, permissions, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, name, apiKey, JSON.stringify(permissions), expiresAt);
      
      return {
        id: result.lastInsertRowid,
        user_id: userId,
        name,
        api_key: apiKey,
        permissions,
        is_active: true,
        expires_at: expiresAt,
        created_at: new Date().toISOString()
      };
    } else {
      const query = `
        INSERT INTO api_keys (user_id, name, api_key, permissions, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;
      const result = await dbAdapter.query(query, [userId, name, apiKey, JSON.stringify(permissions), expiresAt]);
      const row = result.rows[0];
      return {
        ...row,
        permissions: fromJSON(row.permissions)
      };
    }
  },

  // 获取用户的所有 API 密钥
  async getApiKeysByUserId(userId) {
    const query = DB_TYPE === 'sqlite'
      ? 'SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC';
    
    const result = await dbAdapter.query(query, [userId]);
    
    return result.rows.map(row => ({
      ...row,
      permissions: fromJSON(row.permissions),
      is_active: fromBool(row.is_active)
    }));
  },

  // 通过 API 密钥获取信息（用于鉴权）
  async getByApiKey(apiKey) {
    const activeCheck = DB_TYPE === 'sqlite' ? 'is_active = 1' : 'is_active = true';
    const query = DB_TYPE === 'sqlite'
      ? `SELECT ak.*, u.id as owner_id, u.username, u.role, u.is_disabled 
         FROM api_keys ak 
         JOIN users u ON ak.user_id = u.id 
         WHERE ak.api_key = ? AND ak.${activeCheck}`
      : `SELECT ak.*, u.id as owner_id, u.username, u.role, u.is_disabled 
         FROM api_keys ak 
         JOIN users u ON ak.user_id = u.id 
         WHERE ak.api_key = $1 AND ak.${activeCheck}`;
    
    const result = await dbAdapter.query(query, [apiKey]);
    
    if (result.rows[0]) {
      const row = result.rows[0];
      return {
        ...row,
        permissions: fromJSON(row.permissions),
        is_active: fromBool(row.is_active),
        is_disabled: fromBool(row.is_disabled)
      };
    }
    return null;
  },

  // 更新最后使用时间
  async updateLastUsed(apiKeyId) {
    const now = DB_TYPE === 'sqlite' ? "datetime('now', '+8 hours')" : "CURRENT_TIMESTAMP + INTERVAL '8 hours'";
    const query = DB_TYPE === 'sqlite'
      ? `UPDATE api_keys SET last_used_at = ${now} WHERE id = ?`
      : `UPDATE api_keys SET last_used_at = ${now} WHERE id = $1`;
    
    await dbAdapter.query(query, [apiKeyId]);
  },

  // 删除 API 密钥
  async deleteApiKey(id, userId) {
    const query = DB_TYPE === 'sqlite'
      ? 'DELETE FROM api_keys WHERE id = ? AND user_id = ?'
      : 'DELETE FROM api_keys WHERE id = $1 AND user_id = $2';
    
    const result = await dbAdapter.query(query, [id, userId]);
    return DB_TYPE === 'sqlite' ? result.changes > 0 : result.rowCount > 0;
  },

  // 切换 API 密钥状态
  async toggleApiKey(id, userId) {
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare(`
        UPDATE api_keys 
        SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
            updated_at = datetime('now', '+8 hours')
        WHERE id = ? AND user_id = ?
      `).run(id, userId);
      
      const updated = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
      if (updated) {
        return {
          ...updated,
          permissions: fromJSON(updated.permissions),
          is_active: fromBool(updated.is_active)
        };
      }
      return null;
    } else {
      const query = `
        UPDATE api_keys 
        SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
        WHERE id = $1 AND user_id = $2
        RETURNING *
      `;
      const result = await dbAdapter.query(query, [id, userId]);
      if (result.rows[0]) {
        return {
          ...result.rows[0],
          permissions: fromJSON(result.rows[0].permissions)
        };
      }
      return null;
    }
  },

  // 更新 API 密钥信息
  async updateApiKey(id, userId, updates) {
    const { name, permissions } = updates;
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare(`
        UPDATE api_keys 
        SET name = ?, permissions = ?, updated_at = datetime('now', '+8 hours')
        WHERE id = ? AND user_id = ?
      `).run(name, JSON.stringify(permissions), id, userId);
      
      const updated = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
      if (updated) {
        return {
          ...updated,
          permissions: fromJSON(updated.permissions),
          is_active: fromBool(updated.is_active)
        };
      }
      return null;
    } else {
      const query = `
        UPDATE api_keys 
        SET name = $1, permissions = $2, updated_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
        WHERE id = $3 AND user_id = $4
        RETURNING *
      `;
      const result = await dbAdapter.query(query, [name, JSON.stringify(permissions), id, userId]);
      if (result.rows[0]) {
        return {
          ...result.rows[0],
          permissions: fromJSON(result.rows[0].permissions)
        };
      }
      return null;
    }
  }
};

// 测试数据库连接
const testConnection = async () => {
  return await dbAdapter.testConnection();
};

// 优雅关闭数据库连接
const closeDatabase = async () => {
  return await dbAdapter.close();
};

// 导出pool兼容性（用于旧代码）
const pool = dbAdapter.getConnection();

module.exports = {
  pool,
  testConnection,
  closeDatabase,
  imageDB,
  statsDB,
  userDB,
  configDB,
  storageDB,
  apiKeyDB,
  dbAdapter,
  DB_TYPE
};

