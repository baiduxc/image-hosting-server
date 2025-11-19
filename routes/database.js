const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { dbAdapter, DB_TYPE, SQLITE_PATH } = require('../databaseAdapter');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const router = express.Router();

// 获取数据库信息
router.get('/info', authenticate, requireAdmin, async (req, res) => {
  try {
    const info = {
      type: DB_TYPE,
      path: DB_TYPE === 'sqlite' ? SQLITE_PATH : null,
      size: null
    };

    if (DB_TYPE === 'sqlite' && fs.existsSync(SQLITE_PATH)) {
      const stats = fs.statSync(SQLITE_PATH);
      info.size = stats.size;
    }

    res.json({
      success: true,
      data: info
    });
  } catch (error) {
    console.error('获取数据库信息失败:', error);
    res.status(500).json({
      success: false,
      message: '获取数据库信息失败',
      error: error.message
    });
  }
});

// 备份数据库（仅SQLite）
router.post('/backup', authenticate, requireAdmin, async (req, res) => {
  try {
    if (DB_TYPE !== 'sqlite') {
      return res.status(400).json({
        success: false,
        message: '当前数据库类型不支持此备份功能，请使用 PostgreSQL 的专用备份工具（如 pg_dump）'
      });
    }

    // 确保备份目录存在
    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // 生成备份文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `database-backup-${timestamp}.sqlite`;
    const backupPath = path.join(backupDir, backupFileName);

    // 使用 SQLite 的 VACUUM INTO 命令创建备份
    const db = dbAdapter.getConnection();
    
    // 先关闭 WAL 模式，执行备份，然后恢复
    db.pragma('wal_checkpoint(TRUNCATE)');
    
    // 复制数据库文件
    fs.copyFileSync(SQLITE_PATH, backupPath);

    const stats = fs.statSync(backupPath);

    res.json({
      success: true,
      message: '数据库备份成功',
      data: {
        fileName: backupFileName,
        filePath: backupPath,
        fileSize: stats.size,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('数据库备份失败:', error);
    res.status(500).json({
      success: false,
      message: '数据库备份失败',
      error: error.message
    });
  }
});

// 下载备份文件
router.get('/backup/download/:fileName', authenticate, requireAdmin, async (req, res) => {
  try {
    const { fileName } = req.params;
    
    // 安全检查：确保文件名不包含路径遍历
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return res.status(400).json({
        success: false,
        message: '无效的文件名'
      });
    }

    const backupDir = path.join(__dirname, '..', 'backups');
    const filePath = path.join(backupDir, fileName);

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: '备份文件不存在'
      });
    }

    // 发送文件
    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('下载备份文件失败:', err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: '下载备份文件失败',
            error: err.message
          });
        }
      }
    });
  } catch (error) {
    console.error('下载备份文件失败:', error);
    res.status(500).json({
      success: false,
      message: '下载备份文件失败',
      error: error.message
    });
  }
});

// 列出所有备份
router.get('/backups', authenticate, requireAdmin, async (req, res) => {
  try {
    const backupDir = path.join(__dirname, '..', 'backups');
    
    if (!fs.existsSync(backupDir)) {
      return res.json({
        success: true,
        data: []
      });
    }

    const files = fs.readdirSync(backupDir);
    const backups = files
      .filter(file => file.endsWith('.sqlite'))
      .map(file => {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        return {
          fileName: file,
          fileSize: stats.size,
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    res.json({
      success: true,
      data: backups
    });
  } catch (error) {
    console.error('获取备份列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取备份列表失败',
      error: error.message
    });
  }
});

// 删除备份文件
router.delete('/backup/:fileName', authenticate, requireAdmin, async (req, res) => {
  try {
    const { fileName } = req.params;
    
    // 安全检查
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return res.status(400).json({
        success: false,
        message: '无效的文件名'
      });
    }

    const backupDir = path.join(__dirname, '..', 'backups');
    const filePath = path.join(backupDir, fileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: '备份文件不存在'
      });
    }

    fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: '备份文件删除成功'
    });
  } catch (error) {
    console.error('删除备份文件失败:', error);
    res.status(500).json({
      success: false,
      message: '删除备份文件失败',
      error: error.message
    });
  }
});

// PostgreSQL 转 SQLite
router.post('/migrate/pg-to-sqlite', authenticate, requireAdmin, async (req, res) => {
  try {
    const { databaseUrl } = req.body;

    if (!databaseUrl) {
      return res.status(400).json({
        success: false,
        message: '请提供 PostgreSQL 数据库连接字符串'
      });
    }

    // 获取 SSL 配置
    const getSSLConfig = () => {
      const sslMode = process.env.DB_SSL_MODE;
      
      if (sslMode === 'false' || sslMode === false) {
        return false;
      } else if (sslMode === 'require') {
        return { rejectUnauthorized: true };
      } else if (databaseUrl.includes('localhost')) {
        return false;
      } else {
        // 默认对远程数据库使用SSL但不验证证书
        return { rejectUnauthorized: false };
      }
    };

    // 连接到 PostgreSQL 数据库
    const sslConfig = getSSLConfig();
    console.log(`🔐 使用 SSL 配置: ${sslConfig === false ? '禁用' : 'SSL模式=' + process.env.DB_SSL_MODE}`);
    
    const pgPool = new Pool({
      connectionString: databaseUrl,
      ssl: sslConfig
    });

    // 测试连接
    try {
      await pgPool.query('SELECT NOW()');
      console.log('✅ PostgreSQL 数据库连接成功');
    } catch (error) {
      await pgPool.end();
      throw new Error(`PostgreSQL 连接失败: ${error.message}`);
    }

    // 创建迁移目录
    const migrateDir = path.join(__dirname, '..', 'migrations');
    if (!fs.existsSync(migrateDir)) {
      fs.mkdirSync(migrateDir, { recursive: true });
    }

    // 生成 SQLite 文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sqliteFileName = `migrated-${timestamp}.sqlite`;
    const sqlitePath = path.join(migrateDir, sqliteFileName);

    // 创建新的 SQLite 数据库
    const Database = require('better-sqlite3');
    const newDb = new Database(sqlitePath);
    newDb.pragma('journal_mode = WAL');
    newDb.pragma('foreign_keys = ON');

    // 创建表结构
    console.log('📋 创建 SQLite 表结构...');
    createSQLiteTables(newDb);

    // 迁移数据
    console.log('🔄 开始迁移数据...');
    
    // 迁移用户数据
    console.log('  - 迁移用户数据...');
    const usersResult = await pgPool.query('SELECT * FROM users ORDER BY id');
    const insertUser = newDb.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, avatar_url, is_disabled, last_login_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const user of usersResult.rows) {
      insertUser.run(
        user.id,
        user.username,
        user.email,
        user.password_hash,
        user.role,
        user.avatar_url,
        user.is_disabled ? 1 : 0,
        user.last_login_at?.toISOString(),
        user.created_at?.toISOString(),
        user.updated_at?.toISOString()
      );
    }

    // 迁移存储配置
    console.log('  - 迁移存储配置...');
    const storageResult = await pgPool.query('SELECT * FROM storage_configs ORDER BY id');
    const insertStorage = newDb.prepare(`
      INSERT INTO storage_configs (id, name, type, config, is_default, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const storage of storageResult.rows) {
      insertStorage.run(
        storage.id,
        storage.name,
        storage.type,
        JSON.stringify(storage.config),
        storage.is_default ? 1 : 0,
        storage.is_active ? 1 : 0,
        storage.created_at?.toISOString(),
        storage.updated_at?.toISOString()
      );
    }

    // 迁移图片数据
    console.log('  - 迁移图片数据...');
    const imagesResult = await pgPool.query('SELECT * FROM images ORDER BY id');
    const insertImage = newDb.prepare(`
      INSERT INTO images (id, user_id, filename, original_name, file_path, file_url, file_size, 
                          mime_type, width, height, upload_type, original_url, tags, description, 
                          is_deleted, storage_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const image of imagesResult.rows) {
      insertImage.run(
        image.id,
        image.user_id,
        image.filename,
        image.original_name,
        image.file_path,
        image.file_url,
        image.file_size,
        image.mime_type,
        image.width,
        image.height,
        image.upload_type,
        image.original_url,
        JSON.stringify(image.tags || []),
        image.description,
        image.is_deleted ? 1 : 0,
        image.storage_id,
        image.created_at?.toISOString(),
        image.updated_at?.toISOString()
      );
    }

    // 迁移统计数据
    console.log('  - 迁移统计数据...');
    const statsResult = await pgPool.query('SELECT * FROM upload_stats ORDER BY date DESC');
    const insertStats = newDb.prepare(`
      INSERT INTO upload_stats (id, date, upload_count, total_size, transfer_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const stat of statsResult.rows) {
      insertStats.run(
        stat.id,
        stat.date?.toISOString().split('T')[0],
        stat.upload_count,
        stat.total_size,
        stat.transfer_count,
        stat.created_at?.toISOString(),
        stat.updated_at?.toISOString()
      );
    }

    // 迁移系统配置
    console.log('  - 迁移系统配置...');
    const configResult = await pgPool.query('SELECT * FROM system_configs ORDER BY id');
    const insertConfig = newDb.prepare(`
      INSERT INTO system_configs (id, config_key, config_value, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    for (const config of configResult.rows) {
      insertConfig.run(
        config.id,
        config.config_key,
        JSON.stringify(config.config_value),
        config.description,
        config.created_at?.toISOString(),
        config.updated_at?.toISOString()
      );
    }

    // 关闭连接
    newDb.close();
    await pgPool.end();

    console.log('✅ 数据迁移完成');

    const stats = fs.statSync(sqlitePath);

    res.json({
      success: true,
      message: 'PostgreSQL 数据库已成功转换为 SQLite',
      data: {
        fileName: sqliteFileName,
        filePath: sqlitePath,
        fileSize: stats.size,
        recordsCopied: {
          users: usersResult.rows.length,
          images: imagesResult.rows.length,
          storages: storageResult.rows.length,
          stats: statsResult.rows.length,
          configs: configResult.rows.length
        }
      }
    });
  } catch (error) {
    console.error('数据库迁移失败:', error);
    res.status(500).json({
      success: false,
      message: '数据库迁移失败',
      error: error.message
    });
  }
});

// 下载迁移后的数据库文件
router.get('/migrate/download/:fileName', authenticate, requireAdmin, async (req, res) => {
  try {
    const { fileName } = req.params;
    
    // 安全检查
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return res.status(400).json({
        success: false,
        message: '无效的文件名'
      });
    }

    const migrateDir = path.join(__dirname, '..', 'migrations');
    const filePath = path.join(migrateDir, fileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      });
    }

    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('下载文件失败:', err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: '下载文件失败',
            error: err.message
          });
        }
      }
    });
  } catch (error) {
    console.error('下载文件失败:', error);
    res.status(500).json({
      success: false,
      message: '下载文件失败',
      error: error.message
    });
  }
});

// 创建 SQLite 表结构
function createSQLiteTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      avatar_url TEXT,
      is_disabled INTEGER DEFAULT 0,
      last_login_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS storage_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

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
    );

    CREATE TABLE IF NOT EXISTS upload_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      upload_count INTEGER DEFAULT 0,
      total_size INTEGER DEFAULT 0,
      transfer_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key TEXT UNIQUE NOT NULL,
      config_value TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_images_user_id ON images(user_id);
    CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_images_upload_type ON images(upload_type);
    CREATE INDEX IF NOT EXISTS idx_images_is_deleted ON images(is_deleted);
    CREATE INDEX IF NOT EXISTS idx_upload_stats_date ON upload_stats(date DESC);
  `);
}

module.exports = router;

