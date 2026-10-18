const { cloudinary } = require('../config/cloudinary');

function getManagedProductImagePublicId(imageUrl) {
  if (typeof imageUrl !== 'string' || !imageUrl) {
    return null;
  }

  try {
    const url = new URL(imageUrl);
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (
      url.hostname !== 'res.cloudinary.com' ||
      segments[1] !== 'image' ||
      segments[2] !== 'upload'
    ) {
      return null;
    }

    const uploadIndex = segments.indexOf('upload');
    const uploadedPath = segments.slice(uploadIndex + 1);
    const versionIndex = uploadedPath.findIndex((segment) => /^v\d+$/.test(segment));
    const folderIndex = uploadedPath.indexOf('vutech_products');
    const publicPath = versionIndex >= 0
      ? uploadedPath.slice(versionIndex + 1)
      : folderIndex >= 0
        ? uploadedPath.slice(folderIndex)
        : [];

    if (!publicPath.length || publicPath[0] !== 'vutech_products') {
      return null;
    }

    const lastSegment = publicPath[publicPath.length - 1];
    publicPath[publicPath.length - 1] = lastSegment.replace(/\.(jpe?g|png|webp|gif)$/i, '');
    const publicId = publicPath.join('/');

    if (publicPath.some((segment) =>
      !segment || segment === '.' || segment === '..' || segment.includes('/')
    )) {
      return null;
    }

    return publicId;
  } catch {
    return null;
  }
}

async function deleteProductImage(imageUrl) {
  const publicId = getManagedProductImagePublicId(imageUrl);
  if (!publicId) {
    return null;
  }

  const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  return result.result;
}

module.exports = { deleteProductImage, getManagedProductImagePublicId };
