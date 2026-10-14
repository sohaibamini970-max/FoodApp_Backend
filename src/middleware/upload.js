const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

const ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
];

const ALLOWED_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const kind = req.uploadKind || "products";
    const dir = path.join(__dirname, "..", "..", "uploads", kind);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const id = crypto.randomBytes(12).toString("hex");
    cb(null, `${Date.now()}-${id}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk = ALLOWED_MIMES.includes(file.mimetype);
  const extOk = ALLOWED_EXTS.includes(ext);

  if (!mimeOk && !extOk) {
    return cb(new Error("Only JPG, PNG, WEBP, GIF, AVIF images are allowed"));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE },
});

module.exports = upload;