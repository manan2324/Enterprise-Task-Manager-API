import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';
import path from 'node:path';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
]);

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export function sanitizeFileName(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/');
  const baseName = path.posix.basename(normalized);
  return baseName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 100);
}

export class StorageService {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: Boolean(env.S3_ENDPOINT), // Required for local MinIO or R2 custom endpoints
    });
  }

  generateKey(workspaceId: string, taskId: string, fileName: string): string {
    const safeName = sanitizeFileName(fileName) || 'file.bin';
    const uuid = crypto.randomUUID();
    return `workspaces/${workspaceId}/tasks/${taskId}/${uuid}-${safeName}`;
  }

  validateAttachment(mimeType: string, sizeBytes: number): void {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new AppError(
        400,
        'INVALID_MIME_TYPE',
        `Unsupported file type '${mimeType}'. Allowed: ${Array.from(ALLOWED_MIME_TYPES).join(', ')}`,
      );
    }

    if (sizeBytes <= 0 || sizeBytes > MAX_FILE_SIZE_BYTES) {
      throw new AppError(
        400,
        'FILE_TOO_LARGE',
        `File size exceeds maximum allowed limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`,
      );
    }
  }

  async getPresignedUploadUrl(
    key: string,
    mimeType: string,
    sizeBytes: number,
    expiresIn = 900,
  ): Promise<{ uploadUrl: string; key: string; expiresInSeconds: number }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
      ContentLength: sizeBytes,
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn });
    return { uploadUrl, key, expiresInSeconds: expiresIn };
  }

  async getPresignedDownloadUrl(key: string, expiresIn = 900): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
    } catch {
      // Deletion error shouldn't crash caller if key doesn't exist
    }
  }
}

export const storageService = new StorageService();
