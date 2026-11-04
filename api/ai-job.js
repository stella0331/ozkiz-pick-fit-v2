const { wrap } = require("../lib/vercel-adapter");
module.exports = wrap(require("../netlify/functions/ai-job").handler);
