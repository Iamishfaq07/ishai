"""Screenshots as the model reads them.

The desktop's "Scroll to the end" capture is one image several screens tall. Sent like that, a vision model shrinks it
to fit its own size limit and the problem's text blurs, so a tall image goes as parts of about a screen each, top to
bottom, overlapping a little so no line is cut in half without also appearing whole (the prompt says so:
engine.screenshot_prompt). An ordinary screenshot passes through untouched.
"""

import io
import math

from PIL import Image

from orbit_api.providers.llm.base import LLMImage

# A part is about this many times as tall as it's wide, within these heights: a narrow problem pane still gets a
# readable screen's worth, a wide one isn't sent as a short strip.
PART_RATIO = 1.3
PART_MIN = 900
PART_MAX = 1800
OVERLAP = 48
MAX_PARTS = 8
# Up to this much taller than one part, it stays whole.
SLACK = 1.25


def part_boxes(width: int, height: int) -> list[tuple[int, int]]:
    """(top, bottom) of each part, evenly spaced, the last one ending at the bottom; one box if it isn't tall."""
    part = int(min(PART_MAX, max(PART_MIN, width * PART_RATIO)))
    if height <= part * SLACK:
        return [(0, height)]
    n = math.ceil((height - OVERLAP) / (part - OVERLAP))
    if n > MAX_PARTS:  # very long: fewer, taller parts rather than more of them
        n = MAX_PARTS
        part = math.ceil((height - OVERLAP) / n) + OVERLAP
    step = (height - part) / (n - 1)
    return [(round(i * step), min(height, round(i * step) + part)) for i in range(n)]


def split_tall(image: LLMImage) -> list[LLMImage]:
    """The image as the parts the model gets. CPU work: call it off the event loop."""
    with Image.open(io.BytesIO(image.data)) as im:
        boxes = part_boxes(im.width, im.height)
        if len(boxes) == 1:
            return [image]
        im.load()
        parts = []
        for top, bottom in boxes:
            out = io.BytesIO()
            im.crop((0, top, im.width, bottom)).save(out, format="PNG")
            parts.append(LLMImage(out.getvalue(), "image/png"))
        return parts
