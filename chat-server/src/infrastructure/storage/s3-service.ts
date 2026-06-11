import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env.js";
import { logger } from "../../shared/logger/logger.js";

interface PresignArgs {
  key: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number;
}

interface PresignResult {
  uploadUrl: string;
  publicUrl: string;
  key: string;
}

/**
 * Application-facing S3 API.
 *
 * Two implementations, picked at module init based on env:
 *   - `ConfiguredS3Service`  — real S3 (or any S3-compatible service like
 *                              MinIO via S3_ENDPOINT)
 *   - `NotConfiguredS3Service` — throws on every call. Callers (the users
 *                                module) translate the throw into a 501
 *                                response so the rest of the app stays
 *                                usable without S3 credentials.
 *
 * The interface is intentionally narrow (presign + public URL only). All
 * upload bytes flow browser→S3 directly via the presigned URL; the backend
 * never proxies the upload.
 */
export interface S3Service {
  isConfigured(): boolean;
  createPresignedUploadUrl(args: PresignArgs): Promise<PresignResult>;
  publicUrlFor(key: string): string;
}

class NotConfiguredError extends Error {
  constructor() {
    super("S3 is not configured. Set S3_BUCKET to enable uploads.");
    this.name = "NotConfiguredError";
  }
}

class ConfiguredS3Service implements S3Service {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly publicUrlBase: string,
  ) {}

  isConfigured(): boolean {
    return true;
  }

  /**
   * Builds a time-limited PUT URL the browser can upload to directly.
   *
   * The URL is bound to the exact `contentType` and `contentLength` the
   * caller declared, so a client can't (e.g.) request a permission for a
   * 200 KB JPEG and then PUT a 50 MB video. Default 5-minute expiry.
   */
  async createPresignedUploadUrl({
    key,
    contentType,
    contentLength,
    expiresInSeconds = 300,
  }: PresignArgs): Promise<PresignResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });
    return {
      uploadUrl,
      publicUrl: this.publicUrlFor(key),
      key,
    };
  }

  publicUrlFor(key: string): string {
    return `${this.publicUrlBase}/${encodeURI(key)}`;
  }
}

class NotConfiguredS3Service implements S3Service {
  isConfigured(): boolean {
    return false;
  }

  async createPresignedUploadUrl(): Promise<PresignResult> {
    throw new NotConfiguredError();
  }

  publicUrlFor(): string {
    throw new NotConfiguredError();
  }
}

function createS3Service(): S3Service {
  if (!env.S3_BUCKET) {
    logger.warn(
      "S3_BUCKET not set — using NotConfiguredS3Service. Avatar uploads will return 501.",
    );
    return new NotConfiguredS3Service();
  }

  const client = new S3Client({
    region: env.AWS_REGION,
    // AWS SDK v3 (>= 3.729) adds a default CRC32 integrity checksum to every
    // request. For *presigned* PUT URLs that bakes `x-amz-sdk-checksum-algorithm`
    // + `x-amz-checksum-crc32` (computed over an empty body at presign time) into
    // the signed query string. A browser PUT of the real file can't reproduce
    // that checksum, so S3 rejects it with `SignatureDoesNotMatch`. `WHEN_REQUIRED`
    // restores the pre-3.729 behavior — only checksum operations that mandate it
    // (PutObject doesn't) — keeping the presigned upload URL clean.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials:
      env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  });

  const publicUrlBase = `https://${env.S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com`;
  logger.info(
    { bucket: env.S3_BUCKET, region: env.AWS_REGION, publicUrlBase },
    "S3 client ready",
  );

  return new ConfiguredS3Service(client, env.S3_BUCKET, publicUrlBase);
}

export const s3Service = createS3Service();
