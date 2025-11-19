const path = require('path');
const fs = require('fs');
require('dotenv').config();

// 数据库类型检测
const DB_TYPE = process.env.DB_TYPE || 'postgres'; // 'postgres' 或 'sqlite'
const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, 'data', 'database.sqlite');

let db = null;

// 初始化数据库连接
const initDB = () => {
  if (DB_TYPE === 'sqlite') {
    const Database = require('better-sqlite3');
    
    // 确保数据目录存在
    const dataDir = path.dirname(SQLITE_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    db = new Database(SQLITE_PATH, { verbose: console.log });
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    console.log(`✅ 已连接到 SQLite 数据库: ${SQLITE_PATH}`);
    return db;
  } else {
    const { Pool } = require('pg');
    
    const getSSLConfig = () => {
      const sslMode = process.env.DB_SSL_MODE;
      
      if (sslMode === 'false' || sslMode === false) {
        return false;
      } else if (sslMode === 'require') {
        return { rejectUnauthorized: true };
      } else if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')) {
        return false;
      } else {
        return { rejectUnauthorized: false };
      }
    };
    
    db = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: getSSLConfig(),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    
    console.log('✅ 已连接到 PostgreSQL 数据库');
    return db;
  }
};

// 数据库适配器类
class DatabaseAdapter {
  constructor() {
    this.dbType = DB_TYPE;
    this.db = initDB();
  }

  // 执行查询 (SELECT)
  async query(sql, params = []) {
    if (this.dbType === 'sqlite') {
      // SQLite 使用 ? 占位符，需要转换 PostgreSQL 的 $1, $2 格式
      const sqliteSql = this.convertPlaceholders(sql);
      try {
        const stmt = this.db.prepare(sqliteSql);
        const rows = stmt.all(...params);
        return { rows };
      } catch (error) {
        console.error('SQLite 查询错误:', error);
        throw error;
      }
    } else {
      // PostgreSQL
      return await this.db.query(sql, params);
    }
  }

  // 执行单行查询
  async queryOne(sql, params = []) {
    if (this.dbType === 'sqlite') {
      const sqliteSql = this.convertPlaceholders(sql);
      try {
        const stmt = this.db.prepare(sqliteSql);
        const row = stmt.get(...params);
        return { rows: row ? [row] : [] };
      } catch (error) {
        console.error('SQLite 查询错误:', error);
        throw error;
      }
    } else {
      return await this.db.query(sql, params);
    }
  }

  // 执行更新 (INSERT, UPDATE, DELETE)
  async run(sql, params = []) {
    if (this.dbType === 'sqlite') {
      const sqliteSql = this.convertPlaceholders(sql);
      try {
        const stmt = this.db.prepare(sqliteSql);
        const info = stmt.run(...params);
        
        // 如果是 INSERT 且需要返回插入的行，执行额外查询
        if (sql.toUpperCase().includes('RETURNING')) {
          // 提取 RETURNING 后的列名
          const match = sql.match(/RETURNING\s+(.*?)(?:$|;)/i);
          if (match) {
            const columns = match[1].trim();
            const selectSql = `SELECT ${columns} FROM ${this.extractTableName(sql)} WHERE rowid = ?`;
            const row = this.db.prepare(selectSql).get(info.lastInsertRowid);
            return { rows: row ? [row] : [] };
          }
        }
        
        return { rows: [], changes: info.changes, lastInsertRowid: info.lastInsertRowid };
      } catch (error) {
        console.error('SQLite 执行错误:', error);
        throw error;
      }
    } else {
      return await this.db.query(sql, params);
    }
  }

  // 执行多条语句 (用于初始化)
  async exec(sql) {
    if (this.dbType === 'sqlite') {
      try {
        this.db.exec(sql);
        return { success: true };
      } catch (error) {
        console.error('SQLite 执行错误:', error);
        throw error;
      }
    } else {
      return await this.db.query(sql);
    }
  }

  // 事务支持
  async transaction(callback) {
    if (this.dbType === 'sqlite') {
      const transaction = this.db.transaction(callback);
      return transaction();
    } else {
      const client = await this.db.connect();
      try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  }

  // 获取原始连接
  getConnection() {
    return this.db;
  }

  // 测试连接
  async testConnection() {
    try {
      if (this.dbType === 'sqlite') {
        const result = this.db.prepare("SELECT datetime('now') as now").get();
        console.log('✅ SQLite 数据库连接成功:', result.now);
        return true;
      } else {
        const client = await this.db.connect();
        const result = await client.query('SELECT NOW()');
        client.release();
        console.log('✅ PostgreSQL 数据库连接成功:', result.rows[0].now);
        return true;
      }
    } catch (error) {
      console.error('❌ 数据库连接失败:', error.message);
      return false;
    }
  }

  // 关闭连接
  async close() {
    try {
      if (this.dbType === 'sqlite') {
        this.db.close();
      } else {
        await this.db.end();
      }
      console.log('✅ 数据库连接已关闭');
    } catch (error) {
      console.error('❌ 关闭数据库连接时出错:', error);
    }
  }

  // 转换 PostgreSQL 占位符 ($1, $2) 到 SQLite 占位符 (?)
  convertPlaceholders(sql) {
    if (this.dbType === 'sqlite') {
      // 移除 RETURNING 子句（SQLite 不支持）
      sql = sql.replace(/RETURNING\s+.*?(?:$|;)/gi, '');
      
      // 替换 $1, $2, ... 为 ?
      let index = 1;
      return sql.replace(/\$\d+/g, () => '?');
    }
    return sql;
  }

  // 提取表名（用于 RETURNING 模拟）
  extractTableName(sql) {
    const match = sql.match(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/i);
    return match ? match[1] : '';
  }

  // 转换 PostgreSQL 特定语法到 SQLite
  convertSQLToSQLite(sql) {
    if (this.dbType !== 'sqlite') return sql;
    
    // SERIAL -> INTEGER PRIMARY KEY AUTOINCREMENT
    sql = sql.replace(/\bSERIAL\b/gi, 'INTEGER');
    
    // TIMESTAMP WITH TIME ZONE -> TEXT
    sql = sql.replace(/TIMESTAMP WITH TIME ZONE/gi, 'TEXT');
    
    // CURRENT_TIMESTAMP -> datetime('now')
    sql = sql.replace(/CURRENT_TIMESTAMP/g, "datetime('now')");
    
    // BOOLEAN -> INTEGER
    sql = sql.replace(/\bBOOLEAN\b/gi, 'INTEGER');
    
    // TEXT[] (数组) -> TEXT (JSON)
    sql = sql.replace(/TEXT\[\]/gi, 'TEXT');
    
    // JSONB -> TEXT
    sql = sql.replace(/\bJSONB\b/gi, 'TEXT');
    
    // BIGINT -> INTEGER
    sql = sql.replace(/\bBIGINT\b/gi, 'INTEGER');
    
    // VARCHAR -> TEXT
    sql = sql.replace(/VARCHAR\(\d+\)/gi, 'TEXT');
    
    // ILIKE -> LIKE
    sql = sql.replace(/\bILIKE\b/gi, 'LIKE');
    
    // date_trunc -> date
    sql = sql.replace(/date_trunc\('month',\s*CURRENT_DATE\)/gi, "date('now', 'start of month')");
    
    // INTERVAL -> 直接减去天数
    sql = sql.replace(/CURRENT_DATE\s*-\s*INTERVAL\s*'(\d+)\s*days?'/gi, "date('now', '-$1 days')");
    
    // NOW() -> datetime('now')
    sql = sql.replace(/NOW\(\)/gi, "datetime('now')");
    
    // ON CONFLICT 子句（PostgreSQL 和 SQLite 语法稍有不同，但基本兼容）
    // DO UPDATE SET -> 保持不变，SQLite 支持
    
    return sql;
  }
}

// 导出单例
const dbAdapter = new DatabaseAdapter();

module.exports = {
  dbAdapter,
  DB_TYPE,
  SQLITE_PATH
};

