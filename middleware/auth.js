const jwt = require('jsonwebtoken');
const { userDB, apiKeyDB } = require('../database');

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

// API 密钥认证中间件
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        code: 'NO_API_KEY',
        message: '未提供 API 密钥，请在请求头中添加 X-API-Key 或在查询参数中添加 api_key'
      });
    }

    // 验证 API 密钥
    const keyInfo = await apiKeyDB.getByApiKey(apiKey);
    
    if (!keyInfo) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_API_KEY',
        message: 'API 密钥无效或已被禁用'
      });
    }

    // 检查密钥是否过期
    if (keyInfo.expires_at && new Date(keyInfo.expires_at) < new Date()) {
      return res.status(401).json({
        success: false,
        code: 'API_KEY_EXPIRED',
        message: 'API 密钥已过期'
      });
    }

    // 检查用户是否被禁用
    if (keyInfo.is_disabled) {
      return res.status(403).json({
        success: false,
        code: 'USER_DISABLED',
        message: '用户已被禁用'
      });
    }

    // 更新最后使用时间（异步执行，不阻塞请求）
    apiKeyDB.updateLastUsed(keyInfo.id).catch(err => {
      console.error('更新 API 密钥使用时间失败:', err);
    });

    // 将用户信息和权限添加到请求对象
    req.user = {
      id: keyInfo.user_id,
      username: keyInfo.username,
      role: keyInfo.role,
      isApiKey: true,
      apiKeyId: keyInfo.id,
      permissions: keyInfo.permissions || ['upload', 'view']
    };

    next();
  } catch (error) {
    console.error('API 密钥认证失败:', error);
    return res.status(500).json({
      success: false,
      code: 'AUTH_ERROR',
      message: '认证过程发生错误'
    });
  }
};

// 检查 API 权限中间件
const requireApiPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        code: 'NOT_AUTHENTICATED',
        message: '未认证'
      });
    }

    // 如果是通过 JWT 登录的用户（非 API 密钥），允许所有操作
    if (!req.user.isApiKey) {
      return next();
    }

    // 检查 API 密钥是否有对应权限
    const permissions = req.user.permissions || [];
    if (!permissions.includes(permission) && !permissions.includes('all')) {
      return res.status(403).json({
        success: false,
        code: 'PERMISSION_DENIED',
        message: `此 API 密钥没有 "${permission}" 权限`
      });
    }

    next();
  };
};

// 混合认证中间件（支持 JWT 和 API 密钥）
const authenticateAny = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  // 优先使用 JWT
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticate(req, res, next);
  }

  // 其次使用 API 密钥
  if (apiKey) {
    return authenticateApiKey(req, res, next);
  }

  return res.status(401).json({
    success: false,
    code: 'NO_CREDENTIALS',
    message: '未提供认证凭据，请使用 Bearer Token 或 X-API-Key'
  });
};

module.exports = {
  generateToken,
  verifyToken,
  authenticate,
  optionalAuth,
  requireAdmin,
  requireUser,
  requireOwnerOrAdmin,
  authenticateApiKey,
  requireApiPermission,
  authenticateAny
};