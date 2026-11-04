// Lets the existing "Netlify-style" handlers (exports.handler = async (event) => ({statusCode, headers, body}))
// run unchanged as Vercel functions. Vercel passes a Node request/response; this converts
// them to the event object the handlers expect, and writes the handler's result back.
async function readBody(req) {
  // Vercel may already have parsed the body (JSON → object); otherwise read the raw stream.
  try {
    const b = req.body;
    if (b !== undefined && b !== null && b !== "") {
      if (typeof b === "string") return b;
      if (Buffer.isBuffer(b)) return b.toString("utf8");
      return JSON.stringify(b);
    }
  } catch (_) {
    /* fall through to the stream */
  }
  if (req.readableEnded || req.complete === true && req.readable === false) return "";
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function toEvent(req, body) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const query = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });
  return {
    httpMethod: req.method,
    headers: req.headers, // already lower-case
    queryStringParameters: query,
    path: url.pathname,
    rawUrl: url.toString(),
    body: body || null,
    isBase64Encoded: false,
  };
}

function wrap(handler) {
  return async function vercelHandler(req, res) {
    try {
      const body = ["GET", "HEAD"].includes(req.method) ? "" : await readBody(req);
      const out = await handler(toEvent(req, body), {});
      if (!out) {
        res.statusCode = 202;
        return res.end();
      }
      res.statusCode = out.statusCode || 200;
      Object.entries(out.headers || {}).forEach(([k, v]) => res.setHeader(k, v));
      Object.entries(out.multiValueHeaders || {}).forEach(([k, v]) => res.setHeader(k, v));
      const payload = out.isBase64Encoded ? Buffer.from(out.body || "", "base64") : out.body || "";
      return res.end(payload);
    } catch (err) {
      console.error("function failed:", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: String((err && err.message) || err) }));
    }
  };
}

module.exports = { wrap };
