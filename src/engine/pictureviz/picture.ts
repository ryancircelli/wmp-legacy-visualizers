// The picture input the Picture Viz family shares. The DLLs list a photo folder (FindFirstFileA over
// *.tga, *.jpg, *.png, *.bmp, *.tif, *.exif in that order, each in the file system's name order) and load
// each file with GDI+; in this app the "folder" is the playing song's cover art (and its Canvas still where
// there is one), decoded by the browser. A port takes the decoded pixels in the order the DLL would have
// listed the files, and does its own GDI+ scaling step (gdip.ts) on them exactly as the DLL does.

/** One decoded picture: opaque RGB, 3 bytes a pixel, top-down rows, no padding (w * h * 3 bytes). */
export interface Picture {
  w: number;
  h: number;
  rgb: Uint8Array;
}

/** RGBA (ImageData's layout) to a Picture; alpha is dropped (album art is opaque). */
export function pictureFromRGBA(w: number, h: number, rgba: Uint8Array | Uint8ClampedArray): Picture {
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  return { w, h, rgb };
}

/** A picture from an image address (the cover art's, a Canvas still's), decoded by the browser. */
export async function loadPicture(url: string): Promise<Picture> {
  const r = await fetch(url);
  if (!r.ok) throw new Error('picture: HTTP ' + r.status);
  const bmp = await createImageBitmap(await r.blob());
  const { width: w, height: h } = bmp;
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const x = c.getContext('2d');
  if (!x) throw new Error('picture: no 2d context');
  x.drawImage(bmp, 0, 0);
  bmp.close();
  return pictureFromRGBA(w, h, x.getImageData(0, 0, w, h).data);
}
