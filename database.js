const { Pool } = require('pg');
require('dotenv').config();

// 创建数据库连接池
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// 数据库初始化
const initDatabase = async () => {
  try {
    console.log('🔄 正在初始化数据库...');
    
    // 创建用户表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        avatar_url VARCHAR(500),
        is_disabled BOOLEAN DEFAULT FALSE,
        last_login_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 检查images表是否存在user_id列，如果不存在则添加
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'images' AND column_name = 'user_id'
    `);

    if (columnCheck.rows.length === 0) {
      console.log('🔄 正在为images表添加user_id列...');
      await pool.query(`
        ALTER TABLE images 
        ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
      `);
      console.log('✅ user_id列添加成功');
    }

    // 创建图片表（如果不存在）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS images (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_url VARCHAR(500) NOT NULL,
        file_size BIGINT NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        width INTEGER,
        height INTEGER,
        upload_type VARCHAR(20) DEFAULT 'local',
        original_url TEXT,
        tags TEXT[],
        description TEXT,
        is_deleted BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建上传统计表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS upload_stats (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        upload_count INTEGER DEFAULT 0,
        total_size BIGINT DEFAULT 0,
        transfer_count INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建系统配置表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_configs (
        id SERIAL PRIMARY KEY,
        config_key VARCHAR(100) UNIQUE NOT NULL,
        config_value JSONB NOT NULL,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建对象存储配置表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS storage_configs (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(20) NOT NULL,
        config JSONB NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建索引
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_images_user_id ON images(user_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at DESC);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_images_upload_type ON images(upload_type);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_images_is_deleted ON images(is_deleted);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_upload_stats_date ON upload_stats(date DESC);
    `);

    // 创建默认管理员账户（如果不存在）
    const adminExists = await pool.query(`
      SELECT id FROM users WHERE username = 'admin' LIMIT 1
    `);
    
    if (adminExists.rows.length === 0) {
      const bcrypt = require('bcryptjs');
      const defaultPassword = 'admin123';
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      
      await pool.query(`
        INSERT INTO users (username, email, password_hash, role)
        VALUES ('admin', 'admin@example.com', $1, 'admin')
      `, [hashedPassword]);
      
      console.log('✅ 默认管理员账户已创建 (用户名: admin, 密码: admin123)');
    }

    // 创建默认存储配置（如果不存在）
    const defaultStorageExists = await pool.query(`
      SELECT id FROM storage_configs WHERE is_default = true LIMIT 1
    `);
    
    if (defaultStorageExists.rows.length === 0) {
      // 创建一个示例存储配置，用户需要根据实际情况修改
      const defaultStorageConfig = {
        secretId: 'your_secret_id',
        secretKey: 'your_secret_key', 
        bucket: 'your_bucket_name',
        region: 'ap-beijing',
        endpoint: 'https://your_bucket_name.cos.ap-beijing.myqcloud.com',
        customDomain: 'https://your_custom_domain.com'
      };
      
      await pool.query(`
        INSERT INTO storage_configs (name, type, config, is_default, is_active)
        VALUES ('默认腾讯云COS', 'cos', $1, true, true)
      `, [JSON.stringify(defaultStorageConfig)]);
      
      console.log('✅ 默认存储配置已创建 (请在管理后台修改为实际配置)');
    }

    console.log('✅ 数据库初始化完成');
  } catch (error) {
    console.error('❌ 数据库初始化失败:', error);
    throw error;
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
      userId = null
    } = imageData;

    const query = `
      INSERT INTO images (
        user_id, filename, original_name, file_path, file_url, file_size, 
        mime_type, width, height, upload_type, original_url, tags, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;

    const values = [
      userId, filename, originalName, filePath, fileUrl, fileSize,
      mimeType, width, height, uploadType, originalUrl, tags, description
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
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
    let whereClause = 'WHERE is_deleted = FALSE';
    const queryParams = [];
    let paramIndex = 1;

    // 用户筛选
    if (userId) {
      whereClause += ` AND user_id = $${paramIndex}`;
      queryParams.push(userId);
      paramIndex++;
    }

    // 搜索条件
    if (search) {
      whereClause += ` AND (original_name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // 上传类型筛选
    if (uploadType) {
      whereClause += ` AND upload_type = $${paramIndex}`;
      queryParams.push(uploadType);
      paramIndex++;
    }

    // 查询总数
    const countQuery = `SELECT COUNT(*) FROM images ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].count);

    // 查询数据
    const dataQuery = `
      SELECT * FROM images 
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    queryParams.push(limit, offset);

    const dataResult = await pool.query(dataQuery, queryParams);

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
  async getById(id) {
    const query = 'SELECT * FROM images WHERE id = $1 AND is_deleted = FALSE';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  },

  // 更新图片信息
  async update(id, updateData) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        fields.push(`${key} = $${paramIndex}`);
        values.push(updateData[key]);
        paramIndex++;
      }
    });

    if (fields.length === 0) {
      throw new Error('没有要更新的字段');
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const query = `
      UPDATE images 
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex} AND is_deleted = FALSE
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // 软删除图片
  async delete(id) {
    const query = `
      UPDATE images 
      SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND is_deleted = FALSE
      RETURNING *
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  },

  // 批量删除图片
  async batchDelete(ids) {
    const query = `
      UPDATE images 
      SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE id = ANY($1) AND is_deleted = FALSE
      RETURNING *
    `;
    const result = await pool.query(query, [ids]);
    return result.rows;
  }
};

// 统计数据库操作
const statsDB = {
  // 更新每日统计
  async updateDailyStats(date, uploadCount = 0, totalSize = 0, transferCount = 0) {
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
    
    const result = await pool.query(query, [date, uploadCount, totalSize, transferCount]);
    return result.rows[0];
  },

  // 获取总体统计
  async getOverallStats() {
    const queries = [
      // 总图片数
      'SELECT COUNT(*) as total_images FROM images WHERE is_deleted = FALSE',
      // 总存储大小
      'SELECT COALESCE(SUM(file_size), 0) as total_size FROM images WHERE is_deleted = FALSE',
      // 本月上传数
      `SELECT COUNT(*) as monthly_uploads FROM images 
       WHERE is_deleted = FALSE 
       AND created_at >= date_trunc('month', CURRENT_DATE)`,
      // 总流量（这里简化为总大小的2倍，实际应该记录下载统计）
      'SELECT COALESCE(SUM(file_size), 0) * 2 as total_traffic FROM images WHERE is_deleted = FALSE'
    ];

    const results = await Promise.all(
      queries.map(query => pool.query(query))
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
    const query = `
      SELECT 
        date,
        upload_count,
        total_size,
        transfer_count
      FROM upload_stats 
      WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
      ORDER BY date DESC
    `;
    
    const result = await pool.query(query);
    return result.rows;
  }
};

// 测试数据库连接
const testConnection = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    console.log('✅ 数据库连接成功:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ 数据库连接失败:', error.message);
    return false;
  }
};

// 优雅关闭数据库连接
const closeDatabase = async () => {
  try {
    await pool.end();
    console.log('✅ 数据库连接已关闭');
  } catch (error) {
    console.error('❌ 关闭数据库连接时出错:', error);
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

    const query = `
      INSERT INTO users (username, email, password_hash, role, avatar_url)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, username, email, role, avatar_url, created_at
    `;

    const values = [username, email, passwordHash, role, avatarUrl];
    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // 根据用户名查找用户
  async getByUsername(username) {
    const query = 'SELECT * FROM users WHERE username = $1 AND is_disabled = FALSE';
    const result = await pool.query(query, [username]);
    return result.rows[0];
  },

  // 根据邮箱查找用户
  async getByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1 AND is_disabled = FALSE';
    const result = await pool.query(query, [email]);
    return result.rows[0];
  },

  // 根据ID查找用户
  async getById(id) {
    const query = 'SELECT * FROM users WHERE id = $1 AND is_disabled = FALSE';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  },

  // 获取用户列表（管理员功能）
  async getList(options = {}) {
    const {
      page = 1,
      limit = 20,
      search = '',
      role = null,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = options;

    const offset = (page - 1) * limit;
    let whereClause = 'WHERE is_disabled = FALSE';
    const queryParams = [];
    let paramIndex = 1;

    // 搜索条件
    if (search) {
      whereClause += ` AND (username ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // 角色筛选
    if (role) {
      whereClause += ` AND role = $${paramIndex}`;
      queryParams.push(role);
      paramIndex++;
    }

    // 查询总数
    const countQuery = `SELECT COUNT(*) FROM users ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].count);

    // 查询数据
    const dataQuery = `
      SELECT id, username, email, role, avatar_url, last_login_at, created_at, updated_at
      FROM users 
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    queryParams.push(limit, offset);

    const dataResult = await pool.query(dataQuery, queryParams);

    return {
      users: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  // 更新用户信息
  async update(id, updateData) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        fields.push(`${key} = $${paramIndex}`);
        values.push(updateData[key]);
        paramIndex++;
      }
    });

    if (fields.length === 0) {
      throw new Error('没有要更新的字段');
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const query = `
      UPDATE users 
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex} AND is_disabled = FALSE
      RETURNING id, username, email, role, avatar_url, updated_at
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // 更新最后登录时间
  async updateLastLogin(id) {
    const query = `
      UPDATE users 
      SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING last_login_at
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  },

  // 禁用用户
  async disable(id) {
    const query = `
      UPDATE users 
      SET is_disabled = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, username, is_disabled
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  },

  // 启用用户
  async enable(id) {
    const query = `
      UPDATE users 
      SET is_disabled = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, username, is_disabled
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  },

  // 检查用户名是否存在
  async usernameExists(username, excludeId = null) {
    let query = 'SELECT id FROM users WHERE username = $1';
    const params = [username];
    
    if (excludeId) {
      query += ' AND id != $2';
      params.push(excludeId);
    }
    
    const result = await pool.query(query, params);
    return result.rows.length > 0;
  },

  // 检查邮箱是否存在
  async emailExists(email, excludeId = null) {
    let query = 'SELECT id FROM users WHERE email = $1';
    const params = [email];
    
    if (excludeId) {
      query += ' AND id != $2';
      params.push(excludeId);
    }
    
    const result = await pool.query(query, params);
    return result.rows.length > 0;
  },

  // 更新用户个人资料
  async updateProfile(id, profileData) {
    const { email } = profileData;
    const query = `
      UPDATE users 
      SET email = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, username, email, role, avatar_url, created_at, updated_at
    `;
    const result = await pool.query(query, [id, email]);
    return result.rows[0];
  },

  // 修改密码
  async changePassword(id, currentPassword, newPassword) {
    const bcrypt = require('bcryptjs');
    
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
    const query = `
      UPDATE users 
      SET password_hash = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id
    `;
    const result = await pool.query(query, [id, newPasswordHash]);
    return result.rows.length > 0;
  }
};

// 系统配置数据库操作
const configDB = {
  // 获取配置
  async getConfig(key) {
    const query = 'SELECT config_value FROM system_configs WHERE config_key = $1';
    const result = await pool.query(query, [key]);
    return result.rows[0]?.config_value || null;
  },

  // 设置配置
  async setConfig(key, value, description = null) {
    // 确保value不为空
    const configValue = value !== null && value !== undefined ? JSON.stringify(value) : '{}';
    
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
    const result = await pool.query(query, [key, configValue, description]);
    return result.rows[0];
  },

  // 获取所有配置
  async getAllConfigs() {
    const query = 'SELECT config_key, config_value, description FROM system_configs ORDER BY config_key';
    const result = await pool.query(query);
    const configs = {};
    result.rows.forEach(row => {
      configs[row.config_key] = row.config_value;
    });
    return configs;
  },

  // 删除配置
  async deleteConfig(key) {
    const query = 'DELETE FROM system_configs WHERE config_key = $1 RETURNING *';
    const result = await pool.query(query, [key]);
    return result.rows[0];
  },

  // 批量设置配置
  async setConfigs(configs) {
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
};

// 存储配置数据库操作
const storageDB = {
  // 获取所有存储配置
  async getAllStorages() {
    const query = 'SELECT * FROM storage_configs WHERE is_active = true ORDER BY is_default DESC, created_at ASC';
    const result = await pool.query(query);
    return result.rows;
  },

  // 获取存储配置
  async getStorage(id) {
    const query = 'SELECT * FROM storage_configs WHERE id = $1 AND is_active = true';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  },

  // 获取默认存储配置
  async getDefaultStorage() {
    const query = 'SELECT * FROM storage_configs WHERE is_default = true AND is_active = true';
    const result = await pool.query(query);
    return result.rows[0];
  },

  // 创建存储配置
  async createStorage(name, type, config) {
    const query = `
      INSERT INTO storage_configs (name, type, config)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await pool.query(query, [name, type, JSON.stringify(config)]);
    return result.rows[0];
  },

  // 更新存储配置
  async updateStorage(id, name, type, config) {
    const query = `
      UPDATE storage_configs 
      SET name = $2, type = $3, config = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND is_active = true
      RETURNING *
    `;
    const result = await pool.query(query, [id, name, type, JSON.stringify(config)]);
    return result.rows[0];
  },

  // 设置默认存储
  async setDefaultStorage(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      console.log(`🔄 开始设置默认存储，ID: ${id}`);
      
      // 先取消所有默认设置
      const clearResult = await client.query(`
        UPDATE storage_configs 
        SET is_default = false, updated_at = CURRENT_TIMESTAMP
        WHERE is_default = true
        RETURNING id, name
      `);
      
      console.log(`✅ 已取消 ${clearResult.rows.length} 个存储的默认状态:`, clearResult.rows);
      
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
      
      console.log(`✅ 已设置新的默认存储:`, result.rows[0].name);
      
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      console.error('❌ 设置默认存储失败:', error);
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // 删除存储配置（软删除）
  async deleteStorage(id) {
    const query = `
      UPDATE storage_configs 
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND is_default = false
      RETURNING *
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }
};

module.exports = {
  pool,
  initDatabase,
  testConnection,
  closeDatabase,
  imageDB,
  statsDB,
  userDB,
  configDB,
  storageDB
};