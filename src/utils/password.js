const bcrypt = require("bcryptjs");

const hashPassword = (pw) => bcrypt.hash(pw, 12);
const comparePassword = (pw, hash) => bcrypt.compare(pw, hash);

module.exports = { hashPassword, comparePassword };