"""Flask entry point for the parametric 2D sketcher application."""

import json
import os
import traceback
from io import BytesIO
from pathlib import Path

from flask import (
    Flask,
    jsonify,
    render_template,
    request,
    send_file,
)

from solver.sketch_model import Sketch
from solver.constraint_solver import solve
from export.svg_export import export_svg
from export.dxf_export import export_dxf
from export.png_export import decode_png_data_url

app = Flask(__name__)

SAVES_DIR = Path(__file__).parent / "saves"
SAVES_DIR.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# CORS helper – attach headers to every response
# ---------------------------------------------------------------------------
@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    """Serve the main sketcher UI."""
    return render_template("index.html")


@app.route("/api/solve", methods=["POST"])
def api_solve():
    """Accept JSON sketch data, run the constraint solver, return updated positions.

    Expects JSON body: ``{"entities": [...], "constraints": [...]}``
    Returns JSON body: ``{"entities": [...], "constraints": [...]}``
    """
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid or missing JSON body"}), 400

    try:
        sketch = Sketch.from_dict(data)
        solved_sketch = solve(sketch)
        return jsonify(solved_sketch.to_dict())
    except Exception as exc:
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500


@app.route("/api/export/svg", methods=["POST"])
def api_export_svg():
    """Accept JSON sketch data and return an SVG file download."""
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid or missing JSON body"}), 400

    try:
        sketch = Sketch.from_dict(data)
        svg_string = export_svg(sketch)
        buf = BytesIO(svg_string.encode("utf-8"))
        buf.seek(0)
        return send_file(
            buf,
            mimetype="image/svg+xml",
            as_attachment=True,
            download_name="sketch.svg",
        )
    except Exception as exc:
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500


@app.route("/api/export/dxf", methods=["POST"])
def api_export_dxf():
    """Accept JSON sketch data and return a DXF file download."""
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid or missing JSON body"}), 400

    try:
        sketch = Sketch.from_dict(data)
        dxf_bytes = export_dxf(sketch)
        buf = BytesIO(dxf_bytes)
        buf.seek(0)
        return send_file(
            buf,
            mimetype="application/dxf",
            as_attachment=True,
            download_name="sketch.dxf",
        )
    except Exception as exc:
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500


@app.route("/api/export/png", methods=["POST"])
def api_export_png():
    """Accept a PNG data-URL from the client canvas and return a PNG file.

    Expects JSON body: ``{"dataUrl": "data:image/png;base64,..."}``
    """
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid or missing JSON body"}), 400

    data_url = data.get("dataUrl") or data.get("data_url")
    if not data_url:
        return jsonify({"error": "Missing 'dataUrl' field"}), 400

    try:
        png_bytes = decode_png_data_url(data_url)
        buf = BytesIO(png_bytes)
        buf.seek(0)
        return send_file(
            buf,
            mimetype="image/png",
            as_attachment=True,
            download_name="sketch.png",
        )
    except Exception as exc:
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500


@app.route("/api/save", methods=["POST"])
def api_save():
    """Save sketch JSON data to a file on the server.

    Expects JSON body: ``{"name": "my_sketch", "sketch": {...}}``
    """
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid or missing JSON body"}), 400

    name = data.get("name")
    sketch_data = data.get("sketch")
    if not name or sketch_data is None:
        return jsonify({"error": "Missing 'name' or 'sketch' field"}), 400

    # Sanitise file name to prevent directory traversal
    safe_name = Path(name).stem
    if not safe_name:
        return jsonify({"error": "Invalid file name"}), 400

    file_path = SAVES_DIR / f"{safe_name}.json"
    try:
        with open(file_path, "w", encoding="utf-8") as fh:
            json.dump(sketch_data, fh, indent=2)
        return jsonify({"status": "ok", "path": str(file_path)})
    except Exception as exc:
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500


@app.route("/api/load", methods=["POST"])
def api_load():
    """Load sketch JSON data from a file on the server.

    Expects JSON body: ``{"name": "my_sketch"}``
    Returns the sketch JSON stored in the file.
    """
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid or missing JSON body"}), 400

    name = data.get("name")
    if not name:
        return jsonify({"error": "Missing 'name' field"}), 400

    safe_name = Path(name).stem
    if not safe_name:
        return jsonify({"error": "Invalid file name"}), 400

    file_path = SAVES_DIR / f"{safe_name}.json"
    if not file_path.is_file():
        return jsonify({"error": f"File not found: {safe_name}.json"}), 404

    try:
        with open(file_path, "r", encoding="utf-8") as fh:
            sketch_data = json.load(fh)
        return jsonify(sketch_data)
    except Exception as exc:
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
