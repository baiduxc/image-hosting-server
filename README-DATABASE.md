# 数据库升级说明

本次更新添加了 SQLite 数据库支持和数据库管理功能。

## 新增文件

以下文件需要从 `server/` 目录复制到 `docker-backend/` 目录：

1. `databaseAdapter.js` - 数据库适配层，支持 PostgreSQL 和 SQLite
2. `databaseInit.js` - 数据库初始化脚本
3. `databaseOperations.js` - 统一的数据库操作接口
4. `database.js` - 更新的数据库入口文件（已简化）
5. `routes/database.js` - 数据库管理API路由

## 环境变量配置

在 `.env` 文件中添加以下配置：

```env
# 数据库类型：postgres 或 sqlite
DB_TYPE=sqlite

# SQLite 数据库路径（如果使用 SQLite）
SQLITE_PATH=./data/database.sqlite

# PostgreSQL 连接字符串（如果使用 PostgreSQL）
# DATABASE_URL=postgresql://user:password@localhost:5432/dbname
# DB_SSL_MODE=false
```

## 功能说明

### 1. SQLite 支持
- 自动创建和初始化 SQLite 数据库
- 支持所有原有的数据库操作
- 文件存储在 `data/database.sqlite`

### 2. 数据库备份
- 仅支持 SQLite 数据库
- 创建数据库副本文件
- 支持下载备份文件

### 3. PostgreSQL 转 SQLite
- 将现有 PostgreSQL 数据库迁移到 SQLite
- 保留所有数据和关系
- 生成可下载的 SQLite 文件

## 使用说明

### 切换到 SQLite

1. 修改 `.env` 文件：
```env
DB_TYPE=sqlite
SQLITE_PATH=./data/database.sqlite
```

2. 重启服务器
3. 系统将自动创建并初始化 SQLite 数据库

### 从 PostgreSQL 迁移到 SQLite

1. 登录管理后台
2. 进入"系统设置" -> "数据库管理"
3. 在"数据库迁移"部分输入 PostgreSQL 连接字符串
4. 点击"开始转换"
5. 转换完成后下载 SQLite 文件
6. 将文件放置到 `data/database.sqlite`
7. 修改 `.env` 切换到 SQLite 模式
8. 重启服务器

## 注意事项

1. SQLite 适合单用户或小型部署
2. PostgreSQL 适合多用户或大规模部署
3. 定期备份数据库文件
4. 迁移过程可能需要较长时间
5. 确保有足够的磁盘空间

## 依赖更新

package.json 已添加 `better-sqlite3` 依赖，请运行：

```bash
npm install
```

## Docker 部署

如需在 Docker 中使用 SQLite，确保：

1. 数据目录已挂载为卷
2. 文件权限正确
3. 环境变量已正确设置

示例 docker-compose.yml：

```yaml
services:
  app:
    build: .
    environment:
      - DB_TYPE=sqlite
      - SQLITE_PATH=/app/data/database.sqlite
    volumes:
      - ./data:/app/data
```

