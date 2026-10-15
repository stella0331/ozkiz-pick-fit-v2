// Product images are only for reference, so the app shows small, light copies
// ("thumbs/<id>") instead of the full-size originals. If the image library is
// missing or fails for any reason, makeThumb returns null and callers simply
// keep using the original image — nothing breaks.
const THUMB_PREFIX = "thumbs/";
const MAX_W = 360;
const MAX_H = 480;
const QUALITY = 55;

let sharpLib; // undefined = not tried yet, null = unavailable
function getSharp() {
  if (sharpLib === undefined) {
    try {
      sharpLib = require("sharp");
    } catch (err) {
      console.error("thumb: sharp unavailable —", err.message);
      sharpLib = null;
    }
  }
  return sharpLib;
}

async function makeThumb(bytes) {
  const sharp = getSharp();
  if (!sharp) return null;
  try {
    return await sharp(bytes, { failOn: "none" })
      .rotate() // respect the camera's orientation flag
      .resize({ width: MAX_W, height: MAX_H, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }) // transparent PNGs become white, as on the board
      .jpeg({ quality: QUALITY })
      .toBuffer();
  } catch (err) {
    console.error("thumb: resize failed —", err.message);
    return null;
  }
}

module.exports = { THUMB_PREFIX, makeThumb };
