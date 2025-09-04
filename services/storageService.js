/**
 * 统一的对象存储服务
 * 支持多种存储类型：腾讯云COS、阿里云OSS、七牛云、又拍云、Amazon S3、MinIO
 */

const axios = require('axios');
const crypto = require('crypto');

// 官方SDK
const OSS = require('ali-oss');
const COS = require('cos-nodejs-sdk-v5');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const qiniu = require('qiniu');
const upyun = require('upyun');

class StorageService {
  constructor() {
    this.supportedTypes = ['cos', 'oss', 'qiniu', 'upyun', 's3', 'minio'];
  }

  /**
   * 上传文件到指定的存储服务
   * @param {Object} storageConfig - 存储配置
   * @param {Object} fileData - 文件数据 {name, data(base64), size, type}
   * @param {string} customPath - 自定义路径前缀
   * @returns {Promise<Object>} - 返回上传结果 {success, url, error}
   */
  async uploadFile(storageConfig, fileData, customPath = '') {
    try {
      const { type, config } = storageConfig;
      
      if (!this.supportedTypes.includes(type)) {
        throw new Error(`不支持的存储类型: ${type}`);
      }

      // 生成文件名
      const fileName = this.generateFileName(fileData.name, customPath);
      
      // 将base64转换为Buffer
      const fileBuffer = this.base64ToBuffer(fileData.data);

      switch (type) {
        case 'cos':
          return await this.uploadToCOS(config, fileName, fileBuffer, fileData.type);
        case 'oss':
          return await this.uploadToOSS(config, fileName, fileBuffer, fileData.type);
        case 'qiniu':
          return await this.uploadToQiniu(config, fileName, fileBuffer, fileData.type);
        case 'upyun':
          return await this.uploadToUpyun(config, fileName, fileBuffer, fileData.type);
        case 's3':
          return await this.uploadToS3(config, fileName, fileBuffer, fileData.type);
        case 'minio':
          return await this.uploadToMinIO(config, fileName, fileBuffer, fileData.type);
        default:
          throw new Error(`未实现的存储类型: ${type}`);
      }
    } catch (error) {
      console.error('存储服务上传失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 生成唯一文件名
   */
  generateFileName(originalName, customPath = '') {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const ext = originalName.split('.').pop();
    const baseName = `${timestamp}-${random}.${ext}`;
    
    if (customPath) {
      return `${customPath}/${baseName}`;
    }
    
    // 按日期组织文件夹
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `images/${year}/${month}/${day}/${baseName}`;
  }

  /**
   * 将base64转换为Buffer
   */
  base64ToBuffer(base64Data) {
    // 移除data:image/xxx;base64,前缀
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(base64, 'base64');
  }

  /**
   * 腾讯云COS上传
   */
  async uploadToCOS(config, fileName, fileBuffer, mimeType) {
    try {
      const { secretId, secretKey, bucket, endpoint, customDomain } = config;
      
      // 提取region
      const region = this.extractRegionFromEndpoint(endpoint, 'cos');
      
      // 使用官方SDK
      const cos = new COS({
        SecretId: secretId,
        SecretKey: secretKey
      });

      // 上传文件
      const result = await new Promise((resolve, reject) => {
        cos.putObject({
          Bucket: bucket,
          Region: region,
          Key: fileName,
          Body: fileBuffer,
          ContentType: mimeType
        }, (err, data) => {
          if (err) {
            reject(err);
          } else {
            resolve(data);
          }
        });
      });

      if (result && result.statusCode === 200) {
        const fileUrl = customDomain ? `${customDomain}/${fileName}` : `${endpoint}/${fileName}`;
        return {
          success: true,
          url: fileUrl,
          fileName: fileName
        };
      }

      throw new Error(`COS上传失败: ${result?.statusCode || 'Unknown'}`);
    } catch (error) {
      throw new Error(`COS上传错误: ${error.message}`);
    }
  }

  /**
   * 阿里云OSS上传
   */
  async uploadToOSS(config, fileName, fileBuffer, mimeType) {
    try {
      const { accessKeyId, accessKeySecret, bucket, endpoint, customDomain } = config;
      
      // 使用官方SDK
      const client = new OSS({
        region: this.extractRegionFromEndpoint(endpoint, 'oss'),
        accessKeyId: accessKeyId,
        accessKeySecret: accessKeySecret,
        bucket: bucket,
        endpoint: endpoint
      });

      // 上传文件
      const result = await client.put(fileName, fileBuffer, {
        headers: {
          'Content-Type': mimeType
        }
      });

      if (result.res && result.res.status === 200) {
        const fileUrl = customDomain ? `${customDomain}/${fileName}` : result.url;
        return {
          success: true,
          url: fileUrl,
          fileName: fileName
        };
      }

      throw new Error(`OSS上传失败: ${result.res?.status || 'Unknown'}`);
    } catch (error) {
      throw new Error(`OSS上传错误: ${error.message}`);
    }
  }

  /**
   * Amazon S3上传
   */
  async uploadToS3(config, fileName, fileBuffer, mimeType) {
    try {
      const { accessKeyId, secretAccessKey, bucket, region, endpoint, customDomain } = config;
      
      // 使用AWS SDK v3
      const s3Config = {
        credentials: {
          accessKeyId: accessKeyId,
          secretAccessKey: secretAccessKey
        },
        region: region
      };
      
      if (endpoint) {
        s3Config.endpoint = endpoint;
        s3Config.forcePathStyle = true; // 对于自定义endpoint，使用路径样式
      }
      
      const s3Client = new S3Client(s3Config);

      // 上传文件
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: fileName,
        Body: fileBuffer,
        ContentType: mimeType
      });

      const result = await s3Client.send(command);

      // 构建文件URL
      const baseUrl = endpoint || `https://${bucket}.s3.${region}.amazonaws.com`;
      const fileUrl = customDomain ? `${customDomain}/${fileName}` : `${baseUrl}/${fileName}`;
      
      return {
        success: true,
        url: fileUrl,
        fileName: fileName
      };
    } catch (error) {
      throw new Error(`S3上传错误: ${error.message}`);
    }
  }

  /**
   * MinIO上传 (S3兼容)
   */
  async uploadToMinIO(config, fileName, fileBuffer, mimeType) {
    try {
      const { accessKey, secretKey, bucket, endpoint, useSSL = true, customDomain } = config;
      
      // 使用AWS SDK v3处理MinIO (S3兼容)
      const s3Config = {
        credentials: {
          accessKeyId: accessKey,
          secretAccessKey: secretKey
        },
        endpoint: endpoint,
        region: 'us-east-1', // MinIO默认region
        forcePathStyle: true, // MinIO需要路径样式
      };
      
      const s3Client = new S3Client(s3Config);

      // 上传文件
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: fileName,
        Body: fileBuffer,
        ContentType: mimeType
      });

      const result = await s3Client.send(command);

      // 构建文件URL
      const fileUrl = customDomain ? `${customDomain}/${fileName}` : `${endpoint}/${bucket}/${fileName}`;
      
      return {
        success: true,
        url: fileUrl,
        fileName: fileName
      };
    } catch (error) {
      throw new Error(`MinIO上传错误: ${error.message}`);
    }
  }

  /**
   * 七牛云上传
   */
  async uploadToQiniu(config, fileName, fileBuffer, mimeType) {
    try {
      const { accessKey, secretKey, bucket, customDomain } = config;
      
      // 使用官方SDK
      const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
      const putPolicy = new qiniu.rs.PutPolicy({
        scope: bucket
      });
      const uploadToken = putPolicy.uploadToken(mac);

      const config_qiniu = new qiniu.conf.Config();
      const formUploader = new qiniu.form_up.FormUploader(config_qiniu);
      const putExtra = new qiniu.form_up.PutExtra();

      // 上传文件
      const result = await new Promise((resolve, reject) => {
        formUploader.put(uploadToken, fileName, fileBuffer, putExtra, (err, body, info) => {
          if (err) {
            reject(err);
          } else if (info.statusCode === 200) {
            resolve(body);
          } else {
            reject(new Error(`七牛云上传失败: ${info.statusCode}`));
          }
        });
      });

      const fileUrl = customDomain ? `${customDomain}/${fileName}` : `https://cdn.qiniu.com/${fileName}`;
      return {
        success: true,
        url: fileUrl,
        fileName: fileName
      };
    } catch (error) {
      throw new Error(`七牛云上传错误: ${error.message}`);
    }
  }

  /**
   * 又拍云上传
   */
  async uploadToUpyun(config, fileName, fileBuffer, mimeType) {
    try {
      const { operator, password, bucket, customDomain } = config;
      
      // 使用官方SDK
      const service = new upyun.Service(bucket, operator, password);
      const client = new upyun.Client(service);

      // 上传文件
      await client.putFile(`/${fileName}`, fileBuffer);

      const fileUrl = customDomain ? `${customDomain}/${fileName}` : `https://${bucket}.b0.upaiyun.com/${fileName}`;
      return {
        success: true,
        url: fileUrl,
        fileName: fileName
      };
    } catch (error) {
      throw new Error(`又拍云上传错误: ${error.message}`);
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 从endpoint提取region
   */
  extractRegionFromEndpoint(endpoint, type) {
    // 简单的region提取逻辑
    if (type === 'cos' && endpoint.includes('myqcloud.com')) {
      const match = endpoint.match(/cos\.([^.]+)\.myqcloud\.com/);
      return match ? match[1] : 'ap-beijing';
    }
    return 'default';
  }

}

module.exports = StorageService;
