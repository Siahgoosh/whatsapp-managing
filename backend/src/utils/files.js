import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../../../config/index.js";

export const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const VIDEO_MIME = new Set(["video/mp4"]);

export function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function extOf(name = "") {
  const ext = path.extname(name).toLowerCase();
  return ext;
}

export function isAllowedUpload(file) {
  if (!file) return false;
  if (file.size > config.maxUploadBytes) return false;
  const ext = extOf(file.originalname);
  if (!config.allowedExt.has(ext)) return false;
  if (file.mimetype && !config.allowedMime.has(file.mimetype)) return false;
  return true;
}

export function saveBuffer({ buffer, originalName, mimeType, subdir }) {
  const ext = extOf(originalName) || mimeToExt(mimeType);
  const stored = `${Date.now()}-${randomId(8)}${ext}`;
  const dir = path.join(config.paths.uploads, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, stored);
  fs.writeFileSync(abs, buffer);
  return {
    storedName: stored,
    originalName,
    mimeType,
    size: buffer.length,
    relPath: path.join(subdir, stored).replaceAll("\\", "/")
  };
}

export function absUpload(relPath) {
  const resolved = path.resolve(config.paths.uploads, relPath);
  if (!resolved.startsWith(path.resolve(config.paths.uploads))) {
    throw new Error("Invalid path");
  }
  return resolved;
}

function mimeToExt(mime) {
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "application/pdf": ".pdf"
  };
  return map[mime] || "";
}

export function looksLikeRateLimit(err) {
  const text = `${err?.message || ""} ${err?.output?.statusCode || ""} ${err?.data || ""}`.toLowerCase();
  return (
    text.includes("rate") ||
    text.includes("too many") ||
    text.includes("429") ||
    text.includes("blocked") ||
    text.includes("spam") ||
    text.includes("not-authorized") ||
    text.includes("forbidden")
  );
}
