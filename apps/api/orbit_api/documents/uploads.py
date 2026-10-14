"""Shared upload and untrusted-text boundaries, including architecture/code workspaces."""
import io
import re

from PIL import Image, UnidentifiedImageError

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
_INVISIBLE = re.compile(r"[\u200b-\u200f\ufeff\x00]")


def sanitize_text(text: str) -> str:
    return _INVISIBLE.sub("", text).replace("\r\n", "\n")


def validate_image(data: bytes, content_type: str | None = None) -> str:
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("Image is too large (max 5 MB)")
    if not (data.startswith(b"\x89PNG\r\n\x1a\n") or data.startswith(b"\xff\xd8\xff")):
        raise ValueError("Upload a PNG or JPEG image")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS or image.format not in {"PNG", "JPEG"}:
                raise ValueError("Image dimensions or format are unsupported")
            media = "image/png" if image.format == "PNG" else "image/jpeg"
            if content_type and content_type.split(";", 1)[0].strip() not in {media, "application/octet-stream"}:
                raise ValueError("Image content does not match its MIME type")
            image.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as e:
        raise ValueError("Image is malformed or too large to decode safely") from e
    return media
