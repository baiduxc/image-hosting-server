const express = require('express');
const { configDB } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const nodemailer = require('nodemailer');

const router = express.Router();


// 获取系统配置（管理员）
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const configs = await configDB.getAllConfigs();

    
    res.json({
      success: true,
      data: configs
    });
  } catch (error) {
    console.error('获取系统配置失败:', error);
    res.status(500).json({
      success: false,
      message: '获取系统配置失败',
      error: error.message
    });
  }
});

// 获取公开的系统配置（无需认证）
router.get('/system', async (req, res) => {

  try {
    const configs = await configDB.getAllConfigs();

    
    // 从system分组中提取公开配置
    const systemConfig = configs.system || {};
    const securityConfig = configs.security || {};
    

    
    // 构建公开配置对象
    const publicConfigs = {
      site_title: systemConfig.siteName || '图床管理系统',
      site_logo: systemConfig.siteLogo || '',
      site_description: systemConfig.siteDescription || '专业的图片存储和管理平台',
      site_keywords: '图床,图片存储,图片管理',
      allow_register: systemConfig.allowRegistration !== false, // 默认允许注册
      announcement: systemConfig.announcement || '',
      announcement_enabled: systemConfig.announcementEnabled === true
    };
    

    
    res.json({
      success: true,
      data: publicConfigs
    });
  } catch (error) {
    console.error('获取系统配置失败:', error);
    res.status(500).json({
      success: false,
      message: '获取系统配置失败',
      error: error.message
    });
  }
});

// 获取特定配置项
router.get('/:key', authenticate, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const config = await configDB.getConfig(key);
    
    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('获取配置项失败:', error);
    res.status(500).json({
      success: false,
      message: '获取配置项失败',
      error: error.message
    });
  }
});

// 设置系统配置（管理员）
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const configs = req.body;
    
    if (!configs || typeof configs !== 'object') {
      return res.status(400).json({
        success: false,
        message: '配置数据格式错误'
      });
    }

    await configDB.setConfigs(configs);
    
    res.json({
      success: true,
      message: '系统配置保存成功'
    });
  } catch (error) {
    console.error('保存系统配置失败:', error);
    res.status(500).json({
      success: false,
      message: '保存系统配置失败',
      error: error.message
    });
  }
});

// ============ 具体路由必须在参数路由之前 ============

// 测试存储连接
router.post('/test-storage', authenticate, requireAdmin, async (req, res) => {
  try {

    const { storageType, config } = req.body;
    
    if (!storageType || !config) {

      return res.status(400).json({
        success: false,
        message: '请提供存储类型和配置信息'
      });
    }


    
    // 基本参数验证
    const validationResult = validateStorageConfig(storageType, config);
    if (!validationResult.valid) {
      return res.status(400).json({
        success: false,
        message: `配置验证失败: ${validationResult.message}`
      });
    }
    
    // 简化的连接测试（仅验证配置有效性）

    res.json({
      success: true,
      message: `${storageType} 配置验证成功，可以保存使用`
    });
  } catch (error) {
    console.error('测试存储连接失败:', error);
    res.status(500).json({
      success: false,
      message: '测试存储连接失败',
      error: error.message
    });
  }
});

// 验证存储配置
function validateStorageConfig(storageType, config) {
  switch (storageType) {
    case 'cos':
      if (!config.secretId || !config.secretKey || !config.bucket || !config.endpoint) {
        return { valid: false, message: '腾讯云COS配置不完整，请检查SecretId、SecretKey、存储桶名称和Endpoint' };
      }
      break;
    case 'oss':
      if (!config.accessKeyId || !config.accessKeySecret || !config.bucket || !config.endpoint) {
        return { valid: false, message: '阿里云OSS配置不完整，请检查AccessKeyId、AccessKeySecret、存储桶名称和Endpoint' };
      }
      break;
    case 'qiniu':
      if (!config.accessKey || !config.secretKey || !config.bucket || !config.endpoint) {
        return { valid: false, message: '七牛云配置不完整，请检查AccessKey、SecretKey、存储桶名称和Endpoint' };
      }
      break;
    case 'upyun':
      if (!config.operator || !config.password || !config.bucket || !config.endpoint) {
        return { valid: false, message: '又拍云配置不完整，请检查操作员账号、密码、服务名称和Endpoint' };
      }
      break;
    case 's3':
      if (!config.accessKeyId || !config.secretAccessKey || !config.bucket || !config.region) {
        return { valid: false, message: 'Amazon S3配置不完整，请检查Access Key ID、Secret Access Key、存储桶名称和区域' };
      }
      break;
    case 'minio':
      if (!config.accessKey || !config.secretKey || !config.bucket || !config.endpoint) {
        return { valid: false, message: 'MinIO配置不完整，请检查Access Key、Secret Key、存储桶名称和Endpoint' };
      }
      break;
    default:
      return { valid: false, message: '不支持的存储类型' };
  }
  return { valid: true };
}

// 测试邮件发送
router.post('/test-email', authenticate, requireAdmin, async (req, res) => {
  try {
    const { smtpHost, smtpPort, smtpSecure, fromEmail, smtpUser, smtpPass, testEmail } = req.body;
    
    if (!smtpHost || !smtpPort || !fromEmail || !smtpUser || !smtpPass || !testEmail) {
      return res.status(400).json({
        success: false,
        message: '请填写完整的邮件配置信息'
      });
    }

    console.log('📧 开始邮件配置测试...');
    console.log(`SMTP服务器: ${smtpHost}:${smtpPort}`);
    console.log(`使用SSL: ${smtpSecure}`);
    console.log(`认证用户: ${smtpUser}`);
    console.log(`发件人: ${fromEmail}`);
    console.log(`收件人: ${testEmail}`);
    
    // 创建邮件传输器配置
    const transportConfig = {
      host: smtpHost,
      port: parseInt(smtpPort),
      secure: smtpSecure === true || smtpSecure === 'true' || parseInt(smtpPort) === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass
      },
      // 对于 Gmail 和其他服务的特殊配置
      tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
      },
      // 增加超时时间
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
      // 启用调试模式
      debug: true,
      logger: true
    };

    // 针对 Gmail 的特殊处理
    if (smtpHost.includes('gmail')) {
      console.log('🔍 检测到 Gmail，应用特殊配置...');
      transportConfig.service = 'gmail';
      // Gmail 使用 OAuth2 或应用专用密码
      console.log('⚠️ 提示: Gmail 需要使用"应用专用密码"而不是账户密码');
      console.log('📝 设置方法: https://myaccount.google.com/apppasswords');
    }

    const transporter = nodemailer.createTransport(transportConfig);

    // 验证连接配置
    console.log('🔐 验证 SMTP 连接...');
    try {
      await transporter.verify();
      console.log('✅ SMTP 连接验证成功');
    } catch (verifyError) {
      console.error('❌ SMTP 验证失败:', verifyError);
      return res.json({
        success: false,
        message: `SMTP 连接验证失败: ${verifyError.message}`,
        error: verifyError.message,
        hint: smtpHost.includes('gmail') 
          ? 'Gmail 用户请确保使用"应用专用密码"，并启用"允许不够安全的应用"（如果适用）'
          : '请检查 SMTP 服务器地址、端口和认证信息是否正确'
      });
    }
    
    // 构建邮件内容
    const mailOptions = {
      from: `"图床系统" <${fromEmail}>`, // 使用友好的发件人名称
      to: testEmail,
      subject: '图床管理系统 - 邮件配置测试',
      text: '这是一封测试邮件，如果您收到此邮件，说明邮件配置成功！', // 纯文本版本
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0052d9;">📧 邮件配置测试成功！</h2>
          <p>恭喜！您的邮件服务器配置正确，可以正常发送邮件。</p>
          <div style="background: #f3f4f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>配置信息:</strong></p>
            <ul>
              <li>SMTP服务器: ${smtpHost}:${smtpPort}</li>
              <li>发送邮箱: ${fromEmail}</li>
              <li>发送时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</li>
              <li>消息ID: 将在发送后生成</li>
            </ul>
          </div>
          <hr>
          <p style="color: #666; font-size: 12px;">这是一封自动发送的测试邮件，请勿回复。</p>
          <p style="color: #999; font-size: 11px;">如果您没有收到此邮件，请检查垃圾邮件文件夹。</p>
        </div>
      `
    };

    // 发送测试邮件
    console.log('📤 发送测试邮件...');
    const info = await transporter.sendMail(mailOptions);
    
    console.log('✅ 邮件发送成功！');
    console.log('消息ID:', info.messageId);
    console.log('响应:', info.response);
    console.log('已接受:', info.accepted);
    console.log('已拒绝:', info.rejected);

    // 关闭传输器
    transporter.close();
    
    res.json({
      success: true,
      message: '邮件发送测试成功！请检查邮箱（包括垃圾邮件文件夹）',
      data: {
        messageId: info.messageId,
        response: info.response,
        accepted: info.accepted,
        rejected: info.rejected,
        pending: info.pending
      },
      hint: '如果5分钟内未收到邮件，请检查：\n1. 垃圾邮件文件夹\n2. SMTP 配置是否正确\n3. Gmail 用户是否使用了应用专用密码'
    });
  } catch (error) {
    console.error('❌ 测试邮件发送失败:', error);
    console.error('错误详情:', error.stack);
    
    // 提供更详细的错误信息
    let errorMessage = error.message;
    let errorHint = '';
    
    if (error.code === 'EAUTH') {
      errorMessage = '认证失败：用户名或密码错误';
      errorHint = 'Gmail 用户请使用"应用专用密码"而不是账户密码。设置地址: https://myaccount.google.com/apppasswords';
    } else if (error.code === 'ESOCKET' || error.code === 'ETIMEDOUT') {
      errorMessage = '网络连接失败：无法连接到 SMTP 服务器';
      errorHint = '请检查网络连接和 SMTP 服务器地址、端口是否正确';
    } else if (error.code === 'ECONNECTION') {
      errorMessage = '连接被拒绝：SMTP 服务器拒绝连接';
      errorHint = '请检查端口号是否正确（Gmail: 587 或 465）';
    }
    
    res.json({
      success: false,
      message: `邮件发送失败: ${errorMessage}`,
      error: error.message,
      code: error.code,
      hint: errorHint
    });
  }
});

// ============ 参数路由放在最后 ============

// 设置单个配置项
router.post('/:key', authenticate, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;
    
    const result = await configDB.setConfig(key, value, description);
    
    res.json({
      success: true,
      message: '配置项设置成功',
      data: result
    });
  } catch (error) {
    console.error('设置配置项失败:', error);
    res.status(500).json({
      success: false,
      message: '设置配置项失败',
      error: error.message
    });
  }
});

// 删除配置项（管理员）
router.delete('/:key', authenticate, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const result = await configDB.deleteConfig(key);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: '配置项不存在'
      });
    }
    
    res.json({
      success: true,
      message: '配置项删除成功'
    });
  } catch (error) {
    console.error('删除配置项失败:', error);
    res.status(500).json({
      success: false,
      message: '删除配置项失败',
      error: error.message
    });
  }
});

module.exports = router;
