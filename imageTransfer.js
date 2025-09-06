const axios = require('axios');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { imageDB, statsDB } = require('./database');
const { configManager } = require('./config');
const StorageService = require('./services/storageService');

// 常用的User-Agent列表
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// 获取随机User-Agent
const getRandomUserAgent = () => {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};

// 从URL提取域名
const getDomainFromUrl = (url) => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    return null;
  }
};

// 生成文件名
const generateFileName = (originalUrl, contentType) => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  
  // 从URL或Content-Type推断文件扩展名
  let extension = '.jpg'; // 默认扩展名
  
  if (contentType) {
    const mimeToExt = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/bmp': '.bmp',
      'image/svg+xml': '.svg'
    };
    extension = mimeToExt[contentType.toLowerCase()] || '.jpg';
  } else {
    // 从URL推断
    const urlPath = originalUrl.split('?')[0];
    const match = urlPath.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i);
    if (match) {
      extension = '.' + match[1].toLowerCase();
    }
  }
  
  return `transfer-${timestamp}-${random}${extension}`;
};

// 创建请求配置
const createRequestConfig = (url, options = {}) => {
  const domain = getDomainFromUrl(url);
  const config = {
    method: 'GET',
    url: url,
    responseType: 'stream',
    timeout: 30000,
    maxRedirects: 5,
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site',
      ...options.headers
    }
  };

  // 根据域名设置特定的Referer
  if (domain) {
    // 常见网站的Referer策略
    const refererStrategies = {
      'weibo.com': `https://${domain}/`,
      'sina.com.cn': `https://${domain}/`,
      'qq.com': `https://${domain}/`,
      'baidu.com': `https://${domain}/`,
      'zhihu.com': `https://${domain}/`,
      'bilibili.com': `https://${domain}/`,
      'douban.com': `https://${domain}/`,
      'taobao.com': `https://${domain}/`,
      'tmall.com': `https://${domain}/`,
      'jd.com': `https://${domain}/`
    };

    // 设置Referer
    const referer = refererStrategies[domain] || `https://${domain}/`;
    config.headers['Referer'] = referer;
  }

  return config;
};

// 下载图片的核心函数
const downloadImage = async (url, retryCount = 0) => {
  const maxRetries = 3;
  
  try {
    
    // 创建请求配置
    const config = createRequestConfig(url);
    
    // 如果是重试，尝试不同的策略
    if (retryCount > 0) {
      // 第二次尝试：移除Referer
      if (retryCount === 1) {
        delete config.headers['Referer'];
        config.headers['Referer'] = '';
      }
      // 第三次尝试：使用更简单的headers
      else if (retryCount === 2) {
        config.headers = {
          'User-Agent': getRandomUserAgent()
        };
      }
    }

    const response = await axios(config);
    
    // 检查响应状态
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // 检查Content-Type
    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.startsWith('image/')) {
      throw new Error(`无效的内容类型: ${contentType}`);
    }

    // 检查Content-Length
    const contentLength = parseInt(response.headers['content-length'] || '0');
    if (contentLength > 50 * 1024 * 1024) { // 50MB限制
      throw new Error('文件大小超过限制 (50MB)');
    }

    
    return {
      stream: response.data,
      contentType: contentType,
      contentLength: contentLength
    };

  } catch (error) {
    console.error(`❌ 下载失败 (尝试 ${retryCount + 1}): ${error.message}`);
    
    // 如果还有重试机会
    if (retryCount < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 1000));
      return downloadImage(url, retryCount + 1);
    }
    
    throw error;
  }
};

// 保存图片到本地
const saveImageToLocal = async (imageStream, filename, uploadDir) => {
  return new Promise((resolve, reject) => {
    const filePath = path.join(uploadDir, filename);
    const writeStream = fs.createWriteStream(filePath);
    
    let totalSize = 0;
    
    imageStream.on('data', (chunk) => {
      totalSize += chunk.length;
      // 检查文件大小限制
      if (totalSize > 50 * 1024 * 1024) { // 50MB
        writeStream.destroy();
        fs.unlinkSync(filePath).catch(() => {});
        reject(new Error('文件大小超过限制'));
        return;
      }
    });
    
    imageStream.on('error', (error) => {
      writeStream.destroy();
      fs.unlinkSync(filePath).catch(() => {});
      reject(error);
    });
    
    writeStream.on('error', (error) => {
      fs.unlinkSync(filePath).catch(() => {});
      reject(error);
    });
    
    writeStream.on('finish', () => {
      resolve({ filePath, fileSize: totalSize });
    });
    
    imageStream.pipe(writeStream);
  });
};

// 获取图片元数据
const getImageMetadata = async (filePath) => {
  try {
    const metadata = await sharp(filePath).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: metadata.size
    };
  } catch (error) {
    console.warn('获取图片元数据失败:', error.message);
    return { width: null, height: null, format: null, size: null };
  }
};

// 转存单个图片
const transferSingleImage = async (originalUrl, uploadDir, baseUrl, userId = null) => {
  let tempFilePath = null;
  
  try {
    
    // 验证URL格式
    try {
      new URL(originalUrl);
    } catch (error) {
      throw new Error('无效的URL格式');
    }

    // 下载图片
    const { stream, contentType, contentLength } = await downloadImage(originalUrl);
    
    // 生成文件名
    const filename = generateFileName(originalUrl, contentType);
    
    // 先保存到临时本地文件
    const { filePath, fileSize } = await saveImageToLocal(stream, filename, uploadDir);
    tempFilePath = filePath;
    
    // 获取图片元数据
    const metadata = await getImageMetadata(filePath);
    
    // 强制使用对象存储进行转存
    let finalUrl = '';
    let finalPath = '';
    let defaultStorage = null;
    
    try {
      // 从数据库获取默认存储配置
      const { storageDB } = require('./database');
      defaultStorage = await storageDB.getDefaultStorage();
      
      if (!defaultStorage) {
        throw new Error('未找到默认存储配置，请先配置对象存储');
      }
      
      console.log(`🚀 使用存储配置: ${defaultStorage.name} (${defaultStorage.type})`);
      
      const storageService = new StorageService();
      const storageConfig = {
        type: defaultStorage.type,
        config: defaultStorage.config
      };
      
      // 读取文件内容并转换为base64
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');
      
      const fileData = {
        name: filename,
        data: base64Data,
        size: fileSize,
        type: contentType
      };
      
      // 上传到对象存储
      const uploadResult = await storageService.uploadFile(storageConfig, fileData, 'transfer/');
      
      if (uploadResult.success) {
        finalUrl = uploadResult.url;
        finalPath = uploadResult.fileName || `/transfer/${filename}`;
        
        console.log(`✅ 转存成功，对象存储URL: ${finalUrl}`);
        
        // 删除临时本地文件
        fs.unlinkSync(filePath);
        tempFilePath = null;
      } else {
        throw new Error(uploadResult.error || '对象存储上传失败');
      }
    } catch (storageError) {
      console.error('❌ 对象存储上传失败:', storageError.message);
      throw new Error(`转存失败: ${storageError.message}`);
    }
    
    // 保存到数据库
    const imageRecord = await imageDB.create({
      filename: filename,
      originalName: path.basename(originalUrl.split('?')[0]) || filename,
      filePath: finalPath,
      fileUrl: finalUrl,
      fileSize: fileSize,
      mimeType: contentType,
      width: metadata.width,
      height: metadata.height,
      uploadType: 'transfer',
      originalUrl: originalUrl,
      userId: userId,
      storageId: defaultStorage ? defaultStorage.id : null
    });

    
    return {
      success: true,
      originalUrl: originalUrl,
      newUrl: finalUrl,
      filename: filename,
      size: fileSize,
      width: metadata.width,
      height: metadata.height,
      message: '转存成功'
    };

  } catch (error) {
    console.error(`❌ 图片转存失败: ${originalUrl}`, error.message);
    
    // 清理临时文件
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.error('清理临时文件失败:', cleanupError.message);
      }
    }
    
    return {
      success: false,
      originalUrl: originalUrl,
      message: error.message || '转存失败'
    };
  }
};

// 批量转存图片
const transferImages = async (urls, uploadDir, baseUrl, userId = null) => {

  
  const results = [];
  const today = new Date().toISOString().split('T')[0];
  let successCount = 0;
  let totalSize = 0;

  // 并发控制，避免同时下载太多图片
  const concurrency = 3;
  const chunks = [];
  
  for (let i = 0; i < urls.length; i += concurrency) {
    chunks.push(urls.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    const chunkPromises = chunk.map(url => transferSingleImage(url, uploadDir, baseUrl, userId));
    const chunkResults = await Promise.all(chunkPromises);
    
    results.push(...chunkResults);
    
    // 统计成功的转存
    chunkResults.forEach(result => {
      if (result.success) {
        successCount++;
        totalSize += result.size || 0;
      }
    });

    // 在批次之间添加小延迟，避免请求过于频繁
    if (chunks.indexOf(chunk) < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // 更新统计数据
  if (successCount > 0) {
    try {
      await statsDB.updateDailyStats(today, 0, totalSize, successCount);
    } catch (error) {
      console.error('更新统计数据失败:', error);
    }
  }


  
  return results;
};

// 验证图片URL是否可访问
const validateImageUrl = async (url) => {
  try {
    const config = createRequestConfig(url);
    config.method = 'HEAD'; // 只获取头部信息
    config.timeout = 10000; // 较短的超时时间
    
    const response = await axios(config);
    const contentType = response.headers['content-type'];
    
    return {
      valid: response.status === 200 && contentType && contentType.startsWith('image/'),
      contentType: contentType,
      contentLength: parseInt(response.headers['content-length'] || '0')
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
};

module.exports = {
  transferImages,
  transferSingleImage,
  validateImageUrl,
  downloadImage,
  getRandomUserAgent
};