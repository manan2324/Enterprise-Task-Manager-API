import { describe, it, expect, vi } from 'vitest';
import { sanitizeFileName, StorageService } from '../../../src/services/storage.service.js';
import { AppError } from '../../../src/utils/app-error.js';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://mock-s3.example.com/presigned-url'),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = vi.fn().mockResolvedValue({});
  },
  PutObjectCommand: class {
    constructor(public input?: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public input?: unknown) {}
  },
  DeleteObjectCommand: class {
    constructor(public input?: unknown) {}
  },
}));

describe('StorageService', () => {
  it('sanitizes file names properly', () => {
    expect(sanitizeFileName('../../malicious.sh')).toBe('malicious.sh');
    expect(sanitizeFileName('report 2026 (draft)!.pdf')).toBe('report_2026__draft__.pdf');
    expect(sanitizeFileName('normal_document-v1.png')).toBe('normal_document-v1.png');
  });

  it('validates allowed MIME types and size constraints', () => {
    const service = new StorageService();

    expect(() => service.validateAttachment('application/x-executable', 1000)).toThrow(AppError);
    expect(() => service.validateAttachment('image/png', 20 * 1024 * 1024)).toThrow(AppError);
    expect(() => service.validateAttachment('image/png', -1)).toThrow(AppError);
    expect(() => service.validateAttachment('image/png', 5000)).not.toThrow();
  });

  it('generates pre-signed upload URL', async () => {
    const service = new StorageService();
    const key = service.generateKey('ws-1', 'task-1', 'photo.png');
    expect(key).toMatch(/^workspaces\/ws-1\/tasks\/task-1\/[a-f0-9-]+-photo\.png$/);

    const result = await service.getPresignedUploadUrl(key, 'image/png', 5000);
    expect(result.uploadUrl).toBe('https://mock-s3.example.com/presigned-url');
    expect(result.key).toBe(key);
  });
});
