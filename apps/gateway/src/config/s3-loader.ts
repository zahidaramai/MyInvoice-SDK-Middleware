/**
 * S3 Certificate Loader
 * Downloads certificates from S3 for signing configuration
 */
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Parse S3 URI into bucket and key
 * @param s3Uri - S3 URI in format s3://bucket/key
 */
function parseS3Uri(s3Uri: string): { bucket: string; key: string } {
  const match = s3Uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid S3 URI: ${s3Uri}`);
  }
  return { bucket: match[1], key: match[2] };
}

/**
 * Check if a path is an S3 URI
 */
export function isS3Path(filePath: string): boolean {
  return filePath.startsWith('s3://');
}

/**
 * Download file from S3 to local temp directory
 * @param s3Uri - S3 URI (s3://bucket/key)
 * @param region - AWS region (defaults to ap-southeast-2)
 * @returns Local file path
 */
export async function downloadFromS3(
  s3Uri: string,
  region = 'ap-southeast-2'
): Promise<string> {
  const { bucket, key } = parseS3Uri(s3Uri);
  const fileName = path.basename(key);
  const localPath = path.join(os.tmpdir(), `hashlhdn-${Date.now()}-${fileName}`);

  // Create S3 client (uses IAM role credentials on EC2/EB)
  const s3Client = new S3Client({ region });

  try {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3Client.send(command);

    if (!response.Body) {
      throw new Error(`Empty response body from S3: ${s3Uri}`);
    }

    // Convert stream to buffer and write to file
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(localPath, buffer);

    return localPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to download certificate from S3 (${s3Uri}): ${message}`);
  }
}

/**
 * Load certificate path - handles both local paths and S3 URIs
 * @param filePath - Local path or S3 URI
 * @returns Local file path (downloads from S3 if needed)
 */
export async function resolveCertificatePath(filePath: string): Promise<string> {
  if (isS3Path(filePath)) {
    return downloadFromS3(filePath);
  }
  return filePath;
}
