import { useEffect, useState } from "react";
import defaultAvatar from "../assets/default_user.jpg";

// Pictures already fetched in this tab: "userId:version" -> local URL
const cache = new Map();

// A user's profile picture, or the default one. `version` changes whenever the picture
// changes (null = no picture), so a new picture shows straight away everywhere.
export default function Avatar({ api, userId, version, className, alt = "" }) {
  const key = userId && version ? `${userId}:${version}` : null;
  const [url, setUrl] = useState(() => (key && cache.get(key)) || null);

  useEffect(() => {
    if (!key || !api?.avatarBlob) {
      setUrl(null);
      return;
    }
    if (cache.has(key)) {
      setUrl(cache.get(key));
      return;
    }
    let live = true;
    api.avatarBlob(userId, version).then(
      (blob) => {
        if (!blob) return;
        const local = URL.createObjectURL(blob);
        cache.set(key, local);
        if (live) setUrl(local);
      },
      () => {}
    );
    return () => {
      live = false;
    };
  }, [api, key]); // eslint-disable-line react-hooks/exhaustive-deps

  return <img src={url || defaultAvatar} alt={alt} className={className} />;
}

// Crops a chosen photo to the middle square and shrinks it to size x size JPEG (about 30 KB),
// so uploads are small and every picture looks the same in its circle.
export async function squarePhoto(file, size = 256) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("That file isn't a picture this browser can read. Try a JPEG or PNG.");
  }
  const side = Math.min(source.width, source.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PNGs get a white background
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side, 0, 0, size, size);
  source.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the picture."))), "image/jpeg", 0.85)
  );
}
