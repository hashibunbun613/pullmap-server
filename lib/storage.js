const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'pullmap-videos';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const isR2Configured = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY);

let s3;
if (isR2Configured) {
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY,
      secretAccessKey: R2_SECRET_KEY,
    },
  });
  console.log('[Storage] Cloudflare R2 configured');
} else {
  console.log('[Storage] R2 not configured, falling back to local disk');
}

async function uploadFile(key, buffer, contentType = 'application/octet-stream') {
  if (!isR2Configured) return null;
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return key;
}

async function uploadVideo(key, buffer) {
  return uploadFile(key, buffer, 'video/mp4');
}

async function uploadFrame(key, buffer) {
  return uploadFile(`frames/${key}`, buffer, 'image/jpeg');
}

async function uploadDiff(key, buffer) {
  return uploadFile(`diffs/${key}`, buffer, 'image/png');
}

async function deleteFile(key) {
  if (!isR2Configured) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (e) {
    console.error('[Storage] delete error:', e.message);
  }
}

async function deleteVideo(key) {
  return deleteFile(key);
}

function getFileUrl(key) {
  if (R2_PUBLIC_URL) return `${R2_PUBLIC_URL}/${key}`;
  return `/api/r2/${key}`;
}

function getVideoUrl(key) {
  return getFileUrl(key);
}

function getFrameUrl(key) {
  return getFileUrl(`frames/${key}`);
}

function getDiffUrl(key) {
  return getFileUrl(`diffs/${key}`);
}

async function streamFile(key) {
  if (!isR2Configured) return null;
  const resp = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  return resp;
}

async function streamVideo(key) {
  return streamFile(key);
}

module.exports = {
  uploadVideo, uploadFrame, uploadDiff, uploadFile,
  deleteVideo, deleteFile,
  getVideoUrl, getFrameUrl, getDiffUrl, getFileUrl,
  streamVideo, streamFile,
  isR2Configured,
};
