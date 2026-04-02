const axios = require('axios');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { imageDB, statsDB, storageDB } = require('./database');
const { transferSingleImage, validateImageUrl, getRandomUserAgent } = require('./imageTransfer');
const StorageService = require('./services/storageService');

let ytDlpExec = null;
try {
  ytDlpExec = require('yt-dlp-exec');
} catch (error) {
  ytDlpExec = null;
}

const MAX_MEDIA_SIZE = 200 * 1024 * 1024;
const PLATFORM_DOMAINS = {
  youtube: ['youtube.com', 'youtu.be'],
  x: ['x.com', 'twitter.com'],
  douyin: ['douyin.com', 'v.douyin.com'],
  telegram: ['t.me', 'telegram.me', 'telegram.org']
};
const YT_DLP_BINARY_URL = process.env.YT_DLP_BINARY_URL || (
  process.platform === 'win32'
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : process.platform === 'darwin'
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux'
);
const YT_DLP_CACHE_DIR = process.env.YT_DLP_CACHE_DIR || path.join(os.tmpdir(), 'yt-dlp-bin');
const YT_DLP_CACHE_BINARY = path.join(YT_DLP_CACHE_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const YT_DLP_COOKIES_CACHE_DIR = process.env.YT_DLP_COOKIES_CACHE_DIR || path.join(os.tmpdir(), 'yt-dlp-cookies');


const mimeToExt = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'video/x-msvideo': '.avi',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

const extToMime = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

const isVideoContentType = (contentType = '') => contentType.toLowerCase().startsWith('video/');
const isImageContentType = (contentType = '') => contentType.toLowerCase().startsWith('image/');

const getPlatformByUrl = (url) => {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const matched = Object.entries(PLATFORM_DOMAINS).find(([, domains]) => {
      return domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
    });
    return matched?.[0] || null;
  } catch (error) {
    return null;
  }
};

const isSocialVideoUrl = (url) => Boolean(getPlatformByUrl(url));
const isTelegramUrl = (url) => getPlatformByUrl(url) === 'telegram';

const getMimeTypeByExt = (filePath = '') => {
  const ext = path.extname(filePath).toLowerCase();
  return extToMime[ext] || 'application/octet-stream';
};

const normalizeCookieContent = (value = '') => {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .trim();
};

const isLikelyNetscapeCookiesFile = (filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return false;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const normalized = (content || '').replace(/\r\n/g, '\n');
    if (!normalized.trim()) {
      return false;
    }

    if (/#\s*Netscape HTTP Cookie File/i.test(normalized)) {
      return true;
    }

    const dataLine = normalized
      .split('\n')
      .map(line => line.trim())
      .find(line => line && !line.startsWith('#'));

    if (!dataLine) {
      return false;
    }

    return dataLine.split('\t').length >= 7;
  } catch (error) {
    return false;
  }
};

const materializeCookiesFile = (content, envName, transferId = 'N/A') => {

  const normalized = normalizeCookieContent(content);
  if (!normalized) return '';

  ensureDir(YT_DLP_COOKIES_CACHE_DIR);
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 12);
  const safeEnvName = envName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const targetPath = path.join(YT_DLP_COOKIES_CACHE_DIR, `${safeEnvName}-${hash}.txt`);

  if (!fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, `${normalized}\n`, 'utf8');
    if (process.platform !== 'win32') {
      fs.chmodSync(targetPath, 0o600);
    }
    logTransfer(transferId, `已从环境变量生成 Cookie 文件: ${targetPath}`);
  }

  return targetPath;
};

const resolveCookieEnv = (envName, transferId = 'N/A') => {
  const plainValue = (process.env[envName] || '').trim();
  const base64Value = (process.env[`${envName}_BASE64`] || '').trim();

  if (plainValue) {
    if (fs.existsSync(plainValue)) {
      if (isLikelyNetscapeCookiesFile(plainValue)) {
        return plainValue;
      }
      logTransfer(transferId, `${envName} 指向的文件不是 Netscape cookies 格式，已忽略: ${plainValue}`);
      return '';
    }


    if (plainValue.startsWith('base64:')) {
      try {
        const decoded = Buffer.from(plainValue.slice(7), 'base64').toString('utf8');
        return materializeCookiesFile(decoded, envName, transferId);
      } catch (error) {
        logTransfer(transferId, `${envName} 的 base64 内容解析失败: ${error.message || 'unknown'}`);
        return '';
      }
    }

    return materializeCookiesFile(plainValue, envName, transferId);
  }

  if (base64Value) {
    try {
      const decoded = Buffer.from(base64Value, 'base64').toString('utf8');
      return materializeCookiesFile(decoded, `${envName}_BASE64`, transferId);
    } catch (error) {
      logTransfer(transferId, `${envName}_BASE64 解析失败: ${error.message || 'unknown'}`);
      return '';
    }
  }

  return '';
};

const getCookiesFileForUrl = (url, transferId = 'N/A') => {
  const platform = getPlatformByUrl(url);
  const envKeyMap = {
    youtube: 'YT_DLP_COOKIES_YOUTUBE',
    x: 'YT_DLP_COOKIES_X',
    douyin: 'YT_DLP_COOKIES_DOUYIN',
    telegram: 'YT_DLP_COOKIES_TELEGRAM'
  };

  const envCandidates = [];
  if (platform && envKeyMap[platform]) {
    envCandidates.push(envKeyMap[platform]);
  }
  envCandidates.push('YT_DLP_COOKIES_FILE', 'YT_DLP_COOKIES');

  for (const envName of envCandidates) {
    const cookiePath = resolveCookieEnv(envName, transferId);
    if (cookiePath) {
      return cookiePath;
    }
  }

  return '';
};


const sanitizeUrl = (url) => url.toString().trim().replace(/^["']|["']$/g, '');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const createTransferId = () => `transfer-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

const logTransfer = (transferId, message) => {
  console.log(`[MediaTransfer][${transferId}] ${message}`);
};

const executeCommand = (command, args, options = {}) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    const emitLines = (text, isError = false) => {
      if (!text) return;
      const lines = text.toString().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      lines.forEach((line) => {
        if (options.onLine) {
          options.onLine(line, isError);
        }
      });
    };

    child.stdout.on('data', (chunk) => {
      emitLines(chunk, false);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      emitLines(text, true);
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `命令执行失败，退出码: ${code}`));
    });
  });
};

const downloadStandaloneYtDlp = async (targetPath, transferId = 'N/A') => {
  ensureDir(path.dirname(targetPath));
  const tempPath = `${targetPath}.downloading`;
  logTransfer(transferId, `开始下载独立 yt-dlp 二进制: ${YT_DLP_BINARY_URL}`);

  const response = await axios({
    method: 'GET',
    url: YT_DLP_BINARY_URL,
    responseType: 'stream',
    timeout: 120000,
    maxRedirects: 5,
    headers: {
      'User-Agent': getRandomUserAgent()
    }
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(tempPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });

  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }
  fs.renameSync(tempPath, targetPath);

  if (process.platform !== 'win32') {
    fs.chmodSync(targetPath, 0o755);
  }

  logTransfer(transferId, `独立 yt-dlp 已就绪: ${targetPath}`);
};

const findSystemYtDlpBinary = () => {
  const candidates = process.platform === 'win32'
    ? ['yt-dlp.exe', 'yt-dlp']
    : ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp', 'yt-dlp'];

  for (const candidate of candidates) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return candidates[candidates.length - 1];
};

const ensureYtDlpBinary = async (transferId = 'N/A') => {
  const customBinary = process.env.YT_DLP_BINARY;
  if (customBinary && fs.existsSync(customBinary)) {
    logTransfer(transferId, `使用环境变量指定的 yt-dlp: ${customBinary}`);
    return customBinary;
  }

  const systemBinary = findSystemYtDlpBinary();
  try {
    await executeCommand(systemBinary, ['--version']);
    logTransfer(transferId, `使用系统已安装 yt-dlp: ${systemBinary}`);
    return systemBinary;
  } catch (error) {
    logTransfer(transferId, `系统 yt-dlp 不可用，准备下载独立二进制: ${error.message || 'unknown'}`);
  }

  if (!fs.existsSync(YT_DLP_CACHE_BINARY)) {
    await downloadStandaloneYtDlp(YT_DLP_CACHE_BINARY, transferId);
  }

  return YT_DLP_CACHE_BINARY;
};

const getYtDlpExtraArgs = (cookieFile = '') => {
  const args = [];

  if (cookieFile) {
    args.push('--cookies', cookieFile);
  }

  if (process.env.YT_DLP_PROXY) {
    args.push('--proxy', process.env.YT_DLP_PROXY);
  }

  return args;
};

const getPreferredYtDlpFormat = (url) => {
  const platform = getPlatformByUrl(url);
  if (platform === 'telegram') {
    return 'best';
  }
  return 'mp4/best';
};

const buildYtDlpArgs = (url, outputTemplate, cookieFile = '') => {
  return [
    url,
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--newline',
    '--output',
    outputTemplate,
    '--format',
    getPreferredYtDlpFormat(url),
    '--merge-output-format',
    'mp4',
    ...getYtDlpExtraArgs(cookieFile)
  ];
};

const isPythonVersionError = (message = '') => {
  return /unsupported version of Python|Only Python versions 3\.10 and above/i.test(message);
};

const runYtDlp = async (url, outputTemplate, transferId = 'N/A') => {
  const cookieFile = getCookiesFileForUrl(url, transferId);

  const options = {
    noPlaylist: true,
    noWarnings: true,
    noCheckCertificates: true,
    newline: true,
    output: outputTemplate,
    format: getPreferredYtDlpFormat(url),
    mergeOutputFormat: 'mp4'
  };

  if (cookieFile) {
    options.cookies = cookieFile;
    logTransfer(transferId, `按域名启用 Cookie: ${cookieFile}`);
  }

  if (process.env.YT_DLP_PROXY) {
    options.proxy = process.env.YT_DLP_PROXY;
  }

  const logYtDlpLine = (line) => {
    if (/\[download\]|Extracting URL|Downloading|Merging formats|Destination/i.test(line)) {
      logTransfer(transferId, `[yt-dlp] ${line}`);
    }
  };

  if (ytDlpExec) {
    try {
      logTransfer(transferId, '开始使用 yt-dlp-exec 下载社媒视频');
      await ytDlpExec(url, options);
      logTransfer(transferId, 'yt-dlp-exec 下载完成');
      return;
    } catch (error) {
      const message = error?.message || '';
      logYtDlpLine(message);
      if (!isPythonVersionError(message)) {
        throw error;
      }
      logTransfer(transferId, '检测到 Python 版本兼容问题，自动回退独立 yt-dlp 二进制');
    }
  }

  const binaryPath = await ensureYtDlpBinary(transferId);
  logTransfer(transferId, `开始使用独立 yt-dlp 下载: ${binaryPath}`);
  await executeCommand(binaryPath, buildYtDlpArgs(url, outputTemplate, cookieFile), {
    onLine: (line) => logYtDlpLine(line)
  });
  logTransfer(transferId, '独立 yt-dlp 下载完成');
};

const detectMediaType = async (url) => {
  try {
    const response = await axios.head(url, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        'User-Agent': getRandomUserAgent()
      }
    });

    const contentType = (response.headers['content-type'] || '').toLowerCase();
    const contentLength = parseInt(response.headers['content-length'] || '0', 10);

    if (isImageContentType(contentType)) {
      return { mediaType: 'image', contentType, contentLength };
    }

    if (isVideoContentType(contentType)) {
      return { mediaType: 'video', contentType, contentLength };
    }

    return { mediaType: 'unknown', contentType, contentLength };
  } catch (error) {
    return { mediaType: 'unknown', contentType: '', contentLength: 0 };
  }
};

const streamDownloadToFile = async (url, filePath, contentTypeHint = '', transferId = 'N/A') => {
  logTransfer(transferId, `开始直链下载: ${url}`);

  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
    timeout: 60000,
    maxRedirects: 5,
    headers: {
      'User-Agent': getRandomUserAgent(),
      Referer: new URL(url).origin
    }
  });

  const contentType = (response.headers['content-type'] || contentTypeHint || '').toLowerCase();
  const contentLength = parseInt(response.headers['content-length'] || '0', 10);

  if (!isVideoContentType(contentType) && !isImageContentType(contentType)) {
    throw new Error(`无效的内容类型: ${contentType || 'unknown'}`);
  }

  if (contentLength > MAX_MEDIA_SIZE) {
    throw new Error(`文件大小超过限制 (${Math.floor(MAX_MEDIA_SIZE / 1024 / 1024)}MB)`);
  }

  await new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(filePath);
    let total = 0;
    let lastLogTime = Date.now();

    response.data.on('data', (chunk) => {
      total += chunk.length;

      const now = Date.now();
      if (now - lastLogTime >= 2000) {
        const downloadedMB = (total / 1024 / 1024).toFixed(2);
        const totalMB = contentLength > 0 ? (contentLength / 1024 / 1024).toFixed(2) : null;
        const progressText = totalMB ? `${downloadedMB}MB / ${totalMB}MB` : `${downloadedMB}MB`;
        logTransfer(transferId, `直链下载中: ${progressText}`);
        lastLogTime = now;
      }

      if (total > MAX_MEDIA_SIZE) {
        writeStream.destroy();
        try {
          fs.unlinkSync(filePath);
        } catch (error) {}
        reject(new Error(`文件大小超过限制 (${Math.floor(MAX_MEDIA_SIZE / 1024 / 1024)}MB)`));
      }
    });

    response.data.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', () => resolve());
    response.data.pipe(writeStream);
  });

  const finalSize = fs.statSync(filePath).size;
  logTransfer(transferId, `直链下载完成: ${(finalSize / 1024 / 1024).toFixed(2)}MB`);

  return {
    contentType,
    fileSize: finalSize
  };
};

const uploadLocalFileAndSave = async ({ localPath, mimeType, originalUrl, userId, transferId = 'N/A' }) => {
  const defaultStorage = await storageDB.getDefaultStorage();
  if (!defaultStorage) {
    throw new Error('未找到默认存储配置，请先配置对象存储');
  }

  const filename = path.basename(localPath);
  const fileBuffer = fs.readFileSync(localPath);
  const fileSize = fileBuffer.length;

  const storageService = new StorageService();
  const uploadResult = await storageService.uploadFile(
    { type: defaultStorage.type, config: defaultStorage.config },
    {
      name: filename,
      data: fileBuffer.toString('base64'),
      size: fileSize,
      type: mimeType
    },
    'transfer'
  );

  if (!uploadResult.success) {
    throw new Error(uploadResult.error || '对象存储上传失败');
  }

  logTransfer(transferId, '对象存储上传成功，开始写入数据库');

  let width = null;
  let height = null;
  if (isImageContentType(mimeType)) {
    try {
      const metadata = await sharp(localPath).metadata();
      width = metadata.width || null;
      height = metadata.height || null;
    } catch (error) {}
  }

  const record = await imageDB.create({
    filename,
    originalName: path.basename(originalUrl.split('?')[0]) || filename,
    filePath: uploadResult.fileName || filename,
    fileUrl: uploadResult.url,
    fileSize,
    mimeType,
    width,
    height,
    uploadType: 'transfer',
    originalUrl,
    userId,
    storageId: defaultStorage.id
  });

  logTransfer(transferId, `转存完成，记录ID: ${record.id}`);

  return {
    success: true,
    id: record.id,
    originalUrl,
    newUrl: uploadResult.url,
    filename,
    size: fileSize,
    width,
    height,
    mediaType: isVideoContentType(mimeType) ? 'video' : 'image',
    message: '转存成功'
  };
};

const downloadSocialVideo = async (url, tempDir, transferId = 'N/A') => {
  ensureDir(tempDir);

  const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const outputTemplate = path.join(tempDir, `social-${unique}.%(ext)s`);

  logTransfer(transferId, `开始处理社媒链接: ${url}`);

  try {
    await runYtDlp(url, outputTemplate, transferId);
  } catch (error) {
    const rawMessage = error?.message || '';
    const platform = getPlatformByUrl(url);
    const isYoutubeBotCheck = /Sign in to confirm you.?re not a bot|Use --cookies-from-browser or --cookies/i.test(rawMessage);
    const isFreshCookiesRequired = /Fresh cookies.*needed/i.test(rawMessage);
    const pythonVersionError = isPythonVersionError(rawMessage);

    if (isYoutubeBotCheck) {
      throw new Error('YouTube 触发了反爬验证，请配置 YouTube Cookie（环境变量 YT_DLP_COOKIES_YOUTUBE）或更换代理 IP 后重试。');
    }

    if (isFreshCookiesRequired) {
      const platformNameMap = {
        douyin: '抖音',
        x: 'X',
        telegram: 'Telegram',
        youtube: 'YouTube'
      };
      const envKeyMap = {
        douyin: 'YT_DLP_COOKIES_DOUYIN',
        x: 'YT_DLP_COOKIES_X',
        telegram: 'YT_DLP_COOKIES_TELEGRAM',
        youtube: 'YT_DLP_COOKIES_YOUTUBE'
      };
      const name = platformNameMap[platform] || '该平台';
      const envName = envKeyMap[platform] || 'YT_DLP_COOKIES_FILE';
      throw new Error(`${name} 需要新鲜 Cookie，请配置环境变量 ${envName} 后重试。`);
    }

    if (pythonVersionError) {
      throw new Error('社媒视频下载失败：检测到 Python 版本不兼容。请设置 YT_DLP_BINARY 指向独立 yt-dlp 二进制，或使用 Python 3.10+。');
    }

    throw new Error(`社媒视频下载失败：${rawMessage || '未知错误'}`);
  }

  const files = fs.readdirSync(tempDir)
    .filter(name => name.startsWith(`social-${unique}.`))
    .map(name => path.join(tempDir, name));

  if (files.length === 0) {
    throw new Error('未获取到视频文件');
  }

  const targetFile = files[0];
  const mimeType = getMimeTypeByExt(targetFile);

  const fileSize = fs.statSync(targetFile).size;
  if (fileSize > MAX_MEDIA_SIZE) {
    throw new Error(`视频大小超过限制 (${Math.floor(MAX_MEDIA_SIZE / 1024 / 1024)}MB)`);
  }

  return {
    localPath: targetFile,
    mimeType,
    fileSize
  };
};

const normalizeTelegramCandidateUrl = (value = '') => {
  return value
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .trim();
};

const getTelegramProbeUrls = (url) => {
  const urls = new Set([url]);

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || '/';

    const embedUrl = new URL(parsed.toString());
    embedUrl.searchParams.set('embed', '1');
    embedUrl.searchParams.set('mode', 'tme');
    urls.add(embedUrl.toString());

    if (parsed.hostname === 't.me' && !pathname.startsWith('/c/')) {
      const sView = new URL(`https://t.me/s${pathname}`);
      urls.add(sView.toString());
    }
  } catch (error) {}

  return Array.from(urls);
};

const extractTelegramMediaUrl = async (url, transferId = 'N/A') => {
  const probeUrls = getTelegramProbeUrls(url);

  for (const probeUrl of probeUrls) {
    try {
      logTransfer(transferId, `Telegram HTML 解析尝试: ${probeUrl}`);
      const response = await axios.get(probeUrl, {
        timeout: 30000,
        maxRedirects: 5,
        headers: {
          'User-Agent': getRandomUserAgent()
        }
      });

      const html = response.data || '';
      const candidates = [];
      const patterns = [
        /<meta\s+property=["']og:video(?::secure_url)?["']\s+content=["']([^"']+)["']/ig,
        /<meta\s+name=["']twitter:player:stream["']\s+content=["']([^"']+)["']/ig,
        /<meta\s+property=["']og:image(?::secure_url)?["']\s+content=["']([^"']+)["']/ig,
        /<video[^>]+src=["']([^"']+)["']/ig,
        /<source[^>]+src=["']([^"']+)["']/ig,
        /"video_url"\s*:\s*"([^"]+)"/ig,
        /"image_url"\s*:\s*"([^"]+)"/ig
      ];

      patterns.forEach((regex) => {
        regex.lastIndex = 0;
        let match = regex.exec(html);
        while (match?.[1]) {
          candidates.push(normalizeTelegramCandidateUrl(match[1]));
          match = regex.exec(html);
        }
      });

      const dedupCandidates = Array.from(new Set(candidates.filter(Boolean)));

      for (const candidate of dedupCandidates) {
        try {
          const absolute = new URL(candidate, probeUrl).toString();
          const detected = await detectMediaType(absolute);
          if (detected.mediaType === 'video' || detected.mediaType === 'image') {
            logTransfer(transferId, `Telegram HTML 解析到媒体直链: ${absolute}`);
            return {
              mediaUrl: absolute,
              contentType: detected.contentType,
              mediaType: detected.mediaType
            };
          }
        } catch (error) {}
      }
    } catch (error) {
      logTransfer(transferId, `Telegram HTML 解析失败(${probeUrl}): ${error.message || 'unknown'}`);
    }
  }

  return null;
};

const transferSingleMedia = async (inputUrl, uploadDir, baseUrl, userId = null) => {
  let localPath = null;
  const transferId = createTransferId();

  try {
    const url = sanitizeUrl(inputUrl);
    logTransfer(transferId, `开始转存: ${url}`);

    if (!/^https?:\/\/.+/i.test(url)) {
      throw new Error('URL必须以http://或https://开头');
    }

    new URL(url);

    // 先处理社媒分享链接
    if (isSocialVideoUrl(url)) {
      const tempDir = path.join(uploadDir, '_tmp_media');
      try {
        const socialMedia = await downloadSocialVideo(url, tempDir, transferId);
        localPath = socialMedia.localPath;
        return await uploadLocalFileAndSave({
          localPath,
          mimeType: socialMedia.mimeType,
          originalUrl: url,
          userId,
          transferId
        });
      } catch (socialError) {
        if (!isTelegramUrl(url)) {
          throw socialError;
        }

        logTransfer(transferId, `Telegram yt-dlp 失败，尝试 HTML 解析兜底: ${socialError.message || 'unknown'}`);
        const parsed = await extractTelegramMediaUrl(url, transferId);
        if (!parsed?.mediaUrl) {
          if (/https?:\/\/t\.me\/c\//i.test(url)) {
            throw new Error('Telegram 链接未解析到可下载媒体。`t.me/c/...` 多为私有频道内部链接，需使用有权限账号的可访问链接（如公开 `t.me/频道名/消息ID`）后重试。');
          }
          throw socialError;
        }


        const ext = mimeToExt[parsed.contentType] || (parsed.mediaType === 'image' ? '.jpg' : '.mp4');
        const tempName = `transfer-telegram-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
        localPath = path.join(uploadDir, tempName);
        const downloaded = await streamDownloadToFile(parsed.mediaUrl, localPath, parsed.contentType || '', transferId);

        return await uploadLocalFileAndSave({
          localPath,
          mimeType: downloaded.contentType || parsed.contentType || (parsed.mediaType === 'image' ? 'image/jpeg' : 'video/mp4'),
          originalUrl: url,
          userId,
          transferId
        });
      }
    }

    const detected = await detectMediaType(url);

    if (detected.mediaType === 'image') {
      return await transferSingleImage(url, uploadDir, baseUrl, userId);
    }

    if (detected.mediaType !== 'video') {
      // 保持向下兼容，无法探测类型时先按图片尝试
      const imageResult = await transferSingleImage(url, uploadDir, baseUrl, userId);
      if (imageResult.success) {
        return { ...imageResult, mediaType: 'image' };
      }
    }

    const ext = mimeToExt[detected.contentType] || '.mp4';
    const tempName = `transfer-video-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    localPath = path.join(uploadDir, tempName);

    const downloaded = await streamDownloadToFile(url, localPath, detected.contentType || 'video/mp4', transferId);

    logTransfer(transferId, '直链视频下载完成，开始上传到对象存储');
    return await uploadLocalFileAndSave({
      localPath,
      mimeType: downloaded.contentType || 'video/mp4',
      originalUrl: url,
      userId,
      transferId
    });
  } catch (error) {
    logTransfer(transferId, `转存失败: ${error.message || '未知错误'}`);
    return {
      success: false,
      originalUrl: inputUrl,
      mediaType: 'unknown',
      message: error.message || '转存失败'
    };
  } finally {
    if (localPath && fs.existsSync(localPath)) {
      try {
        fs.unlinkSync(localPath);
      } catch (error) {}
    }
  }
};

const transferMedia = async (urls, uploadDir, baseUrl, userId = null) => {
  console.log(`[MediaTransfer] 批量转存开始: ${urls.length} 个链接, userId=${userId || 'anonymous'}`);
  const results = [];
  const today = new Date().toISOString().split('T')[0];
  let successCount = 0;
  let totalSize = 0;

  const concurrency = 3;
  for (let i = 0; i < urls.length; i += concurrency) {
    const chunk = urls.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map(url => transferSingleMedia(url, uploadDir, baseUrl, userId)));
    results.push(...chunkResults);

    chunkResults.forEach(item => {
      if (item.success) {
        successCount += 1;
        totalSize += item.size || 0;
      }
    });

    if (i + concurrency < urls.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  if (successCount > 0) {
    try {
      await statsDB.updateDailyStats(today, 0, totalSize, successCount);
    } catch (error) {}
  }

  console.log(`[MediaTransfer] 批量转存结束: 成功 ${successCount} / ${urls.length}, 总大小 ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
  return results;
};

const validateMediaUrl = async (inputUrl) => {
  const url = sanitizeUrl(inputUrl);

  if (!/^https?:\/\/.+/i.test(url)) {
    return { valid: false, mediaType: 'unknown', error: 'URL必须以http://或https://开头' };
  }

  if (isSocialVideoUrl(url)) {
    const platform = getPlatformByUrl(url);
    return {
      valid: true,
      mediaType: platform === 'telegram' ? 'unknown' : 'video',
      source: 'social',
      platform
    };
  }

  const imageValidation = await validateImageUrl(url);
  if (imageValidation.valid) {
    return {
      ...imageValidation,
      mediaType: 'image'
    };
  }

  const detected = await detectMediaType(url);
  if (detected.mediaType === 'video') {
    if (detected.contentLength > MAX_MEDIA_SIZE) {
      return {
        valid: false,
        mediaType: 'video',
        error: `文件大小超过限制 (${Math.floor(MAX_MEDIA_SIZE / 1024 / 1024)}MB)`
      };
    }

    return {
      valid: true,
      mediaType: 'video',
      contentType: detected.contentType,
      contentLength: detected.contentLength
    };
  }

  return {
    valid: false,
    mediaType: 'unknown',
    error: imageValidation.error || '无法识别为可转存的图片或视频链接'
  };
};

module.exports = {
  transferMedia,
  transferSingleMedia,
  validateMediaUrl,
  isSocialVideoUrl
};
