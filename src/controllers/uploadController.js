const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const UPLOAD_ROOT = path.join(__dirname, "..", "..", "uploads");

/**
 * POST /api/admin/upload?kind=products|categories
 * multipart/form-data: field name = "file"
 */
exports.uploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const kind = req.uploadKind || "products";
    const originalPath = req.file.path;
    const originalName = path.basename(req.file.filename, path.extname(req.file.filename));

    // ── Resize + convert to WebP ──
    const targetDir = path.join(UPLOAD_ROOT, kind);
    const targetFile = `${originalName}.webp`;
    const targetPath = path.join(targetDir, targetFile);

    const maxWidth = kind === "categories" ? 256 : 1200;

    await sharp(originalPath)
      .rotate() // auto-rotate based on EXIF
      .resize({
        width: maxWidth,
        withoutEnlargement: true,
        fit: "inside",
      })
      .webp({ quality: 82 })
      .toFile(targetPath);

    // Delete the raw upload (we keep the compressed webp)
    fs.unlinkSync(originalPath);

    // ── Public URL ──
    const base =
      process.env.PUBLIC_URL ||
      `http://localhost:${process.env.PORT || 5000}`;

    const url = `${base}/uploads/${kind}/${targetFile}`;

    res.json({
      message: "Uploaded",
      url,
      kind,
      size: fs.statSync(targetPath).size,
    });
  } catch (err) {
    if (err.message && err.message.includes("images are allowed")) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};