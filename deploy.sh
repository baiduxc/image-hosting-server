#!/bin/bash

echo "🚀 图床管理系统后端部署脚本"
echo "=============================="

# 检查是否存在 .env 文件
if [ ! -f .env ]; then
    echo "❌ 未找到 .env 文件"
    echo "📝 请复制 env.example 为 .env 并配置环境变量"
    echo ""
    echo "cp env.example .env"
    echo "nano .env"
    echo ""
    exit 1
fi

echo "✅ 环境变量文件检查通过"

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    exit 1
fi

echo "✅ Docker 检查通过"

# 检查 Docker Compose 是否可用
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose 未安装，请先安装 Docker Compose"
    exit 1
fi

echo "✅ Docker Compose 检查通过"

echo ""
echo "🐳 开始构建和启动服务..."

# 停止现有容器（如果存在）
docker-compose down

# 构建并启动服务
docker-compose up --build -d

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 部署成功！"
    echo ""
    echo "📊 服务状态："
    docker-compose ps
    echo ""
    echo "🔗 服务地址: http://localhost:3001"
    echo "🔍 健康检查: http://localhost:3001/api/health"
    echo ""
    echo "📝 查看日志: docker-compose logs -f"
    echo "🛑 停止服务: docker-compose down"
else
    echo ""
    echo "❌ 部署失败，请检查日志："
    docker-compose logs
    exit 1
fi
