const serverless = require("serverless-http");
const express = require("express");
const app = require("../../src/app");

// Create a wrapper Express app to fix path stripping
const netlifyApp = express();

netlifyApp.use((req, res, next) => {
    // If Netlify strips the /api prefix, add it back so Express routes match
    if (req.url.startsWith("/api") === false) {
        req.url = "/api" + req.url;
    }
    next();
});

netlifyApp.use(app);

module.exports.handler = serverless(netlifyApp);