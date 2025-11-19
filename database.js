// 这个文件现在使用新的数据库适配器，支持 PostgreSQL 和 SQLite
// 保留此文件以保持向后兼容性

const { initDatabase } = require('./databaseInit');
const {
  pool,
  testConnection,
  closeDatabase,
  imageDB,
  statsDB,
  userDB,
  configDB,
  storageDB
} = require('./databaseOperations');

// 导出接口（保持向后兼容）
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
