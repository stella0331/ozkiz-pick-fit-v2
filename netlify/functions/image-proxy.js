const { retrievePage, getFileUrl, NotionRateLimitError } = require("./_notion");

const FALLBACK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#f0e9dd"/></svg>';

function fallbackResponse() {
  return {
    statusCode: 200,
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" },
    body: FALLBACK_SVG,
  };
}

exports.handler = async (event) => {
  const id = event.queryStringParameters?.id;
  if (!id) return fallbackResponse();
  try {
    const page = await retrievePage(id);
    const url = getFileUrl(page, "대표이미지");
    if (!url) return fallbackResponse();
    return {
      statusCode: 302,
      headers: { Location: url, "Cache-Control": "no-store" },
      body: "",
    };
  } catch (err) {
    // Includes NotionRateLimitError — an occasional missed image is far
    // better than the whole board erroring out.
    return fallbackResponse();
  }
};
