const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { userDB, configDB } = require('../database');
const { generateToken, authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// 获取邮件配置
async function getEmailConfig() {
  const config = await configDB.getConfig('email');
  return config || {};
}

// 发送验证邮件
async function sendVerificationEmail(email, token, username) {
  const emailConfig = await getEmailConfig();
  
  if (!emailConfig.smtpHost || !emailConfig.smtpUser || !emailConfig.smtpPass) {
    console.error('邮件配置不完整，无法发送验证邮件');
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: emailConfig.smtpHost,
    port: parseInt(emailConfig.smtpPort) || 587,
    secure: emailConfig.smtpSecure === true || parseInt(emailConfig.smtpPort) === 465,
    auth: {
      user: emailConfig.smtpUser,
      pass: emailConfig.smtpPass
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  const verificationLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify-email?token=${token}`;

  const mailOptions = {
    from: `"${emailConfig.fromName || '图床系统'}" <${emailConfig.fromEmail || emailConfig.smtpUser}>`,
    to: email,
    subject: '邮箱验证 - 请激活您的账号',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0052d9;">欢迎注册图床系统！</h2>
        <p>您好 ${username}，</p>
        <p>感谢您注册我们的服务。请点击下方按钮验证您的邮箱地址：</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationLink}" 
             style="background: #0052d9; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
            验证邮箱地址
          </a>
        </div>
        <p>或者复制以下链接到浏览器：</p>
        <p style="word-break: break-all; color: #666; font-size: 14px;">${verificationLink}</p>
        <p style="color: #999; font-size: 12px; margin-top: 30px;">
          此链接将在24小时后失效。如非您本人操作，请忽略此邮件。
        </p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('发送验证邮件失败:', error);
    return false;
  }
}

// 检查注册状态（公开接口）
router.get('/registration-status', async (req, res) => {
  try {
    const registrationConfig = await configDB.getConfig('allowRegistration');
    const allowRegistration = registrationConfig ? JSON.parse(registrationConfig.config_value) : true;
    
    res.json({
      success: true,
      data: {
        allowRegistration
      }
    });
  } catch (error) {
    console.error('获取注册状态错误:', error);
    // 如果数据库连接失败，默认允许注册，避免影响用户体验
    res.json({
      success: true,
      data: {
        allowRegistration: true
      }
    });
  }
});

// 用户注册
router.post('/register', async (req, res) => {
  try {
    // 检查注册是否开启
    const registrationConfig = await configDB.getConfig('allowRegistration');
    const allowRegistration = registrationConfig ? JSON.parse(registrationConfig.config_value) : true;
    
    if (!allowRegistration) {
      return res.status(403).json({
        success: false,
        message: '系统当前已关闭用户注册功能'
      });
    }

    const { username, email, password, confirmPassword } = req.body;

    // 验证输入
    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: '请填写所有必填字段'
      });
    }

    // 验证用户名格式
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({
        success: false,
        message: '用户名只能包含字母、数字和下划线，长度3-20位'
      });
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: '请输入有效的邮箱地址'
      });
    }

    // 验证密码强度
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: '密码长度至少6位'
      });
    }

    // 验证密码确认
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: '两次输入的密码不一致'
      });
    }

    // 检查用户名是否已存在
    const existingUsername = await userDB.usernameExists(username);
    if (existingUsername) {
      return res.status(400).json({
        success: false,
        message: '用户名已存在'
      });
    }

    // 检查邮箱是否已存在
    const existingEmail = await userDB.emailExists(email);
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: '邮箱已被注册'
      });
    }

    // 加密密码
    const passwordHash = await bcrypt.hash(password, 10);

    // 检查是否需要邮箱验证
    const securityConfig = await configDB.getConfig('security');
    const requireEmailVerification = securityConfig?.requireEmailVerification === true;

    // 创建用户
    const newUser = await userDB.create({
      username,
      email,
      passwordHash,
      role: 'user'
    });

    // 如果需要邮箱验证，发送验证邮件
    let emailSent = false;
    if (requireEmailVerification) {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      await userDB.setEmailVerificationToken(newUser.id, verificationToken);
      emailSent = await sendVerificationEmail(email, verificationToken, username);
    }

    res.status(201).json({
      success: true,
      message: requireEmailVerification 
        ? (emailSent ? '注册成功，请查收验证邮件完成激活' : '注册成功，但验证邮件发送失败，请稍后重试')
        : '注册成功',
      data: {
        user: {
          id: newUser.id,
          username: newUser.username,
          email: newUser.email,
          role: newUser.role,
          createdAt: newUser.created_at,
          emailVerified: !requireEmailVerification
        },
        requireEmailVerification,
        emailSent
      }
    });

  } catch (error) {
    console.error('用户注册错误:', error);
    res.status(500).json({
      success: false,
      message: '注册失败',
      error: error.message
    });
  }
});

// 用户登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // 验证输入
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: '请输入用户名和密码'
      });
    }

    // 查找用户（支持用户名或邮箱登录）
    let user;
    if (username.includes('@')) {
      user = await userDB.getByEmail(username);
    } else {
      user = await userDB.getByUsername(username);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }

    // 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }

    // 检查是否需要邮箱验证
    const securityConfig = await configDB.getConfig('security');
    const requireEmailVerification = securityConfig?.requireEmailVerification === true;

    // 如果需要邮箱验证且用户未验证，则不允许登录
    if (requireEmailVerification && !user.email_verified) {
      return res.status(403).json({
        success: false,
        message: '请先验证邮箱后再登录',
        code: 'EMAIL_NOT_VERIFIED',
        data: {
          email: user.email,
          username: user.username
        }
      });
    }

    // 更新最后登录时间
    await userDB.updateLastLogin(user.id);

    // 生成token
    const token = generateToken(user);

    res.json({
      success: true,
      message: '登录成功',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          avatarUrl: user.avatar_url,
          emailVerified: user.email_verified,
          lastLoginAt: new Date().toISOString()
        },
        token
      }
    });

  } catch (error) {
    console.error('用户登录错误:', error);
    res.status(500).json({
      success: false,
      message: '登录失败',
      error: error.message
    });
  }
});

// 获取当前用户信息
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await userDB.getById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatar_url,
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at
      }
    });

  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({
      success: false,
      message: '获取用户信息失败',
      error: error.message
    });
  }
});

// 更新用户信息
router.put('/me', authenticate, async (req, res) => {
  try {
    const { email, currentPassword, newPassword, avatarUrl } = req.body;
    const updateData = {};

    // 更新邮箱
    if (email && email !== req.user.email) {
      // 验证邮箱格式
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: '请输入有效的邮箱地址'
        });
      }

      // 检查邮箱是否已被使用
      const emailExists = await userDB.emailExists(email, req.user.id);
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: '邮箱已被其他用户使用'
        });
      }

      updateData.email = email;
    }

    // 更新密码
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: '请输入当前密码'
        });
      }

      // 验证当前密码
      const user = await userDB.getById(req.user.id);
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          success: false,
          message: '当前密码错误'
        });
      }

      // 验证新密码强度
      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: '新密码长度至少6位'
        });
      }

      updateData.password_hash = await bcrypt.hash(newPassword, 10);
    }

    // 更新头像
    if (avatarUrl !== undefined) {
      updateData.avatar_url = avatarUrl;
    }

    // 执行更新
    if (Object.keys(updateData).length > 0) {
      const updatedUser = await userDB.update(req.user.id, updateData);
      
      res.json({
        success: true,
        message: '用户信息更新成功',
        data: {
          id: updatedUser.id,
          username: updatedUser.username,
          email: updatedUser.email,
          role: updatedUser.role,
          avatarUrl: updatedUser.avatar_url
        }
      });
    } else {
      res.json({
        success: true,
        message: '没有需要更新的信息'
      });
    }

  } catch (error) {
    console.error('更新用户信息错误:', error);
    res.status(500).json({
      success: false,
      message: '更新用户信息失败',
      error: error.message
    });
  }
});

// 获取用户列表（管理员功能）
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', role } = req.query;
    
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      search: search.toString(),
      role: role || null
    };

    const result = await userDB.getList(options);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('获取用户列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取用户列表失败',
      error: error.message
    });
  }
});

// 获取用户统计（管理员功能）
router.get('/users/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const stats = await userDB.getStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('获取用户统计错误:', error);
    res.status(500).json({
      success: false,
      message: '获取用户统计失败',
      error: error.message
    });
  }
});

// 更新用户信息（管理员功能）
router.put('/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { email, role, groupId, groupExpiresAt, isDisabled } = req.body;
    
    // 不能修改自己的角色为普通用户（防止失去管理员权限）
    if (parseInt(id) === req.user.id && role === 'user') {
      return res.status(400).json({
        success: false,
        message: '不能取消自己的管理员权限'
      });
    }
    
    const updateData = {};
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;
    if (groupId !== undefined) updateData.group_id = groupId;
    if (groupExpiresAt !== undefined) updateData.group_expires_at = groupExpiresAt;
    if (isDisabled !== undefined) updateData.isDisabled = isDisabled;
    
    const result = await userDB.update(parseInt(id), updateData);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }
    
    res.json({
      success: true,
      message: '用户信息更新成功',
      data: result
    });
  } catch (error) {
    console.error('更新用户错误:', error);
    res.status(500).json({
      success: false,
      message: '更新用户失败',
      error: error.message
    });
  }
});

// 删除用户（管理员功能）
router.delete('/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 不能删除自己
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: '不能删除自己的账户'
      });
    }
    
    const result = await userDB.delete(parseInt(id));
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }
    
    res.json({
      success: true,
      message: '用户删除成功'
    });
  } catch (error) {
    console.error('删除用户错误:', error);
    res.status(500).json({
      success: false,
      message: '删除用户失败',
      error: error.message
    });
  }
});

// 禁用用户（管理员功能）
router.post('/users/:id/disable', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 不能禁用自己
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: '不能禁用自己的账户'
      });
    }

    const result = await userDB.disable(parseInt(id));
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    res.json({
      success: true,
      message: '用户已禁用',
      data: result
    });

  } catch (error) {
    console.error('禁用用户错误:', error);
    res.status(500).json({
      success: false,
      message: '禁用用户失败',
      error: error.message
    });
  }
});

// 启用用户（管理员功能）
router.post('/users/:id/enable', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await userDB.enable(parseInt(id));
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    res.json({
      success: true,
      message: '用户已启用',
      data: result
    });

  } catch (error) {
    console.error('启用用户错误:', error);
    res.status(500).json({
      success: false,
      message: '启用用户失败',
      error: error.message
    });
  }
});

// 验证token有效性
router.get('/verify', authenticate, (req, res) => {
  res.json({
    success: true,
    message: 'Token有效',
    data: {
      user: req.user
    }
  });
});

// 验证邮箱（通过token）
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: '缺少验证令牌'
      });
    }

    // 查找带有此令牌的用户
    const user = await userDB.getByVerificationToken(token);
    
    if (!user) {
      return res.status(400).json({
        success: false,
        message: '验证链接已失效或不存在'
      });
    }

    // 验证邮箱
    const verified = await userDB.verifyEmail(token);
    
    if (verified) {
      res.json({
        success: true,
        message: '邮箱验证成功，您现在可以登录了'
      });
    } else {
      res.status(400).json({
        success: false,
        message: '邮箱验证失败'
      });
    }
  } catch (error) {
    console.error('邮箱验证错误:', error);
    res.status(500).json({
      success: false,
      message: '邮箱验证失败',
      error: error.message
    });
  }
});

// 重新发送验证邮件
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: '请提供邮箱地址'
      });
    }

    // 查找用户
    const user = await userDB.getByEmail(email);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 检查是否已经验证
    if (user.email_verified) {
      return res.status(400).json({
        success: false,
        message: '邮箱已经验证过了'
      });
    }

    // 检查邮件配置
    const emailConfig = await getEmailConfig();
    if (!emailConfig.smtpHost || !emailConfig.smtpUser || !emailConfig.smtpPass) {
      return res.status(500).json({
        success: false,
        message: '邮件服务未配置，无法发送验证邮件'
      });
    }

    // 生成新令牌并发送
    const verificationToken = crypto.randomBytes(32).toString('hex');
    await userDB.setEmailVerificationToken(user.id, verificationToken);
    const emailSent = await sendVerificationEmail(user.email, verificationToken, user.username);

    if (emailSent) {
      res.json({
        success: true,
        message: '验证邮件已发送，请查收'
      });
    } else {
      res.status(500).json({
        success: false,
        message: '验证邮件发送失败，请稍后重试'
      });
    }
  } catch (error) {
    console.error('重发验证邮件错误:', error);
    res.status(500).json({
      success: false,
      message: '重发验证邮件失败',
      error: error.message
    });
  }
});

module.exports = router;