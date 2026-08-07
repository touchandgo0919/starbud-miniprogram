const BRAND_NAME = "星星芽AI助手";
const SHARE_IMAGE_URL = "/assets/starbud-share.png";

function buildSharePayload(section, path) {
  return {
    title: `${BRAND_NAME} · ${section}`,
    imageUrl: SHARE_IMAGE_URL,
    ...(path ? { path } : {})
  };
}

module.exports = {
  BRAND_NAME,
  SHARE_IMAGE_URL,
  buildSharePayload
};
