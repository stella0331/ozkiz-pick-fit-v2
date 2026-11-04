// Every other API route (boards, shoots, products, …) is served by this one file: it looks up
// netlify/functions/<name>.js and runs its handler. Routes that need special settings have their
// own file next to this one (ai-start.js, image-proxy.js, …) and take priority.
const path = require("path");
const { wrap } = require("../lib/vercel-adapter");

module.exports = async (req, res) => {
  const name = decodeURIComponent(new URL(req.url, "https://x").pathname.split("/").filter(Boolean).pop() || "");
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name) || name === "ai-run-background") {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "없는 주소예요." }));
  }
  let mod;
  try {
    mod = require(path.join(__dirname, "..", "netlify", "functions", name + ".js"));
  } catch (err) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "없는 주소예요: " + name }));
  }
  return wrap(mod.handler)(req, res);
};
