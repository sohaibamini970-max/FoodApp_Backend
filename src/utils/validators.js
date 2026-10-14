// Name: letters, numbers, spaces, hyphens, apostrophes only
const NAME_REGEX = /^[A-Za-z0-9\s'\-]{2,120}$/;
const CATEGORY_NAME_REGEX = /^[A-Za-z\s]{2,60}$/;
const URL_REGEX = /^https?:\/\/.+/i;
const DATA_URL_REGEX = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i;

function validateProductName(name) {
    if (!name || typeof name !== "string") return "Name is required";
    const trimmed = name.trim();
    if (trimmed.length < 2) return "Name must be at least 2 characters";
    if (trimmed.length > 120) return "Name must be under 120 characters";
    if (!NAME_REGEX.test(trimmed))
        return "Name can only contain letters, numbers, spaces, hyphens, and apostrophes";
    return null;
}

function validateDescription(desc, required = false) {
    if (!desc && !required) return null;
    if (typeof desc !== "string") return "Description must be text";
    if (desc.length > 2000) return "Description too long (max 2000)";
    return null;
}

function validatePrice(price) {
    const n = Number(price);
    if (!Number.isFinite(n)) return "Price must be a number";
    if (n < 0) return "Price cannot be negative";
    if (n > 1_000_000) return "Price is too high";
    if (!Number.isInteger(n)) return "Price must be a whole number (PKR)";
    return null;
}

function validateOldPrice(price, oldPrice) {
    if (oldPrice === null || oldPrice === undefined || oldPrice === "") return null;
    const err = validatePrice(oldPrice);
    if (err) return "Old price: " + err;
    if (Number(oldPrice) > 0 && Number(oldPrice) <= Number(price))
        return "Old price must be greater than current price";
    return null;
}

function validateRating(rating) {
    const n = Number(rating);
    if (!Number.isFinite(n)) return "Rating must be a number";
    if (n < 0 || n > 5) return "Rating must be between 0 and 5";
    return null;
}

function validateImage(img) {
    if (!img || typeof img !== "string") return "Image is required";
    if (img.length > 5_000_000) return "Image is too large (max 5MB)";
    if (URL_REGEX.test(img) || DATA_URL_REGEX.test(img)) return null;
    return "Image must be a valid URL or uploaded file";
}

function validateCategoryIcon(icon) {
    if (!icon) return null;
    if (icon.length > 16) return "Emoji icon is too long";
    return null;
}

function validateCategoryName(name) {
    if (!name) return "Category name is required";
    const trimmed = name.trim();
    if (trimmed.length < 2) return "Category name must be at least 2 characters";
    if (trimmed.length > 60) return "Category name too long";
    if (!CATEGORY_NAME_REGEX.test(trimmed))
        return "Category name can only contain letters and spaces";
    return null;
}

function validateCalories(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "Calories must be a number";
    if (v < 0) return "Calories cannot be negative";
    return null;
}

function validateReviews(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "Reviews must be a number";
    if (v < 0) return "Reviews cannot be negative";
    return null;
}

module.exports = {
    validateProductName,
    validateDescription,
    validatePrice,
    validateOldPrice,
    validateRating,
    validateImage,
    validateCategoryIcon,
    validateCategoryName,
    validateCalories,
    validateReviews,
};