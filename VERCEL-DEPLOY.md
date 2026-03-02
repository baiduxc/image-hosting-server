# Vercel 一键部署指南

## 一键部署

点击下方按钮，即可将图床 API 服务部署到 Vercel：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/你的用户名/你的仓库名&env=DATABASE_URL,JWT_SECRET&envDescription=数据库连接和JWT密钥配置&envLink=https://github.com/你的用户名/你的仓库名#环境变量配置&project-name=image-hosting-api&repository-name=image-hosting-api)

> ⚠️ **注意**：请将上方链接中的 `你的用户名/你的仓库名` 替换为你实际的 GitHub 仓库地址。

## 环境变量配置

部署时需要配置以下环境变量：

### 必需变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `DATABASE_URL` | PostgreSQL 数据库连接字符串 | `postgresql://user:pass@host:5432/dbname` |
| `JWT_SECRET` | JWT 签名密钥（建议32位以上随机字符串） | `your-super-secret-key-here` |

### 可选变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DB_TYPE` | 数据库类型 | `postgres` |
| `DB_SSL_MODE` | SSL 模式 | `require` |
| `NODE_ENV` | 运行环境 | `production` |

## 数据库配置

### 推荐：Vercel Postgres

1. 在 Vercel 项目中，进入 **Storage** 标签
2. 点击 **Create Database** → 选择 **Postgres**
3. 创建后，`DATABASE_URL` 会自动注入到环境变量中

### 其他云数据库

也可以使用以下第三方 PostgreSQL 服务：

- [Neon](https://neon.tech/) - 免费额度充足
- [Supabase](https://supabase.com/) - 免费 500MB
- [Railway](https://railway.app/) - 按量付费
- [PlanetScale](https://planetscale.com/) - MySQL（需要代码适配）

## 部署步骤

### 方法一：一键部署（推荐）

1. 点击上方 **Deploy with Vercel** 按钮
2. 登录/注册 Vercel 账号
3. 选择 GitHub 账号并授权
4. 填写环境变量
5. 点击 **Deploy** 完成部署

### 方法二：手动部署

1. Fork 本仓库到你的 GitHub
2. 登录 [Vercel](https://vercel.com/)
3. 点击 **Add New** → **Project**
4. 导入你的仓库
5. 配置环境变量：
   - `DATABASE_URL`: 你的 PostgreSQL 连接字符串
   - `JWT_SECRET`: 随机生成的密钥
6. 点击 **Deploy**

### 方法三：CLI 部署

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录
vercel login

# 部署
vercel --prod
```

## 部署后配置

### 1. 初始化管理员账户

首次部署后，访问 `/api/health` 确认服务正常运行，然后通过 API 注册第一个用户（将自动成为管理员）：

```bash
curl -X POST https://你的域名.vercel.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","email":"admin@example.com","password":"your-password"}'
```

### 2. 配置对象存储

登录后，在设置中配置对象存储（支持腾讯云 COS、阿里云 OSS、AWS S3、MinIO 等）。

## 限制说明

| 限制项 | Vercel Hobby（免费） | Vercel Pro |
|--------|---------------------|------------|
| 函数执行时间 | 10 秒 | 60 秒 |
| 函数内存 | 1024 MB | 3008 MB |
| 每月调用次数 | 100,000 | 1,000,000 |

> 💡 **提示**：图片上传建议配置对象存储直传，避免通过 Serverless 函数中转大文件。

## 常见问题

### Q: 可以在 Vercel 上使用 SQLite 吗？

A: 技术上可以部署，但**不建议**。Vercel Serverless Functions 的文件系统是临时的，每次冷启动数据会丢失。建议使用 PostgreSQL（Vercel Postgres、Neon、Supabase 等）。

如果你需要使用 SQLite，建议选择以下平台：
- **Zeabur** - 容器化部署，支持持久化存储
- **Railway** - 支持持久化卷
- **Fly.io** - 支持持久化存储
- **自建服务器** - Docker 部署

### Q: 如何更新部署？

A: 推送代码到 GitHub 后，Vercel 会自动重新部署。

### Q: 如何查看日志？

A: 在 Vercel 控制台 → 你的项目 → **Logs** 标签页查看运行时日志。

### Q: 前端如何连接？

A: 前端 `.env` 文件中设置：

```env
VITE_API_BASE_URL=https://你的域名.vercel.app
```

## 相关链接

- [Vercel 文档](https://vercel.com/docs)
- [Vercel Postgres 文档](https://vercel.com/docs/storage/vercel-postgres)
- [项目主仓库](https://github.com/baiduxc/image-hosting-server)
