# Docker 部署指南

## 问题解决

### ❌ 原始错误
```
npm ci --only=production
npm error Run "npm help ci" for more info
exit code: 1
```

### ✅ 解决方案

**原因分析：**
1. `better-sqlite3` 是原生 C++ 模块，需要编译
2. Alpine Linux 缺少编译工具链
3. `npm ci` 在某些情况下无法重新编译原生模块

**修复内容：**
1. 安装必要的构建工具（python3, make, g++, gcc, sqlite-dev）
2. 改用 `npm install --only=production` 而不是 `npm ci`
3. 添加多阶段构建以减小镜像大小

## 快速开始

### 方式一：使用 SQLite（推荐个人使用）

1. **准备环境变量**

创建 `.env` 文件：
```env
# 数据库配置
DB_TYPE=sqlite
SQLITE_PATH=/app/data/database.sqlite

# JWT密钥（请务必修改！）
JWT_SECRET=your-super-secret-jwt-key-change-me

# 服务器配置
PORT=3001
NODE_ENV=production
```

2. **构建并启动**

```bash
# 使用标准 Dockerfile
docker-compose up -d image-hosting-sqlite

# 或者使用优化版本（更小的镜像）
docker build -f Dockerfile.optimized -t image-hosting:latest .
docker run -d \
  -p 3001:3001 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/uploads:/app/uploads \
  --env-file .env \
  --name image-hosting \
  image-hosting:latest
```

3. **访问服务**

打开浏览器访问：`http://localhost:3001`

默认管理员账号：
- 用户名：`admin`
- 密码：`admin123`

### 方式二：使用 PostgreSQL（多用户场景）

```bash
# 启动 PostgreSQL 和应用
docker-compose --profile postgres up -d

# 查看日志
docker-compose logs -f
```

## 文件说明

### Dockerfile（标准版本）
- 基于 `node:18-alpine`
- 安装构建工具
- 适合开发和测试

### Dockerfile.optimized（优化版本）
- 多阶段构建
- 更小的镜像体积（约减少 40%）
- 包含健康检查
- 使用 dumb-init
- 推荐生产环境使用

### docker-compose.yml.example
- 包含 SQLite 和 PostgreSQL 两种配置
- 使用 profiles 控制启动哪个服务
- 包含健康检查和自动重启

## 构建选项

### 标准构建
```bash
docker build -t image-hosting:standard .
```

### 优化构建
```bash
docker build -f Dockerfile.optimized -t image-hosting:optimized .
```

### 指定平台构建
```bash
# ARM64（如 Apple M1/M2）
docker build --platform linux/arm64 -t image-hosting:arm64 .

# AMD64（如 Intel/AMD）
docker build --platform linux/amd64 -t image-hosting:amd64 .
```

## 数据持久化

### 重要目录

| 目录 | 说明 | 是否必须挂载 |
|------|------|--------------|
| `/app/data` | SQLite 数据库文件 | ✅ 是（SQLite模式） |
| `/app/uploads` | 本地上传的图片 | ✅ 是 |
| `/app/backups` | 数据库备份 | 推荐 |
| `/app/migrations` | 迁移文件 | 可选 |
| `/app/logs` | 日志文件 | 可选 |

### 挂载示例

```bash
docker run -d \
  -p 3001:3001 \
  -v /host/data:/app/data \
  -v /host/uploads:/app/uploads \
  -v /host/backups:/app/backups \
  --env-file .env \
  --name image-hosting \
  image-hosting:latest
```

## 环境变量

### 数据库配置

```env
# SQLite 配置
DB_TYPE=sqlite
SQLITE_PATH=/app/data/database.sqlite

# 或 PostgreSQL 配置
DB_TYPE=postgres
DATABASE_URL=postgresql://user:password@host:5432/database
DB_SSL_MODE=false
```

### 服务器配置

```env
# JWT 密钥（必须）
JWT_SECRET=your-secret-key

# 服务端口
PORT=3001

# 运行环境
NODE_ENV=production
```

## 常见问题

### Q1: 构建时报错 "npm ci failed"

**解决方案：**
- 确保使用更新后的 Dockerfile
- 删除本地的 `node_modules` 和 `package-lock.json`
- 清理 Docker 缓存：`docker builder prune -a`

### Q2: 容器启动后数据丢失

**原因：** 未挂载数据卷

**解决方案：**
```bash
# 务必挂载 data 和 uploads 目录
docker run -d \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/uploads:/app/uploads \
  image-hosting:latest
```

### Q3: better-sqlite3 相关错误

**错误示例：**
```
Error: Cannot find module 'better-sqlite3'
```

**解决方案：**
1. 确保 Dockerfile 中安装了构建工具
2. 使用 `npm install` 而不是 `npm ci`
3. 重新构建镜像：`docker build --no-cache -t image-hosting:latest .`

### Q4: 权限问题

**错误示例：**
```
EACCES: permission denied, mkdir '/app/data'
```

**解决方案：**
```bash
# 确保挂载目录有正确的权限
mkdir -p data uploads backups
chmod -R 755 data uploads backups
chown -R 1001:1001 data uploads backups

# 或在 docker-compose 中使用 root 用户（不推荐）
user: "0:0"
```

## 监控和维护

### 查看日志
```bash
# Docker Compose
docker-compose logs -f

# 单个容器
docker logs -f image-hosting
```

### 健康检查
```bash
# 检查容器状态
docker ps

# 手动健康检查
curl http://localhost:3001/api/health
```

### 备份数据库
```bash
# 进入容器
docker exec -it image-hosting sh

# 或直接复制数据库文件
docker cp image-hosting:/app/data/database.sqlite ./backup-$(date +%Y%m%d).sqlite
```

### 更新镜像
```bash
# 1. 停止容器
docker-compose down

# 2. 拉取最新代码
git pull

# 3. 重新构建
docker-compose build --no-cache

# 4. 启动
docker-compose up -d
```

## 生产环境建议

### 1. 使用优化版 Dockerfile
```bash
docker build -f Dockerfile.optimized -t image-hosting:prod .
```

### 2. 配置反向代理（Nginx）

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### 3. 使用 Docker Secrets（Docker Swarm）

```yaml
secrets:
  jwt_secret:
    external: true

services:
  app:
    secrets:
      - jwt_secret
    environment:
      - JWT_SECRET_FILE=/run/secrets/jwt_secret
```

### 4. 资源限制

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

### 5. 定期备份

```bash
# 添加到 crontab
0 2 * * * docker exec image-hosting node -e "require('./databaseOperations').backupDatabase()"
```

## 性能优化

### 1. 使用构建缓存
```bash
# 启用 BuildKit
export DOCKER_BUILDKIT=1
docker build -t image-hosting:latest .
```

### 2. 多阶段构建
使用 `Dockerfile.optimized` 可以显著减小镜像大小

### 3. 清理未使用的镜像
```bash
docker image prune -a
docker builder prune -a
```

## 故障排查

### 容器无法启动

```bash
# 查看详细日志
docker logs image-hosting

# 进入容器调试
docker run -it --entrypoint sh image-hosting:latest

# 检查环境变量
docker exec image-hosting env
```

### 数据库连接失败

```bash
# 检查数据库文件
docker exec image-hosting ls -la /app/data/

# 测试数据库连接
docker exec image-hosting node -e "require('./databaseAdapter').testConnection()"
```

## 技术支持

遇到问题？
1. 查看日志：`docker logs image-hosting`
2. 检查环境变量配置
3. 确认数据卷挂载正确
4. 查看 GitHub Issues

---

**最后更新：** 2025-01-20  
**版本：** v2.0.0

