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

    const now = DB_TYPE === 'sqlite' ? "datetime('now')" : "CURRENT_TIMESTAMP";
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
    const now = DB_TYPE === 'sqlite' ? "datetime('now')" : "CURRENT_TIMESTAMP";
    
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
        SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
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
        SET is_deleted = ?, updated_at = datetime('now')
        WHERE id IN (${placeholders}) AND is_deleted = 0
      `).run(deletedVal, ...ids);
      
      const rows = db.prepare(`SELECT * FROM images WHERE id IN (${placeholders})`).all(...ids);
      return rows;
    } else {
      const query = `
        UPDATE images 
        SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
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
  // 创建新用户
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
        INSERT INTO users (username, email, password_hash, role, avatar_url)
        VALUES (?, ?, ?, ?, ?)
      `).run(username, email, passwordHash, role, avatarUrl);
      
      return db.prepare('SELECT id, username, email, role, avatar_url, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
    } else {
      const query = `
        INSERT INTO users (username, email, password_hash, role, avatar_url)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, username, email, role, avatar_url, created_at
      `;
      const values = [username, email, passwordHash, role, avatarUrl];
      const result = await dbAdapter.query(query, values);
      return result.rows[0];
    }
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

  // 更新最后登录时间
  async updateLastLogin(id) {
    const now = DB_TYPE === 'sqlite' ? "datetime('now')" : "CURRENT_TIMESTAMP";
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      db.prepare(`
        UPDATE users 
        SET last_login_at = ${now}, updated_at = ${now}
        WHERE id = ?
      `).run(id);
      return db.prepare('SELECT last_login_at FROM users WHERE id = ?').get(id);
    } else {
      const query = `
        UPDATE users 
        SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
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
    const now = DB_TYPE === 'sqlite' ? "datetime('now')" : "CURRENT_TIMESTAMP";
    
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
        SET email = $2, updated_at = CURRENT_TIMESTAMP
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
    const now = DB_TYPE === 'sqlite' ? "datetime('now')" : "CURRENT_TIMESTAMP";
    
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
        SET password_hash = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id
      `;
      const result = await dbAdapter.query(query, [id, newPasswordHash]);
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
              updated_at = datetime('now')
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
          updated_at = CURRENT_TIMESTAMP
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
    return fromJSON(value);
  },

  // 设置配置
  async setConfig(key, value, description = null) {
    const configValue = JSON.stringify(value || {});
    
    if (DB_TYPE === 'sqlite') {
      const db = dbAdapter.getConnection();
      const existing = db.prepare('SELECT id FROM system_configs WHERE config_key = ?').get(key);
      
      if (existing) {
        db.prepare(`
          UPDATE system_configs 
          SET config_value = ?, description = COALESCE(?, description), updated_at = datetime('now')
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
          updated_at = CURRENT_TIMESTAMP
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
      configs[row.config_key] = fromJSON(row.config_value);
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
              SET config_value = ?, updated_at = datetime('now')
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
              updated_at = CURRENT_TIMESTAMP
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
    
    // 转换 config 字段
    return result.rows.map(row => ({
      ...row,
      config: fromJSON(row.config),
      is_default: fromBool(row.is_default),
      is_active: fromBool(row.is_active)
    }));
  },

  // 获取存储配置
  async getStorage(id) {
    const activeCheck = DB_TYPE === 'sqlite' ? 'is_active = 1' : 'is_active = true';
    const query = `SELECT * FROM storage_configs WHERE id = ${DB_TYPE === 'sqlite' ? '?' : '$1'} AND ${activeCheck}`;
    const result = await dbAdapter.query(query, [id]);
    
    if (result.rows[0]) {
      return {
        ...result.rows[0],
        config: fromJSON(result.rows[0].config),
        is_default: fromBool(result.rows[0].is_default),
        is_active: fromBool(result.rows[0].is_active)
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
      return {
        ...result.rows[0],
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
        ...row,
        config: fromJSON(row.config),
        is_default: fromBool(row.is_default),
        is_active: fromBool(row.is_active)
      };
    } else {
      const query = `
        INSERT INTO storage_configs (name, type, config)
        VALUES ($1, $2, $3)
        RETURNING *
      `;
      const result = await dbAdapter.query(query, [name, type, configValue]);
      return {
        ...result.rows[0],
        config: fromJSON(result.rows[0].config)
      };
    }
  },

  // 更新存储配置
  async updateStorage(id, name, type, config) {
    const configValue = JSON.stringify(config);
    const now = DB_TYPE === 'sqlite' ? "datetime('now')" : "CURRENT_TIMESTAMP";
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
        ...row,
        config: fromJSON(row.config),
        is_default: fromBool(row.is_default),
        is_active: fromBool(row.is_active)
      } : null;
    } else {
      const query = `
        UPDATE storage_configs 
        SET name = $2, type = $3, config = $4, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND is_active = true
        RETURNING *
      `;
      const result = await dbAdapter.query(query, [id, name, type, configValue]);
      return result.rows[0] ? {
        ...result.rows[0],
        config: fromJSON(result.rows[0].config)
      } : null;
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
          SET is_default = 0, updated_at = datetime('now')
          WHERE is_default = 1
        `).run();
        
        // 设置新的默认存储
        const info = db.prepare(`
          UPDATE storage_configs 
          SET is_default = 1, updated_at = datetime('now')
          WHERE id = ? AND is_active = 1
        `).run(id);
        
        if (info.changes === 0) {
          throw new Error(`存储配置 ID ${id} 不存在或已被禁用`);
        }
      });
      
      transaction();
      const row = db.prepare('SELECT * FROM storage_configs WHERE id = ?').get(id);
      return {
        ...row,
        config: fromJSON(row.config),
        is_default: fromBool(row.is_default),
        is_active: fromBool(row.is_active)
      };
    } else {
      const pool = dbAdapter.getConnection();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        // 先取消所有默认设置
        await client.query(`
          UPDATE storage_configs 
          SET is_default = false, updated_at = CURRENT_TIMESTAMP
          WHERE is_default = true
        `);
        
        // 设置新的默认存储
        const result = await client.query(`
          UPDATE storage_configs 
          SET is_default = true, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND is_active = true
          RETURNING *
        `, [id]);
        
        if (result.rows.length === 0) {
          throw new Error(`存储配置 ID ${id} 不存在或已被禁用`);
        }
        
        await client.query('COMMIT');
        return {
          ...result.rows[0],
          config: fromJSON(result.rows[0].config)
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
    const now = DB_TYPE === 'sqlite' ? "datetime('now')" : "CURRENT_TIMESTAMP";
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
        SET is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND is_default = false
        RETURNING *
      `;
      const result = await dbAdapter.query(query, [id]);
      return result.rows[0];
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
  dbAdapter,
  DB_TYPE
};

