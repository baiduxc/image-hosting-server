const jwt = require('jsonwebtoken');
const { userDB } = require('../database');

// JWT密钥
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-here';

// 生成JWT Token
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// 验证JWT Token
const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new Error('无效的token');
  }
};

// 认证中间件
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: '未提供认证token'
      });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    
    // 验证用户是否存在且未被禁用
    const user = await userDB.getById(decoded.id);
    if (!user || user.is_disabled) {
      return res.status(401).json({
        success: false,
        message: '用户不存在或已被禁用'
      });
    }

    // 将用户信息添加到请求对象
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      createdAt: user.created_at
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: '认证失败',
      error: error.message
    });
  }
};

// 可选认证中间件（不强制要求登录）
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyToken(token);
      
      const user = await userDB.getById(decoded.id);
      if (user && !user.is_disabled) {
        req.user = {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          createdAt: user.created_at
        };
      }
    }
    
    next();
  } catch (error) {
    // 可选认证失败时不阻止请求继续
    next();
  }
};

// 管理员权限检查中间件
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: '需要登录'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: '需要管理员权限'
    });
  }

  next();
};

// 用户权限检查中间件（用户或管理员）
const requireUser = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: '需要登录'
    });
  }

  if (!['user', 'admin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: '权限不足'
    });
  }

  next();
};

// 资源所有者检查中间件
const requireOwnerOrAdmin = (resourceUserIdField = 'user_id') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: '需要登录'
      });
    }

    // 管理员可以访问所有资源
    if (req.user.role === 'admin') {
      return next();
    }

    // 检查资源是否属于当前用户
    const resourceUserId = req.resource && req.resource[resourceUserIdField];
    if (resourceUserId && resourceUserId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: '只能访问自己的资源'
      });
    }

    next();
  };
};

module.exports = {
  generateToken,
  verifyToken,
  authenticate,
  optionalAuth,
  requireAdmin,
  requireUser,
  requireOwnerOrAdmin
};