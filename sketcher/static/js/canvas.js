/**
 * CanvasEngine — Core 2D rendering engine for the parametric sketcher.
 * Manages an HTML5 Canvas with pan/zoom, grid, entity rendering,
 * constraint visualization, dimensions, hit-testing, and selection box.
 */
(function () {
  "use strict";

  // ───────────────────────── helpers ─────────────────────────
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function dist(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pointToSegmentDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return dist(px, py, ax, ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = clamp(t, 0, 1);
    return dist(px, py, ax + t * dx, ay + t * dy);
  }

  // ───────────────────────── styles ─────────────────────────
  const STYLES = {
    normal:       { stroke: "#d4d4d4", lineWidth: 1.5, dash: [] },
    selected:     { stroke: "#007acc", lineWidth: 2.5, dash: [] },
    hovered:      { stroke: "#4db8ff", lineWidth: 2,   dash: [] },
    construction: { stroke: "#e08030", lineWidth: 1,   dash: [6, 4] },
    constrained:  { stroke: "#3ec43e", lineWidth: 1.5, dash: [] },
  };

  const GRID_MAJOR_COLOR = "rgba(255,255,255,0.15)";
  const GRID_MINOR_COLOR = "rgba(255,255,255,0.06)";
  const BACKGROUND       = "#1e1e1e";
  const CROSSHAIR_COLOR  = "rgba(255,255,255,0.3)";
  const SELECTION_BOX     = { stroke: "#007acc", fill: "rgba(0,122,204,0.12)", dash: [5, 3] };

  const CONSTRAINT_SYMBOLS = {
    horizontal:    "H",
    vertical:      "V",
    perpendicular: "\u22A5",
    parallel:      "\u2225",
    tangent:       "T",
    equal:         "=",
    coincident:    "\u00B7",
    concentric:    "\u25CE",
    fixed:         "\u2302",
    symmetric:     "S",
    midpoint:      "M",
  };

  // ───────────────────────── CanvasEngine ─────────────────────────
  class CanvasEngine {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Object} [opts]
     */
    constructor(canvas, opts) {
      opts = opts || {};
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");

      // view transform: screen = world * scale + offset
      this.scale = opts.initialScale || 40;        // pixels per world unit
      this.offsetX = canvas.width / 2;
      this.offsetY = canvas.height / 2;

      // zoom limits
      this.minScale = opts.minScale || 1;
      this.maxScale = opts.maxScale || 5000;

      // grid
      this.gridMajor      = opts.gridMajor || 1;       // world units between major lines
      this.gridSubdivisions = opts.gridSubdivisions || 5;

      // interaction state (written externally or by internal handlers)
      this.mouseScreenX = 0;
      this.mouseScreenY = 0;
      this.selectionBox = null; // {x1,y1,x2,y2} in screen coords or null

      // internal panning state
      this._panning = false;
      this._panStartX = 0;
      this._panStartY = 0;
      this._spaceDown = false;

      this._bindEvents();
    }

    // ──────────── coordinate transforms ────────────

    worldToScreen(wx, wy) {
      return {
        x: wx * this.scale + this.offsetX,
        y: -wy * this.scale + this.offsetY,   // y-up in world, y-down on screen
      };
    }

    screenToWorld(sx, sy) {
      return {
        x: (sx - this.offsetX) / this.scale,
        y: -(sy - this.offsetY) / this.scale,
      };
    }

    // ──────────── pan / zoom events ────────────

    _bindEvents() {
      const c = this.canvas;

      c.addEventListener("wheel", (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const newScale = clamp(this.scale * zoomFactor, this.minScale, this.maxScale);
        // zoom centred on cursor
        const wx = (e.offsetX - this.offsetX) / this.scale;
        const wy = (e.offsetY - this.offsetY) / this.scale;
        this.scale = newScale;
        this.offsetX = e.offsetX - wx * this.scale;
        this.offsetY = e.offsetY - wy * this.scale;
      }, { passive: false });

      c.addEventListener("mousedown", (e) => {
        if (e.button === 1 || (this._spaceDown && e.button === 0)) {
          this._panning = true;
          this._panStartX = e.offsetX - this.offsetX;
          this._panStartY = e.offsetY - this.offsetY;
          e.preventDefault();
        }
      });

      c.addEventListener("mousemove", (e) => {
        this.mouseScreenX = e.offsetX;
        this.mouseScreenY = e.offsetY;
        if (this._panning) {
          this.offsetX = e.offsetX - this._panStartX;
          this.offsetY = e.offsetY - this._panStartY;
        }
      });

      const endPan = () => { this._panning = false; };
      c.addEventListener("mouseup", endPan);
      c.addEventListener("mouseleave", endPan);

      window.addEventListener("keydown", (e) => {
        if (e.code === "Space") { this._spaceDown = true; }
      });
      window.addEventListener("keyup", (e) => {
        if (e.code === "Space") { this._spaceDown = false; this._panning = false; }
      });

      // keep canvas size in sync
      const ro = new ResizeObserver(() => {
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;
      });
      ro.observe(this.canvas);
    }

    // ──────────── fit all ────────────

    fitAll(sketch) {
      if (!sketch || !sketch.entities || sketch.entities.length === 0) {
        this.scale = 40;
        this.offsetX = this.canvas.width / 2;
        this.offsetY = this.canvas.height / 2;
        return;
      }

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      const expand = (x, y) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      };

      for (const e of sketch.entities) {
        this._entityBounds(e, expand);
      }

      if (!isFinite(minX)) return;

      const pad = 40; // screen pixels padding
      const w = maxX - minX || 1;
      const h = maxY - minY || 1;
      this.scale = Math.min(
        (this.canvas.width - pad * 2) / w,
        (this.canvas.height - pad * 2) / h
      );
      this.scale = clamp(this.scale, this.minScale, this.maxScale);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      this.offsetX = this.canvas.width / 2 - cx * this.scale;
      this.offsetY = this.canvas.height / 2 + cy * this.scale;
    }

    _entityBounds(e, expand) {
      switch (e.type) {
        case "point":
          expand(e.x, e.y);
          break;
        case "line":
          expand(e.x1, e.y1);
          expand(e.x2, e.y2);
          break;
        case "circle":
          expand(e.cx - e.r, e.cy - e.r);
          expand(e.cx + e.r, e.cy + e.r);
          break;
        case "arc": {
          expand(e.cx - e.r, e.cy - e.r);
          expand(e.cx + e.r, e.cy + e.r);
          break;
        }
        case "ellipse":
          expand(e.cx - e.rx, e.cy - e.ry);
          expand(e.cx + e.rx, e.cy + e.ry);
          break;
        case "rectangle":
          expand(e.x, e.y);
          expand(e.x + e.width, e.y + e.height);
          break;
        case "polygon":
        case "polyline":
          if (e.points) e.points.forEach((p) => expand(p.x, p.y));
          break;
        case "spline":
          if (e.points) e.points.forEach((p) => expand(p.x, p.y));
          break;
      }
    }

    // ──────────── main render ────────────

    /**
     * @param {Object}   sketch       — { entities, constraints, parameters, layers }
     * @param {Set|Array} selectedIds
     * @param {string|null} hoveredId
     * @param {Object|null} activeTool — optional active-tool state
     */
    render(sketch, selectedIds, hoveredId, activeTool) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;

      selectedIds = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);

      // clear
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, W, H);

      // grid
      this._drawGrid(ctx, W, H);

      // origin axes
      this._drawOriginAxes(ctx, W, H);

      if (sketch) {
        // entities
        const entities = sketch.entities || [];
        for (const e of entities) {
          const style = this._resolveStyle(e, selectedIds, hoveredId);
          this._drawEntity(ctx, e, style);
        }

        // constraints
        const constraints = sketch.constraints || [];
        for (const c of constraints) {
          this._drawConstraint(ctx, c, entities);
        }
      }

      // selection box
      if (this.selectionBox) {
        this._drawSelectionBox(ctx);
      }

      // crosshair + coordinate readout
      this._drawCrosshair(ctx, W, H);
    }

    // ──────────── grid ────────────

    _drawGrid(ctx, W, H) {
      // choose grid spacing that keeps major lines roughly 60-200 px apart
      let major = this.gridMajor;
      const minPx = 60;
      const maxPx = 200;
      while (major * this.scale < minPx) major *= (major >= 1 ? 5 : 2);
      while (major * this.scale > maxPx) major /= (major > 1 ? 5 : 2);
      if (major <= 0) major = 1;

      const minor = major / this.gridSubdivisions;
      const topLeft = this.screenToWorld(0, 0);
      const botRight = this.screenToWorld(W, H);

      const startX = Math.floor(Math.min(topLeft.x, botRight.x) / minor) * minor;
      const endX   = Math.ceil(Math.max(topLeft.x, botRight.x) / minor) * minor;
      const startY = Math.floor(Math.min(topLeft.y, botRight.y) / minor) * minor;
      const endY   = Math.ceil(Math.max(topLeft.y, botRight.y) / minor) * minor;

      ctx.lineWidth = 1;
      for (let x = startX; x <= endX; x += minor) {
        const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-9;
        ctx.strokeStyle = isMajor ? GRID_MAJOR_COLOR : GRID_MINOR_COLOR;
        const sx = this.worldToScreen(x, 0).x;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, H);
        ctx.stroke();
      }
      for (let y = startY; y <= endY; y += minor) {
        const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-9;
        ctx.strokeStyle = isMajor ? GRID_MAJOR_COLOR : GRID_MINOR_COLOR;
        const sy = this.worldToScreen(0, y).y;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(W, sy);
        ctx.stroke();
      }
    }

    // ──────────── origin axes ────────────

    _drawOriginAxes(ctx, W, H) {
      const o = this.worldToScreen(0, 0);
      ctx.lineWidth = 1;

      // X axis (red)
      ctx.strokeStyle = "rgba(220,60,60,0.6)";
      ctx.beginPath();
      ctx.moveTo(0, o.y);
      ctx.lineTo(W, o.y);
      ctx.stroke();

      // Y axis (green)
      ctx.strokeStyle = "rgba(60,180,60,0.6)";
      ctx.beginPath();
      ctx.moveTo(o.x, 0);
      ctx.lineTo(o.x, H);
      ctx.stroke();
    }

    // ──────────── style resolution ────────────

    _resolveStyle(entity, selectedIds, hoveredId) {
      if (entity.construction) return "construction";
      if (selectedIds.has(entity.id)) return "selected";
      if (entity.id === hoveredId) return "hovered";
      if (entity.constrained) return "constrained";
      return "normal";
    }

    _applyStyle(ctx, styleName) {
      const s = STYLES[styleName] || STYLES.normal;
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = s.lineWidth;
      ctx.setLineDash(s.dash);
    }

    // ──────────── entity drawing ────────────

    _drawEntity(ctx, e, styleName) {
      ctx.save();
      this._applyStyle(ctx, styleName);

      switch (e.type) {
        case "point":    this._drawPoint(ctx, e, styleName); break;
        case "line":     this._drawLine(ctx, e); break;
        case "circle":   this._drawCircle(ctx, e); break;
        case "arc":      this._drawArc(ctx, e); break;
        case "ellipse":  this._drawEllipse(ctx, e); break;
        case "rectangle":this._drawRectangle(ctx, e); break;
        case "polygon":  this._drawPolygon(ctx, e); break;
        case "polyline": this._drawPolyline(ctx, e); break;
        case "spline":   this._drawSpline(ctx, e); break;
      }

      ctx.restore();
    }

    _drawPoint(ctx, e, styleName) {
      const s = this.worldToScreen(e.x, e.y);
      const sz = 4;
      const color = (STYLES[styleName] || STYLES.normal).stroke;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(s.x - sz, s.y - sz);
      ctx.lineTo(s.x + sz, s.y + sz);
      ctx.moveTo(s.x + sz, s.y - sz);
      ctx.lineTo(s.x - sz, s.y + sz);
      ctx.stroke();
    }

    _drawLine(ctx, e) {
      const a = this.worldToScreen(e.x1, e.y1);
      const b = this.worldToScreen(e.x2, e.y2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    _drawCircle(ctx, e) {
      const c = this.worldToScreen(e.cx, e.cy);
      const r = e.r * this.scale;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    _drawArc(ctx, e) {
      const c = this.worldToScreen(e.cx, e.cy);
      const r = e.r * this.scale;
      // angles: world y-up => screen y-down means angles negate
      const startAngle = -e.endAngle;
      const endAngle = -e.startAngle;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, startAngle, endAngle);
      ctx.stroke();
    }

    _drawEllipse(ctx, e) {
      const c = this.worldToScreen(e.cx, e.cy);
      const rx = e.rx * this.scale;
      const ry = e.ry * this.scale;
      const rot = -(e.rotation || 0);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rx, ry, rot, 0, Math.PI * 2);
      ctx.stroke();
    }

    _drawRectangle(ctx, e) {
      const a = this.worldToScreen(e.x, e.y);
      const b = this.worldToScreen(e.x + e.width, e.y + e.height);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      ctx.strokeRect(x, y, w, h);
    }

    _drawPolygon(ctx, e) {
      if (!e.points || e.points.length < 2) return;
      ctx.beginPath();
      const s0 = this.worldToScreen(e.points[0].x, e.points[0].y);
      ctx.moveTo(s0.x, s0.y);
      for (let i = 1; i < e.points.length; i++) {
        const s = this.worldToScreen(e.points[i].x, e.points[i].y);
        ctx.lineTo(s.x, s.y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    _drawPolyline(ctx, e) {
      if (!e.points || e.points.length < 2) return;
      ctx.beginPath();
      const s0 = this.worldToScreen(e.points[0].x, e.points[0].y);
      ctx.moveTo(s0.x, s0.y);
      for (let i = 1; i < e.points.length; i++) {
        const s = this.worldToScreen(e.points[i].x, e.points[i].y);
        ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
    }

    _drawSpline(ctx, e) {
      // approximate spline through control points using Catmull-Rom
      if (!e.points || e.points.length < 2) return;
      const pts = e.points;
      const steps = 20; // segments between each pair

      ctx.beginPath();
      const s0 = this.worldToScreen(pts[0].x, pts[0].y);
      ctx.moveTo(s0.x, s0.y);

      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(i - 1, 0)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(i + 2, pts.length - 1)];

        for (let t = 1; t <= steps; t++) {
          const f = t / steps;
          const f2 = f * f;
          const f3 = f2 * f;
          const wx = 0.5 * (
            (2 * p1.x) +
            (-p0.x + p2.x) * f +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3
          );
          const wy = 0.5 * (
            (2 * p1.y) +
            (-p0.y + p2.y) * f +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f3
          );
          const s = this.worldToScreen(wx, wy);
          ctx.lineTo(s.x, s.y);
        }
      }
      ctx.stroke();
    }

    // ──────────── constraint visualization ────────────

    _drawConstraint(ctx, c, entities) {
      const symbol = CONSTRAINT_SYMBOLS[c.type] || "?";

      // find position: use first referenced entity's midpoint
      let wx = 0, wy = 0;
      if (c.entityIds && c.entityIds.length > 0) {
        const ent = entities.find((e) => e.id === c.entityIds[0]);
        if (ent) {
          const mid = this._entityMidpoint(ent);
          wx = mid.x;
          wy = mid.y;
        }
      } else if (c.x !== undefined && c.y !== undefined) {
        wx = c.x;
        wy = c.y;
      }

      const s = this.worldToScreen(wx, wy);
      // offset slightly so it doesn't overlap the entity
      const ox = 10;
      const oy = -10;

      ctx.save();
      ctx.font = "bold 11px monospace";
      ctx.fillStyle = "#3ec43e";
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 3;
      ctx.strokeText(symbol, s.x + ox, s.y + oy);
      ctx.fillText(symbol, s.x + ox, s.y + oy);
      ctx.restore();
    }

    _entityMidpoint(e) {
      switch (e.type) {
        case "point":    return { x: e.x, y: e.y };
        case "line":     return { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
        case "circle":   return { x: e.cx, y: e.cy };
        case "arc":      return { x: e.cx, y: e.cy };
        case "ellipse":  return { x: e.cx, y: e.cy };
        case "rectangle":return { x: e.x + e.width / 2, y: e.y + e.height / 2 };
        default:
          if (e.points && e.points.length) {
            const mid = Math.floor(e.points.length / 2);
            return { x: e.points[mid].x, y: e.points[mid].y };
          }
          return { x: 0, y: 0 };
      }
    }

    // ──────────── dimension rendering ────────────

    /**
     * Draw a linear distance dimension between two world points.
     */
    drawDistanceDimension(ctx, wx1, wy1, wx2, wy2, offset) {
      offset = offset || 20;
      const a = this.worldToScreen(wx1, wy1);
      const b = this.worldToScreen(wx2, wy2);
      const d = dist(wx1, wy1, wx2, wy2);

      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const nx = Math.cos(angle + Math.PI / 2) * offset;
      const ny = Math.sin(angle + Math.PI / 2) * offset;

      const a2 = { x: a.x + nx, y: a.y + ny };
      const b2 = { x: b.x + nx, y: b.y + ny };

      ctx.save();
      ctx.strokeStyle = "#ccc";
      ctx.fillStyle = "#ccc";
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.font = "12px sans-serif";

      // extension lines
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(a2.x, a2.y);
      ctx.moveTo(b.x, b.y); ctx.lineTo(b2.x, b2.y);
      ctx.stroke();

      // dimension line with arrows
      ctx.beginPath();
      ctx.moveTo(a2.x, a2.y);
      ctx.lineTo(b2.x, b2.y);
      ctx.stroke();

      this._drawArrowhead(ctx, a2.x, a2.y, angle);
      this._drawArrowhead(ctx, b2.x, b2.y, angle + Math.PI);

      // text
      const mx = (a2.x + b2.x) / 2;
      const my = (a2.y + b2.y) / 2;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(d.toFixed(2), mx, my - 3);
      ctx.restore();
    }

    /**
     * Draw an angle dimension at a vertex.
     */
    drawAngleDimension(ctx, cx, cy, startAngle, endAngle, radius) {
      radius = radius || 30;
      const c = this.worldToScreen(cx, cy);

      ctx.save();
      ctx.strokeStyle = "#ccc";
      ctx.fillStyle = "#ccc";
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.font = "12px sans-serif";

      const sa = -startAngle;
      const ea = -endAngle;

      ctx.beginPath();
      ctx.arc(c.x, c.y, radius, sa, ea, ea < sa);
      ctx.stroke();

      const angleDeg = Math.abs(endAngle - startAngle) * (180 / Math.PI);
      const midA = (sa + ea) / 2;
      const tx = c.x + (radius + 12) * Math.cos(midA);
      const ty = c.y + (radius + 12) * Math.sin(midA);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(angleDeg.toFixed(1) + "\u00B0", tx, ty);
      ctx.restore();
    }

    /**
     * Draw a radius dimension on a circle/arc.
     */
    drawRadiusDimension(ctx, cx, cy, r, angle) {
      angle = angle || Math.PI / 4;
      const c = this.worldToScreen(cx, cy);
      const rPx = r * this.scale;

      const ex = c.x + rPx * Math.cos(angle);
      const ey = c.y - rPx * Math.sin(angle);

      ctx.save();
      ctx.strokeStyle = "#ccc";
      ctx.fillStyle = "#ccc";
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.font = "12px sans-serif";

      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      this._drawArrowhead(ctx, ex, ey, Math.atan2(ey - c.y, ex - c.x) + Math.PI);

      const mx = (c.x + ex) / 2;
      const my = (c.y + ey) / 2;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("R" + r.toFixed(2), mx, my - 3);
      ctx.restore();
    }

    _drawArrowhead(ctx, x, y, angle) {
      const len = 8;
      const half = Math.PI / 7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len * Math.cos(angle + half), y + len * Math.sin(angle + half));
      ctx.lineTo(x + len * Math.cos(angle - half), y + len * Math.sin(angle - half));
      ctx.closePath();
      ctx.fill();
    }

    // ──────────── selection box ────────────

    _drawSelectionBox(ctx) {
      const b = this.selectionBox;
      ctx.save();
      ctx.strokeStyle = SELECTION_BOX.stroke;
      ctx.fillStyle = SELECTION_BOX.fill;
      ctx.lineWidth = 1;
      ctx.setLineDash(SELECTION_BOX.dash);
      const x = Math.min(b.x1, b.x2);
      const y = Math.min(b.y1, b.y2);
      const w = Math.abs(b.x2 - b.x1);
      const h = Math.abs(b.y2 - b.y1);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }

    // ──────────── crosshair + readout ────────────

    _drawCrosshair(ctx, W, H) {
      const mx = this.mouseScreenX;
      const my = this.mouseScreenY;

      ctx.save();
      ctx.strokeStyle = CROSSHAIR_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(mx, 0); ctx.lineTo(mx, H);
      ctx.moveTo(0, my); ctx.lineTo(W, my);
      ctx.stroke();

      const world = this.screenToWorld(mx, my);
      ctx.setLineDash([]);
      ctx.font = "11px monospace";
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(
        "(" + world.x.toFixed(2) + ", " + world.y.toFixed(2) + ")",
        mx + 12,
        my + 8
      );
      ctx.restore();
    }

    // ──────────── hit testing ────────────

    /**
     * Returns the id of the entity closest to (screenX, screenY) within
     * `tolerance` screen-pixels, or null.
     */
    hitTest(screenX, screenY, entities, tolerance) {
      tolerance = tolerance || 6;
      const w = this.screenToWorld(screenX, screenY);
      const tolWorld = tolerance / this.scale;

      let bestDist = Infinity;
      let bestId = null;

      for (const e of entities) {
        const d = this._entityDistance(w.x, w.y, e);
        if (d < tolWorld && d < bestDist) {
          bestDist = d;
          bestId = e.id;
        }
      }

      return bestId;
    }

    _entityDistance(px, py, e) {
      switch (e.type) {
        case "point":
          return dist(px, py, e.x, e.y);

        case "line":
          return pointToSegmentDist(px, py, e.x1, e.y1, e.x2, e.y2);

        case "circle": {
          const dc = dist(px, py, e.cx, e.cy);
          return Math.abs(dc - e.r);
        }

        case "arc": {
          const dc = dist(px, py, e.cx, e.cy);
          const angle = Math.atan2(py - e.cy, px - e.cx);
          const inArc = this._angleInRange(angle, e.startAngle, e.endAngle);
          if (inArc) return Math.abs(dc - e.r);
          // otherwise distance to endpoints
          const p1x = e.cx + e.r * Math.cos(e.startAngle);
          const p1y = e.cy + e.r * Math.sin(e.startAngle);
          const p2x = e.cx + e.r * Math.cos(e.endAngle);
          const p2y = e.cy + e.r * Math.sin(e.endAngle);
          return Math.min(dist(px, py, p1x, p1y), dist(px, py, p2x, p2y));
        }

        case "ellipse": {
          // approximate: normalize point into unit circle space
          const rot = e.rotation || 0;
          const dx = px - e.cx;
          const dy = py - e.cy;
          const cosR = Math.cos(-rot);
          const sinR = Math.sin(-rot);
          const lx = (dx * cosR - dy * sinR) / e.rx;
          const ly = (dx * sinR + dy * cosR) / e.ry;
          const d = Math.sqrt(lx * lx + ly * ly);
          return Math.abs(d - 1) * Math.min(e.rx, e.ry);
        }

        case "rectangle": {
          const sides = [
            { x1: e.x, y1: e.y, x2: e.x + e.width, y2: e.y },
            { x1: e.x + e.width, y1: e.y, x2: e.x + e.width, y2: e.y + e.height },
            { x1: e.x + e.width, y1: e.y + e.height, x2: e.x, y2: e.y + e.height },
            { x1: e.x, y1: e.y + e.height, x2: e.x, y2: e.y },
          ];
          let minD = Infinity;
          for (const s of sides) {
            minD = Math.min(minD, pointToSegmentDist(px, py, s.x1, s.y1, s.x2, s.y2));
          }
          return minD;
        }

        case "polygon": {
          if (!e.points || e.points.length < 2) return Infinity;
          let minD = Infinity;
          for (let i = 0; i < e.points.length; i++) {
            const a = e.points[i];
            const b = e.points[(i + 1) % e.points.length];
            minD = Math.min(minD, pointToSegmentDist(px, py, a.x, a.y, b.x, b.y));
          }
          return minD;
        }

        case "polyline":
        case "spline": {
          if (!e.points || e.points.length < 2) return Infinity;
          let minD = Infinity;
          for (let i = 0; i < e.points.length - 1; i++) {
            const a = e.points[i];
            const b = e.points[i + 1];
            minD = Math.min(minD, pointToSegmentDist(px, py, a.x, a.y, b.x, b.y));
          }
          return minD;
        }

        default:
          return Infinity;
      }
    }

    _angleInRange(a, start, end) {
      // normalize to [0, 2pi)
      const TWO_PI = Math.PI * 2;
      const normalize = (v) => ((v % TWO_PI) + TWO_PI) % TWO_PI;
      const ns = normalize(start);
      const ne = normalize(end);
      const na = normalize(a);
      if (ns <= ne) return na >= ns && na <= ne;
      return na >= ns || na <= ne;
    }
  }

  // expose globally
  window.CanvasEngine = CanvasEngine;
})();
