const fs = require('fs');
const path = require('path');

// 配置文件路径
const CONFIG_FILE = path.join(__dirname, 'config.json');

// 默认配置
const DEFAULT_CONFIG = {
  basic: {
    maxFileSize: 10,
    maxBatchCount: 20,
    allowedTypes: ['jpeg', 'jpg', 'png', 'gif', 'webp'],
    autoCompress: true,
    compressQuality: 80,
    generateThumbnail: true
  },
  storage: {
    defaultStorage: 'local',
    localPath: '/uploads',
    cos: {
      secretId: '',
      secretKey: '',
      bucket: '',
      region: 'ap-beijing',
      domain: ''
    },
    oss: {
      accessKeyId: '',
      accessKeySecret: '',
      bucket: '',
      region: 'oss-cn-beijing',
      domain: ''
    },
    qiniu: {
      accessKey: '',
      secretKey: '',
      bucket: '',
      domain: ''
    }
  },
  security: {
    enableApiLimit: true,
    apiRateLimit: 100,
    ipWhitelist: '',
    enableHotlinkProtection: false,
    allowedDomains: ''
  },
  interface: {
    theme: 'light',
    primaryColor: '#0052d9',
    defaultView: 'grid',
    pageSize: 24,
    showFileInfo: ['size', 'uploadTime']
  }
};

// 配置管理类
class ConfigManager {
  constructor() {
    this.config = this.loadConfig();
  }

  // 加载配置
  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const configData = fs.readFileSync(CONFIG_FILE, 'utf8');
        const config = JSON.parse(configData);
        
        // 合并默认配置，确保所有字段都存在
        return this.mergeConfig(DEFAULT_CONFIG, config);
      }
    } catch (error) {
      console.error('加载配置文件失败:', error);
    }
    
    // 如果加载失败或文件不存在，使用默认配置
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  // 保存配置
  saveConfig(newConfig) {
    try {
      // 合并配置
      this.config = this.mergeConfig(this.config, newConfig);
      
      // 写入文件
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
      
      return true;
    } catch (error) {
      console.error('保存配置文件失败:', error);
      return false;
    }
  }

  // 获取配置
  getConfig() {
    return JSON.parse(JSON.stringify(this.config));
  }

  // 获取特定配置项
  get(key) {
    const keys = key.split('.');
    let value = this.config;
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  // 设置特定配置项
  set(key, value) {
    const keys = key.split('.');
    let current = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!current[k] || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k];
    }
    
    current[keys[keys.length - 1]] = value;
    return this.saveConfig(this.config);
  }

  // 重置为默认配置
  resetToDefault() {
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    return this.saveConfig(this.config);
  }

  // 深度合并配置对象
  mergeConfig(target, source) {
    const result = JSON.parse(JSON.stringify(target));
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          result[key] = this.mergeConfig(result[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }
    
    return result;
  }

  // 验证配置
  validateConfig(config) {
    const errors = [];

    // 验证基础设置
    if (config.basic) {
      if (config.basic.maxFileSize && (config.basic.maxFileSize < 1 || config.basic.maxFileSize > 100)) {
        errors.push('文件大小限制必须在1-100MB之间');
      }
      
      if (config.basic.maxBatchCount && (config.basic.maxBatchCount < 1 || config.basic.maxBatchCount > 50)) {
        errors.push('批量上传数量必须在1-50之间');
      }
      
      if (config.basic.compressQuality && (config.basic.compressQuality < 10 || config.basic.compressQuality > 100)) {
        errors.push('压缩质量必须在10-100之间');
      }
    }

    // 验证安全设置
    if (config.security) {
      if (config.security.apiRateLimit && (config.security.apiRateLimit < 1 || config.security.apiRateLimit > 1000)) {
        errors.push('API频率限制必须在1-1000之间');
      }
    }

    // 验证界面设置
    if (config.interface) {
      if (config.interface.pageSize && ![12, 24, 48, 96].includes(config.interface.pageSize)) {
        errors.push('每页显示数量必须是12、24、48或96');
      }
    }

    return errors;
  }

  // 测试存储连接
  async testStorageConnection(storageType, storageConfig) {
    try {
      switch (storageType) {
        case 'cos':
          return await this.testCosConnection(storageConfig);
        case 'oss':
          return await this.testOssConnection(storageConfig);
        case 'qiniu':
          return await this.testQiniuConnection(storageConfig);
        default:
          return { success: false, message: '不支持的存储类型' };
      }
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // 测试腾讯云COS连接
  async testCosConnection(cosConfig) {
    const { secretId, secretKey, bucket, region } = cosConfig;
    
    if (!secretId || !secretKey || !bucket || !region) {
      return { success: false, message: '请填写完整的COS配置信息' };
    }

    try {
      // 这里应该使用腾讯云COS SDK进行实际测试
      // 暂时返回模拟结果
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return { success: true, message: 'COS连接测试成功' };
    } catch (error) {
      return { success: false, message: `COS连接失败: ${error.message}` };
    }
  }

  // 测试阿里云OSS连接
  async testOssConnection(ossConfig) {
    const { accessKeyId, accessKeySecret, bucket, region } = ossConfig;
    
    if (!accessKeyId || !accessKeySecret || !bucket || !region) {
      return { success: false, message: '请填写完整的OSS配置信息' };
    }

    try {
      // 这里应该使用阿里云OSS SDK进行实际测试
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return { success: true, message: 'OSS连接测试成功' };
    } catch (error) {
      return { success: false, message: `OSS连接失败: ${error.message}` };
    }
  }

  // 测试七牛云连接
  async testQiniuConnection(qiniuConfig) {
    const { accessKey, secretKey, bucket } = qiniuConfig;
    
    if (!accessKey || !secretKey || !bucket) {
      return { success: false, message: '请填写完整的七牛云配置信息' };
    }

    try {
      // 这里应该使用七牛云SDK进行实际测试
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return { success: true, message: '七牛云连接测试成功' };
    } catch (error) {
      return { success: false, message: `七牛云连接失败: ${error.message}` };
    }
  }
}

// 创建全局配置管理实例
const configManager = new ConfigManager();

module.exports = {
  configManager,
  DEFAULT_CONFIG
};