const { dbAdapter, DB_TYPE } = require('./databaseAdapter');
const bcrypt = require('bcryptjs');

// 数据库初始化
const initDatabase = async () => {
  try {
    console.log(`🔄 正在初始化 ${DB_TYPE} 数据库...`);
    
    if (DB_TYPE === 'sqlite') {
      await initSQLiteDatabase();
    } else {
      await initPostgresDatabase();
    }
    
    console.log('✅ 数据库初始化完成');
  } catch (error) {
    console.error('❌ 数据库初始化失败:', error);
    throw error;
  }
};

// 初始化 SQLite 数据库
async function initSQLiteDatabase() {
  const db = dbAdapter.getConnection();
  
  // 创建用户表（使用北京时间 UTC+8）
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      avatar_url TEXT,
      is_disabled INTEGER DEFAULT 0,
      email_verified INTEGER DEFAULT 0,
      email_verification_token TEXT,
      email_verification_sent_at TEXT,
      last_login_at TEXT,
      created_at TEXT DEFAULT (datetime('now', '+8 hours')),
      updated_at TEXT DEFAULT (datetime('now', '+8 hours'))
    )
  `);
  
  // 升级：添加缺失的字段（如果表已存在但缺少这些字段）
  try {
    const columns = db.prepare("PRAGMA table_info(users)").all();
    const columnNames = columns.map(c => c.name);
    
    if (!columnNames.includes('email_verified')) {
      console.log('🔄 升级数据库: 添加 email_verified 字段');
      db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0');
    }
    if (!columnNames.includes('email_verification_token')) {
      console.log('🔄 升级数据库: 添加 email_verification_token 字段');
      db.exec('ALTER TABLE users ADD COLUMN email_verification_token TEXT');
    }
    if (!columnNames.includes('email_verification_sent_at')) {
      console.log('🔄 升级数据库: 添加 email_verification_sent_at 字段');
      db.exec('ALTER TABLE users ADD COLUMN email_verification_sent_at TEXT');
    }
    if (!columnNames.includes('last_login_at')) {
      console.log('🔄 升级数据库: 添加 last_login_at 字段');
      db.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT');
    }
    if (!columnNames.includes('created_at')) {
      console.log('🔄 升级数据库: 添加 created_at 字段');
      db.exec('ALTER TABLE users ADD COLUMN created_at TEXT DEFAULT (datetime(\'now\'))');
    }
    if (!columnNames.includes('updated_at')) {
      console.log('🔄 升级数据库: 添加 updated_at 字段');
      db.exec('ALTER TABLE users ADD COLUMN updated_at TEXT DEFAULT (datetime(\'now\'))');
    }
  } catch (error) {
    console.error('数据库升级失败:', error);
  }

  // 创建图片表
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      upload_type TEXT DEFAULT 'local',
      original_url TEXT,
      tags TEXT,
      description TEXT,
      is_deleted INTEGER DEFAULT 0,
      storage_id INTEGER REFERENCES storage_configs(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 创建上传统计表
  db.exec(`
    CREATE TABLE IF NOT EXISTS upload_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      upload_count INTEGER DEFAULT 0,
      total_size INTEGER DEFAULT 0,
      transfer_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 创建系统配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key TEXT UNIQUE NOT NULL,
      config_value TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 创建对象存储配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 创建 API 密钥表
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      api_key TEXT UNIQUE NOT NULL,
      permissions TEXT DEFAULT '["upload","view"]',
      is_active INTEGER DEFAULT 1,
      last_used_at TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_images_user_id ON images(user_id);
    CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_images_upload_type ON images(upload_type);
    CREATE INDEX IF NOT EXISTS idx_images_is_deleted ON images(is_deleted);
    CREATE INDEX IF NOT EXISTS idx_upload_stats_date ON upload_stats(date DESC);
    CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_api_key ON api_keys(api_key);
  `);

  // 创建默认管理员账户
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ? LIMIT 1').get('admin');
  
  if (!adminExists) {
    const defaultPassword = 'admin123';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);
    
    db.prepare(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `).run('admin', 'admin@example.com', hashedPassword, 'admin');
    
    console.log('✅ 默认管理员账户已创建 (用户名: admin, 密码: admin123)');
  }

  // 创建默认存储配置
  const defaultStorageExists = db.prepare('SELECT id FROM storage_configs WHERE is_default = 1 LIMIT 1').get();
  
  if (!defaultStorageExists) {
    const defaultStorageConfig = {
      secretId: 'your_secret_id',
      secretKey: 'your_secret_key',
      bucket: 'your_bucket_name',
      region: 'ap-beijing',
      endpoint: 'https://your_bucket_name.cos.ap-beijing.myqcloud.com',
      customDomain: 'https://your_custom_domain.com'
    };
    
    db.prepare(`
      INSERT INTO storage_configs (name, type, config, is_default, is_active)
      VALUES (?, ?, ?, ?, ?)
    `).run('默认腾讯云COS', 'cos', JSON.stringify(defaultStorageConfig), 1, 1);
    
    console.log('✅ 默认存储配置已创建 (请在管理后台修改为实际配置)');
  }

  // 初始化默认系统配置
  await initDefaultConfigs();
}

// 初始化 PostgreSQL 数据库
async function initPostgresDatabase() {
  const pool = dbAdapter.getConnection();
  
  // 创建用户表（使用北京时间 UTC+8）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'user',
      avatar_url VARCHAR(500),
      is_disabled BOOLEAN DEFAULT FALSE,
      email_verified BOOLEAN DEFAULT FALSE,
      email_verification_token VARCHAR(255),
      email_verification_sent_at TIMESTAMP WITH TIME ZONE,
      last_login_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '8 hours'),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '8 hours')
    )
  `);
  
  // 升级：添加缺失的字段（如果表已存在但缺少这些字段）
  try {
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users'
    `);
    const columns = columnCheck.rows.map(r => r.column_name);
    
    if (!columns.includes('email_verified')) {
      console.log('🔄 升级数据库: 添加 email_verified 字段');
      await pool.query('ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE');
    }
    if (!columns.includes('email_verification_token')) {
      console.log('🔄 升级数据库: 添加 email_verification_token 字段');
      await pool.query('ALTER TABLE users ADD COLUMN email_verification_token VARCHAR(255)');
    }
    if (!columns.includes('email_verification_sent_at')) {
      console.log('🔄 升级数据库: 添加 email_verification_sent_at 字段');
      await pool.query('ALTER TABLE users ADD COLUMN email_verification_sent_at TIMESTAMP WITH TIME ZONE');
    }
    if (!columns.includes('last_login_at')) {
      console.log('🔄 升级数据库: 添加 last_login_at 字段');
      await pool.query('ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP WITH TIME ZONE');
    }
    if (!columns.includes('created_at')) {
      console.log('🔄 升级数据库: 添加 created_at 字段');
      await pool.query('ALTER TABLE users ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP');
    }
    if (!columns.includes('updated_at')) {
      console.log('🔄 升级数据库: 添加 updated_at 字段');
      await pool.query('ALTER TABLE users ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP');
    }
  } catch (error) {
    console.error('数据库升级失败:', error);
  }

  // 创建图片表
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

  // 检查并添加 user_id 列
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

  // 创建 API 密钥表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      api_key VARCHAR(64) UNIQUE NOT NULL,
      permissions JSONB DEFAULT '["upload","view"]',
      is_active BOOLEAN DEFAULT TRUE,
      last_used_at TIMESTAMP WITH TIME ZONE,
      expires_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 检查并添加 storage_id 列
  const storageColumnCheck = await pool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'images' AND column_name = 'storage_id'
  `);

  if (storageColumnCheck.rows.length === 0) {
    console.log('🔄 正在为images表添加storage_id列...');
    await pool.query(`
      ALTER TABLE images 
      ADD COLUMN storage_id INTEGER REFERENCES storage_configs(id) ON DELETE SET NULL
    `);
    console.log('✅ storage_id列添加成功');
  }

  // 创建索引
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_images_user_id ON images(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_images_upload_type ON images(upload_type)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_images_is_deleted ON images(is_deleted)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_upload_stats_date ON upload_stats(date DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_api_key ON api_keys(api_key)`);

  // 创建默认管理员账户
  const adminExists = await pool.query(`
    SELECT id FROM users WHERE username = 'admin' LIMIT 1
  `);
  
  if (adminExists.rows.length === 0) {
    const defaultPassword = 'admin123';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);
    
    await pool.query(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES ('admin', 'admin@example.com', $1, 'admin')
    `, [hashedPassword]);
    
    console.log('✅ 默认管理员账户已创建 (用户名: admin, 密码: admin123)');
  }

  // 创建默认存储配置
  const defaultStorageExists = await pool.query(`
    SELECT id FROM storage_configs WHERE is_default = true LIMIT 1
  `);
  
  if (defaultStorageExists.rows.length === 0) {
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

  // 初始化默认系统配置
  await initDefaultConfigs();
}

// 初始化默认系统配置
async function initDefaultConfigs() {
  try {
    const result = await dbAdapter.query('SELECT COUNT(*) as count FROM system_configs');
    const configCount = parseInt(result.rows[0].count);
    
    if (configCount === 0) {
      console.log('初始化默认系统配置...');
      
      const defaultConfigs = [
        {
          key: 'system',
          value: {
            siteName: '图床管理系统',
            siteDescription: '专业的图片存储和管理平台',
            siteLogo: '',
            siteIcon: '',
            maxFileSize: 10,
            maxBatchCount: 20,
            allowedTypes: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
            autoCompress: false,
            compressQuality: 80,
            allowRegistration: true
          },
          description: '系统基础配置'
        },
        {
          key: 'security',
          value: {
            allowRegistration: true,
            requireEmailVerification: false,
            jwtExpiration: 24,
            maxLoginAttempts: 5
          },
          description: '安全配置'
        },
        {
          key: 'email',
          value: {
            smtpHost: '',
            smtpPort: 587,
            smtpSecure: false,
            fromEmail: '',
            fromName: '图床系统',
            smtpUser: '',
            smtpPass: '',
            testEmail: ''
          },
          description: '邮件服务配置'
        }
      ];
      
      for (const config of defaultConfigs) {
        if (DB_TYPE === 'sqlite') {
          const db = dbAdapter.getConnection();
          db.prepare(
            'INSERT INTO system_configs (config_key, config_value, description) VALUES (?, ?, ?)'
          ).run(config.key, JSON.stringify(config.value), config.description);
        } else {
          await dbAdapter.query(
            'INSERT INTO system_configs (config_key, config_value, description) VALUES ($1, $2, $3)',
            [config.key, JSON.stringify(config.value), config.description]
          );
        }
      }
      
      console.log('✅ 默认系统配置初始化完成');
    }
  } catch (error) {
    console.error('❌ 初始化默认配置失败:', error);
  }
}

module.exports = {
  initDatabase
};

