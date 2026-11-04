const { wrap } = require("../lib/vercel-adapter");
module.exports = wrap(require("../netlify/functions/ai-start").handler);
