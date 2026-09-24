import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { AppError } from "../lib/server/errors";
import { MAX_AVATAR_PIXELS, MAX_AVATAR_UPLOAD_BYTES, readAvatarBody, transformAvatar } from "../lib/avatar-image";

test("avatar uploads require matching raster magic bytes and stay within the streaming byte limit", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
  await assert.rejects(transformAvatar(svg, "image/png"), (error: unknown) => error instanceof AppError && error.code === "avatar_type_invalid");

  const oversizedRequest = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-type": "image/jpeg" },
    body: new Uint8Array(MAX_AVATAR_UPLOAD_BYTES + 1),
  });
  await assert.rejects(readAvatarBody(oversizedRequest), (error: unknown) => error instanceof AppError && error.code === "avatar_too_large");
  await assert.rejects(readAvatarBody(new Request("http://localhost/upload", {
    method: "POST", headers: { "content-type": "image/svg+xml" }, body: svg,
  })), (error: unknown) => error instanceof AppError && error.code === "avatar_type_invalid");
});

test("avatar conversion honors the pixel ceiling and strips metadata from WebP output", async () => {
  assert.equal(MAX_AVATAR_PIXELS, 16_000_000);
  const tooLarge = await sharp({ create: { width: 4_001, height: 4_001, channels: 3, background: "#5588aa" } }).png().toBuffer();
  await assert.rejects(transformAvatar(tooLarge, "image/png"), (error: unknown) => error instanceof AppError && error.code === "avatar_decode_failed");

  const original = await sharp({ create: { width: 40, height: 24, channels: 3, background: "#cc8844" } })
    .withExif({ IFD0: { Artist: "private-metadata" } }).jpeg().toBuffer();
  const output = await transformAvatar(original, "image/jpeg");
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);
  assert.equal(metadata.exif, undefined);
  assert.ok(output.byteLength <= 256 * 1024);
});
