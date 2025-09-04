# 数据库配置说明

## Neon Postgres 数据库设置

### 1. 创建 Neon 数据库
1. 访问 [Neon Console](https://console.neon.tech/)
2. 注册并登录账户
3. 创建新项目
4. 获取数据库连接字符串

### 2. 配置环境变量
在 `server/.env` 文件中更新 `DATABASE_URL`：

```env
DATABASE_URL=postgresql://username:password@hostname:5432/database_name?sslmode=require
```

### 3. 数据库表结构

#### images 表
存储图片信息的主表：
- `id`: 主键，自增
- `filename`: 文件名
- `original_name`: 原始文件名
- `file_path`: 文件路径
- `file_url`: 访问URL
- `file_size`: 文件大小（字节）
- `mime_type`: MIME类型
- `width`: 图片宽度（可选）
- `height`: 图片高度（可选）
- `upload_type`: 上传类型（local/transfer）
- `original_url`: 原始URL（转存时使用）
- `tags`: 标签数组
- `description`: 描述
- `is_deleted`: 软删除标记
- `created_at`: 创建时间
- `updated_at`: 更新时间

#### upload_stats 表
存储上传统计数据：
- `id`: 主键，自增
- `date`: 日期（唯一）
- `upload_count`: 上传数量
- `total_size`: 总大小
- `transfer_count`: 转存数量
- `created_at`: 创建时间
- `updated_at`: 更新时间

### 4. 数据库操作 API

#### imageDB 模块
- `create(imageData)`: 创建图片记录
- `getList(options)`: 获取图片列表（支持分页、搜索、筛选）
- `getById(id)`: 根据ID获取图片
- `update(id, updateData)`: 更新图片信息
- `delete(id)`: 软删除图片
- `batchDelete(ids)`: 批量删除图片

#### statsDB 模块
- `updateDailyStats(date, uploadCount, totalSize, transferCount)`: 更新每日统计
- `getOverallStats()`: 获取总体统计数据
- `getUploadTrend(days)`: 获取上传趋势数据

### 5. 测试数据库连接

服务器启动时会自动：
1. 测试数据库连接
2. 初始化数据库表结构
3. 创建必要的索引

如果数据库连接失败，服务器会以内存模式运行（功能受限）。

### 6. 注意事项

- 确保 Neon 数据库的 SSL 连接已启用
- 生产环境建议设置连接池参数
- 定期备份数据库数据
- 监控数据库性能和存储使用情况