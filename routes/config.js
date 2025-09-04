const express = require('express');
const { configDB } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

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
      allow_register: securityConfig.allowRegister !== false // 默认允许注册
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

    const nodemailer = require('nodemailer');
    
    // 创建邮件传输器
    const transporter = nodemailer.createTransporter({
      host: smtpHost,
      port: parseInt(smtpPort),
      secure: smtpSecure || false, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPass
      },
      // 忽略自签名证书错误
      tls: {
        rejectUnauthorized: false
      }
    });

    // 验证连接配置

    await transporter.verify();

    
    // 发送测试邮件

    const info = await transporter.sendMail({
      from: fromEmail,
      to: testEmail,
      subject: '图床管理系统 - 邮件配置测试',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0052d9;">📧 邮件配置测试成功！</h2>
          <p>恭喜！您的邮件服务器配置正确，可以正常发送邮件。</p>
          <div style="background: #f3f4f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>配置信息:</strong></p>
            <ul>
              <li>SMTP服务器: ${smtpHost}:${smtpPort}</li>
              <li>发送邮箱: ${fromEmail}</li>
              <li>发送时间: ${new Date().toLocaleString('zh-CN')}</li>
            </ul>
          </div>
          <hr>
          <p style="color: #666; font-size: 12px;">这是一封自动发送的测试邮件，请勿回复。</p>
        </div>
      `
    });

    
    res.json({
      success: true,
      message: '邮件发送测试成功！请检查邮箱是否收到测试邮件',
      messageId: info.messageId
    });
  } catch (error) {
    console.error('测试邮件发送失败:', error);
    res.json({
      success: false,
      message: `邮件发送失败: ${error.message}`
    });
  }
});

module.exports = router;
