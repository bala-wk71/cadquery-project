"""Decode a base64-encoded PNG data-URL from a browser ``<canvas>`` element.

The client calls ``canvas.toDataURL("image/png")`` and sends the resulting
string to the server.  This module strips the ``data:image/png;base64,``
prefix and decodes the payload into raw PNG bytes.
"""

from __future__ import annotations

import base64
import re


def decode_png_data_url(data_url: str) -> bytes:
    """Decode a ``data:image/png;base64,...`` string into PNG bytes.

    Parameters
    ----------
    data_url:
        The full data-URL string as returned by ``canvas.toDataURL()``.

    Returns
    -------
    bytes
        The decoded PNG image data.

    Raises
    ------
    ValueError
        If *data_url* is not a valid ``data:`` URI with a base64 payload.
    """
    if not data_url:
        raise ValueError("Empty data URL")

    # Accept both the strict form and a bare base64 string.
    match = re.match(
        r"^data:(?P<mime>[^;]+);base64,(?P<payload>.+)$",
        data_url,
        re.DOTALL,
    )

    if match:
        payload = match.group("payload")
    else:
        # Fall back: treat the whole string as raw base64.
        payload = data_url

    try:
        return base64.b64decode(payload)
    except Exception as exc:
        raise ValueError(f"Failed to decode base64 payload: {exc}") from exc
