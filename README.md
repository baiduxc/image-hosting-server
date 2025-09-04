# 图床管理系统 - 后端服务

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.1.0-blue.svg)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-blue.svg)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

专业的图片存储和管理系统后端服务，支持多云存储、用户管理、权限控制等功能。

## 🚀 功能特性

### 核心功能
- **多云存储支持** - 腾讯云COS、阿里云OSS、七牛云、又拍云、Amazon S3、MinIO
- **用户管理系统** - 注册、登录、权限控制、个人资料管理
- **图片管理** - 上传、转存、删除、批量操作、搜索筛选
- **统计分析** - 上传统计、存储使用量、流量分析
- **系统配置** - 动态配置管理、存储配置、安全设置

### 技术特性
- **RESTful API** - 标准化的API接口设计
- **JWT认证** - 安全的用户认证机制
- **数据库连接池** - 高效的PostgreSQL连接管理
- **文件处理** - 支持多种图片格式，自动压缩优化
- **CORS支持** - 完整的跨域资源共享配置
- **错误处理** - 完善的错误处理和日志记录

## 📋 系统要求

- **Node.js** >= 18.0.0
- **PostgreSQL** >= 14.0
- **内存** >= 512MB
- **存储空间** >= 1GB

## 🛠️ 安装部署

### 1. 克隆项目
```bash
git clone <repository-url>
cd image-hosting-system/server
```

### 2. 安装依赖
```bash
npm install
```

### 3. 环境配置
复制并配置环境变量：
```bash
cp .env.example .env
```

编辑 `.env` 文件：
```env
# 服务器配置
PORT=3001
NODE_ENV=production

# 数据库配置 - Neon PostgreSQL
DATABASE_URL=postgresql://username:password@host:port/database?sslmode=require

# JWT密钥 (请生成一个安全的随机字符串)
JWT_SECRET=your_jwt_secret_key_here
```

### 4. 数据库初始化
启动服务器时会自动初始化数据库表结构和默认数据：
```bash
npm start
```

### 5. 默认管理员账户
系统会自动创建默认管理员账户：
- **用户名**: `admin`
- **密码**: `admin123`
- **邮箱**: `admin@example.com`

⚠️ **安全提醒**: 首次登录后请立即修改默认密码！

## 🗄️ 数据库结构

### 主要数据表

#### users - 用户表
```sql
CREATE TABLE users (
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
);
```

#### images - 图片表
```sql
CREATE TABLE images (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
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
);
```

#### storage_configs - 存储配置表
```sql
CREATE TABLE storage_configs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL,
  config JSONB NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

#### system_configs - 系统配置表
```sql
CREATE TABLE system_configs (
  id SERIAL PRIMARY KEY,
  config_key VARCHAR(100) UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

## 🔌 API 接口文档

### 认证接口

#### POST /api/auth/register
用户注册
```json
{
  "username": "string",
  "email": "string", 
  "password": "string"
}
```

#### POST /api/auth/login
用户登录
```json
{
  "login": "string", // 用户名或邮箱
  "password": "string"
}
```

#### GET /api/auth/profile
获取用户信息 (需要认证)

#### PUT /api/auth/profile
更新用户信息 (需要认证)

### 图片管理接口

#### GET /api/images
获取图片列表
- **参数**: `page`, `limit`, `search`, `uploadType`
- **返回**: 分页的图片列表

#### POST /api/upload-to-storage
上传图片到对象存储 (需要认证)
```json
{
  "files": [
    {
      "name": "string",
      "data": "base64_string",
      "size": "number",
      "type": "string"
    }
  ],
  "storageId": "number"
}
```

#### POST /api/transfer
网络图片转存 (需要认证)
```json
{
  "urls": ["string"]
}
```

#### DELETE /api/images/:id
删除图片 (需要认证)

### 存储配置接口

#### GET /api/storage
获取存储配置列表 (需要管理员权限)

#### POST /api/storage
创建存储配置 (需要管理员权限)

#### PUT /api/storage/:id
更新存储配置 (需要管理员权限)

#### PUT /api/storage/:id/default
设置默认存储 (需要管理员权限)

### 系统配置接口

#### GET /api/config/system
获取系统配置

#### PUT /api/config/system
更新系统配置 (需要管理员权限)

#### GET /api/config/public
获取公开系统配置 (无需认证)

## 🗂️ 项目结构

```
server/
├── middleware/           # 中间件
│   └── auth.js          # 认证中间件
├── routes/              # 路由模块
│   ├── auth.js         # 认证路由
│   ├── images.js       # 图片管理路由
│   ├── users.js        # 用户管理路由
│   ├── config.js       # 配置管理路由
│   └── storage.js      # 存储配置路由
├── services/           # 服务模块
│   └── storageService.js # 对象存储服务
├── uploads/            # 本地上传目录
├── config.js           # 配置管理器
├── database.js         # 数据库操作
├── imageTransfer.js    # 图片转存功能
├── index.js           # 应用入口
├── package.json       # 项目配置
├── .env              # 环境变量
├── .dockerignore     # Docker忽略文件
├── Dockerfile        # Docker配置
└── README.md         # 项目文档
```

## ☁️ 对象存储配置

### 腾讯云COS配置示例
```json
{
  "type": "cos",
  "config": {
    "secretId": "your_secret_id",
    "secretKey": "your_secret_key",
    "bucket": "your_bucket_name",
    "region": "ap-beijing",
    "endpoint": "https://your_bucket.cos.ap-beijing.myqcloud.com",
    "customDomain": "https://your_custom_domain.com"
  }
}
```

### 阿里云OSS配置示例
```json
{
  "type": "oss",
  "config": {
    "accessKeyId": "your_access_key_id",
    "accessKeySecret": "your_access_key_secret",
    "bucket": "your_bucket_name",
    "region": "oss-cn-beijing",
    "endpoint": "https://oss-cn-beijing.aliyuncs.com",
    "customDomain": "https://your_custom_domain.com"
  }
}
```

### Amazon S3配置示例
```json
{
  "type": "s3",
  "config": {
    "accessKeyId": "your_access_key_id",
    "secretAccessKey": "your_secret_access_key",
    "bucket": "your_bucket_name",
    "region": "us-east-1",
    "endpoint": "https://s3.amazonaws.com",
    "customDomain": "https://your_custom_domain.com"
  }
}
```

### MinIO配置示例
```json
{
  "type": "minio",
  "config": {
    "accessKey": "your_access_key",
    "secretKey": "your_secret_key",
    "bucket": "your_bucket_name",
    "endpoint": "https://your_minio_server.com",
    "useSSL": true,
    "customDomain": "https://your_custom_domain.com"
  }
}
```

## 🔧 配置说明

### 系统配置
- **站点名称**: 系统显示名称
- **站点Logo**: 系统Logo URL
- **最大文件大小**: 单个文件上传限制 (MB)
- **批量上传数量**: 单次批量上传文件数量限制
- **允许的文件类型**: 支持的图片格式
- **允许注册**: 是否开放用户注册

### 安全配置
- **JWT过期时间**: Token有效期 (小时)
- **最大登录尝试**: 登录失败次数限制
- **邮箱验证**: 是否需要邮箱验证

### 邮件配置
- **SMTP服务器**: 邮件服务器地址
- **SMTP端口**: 邮件服务器端口
- **发件人邮箱**: 系统发件邮箱
- **SMTP认证**: 邮箱用户名和密码

## 🐳 Docker 部署

### 构建镜像
```bash
docker build -t image-hosting-server .
```

### 运行容器
```bash
docker run -d \
  --name image-hosting-server \
  -p 3001:3001 \
  -e DATABASE_URL="your_database_url" \
  -e JWT_SECRET="your_jwt_secret" \
  image-hosting-server
```

### Docker Compose
```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/imagehost
      - JWT_SECRET=your_jwt_secret
      - NODE_ENV=production
    depends_on:
      - db
  
  db:
    image: postgres:14
    environment:
      - POSTGRES_DB=imagehost
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

## 📊 性能优化

### 数据库优化
- 使用连接池管理数据库连接
- 创建适当的索引提升查询性能
- 实现软删除避免数据丢失

### 文件处理优化
- 支持多种图片格式
- 自动图片压缩和优化
- 异步文件上传处理

### 缓存策略
- 静态文件缓存设置
- API响应缓存
- 数据库查询结果缓存

## 🔒 安全措施

### 认证安全
- JWT Token认证
- 密码加密存储 (bcrypt)
- 登录失败次数限制

### API安全
- CORS跨域配置
- 请求大小限制
- SQL注入防护

### 文件安全
- 文件类型验证
- 文件大小限制
- 恶意文件检测

## 📝 开发指南

### 本地开发
```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 查看日志
tail -f logs/app.log
```

### 代码规范
- 使用 ESLint 进行代码检查
- 遵循 RESTful API 设计原则
- 编写完整的错误处理逻辑
- 添加适当的日志记录

### 测试
```bash
# 运行测试
npm test

# 测试覆盖率
npm run test:coverage
```

## 🚨 故障排除

### 常见问题

#### 1. 数据库连接失败
```
❌ 数据库连接失败: connection refused
```
**解决方案**:
- 检查数据库服务是否运行
- 验证 `DATABASE_URL` 配置是否正确
- 确认网络连接和防火墙设置

#### 2. 对象存储上传失败
```
❌ COS上传错误: Access Denied
```
**解决方案**:
- 检查存储配置中的密钥是否正确
- 验证存储桶权限设置
- 确认存储桶名称和区域配置

#### 3. JWT认证失败
```
❌ JWT验证失败: invalid token
```
**解决方案**:
- 检查 `JWT_SECRET` 环境变量
- 验证Token是否过期
- 确认请求头格式正确

### 日志查看
```bash
# 查看应用日志
docker logs image-hosting-server

# 实时日志
docker logs -f image-hosting-server
```

## 📈 监控和维护

### 健康检查
```bash
# 检查服务状态
curl http://localhost:3001/api/health

# 检查数据库连接
curl http://localhost:3001/api/health/db
```

### 性能监控
- CPU和内存使用率
- 数据库连接数
- API响应时间
- 存储使用量

### 备份策略
- 定期数据库备份
- 配置文件备份
- 上传文件备份

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 📞 支持

如果您遇到问题或需要帮助，请：

1. 查看 [FAQ](docs/FAQ.md)
2. 搜索 [Issues](../../issues)
3. 创建新的 [Issue](../../issues/new)

## 🔄 更新日志

### v1.0.0 (2024-01-01)
- ✨ 初始版本发布
- 🚀 支持多云存储
- 👥 用户管理系统
- 📊 统计分析功能
- 🔧 系统配置管理

---

**开发团队** | **技术支持** | **文档更新**