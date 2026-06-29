import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env.js";
import { logger } from "../../shared/logger/logger.js";

interface PresignArgs {
  key: string;
  contentType: string;
  contentLength: number;
  /**
   * Optional `Content-Disposition` baked into the signed PUT. Used to force a
   * download (`attachment; filename="…"`) for non-inline/unknown types so they
   * can't execute inline when opened. The browser PUT must echo this header.
   */
  contentDisposition?: string;
  expiresInSeconds?: number;
}

interface PresignResult {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  /** Headers the browser MUST send on the PUT to match the signature. */
  requiredHeaders: Record<string, string>;
}

/** Object metadata read back from S3 (the authoritative type/size after upload). */
export interface HeadObjectResult {
  contentType: string;
  contentLength: number;
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
  /**
   * A short-lived presigned GET URL — how private objects (chat attachments) are
   * read. Authenticated as our credentials, so it works on a private bucket and
   * bypasses the bucket's public-access block; expires, so a leaked URL isn't
   * forever-readable.
   */
  getDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Read an object's authoritative type/size, or `null` if it doesn't exist. */
  headObject(key: string): Promise<HeadObjectResult | null>;
}

/** Default lifetime for a presigned GET URL (6h). Re-signed on each message read. */
const DOWNLOAD_URL_TTL_SECONDS = 6 * 60 * 60;

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
    contentDisposition,
    expiresInSeconds = 300,
  }: PresignArgs): Promise<PresignResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
      ...(contentDisposition ? { ContentDisposition: contentDisposition } : {}),
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });
    // The browser PUT must send exactly the headers that were signed.
    const requiredHeaders: Record<string, string> = {
      "Content-Type": contentType,
    };
    if (contentDisposition)
      requiredHeaders["Content-Disposition"] = contentDisposition;
    return {
      uploadUrl,
      publicUrl: this.publicUrlFor(key),
      key,
      requiredHeaders,
    };
  }

  publicUrlFor(key: string): string {
    return `${this.publicUrlBase}/${encodeURI(key)}`;
  }

  async getDownloadUrl(
    key: string,
    expiresInSeconds = DOWNLOAD_URL_TTL_SECONDS,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      {
        expiresIn: expiresInSeconds,
      },
    );
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        contentType: out.ContentType ?? "application/octet-stream",
        contentLength: out.ContentLength ?? 0,
      };
    } catch (err) {
      // Missing object (404/NotFound) → null so the caller rejects the send.
      const name = (err as { name?: string }).name;
      if (
        name === "NotFound" ||
        name === "NoSuchKey" ||
        name === "NotFoundException"
      ) {
        return null;
      }
      throw err;
    }
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

  async getDownloadUrl(): Promise<string> {
    throw new NotConfiguredError();
  }

  async headObject(): Promise<HeadObjectResult | null> {
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
  logger.info("S3 client ready");

  return new ConfiguredS3Service(client, env.S3_BUCKET, publicUrlBase);
}

export const s3Service = createS3Service();
