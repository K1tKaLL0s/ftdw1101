import sharp, { type Metadata, type Sharp } from "sharp";
import { AppError } from "./server/errors";

export const MAX_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_AVATAR_OUTPUT_BYTES = 256 * 1024;
export const MAX_AVATAR_PIXELS = 16_000_000;

type AvatarFormat = "jpeg" | "png" | "webp";

function declaredFormat(contentType: string | null): AvatarFormat | null {
  switch (contentType?.split(";", 1)[0]?.trim().toLowerCase()) {
    case "image/jpeg": return "jpeg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    default: return null;
  }
}

function sniffFormat(bytes: Uint8Array): AvatarFormat | null {
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.byteLength >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "png";
  if (bytes.byteLength >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "webp";
  return null;
}

export async function readAvatarBody(request: Request): Promise<Buffer> {
  if (!declaredFormat(request.headers.get("content-type"))) {
    throw new AppError(415, "avatar_type_invalid", "头像仅支持 JPEG、PNG 或 WebP 图片。 ");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AVATAR_UPLOAD_BYTES) {
    throw new AppError(413, "avatar_too_large", "头像图片不能超过 2 MiB。 ");
  }
  if (!request.body) throw new AppError(400, "avatar_body_required", "请先选择头像图片。 ");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_AVATAR_UPLOAD_BYTES) {
        await reader.cancel();
        throw new AppError(413, "avatar_too_large", "头像图片不能超过 2 MiB。 ");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new AppError(400, "avatar_body_required", "请先选择头像图片。 ");
  return Buffer.concat(chunks, size);
}

export async function transformAvatar(input: Buffer, contentType: string | null): Promise<Buffer> {
  const expectedFormat = declaredFormat(contentType);
  if (!expectedFormat || sniffFormat(input) !== expectedFormat) {
    throw new AppError(415, "avatar_type_invalid", "头像图片格式与内容不匹配。 ");
  }
  if (input.byteLength > MAX_AVATAR_UPLOAD_BYTES) {
    throw new AppError(413, "avatar_too_large", "头像图片不能超过 2 MiB。 ");
  }
  let pipeline: Sharp;
  let metadata: Metadata;
  try {
    pipeline = sharp(input, { limitInputPixels: MAX_AVATAR_PIXELS, failOn: "warning", animated: false, sequentialRead: true });
    metadata = await pipeline.metadata();
  } catch {
    throw new AppError(422, "avatar_decode_failed", "无法读取这张图片，请换一张图片后重试。 ");
  }
  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height
    || metadata.width * metadata.height > MAX_AVATAR_PIXELS || (metadata.pages !== undefined && metadata.pages !== 1)) {
    throw new AppError(422, "avatar_decode_failed", "头像必须是单帧且不超过 1600 万像素的有效图片。 ");
  }
  try {
    const output = await pipeline.rotate().resize(256, 256, { fit: "cover", position: "centre" }).webp({ quality: 82, effort: 4 }).toBuffer();
    if (output.byteLength > MAX_AVATAR_OUTPUT_BYTES) {
      throw new AppError(422, "avatar_output_too_large", "压缩后的头像仍超过 256 KiB，请换一张图片。 ");
    }
    return output;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, "avatar_decode_failed", "无法转换这张图片，请换一张图片后重试。 ");
  }
}
