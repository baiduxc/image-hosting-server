@echo off
echo 🚀 图床管理系统后端部署脚本
echo ==============================

REM 检查是否存在 .env 文件
if not exist .env (
    echo ❌ 未找到 .env 文件
    echo 📝 请复制 env.example 为 .env 并配置环境变量
    echo.
    echo copy env.example .env
    echo notepad .env
    echo.
    pause
    exit /b 1
)

echo ✅ 环境变量文件检查通过

REM 检查 Docker 是否安装
docker --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker 未安装，请先安装 Docker
    pause
    exit /b 1
)

echo ✅ Docker 检查通过

REM 检查 Docker Compose 是否可用
docker-compose --version >nul 2>&1
if errorlevel 1 (
    docker compose version >nul 2>&1
    if errorlevel 1 (
        echo ❌ Docker Compose 未安装，请先安装 Docker Compose
        pause
        exit /b 1
    )
)

echo ✅ Docker Compose 检查通过

echo.
echo 🐳 开始构建和启动服务...

REM 停止现有容器（如果存在）
docker-compose down

REM 构建并启动服务
docker-compose up --build -d

if %errorlevel% equ 0 (
    echo.
    echo 🎉 部署成功！
    echo.
    echo 📊 服务状态：
    docker-compose ps
    echo.
    echo 🔗 服务地址: http://localhost:3001
    echo 🔍 健康检查: http://localhost:3001/api/health
    echo.
    echo 📝 查看日志: docker-compose logs -f
    echo 🛑 停止服务: docker-compose down
) else (
    echo.
    echo ❌ 部署失败，请检查日志：
    docker-compose logs
)

pause
