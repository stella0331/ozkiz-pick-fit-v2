const { wrap } = require("../lib/vercel-adapter");
module.exports = wrap(require("../netlify/functions/sync-products").handler);
