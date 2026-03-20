/**
 * export.js — Client-side export helpers for the parametric 2D sketcher.
 * Provides file export (SVG, DXF, PNG), sketch save/load, and JSON
 * serialization utilities.
 *
 * Exports: ExportManager (attached to window)
 */
(function () {
  "use strict";

  // ───────────────────────── helpers ─────────────────────────

  /**
   * Update the status bar message element.
   * @param {string} message
   * @param {string} [level]  "info" | "success" | "error"
   */
  function setStatus(message, level) {
    var el = document.getElementById("status-tool");
    if (!el) return;
    var span = el.querySelector("#active-tool-name");
    if (span) {
      span.textContent = message;
      span.style.color =
        level === "error"
          ? "#f44747"
          : level === "success"
          ? "#3ec43e"
          : "";
      // Reset colour after a delay
      if (level) {
        setTimeout(function () {
          span.style.color = "";
        }, 3000);
      }
    }
  }

  // ───────────────────────── ExportManager ─────────────────────────

  class ExportManager {
    constructor() {}

    // ──────────── file download helper ────────────

    /**
     * Trigger a browser file download from a Blob.
     * @param {Blob}   blob
     * @param {string} filename
     */
    downloadFile(blob, filename) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      // Clean up
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    }

    // ──────────── SVG export ────────────

    /**
     * Export the sketch as SVG by sending data to the backend.
     * @param {Object} sketch  Sketch data object
     */
    exportSVG(sketch) {
      var self = this;
      setStatus("Exporting SVG...");

      fetch("/api/export/svg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sketch),
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("Server responded with status " + response.status);
          }
          return response.blob();
        })
        .then(function (blob) {
          self.downloadFile(blob, "sketch.svg");
          setStatus("SVG exported", "success");
        })
        .catch(function (err) {
          console.error("SVG export failed:", err);
          setStatus("SVG export failed: " + err.message, "error");
        });
    }

    // ──────────── DXF export ────────────

    /**
     * Export the sketch as DXF by sending data to the backend.
     * @param {Object} sketch  Sketch data object
     */
    exportDXF(sketch) {
      var self = this;
      setStatus("Exporting DXF...");

      fetch("/api/export/dxf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sketch),
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("Server responded with status " + response.status);
          }
          return response.blob();
        })
        .then(function (blob) {
          self.downloadFile(blob, "sketch.dxf");
          setStatus("DXF exported", "success");
        })
        .catch(function (err) {
          console.error("DXF export failed:", err);
          setStatus("DXF export failed: " + err.message, "error");
        });
    }

    // ──────────── PNG export ────────────

    /**
     * Export the canvas as a PNG image.
     * Captures the canvas as a data URL, sends it to the backend for
     * processing, and triggers a download.
     * @param {HTMLCanvasElement} canvas
     */
    exportPNG(canvas) {
      var self = this;
      setStatus("Exporting PNG...");

      try {
        var dataURL = canvas.toDataURL("image/png");

        fetch("/api/export/png", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataURL }),
        })
          .then(function (response) {
            if (!response.ok) {
              throw new Error(
                "Server responded with status " + response.status
              );
            }
            return response.blob();
          })
          .then(function (blob) {
            self.downloadFile(blob, "sketch.png");
            setStatus("PNG exported", "success");
          })
          .catch(function (err) {
            console.error("PNG export failed:", err);
            setStatus("PNG export failed: " + err.message, "error");
          });
      } catch (err) {
        console.error("PNG capture failed:", err);
        setStatus("PNG capture failed: " + err.message, "error");
      }
    }

    // ──────────── sketch save ────────────

    /**
     * Save the sketch to the backend.
     * @param {Object} sketch  Sketch data object
     * @param {string} name    Name / identifier for the saved sketch
     * @returns {Promise<boolean>}  Resolves true on success
     */
    saveSketch(sketch, name) {
      setStatus("Saving sketch...");

      return fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, sketch: sketch }),
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("Server responded with status " + response.status);
          }
          return response.json();
        })
        .then(function () {
          setStatus('Sketch "' + name + '" saved', "success");
          return true;
        })
        .catch(function (err) {
          console.error("Save failed:", err);
          setStatus("Save failed: " + err.message, "error");
          return false;
        });
    }

    // ──────────── sketch load ────────────

    /**
     * Load a sketch from the backend by name.
     * @param {string} name  Name / identifier for the sketch to load
     * @returns {Promise<Object|null>}  Resolves with sketch data or null on error
     */
    loadSketch(name) {
      setStatus("Loading sketch...");

      return fetch("/api/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name }),
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("Server responded with status " + response.status);
          }
          return response.json();
        })
        .then(function (data) {
          setStatus('Sketch "' + name + '" loaded', "success");
          return data.sketch || data;
        })
        .catch(function (err) {
          console.error("Load failed:", err);
          setStatus("Load failed: " + err.message, "error");
          return null;
        });
    }

    // ──────────── JSON serialization ────────────

    /**
     * Serialize sketch data to a formatted JSON string.
     * @param {Object} sketch
     * @returns {string}
     */
    getSketchJSON(sketch) {
      return JSON.stringify(sketch, null, 2);
    }

    /**
     * Parse a JSON string back into a sketch data object.
     * Returns null and shows status on error.
     * @param {string} jsonString
     * @returns {Object|null}
     */
    importSketchJSON(jsonString) {
      try {
        var data = JSON.parse(jsonString);

        // Validate basic structure
        if (typeof data !== "object" || data === null) {
          throw new Error("Invalid sketch data: expected an object");
        }

        // Ensure required arrays exist
        if (!Array.isArray(data.entities)) {
          data.entities = [];
        }
        if (!Array.isArray(data.constraints)) {
          data.constraints = [];
        }
        if (!Array.isArray(data.parameters)) {
          data.parameters = [];
        }
        if (!Array.isArray(data.layers)) {
          data.layers = [];
        }

        setStatus("Sketch imported from JSON", "success");
        return data;
      } catch (err) {
        console.error("JSON import failed:", err);
        setStatus("JSON import failed: " + err.message, "error");
        return null;
      }
    }
  }

  // expose globally
  window.ExportManager = ExportManager;
})();
