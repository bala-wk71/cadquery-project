/**
 * tools.js - Drawing and Editing Tools for Parametric 2D Sketcher
 *
 * Exports: ToolManager (attached to window)
 *
 * Each tool follows a state-machine pattern:
 *   activate → mouse events → preview → commit entity
 */

(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // Entity ID generator
  // ──────────────────────────────────────────────
  let _entityCounter = 0;
  function nextId() {
    return 'entity_' + (++_entityCounter);
  }

  // ──────────────────────────────────────────────
  // Geometry helpers
  // ──────────────────────────────────────────────
  function dist(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Compute circumscribed circle from 3 points.
   * Returns {cx, cy, r} or null if collinear.
   */
  function circumcircle(x1, y1, x2, y2, x3, y3) {
    const ax = x1, ay = y1;
    const bx = x2, by = y2;
    const cx = x3, cy = y3;

    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-10) return null;

    const ux = ((ax * ax + ay * ay) * (by - cy) +
                (bx * bx + by * by) * (cy - ay) +
                (cx * cx + cy * cy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (cx - bx) +
                (bx * bx + by * by) * (ax - cx) +
                (cx * cx + cy * cy) * (bx - ax)) / D;

    const r = dist(ux, uy, ax, ay);
    return { cx: ux, cy: uy, r: r };
  }

  /**
   * Normalize angle to [0, 2π).
   */
  function normalizeAngle(a) {
    a = a % (2 * Math.PI);
    if (a < 0) a += 2 * Math.PI;
    return a;
  }

  /**
   * Compute the angle from center to point.
   */
  function angleFromCenter(cx, cy, px, py) {
    return Math.atan2(py - cy, px - cx);
  }

  /**
   * Point-to-line-segment distance.
   */
  function pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return dist(px, py, x1, y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return dist(px, py, x1 + t * dx, y1 + t * dy);
  }

  /**
   * Point-to-circle distance (distance to circumference).
   */
  function pointToCircleDist(px, py, cx, cy, r) {
    return Math.abs(dist(px, py, cx, cy) - r);
  }

  /**
   * Line-line intersection. Returns {x, y} or null.
   */
  function lineLineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1)
    };
  }

  /**
   * Reflect a point across a line defined by two points.
   */
  function reflectPoint(px, py, lx1, ly1, lx2, ly2) {
    const dx = lx2 - lx1;
    const dy = ly2 - ly1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { x: px, y: py };
    const t = ((px - lx1) * dx + (py - ly1) * dy) / lenSq;
    const projX = lx1 + t * dx;
    const projY = ly1 + t * dy;
    return {
      x: 2 * projX - px,
      y: 2 * projY - py
    };
  }

  /**
   * Rotate a point around a center by an angle (radians).
   */
  function rotatePoint(px, py, cx, cy, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = px - cx;
    const dy = py - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos
    };
  }

  /**
   * Scale a point from a center by a factor.
   */
  function scalePoint(px, py, cx, cy, factor) {
    return {
      x: cx + (px - cx) * factor,
      y: cy + (py - cy) * factor
    };
  }

  /**
   * Deep clone an entity object.
   */
  function cloneEntity(e) {
    return JSON.parse(JSON.stringify(e));
  }

  // ──────────────────────────────────────────────
  // Hit-testing helpers (returns distance)
  // ──────────────────────────────────────────────
  const HIT_TOLERANCE = 8; // pixels – caller can adjust

  function hitTestEntity(entity, wx, wy) {
    switch (entity.type) {
      case 'point':
        return dist(wx, wy, entity.x, entity.y);
      case 'line':
        return pointToSegmentDist(wx, wy, entity.x1, entity.y1, entity.x2, entity.y2);
      case 'polyline': {
        let best = Infinity;
        for (let i = 0; i < entity.points.length - 1; i++) {
          const d = pointToSegmentDist(wx, wy,
            entity.points[i].x, entity.points[i].y,
            entity.points[i + 1].x, entity.points[i + 1].y);
          if (d < best) best = d;
        }
        return best;
      }
      case 'rectangle': {
        const rx = entity.x, ry = entity.y;
        const rw = entity.width, rh = entity.height;
        const sides = [
          [rx, ry, rx + rw, ry],
          [rx + rw, ry, rx + rw, ry + rh],
          [rx + rw, ry + rh, rx, ry + rh],
          [rx, ry + rh, rx, ry]
        ];
        let best = Infinity;
        for (const s of sides) {
          const d = pointToSegmentDist(wx, wy, s[0], s[1], s[2], s[3]);
          if (d < best) best = d;
        }
        return best;
      }
      case 'circle':
        return pointToCircleDist(wx, wy, entity.cx, entity.cy, entity.r);
      case 'arc':
        return pointToCircleDist(wx, wy, entity.cx, entity.cy, entity.r);
      case 'ellipse': {
        // Approximate: distance to ellipse boundary
        const cos = Math.cos(-entity.rotation || 0);
        const sin = Math.sin(-entity.rotation || 0);
        const dx = wx - entity.cx;
        const dy = wy - entity.cy;
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        const norm = Math.sqrt((lx * lx) / (entity.rx * entity.rx) +
                               (ly * ly) / (entity.ry * entity.ry));
        if (norm === 0) return Math.min(entity.rx, entity.ry);
        const nearX = lx / norm;
        const nearY = ly / norm;
        return dist(lx, ly, nearX, nearY);
      }
      case 'polygon': {
        const pts = polygonVertices(entity);
        let best = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length;
          const d = pointToSegmentDist(wx, wy, pts[i].x, pts[i].y, pts[j].x, pts[j].y);
          if (d < best) best = d;
        }
        return best;
      }
      case 'spline': {
        let best = Infinity;
        for (let i = 0; i < entity.points.length - 1; i++) {
          const d = pointToSegmentDist(wx, wy,
            entity.points[i].x, entity.points[i].y,
            entity.points[i + 1].x, entity.points[i + 1].y);
          if (d < best) best = d;
        }
        return best;
      }
      default:
        return Infinity;
    }
  }

  function polygonVertices(entity) {
    const pts = [];
    const sides = entity.sides || 6;
    const rot = entity.rotation || 0;
    for (let i = 0; i < sides; i++) {
      const a = rot + (2 * Math.PI * i) / sides;
      pts.push({
        x: entity.cx + entity.r * Math.cos(a),
        y: entity.cy + entity.r * Math.sin(a)
      });
    }
    return pts;
  }

  // ──────────────────────────────────────────────
  // Base Tool
  // ──────────────────────────────────────────────
  class BaseTool {
    constructor(manager) {
      this.manager = manager;
      this.preview = [];
    }
    activate() { this.preview = []; }
    deactivate() { this.preview = []; }
    onMouseDown(wx, wy, event) {}
    onMouseMove(wx, wy, event) {}
    onMouseUp(wx, wy, event) {}
    onKeyDown(event) {}
    getPreview() { return this.preview; }

    commit(entity) {
      entity.id = nextId();
      if (this.manager.onEntityCreated) {
        this.manager.onEntityCreated(entity);
      }
    }

    notifyModified(entities) {
      if (this.manager.onEntitiesModified) {
        this.manager.onEntitiesModified(entities);
      }
    }

    getEntities() {
      return this.manager.entities || [];
    }

    getSelection() {
      return this.manager.selection || [];
    }

    setSelection(sel) {
      this.manager.selection = sel;
    }

    promptValue(message, defaultVal) {
      if (this.manager.promptValue) {
        return this.manager.promptValue(message, defaultVal);
      }
      return prompt(message, defaultVal);
    }

    findEntityAt(wx, wy, tolerance) {
      tolerance = tolerance || HIT_TOLERANCE;
      const entities = this.getEntities();
      let best = null;
      let bestDist = tolerance;
      for (const e of entities) {
        const d = hitTestEntity(e, wx, wy);
        if (d < bestDist) {
          bestDist = d;
          best = e;
        }
      }
      return best;
    }
  }

  // ──────────────────────────────────────────────
  // DRAWING TOOLS
  // ──────────────────────────────────────────────

  // ---- Point Tool ----
  class PointTool extends BaseTool {
    onMouseDown(wx, wy, event) {
      this.commit({ type: 'point', x: wx, y: wy });
    }
  }

  // ---- Line Tool ----
  class LineTool extends BaseTool {
    activate() {
      super.activate();
      this.state = 'idle'; // idle | placing
      this.startX = 0;
      this.startY = 0;
    }

    onMouseDown(wx, wy, event) {
      if (this.state === 'idle') {
        this.startX = wx;
        this.startY = wy;
        this.state = 'placing';
      } else {
        this.commit({
          type: 'line',
          x1: this.startX, y1: this.startY,
          x2: wx, y2: wy
        });
        this.state = 'idle';
        this.preview = [];
      }
    }

    onMouseMove(wx, wy, event) {
      if (this.state === 'placing') {
        this.preview = [{
          type: 'line',
          x1: this.startX, y1: this.startY,
          x2: wx, y2: wy,
          _preview: true
        }];
      }
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        this.state = 'idle';
        this.preview = [];
      }
    }
  }

  // ---- Polyline Tool ----
  class PolylineTool extends BaseTool {
    activate() {
      super.activate();
      this.points = [];
      this.cursorX = 0;
      this.cursorY = 0;
    }

    onMouseDown(wx, wy, event) {
      // Double-click finishes
      if (event.detail === 2 && this.points.length >= 2) {
        this._finish();
        return;
      }
      this.points.push({ x: wx, y: wy });
    }

    onMouseMove(wx, wy, event) {
      this.cursorX = wx;
      this.cursorY = wy;
      this._updatePreview();
    }

    onKeyDown(event) {
      if (event.key === 'Enter' && this.points.length >= 2) {
        this._finish();
      } else if (event.key === 'Escape') {
        this.points = [];
        this.preview = [];
      }
    }

    _updatePreview() {
      this.preview = [];
      // Segments so far
      for (let i = 0; i < this.points.length - 1; i++) {
        this.preview.push({
          type: 'line',
          x1: this.points[i].x, y1: this.points[i].y,
          x2: this.points[i + 1].x, y2: this.points[i + 1].y,
          _preview: true
        });
      }
      // Rubber band to cursor
      if (this.points.length > 0) {
        const last = this.points[this.points.length - 1];
        this.preview.push({
          type: 'line',
          x1: last.x, y1: last.y,
          x2: this.cursorX, y2: this.cursorY,
          _preview: true
        });
      }
    }

    _finish() {
      if (this.points.length >= 2) {
        this.commit({
          type: 'polyline',
          points: this.points.slice()
        });
      }
      this.points = [];
      this.preview = [];
    }
  }

  // ---- Rectangle Tool ----
  class RectangleTool extends BaseTool {
    activate() {
      super.activate();
      this.state = 'idle';
      this.x1 = 0;
      this.y1 = 0;
    }

    onMouseDown(wx, wy, event) {
      if (this.state === 'idle') {
        this.x1 = wx;
        this.y1 = wy;
        this.state = 'placing';
      } else {
        const x = Math.min(this.x1, wx);
        const y = Math.min(this.y1, wy);
        const w = Math.abs(wx - this.x1);
        const h = Math.abs(wy - this.y1);
        this.commit({ type: 'rectangle', x: x, y: y, width: w, height: h });
        this.state = 'idle';
        this.preview = [];
      }
    }

    onMouseMove(wx, wy, event) {
      if (this.state === 'placing') {
        const x = Math.min(this.x1, wx);
        const y = Math.min(this.y1, wy);
        const w = Math.abs(wx - this.x1);
        const h = Math.abs(wy - this.y1);
        this.preview = [{
          type: 'rectangle', x: x, y: y, width: w, height: h,
          _preview: true
        }];
      }
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        this.state = 'idle';
        this.preview = [];
      }
    }
  }

  // ---- Circle Tool ----
  class CircleTool extends BaseTool {
    activate() {
      super.activate();
      this.state = 'idle';
      this.cx = 0;
      this.cy = 0;
    }

    onMouseDown(wx, wy, event) {
      if (this.state === 'idle') {
        this.cx = wx;
        this.cy = wy;
        this.state = 'placing';
      } else {
        const r = dist(this.cx, this.cy, wx, wy);
        this.commit({ type: 'circle', cx: this.cx, cy: this.cy, r: r });
        this.state = 'idle';
        this.preview = [];
      }
    }

    onMouseMove(wx, wy, event) {
      if (this.state === 'placing') {
        const r = dist(this.cx, this.cy, wx, wy);
        this.preview = [{
          type: 'circle', cx: this.cx, cy: this.cy, r: r,
          _preview: true
        }];
      }
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        this.state = 'idle';
        this.preview = [];
      }
    }
  }

  // ---- Arc Tool (3-point) ----
  class ArcTool extends BaseTool {
    activate() {
      super.activate();
      this.state = 'idle'; // idle | got_start | got_mid
      this.points = [];
    }

    onMouseDown(wx, wy, event) {
      if (this.state === 'idle') {
        this.points = [{ x: wx, y: wy }];
        this.state = 'got_start';
      } else if (this.state === 'got_start') {
        this.points.push({ x: wx, y: wy });
        this.state = 'got_mid';
      } else if (this.state === 'got_mid') {
        this.points.push({ x: wx, y: wy });
        this._finish();
      }
    }

    onMouseMove(wx, wy, event) {
      this.preview = [];
      if (this.state === 'got_start') {
        // Show line from start to cursor
        this.preview.push({
          type: 'line',
          x1: this.points[0].x, y1: this.points[0].y,
          x2: wx, y2: wy,
          _preview: true
        });
      } else if (this.state === 'got_mid') {
        // Compute arc preview through start, mid, cursor
        const cc = circumcircle(
          this.points[0].x, this.points[0].y,
          this.points[1].x, this.points[1].y,
          wx, wy
        );
        if (cc) {
          const startAngle = angleFromCenter(cc.cx, cc.cy, this.points[0].x, this.points[0].y);
          const endAngle = angleFromCenter(cc.cx, cc.cy, wx, wy);
          this.preview.push({
            type: 'arc',
            cx: cc.cx, cy: cc.cy, r: cc.r,
            startAngle: startAngle, endAngle: endAngle,
            _preview: true
          });
        }
      }
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        this.state = 'idle';
        this.points = [];
        this.preview = [];
      }
    }

    _finish() {
      const p = this.points;
      const cc = circumcircle(p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y);
      if (cc) {
        const startAngle = angleFromCenter(cc.cx, cc.cy, p[0].x, p[0].y);
        const endAngle = angleFromCenter(cc.cx, cc.cy, p[2].x, p[2].y);
        this.commit({
          type: 'arc',
          cx: cc.cx, cy: cc.cy, r: cc.r,
          startAngle: startAngle, endAngle: endAngle
        });
      }
      this.state = 'idle';
      this.points = [];
      this.preview = [];
    }
  }

  // ---- Ellipse Tool ----
  class EllipseTool extends BaseTool {
    activate() {
      super.activate();
      this.state = 'idle'; // idle | got_center | got_major
      this.cx = 0;
      this.cy = 0;
      this.rx = 0;
      this.rotation = 0;
    }

    onMouseDown(wx, wy, event) {
      if (this.state === 'idle') {
        this.cx = wx;
        this.cy = wy;
        this.state = 'got_center';
      } else if (this.state === 'got_center') {
        this.rx = dist(this.cx, this.cy, wx, wy);
        this.rotation = Math.atan2(wy - this.cy, wx - this.cx);
        this.state = 'got_major';
      } else if (this.state === 'got_major') {
        // Project cursor onto minor axis to get ry
        const cos = Math.cos(-this.rotation);
        const sin = Math.sin(-this.rotation);
        const dx = wx - this.cx;
        const dy = wy - this.cy;
        const ry = Math.abs(dx * sin + dy * cos);
        this.commit({
          type: 'ellipse',
          cx: this.cx, cy: this.cy,
          rx: this.rx, ry: ry,
          rotation: this.rotation
        });
        this.state = 'idle';
        this.preview = [];
      }
    }

    onMouseMove(wx, wy, event) {
      this.preview = [];
      if (this.state === 'got_center') {
        const r = dist(this.cx, this.cy, wx, wy);
        const rot = Math.atan2(wy - this.cy, wx - this.cx);
        this.preview.push({
          type: 'ellipse',
          cx: this.cx, cy: this.cy, rx: r, ry: r * 0.5,
          rotation: rot, _preview: true
        });
      } else if (this.state === 'got_major') {
        const cos = Math.cos(-this.rotation);
        const sin = Math.sin(-this.rotation);
        const dx = wx - this.cx;
        const dy = wy - this.cy;
        const ry = Math.abs(dx * sin + dy * cos);
        this.preview.push({
          type: 'ellipse',
          cx: this.cx, cy: this.cy,
          rx: this.rx, ry: ry,
          rotation: this.rotation, _preview: true
        });
      }
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        this.state = 'idle';
        this.preview = [];
      }
    }
  }

  // ---- Polygon Tool ----
  class PolygonTool extends BaseTool {
    activate() {
      super.activate();
      this.state = 'idle';
      this.cx = 0;
      this.cy = 0;
      this.sides = this.manager.polygonSides || 6;
    }

    onMouseDown(wx, wy, event) {
      if (this.state === 'idle') {
        this.cx = wx;
        this.cy = wy;
        this.sides = this.manager.polygonSides || 6;
        this.state = 'placing';
      } else {
        const r = dist(this.cx, this.cy, wx, wy);
        const rotation = Math.atan2(wy - this.cy, wx - this.cx);
        this.commit({
          type: 'polygon',
          cx: this.cx, cy: this.cy, r: r,
          sides: this.sides, rotation: rotation
        });
        this.state = 'idle';
        this.preview = [];
      }
    }

    onMouseMove(wx, wy, event) {
      if (this.state === 'placing') {
        const r = dist(this.cx, this.cy, wx, wy);
        const rotation = Math.atan2(wy - this.cy, wx - this.cx);
        this.preview = [{
          type: 'polygon',
          cx: this.cx, cy: this.cy, r: r,
          sides: this.sides, rotation: rotation,
          _preview: true
        }];
      }
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        this.state = 'idle';
        this.preview = [];
      }
    }
  }

  // ---- Spline Tool ----
  class SplineTool extends BaseTool {
    activate() {
      super.activate();
      this.points = [];
      this.cursorX = 0;
      this.cursorY = 0;
    }

    onMouseDown(wx, wy, event) {
      this.points.push({ x: wx, y: wy });
      this._updatePreview();
    }

    onMouseMove(wx, wy, event) {
      this.cursorX = wx;
      this.cursorY = wy;
      this._updatePreview();
    }

    onKeyDown(event) {
      if (event.key === 'Enter' && this.points.length >= 2) {
        this.commit({
          type: 'spline',
          points: this.points.slice()
        });
        this.points = [];
        this.preview = [];
      } else if (event.key === 'Escape') {
        this.points = [];
        this.preview = [];
      }
    }

    _updatePreview() {
      this.preview = [];
      const pts = this.points.slice();
      // Show control points as small crosses
      for (const p of pts) {
        this.preview.push({
          type: 'point', x: p.x, y: p.y, _preview: true
        });
      }
      // Rubber band to cursor
      if (pts.length > 0) {
        const allPts = pts.concat([{ x: this.cursorX, y: this.cursorY }]);
        this.preview.push({
          type: 'spline', points: allPts, _preview: true
        });
      }
    }
  }

  // ──────────────────────────────────────────────
  // EDITING TOOLS
  // ──────────────────────────────────────────────

  // ---- Select Tool ----
  class SelectTool extends BaseTool {
    activate() {
      super.activate();
      this.dragging = false;
      this.dragStartX = 0;
      this.dragStartY = 0;
      this.cursorX = 0;
      this.cursorY = 0;
    }

    onMouseDown(wx, wy, event) {
      this.dragging = true;
      this.dragStartX = wx;
      this.dragStartY = wy;

      const entity = this.findEntityAt(wx, wy);
      if (entity) {
        const selection = this.getSelection();
        if (event.shiftKey) {
          // Toggle selection
          const idx = selection.indexOf(entity);
          if (idx >= 0) {
            selection.splice(idx, 1);
          } else {
            selection.push(entity);
          }
          this.setSelection(selection);
        } else {
          // Select only this entity
          if (selection.indexOf(entity) < 0) {
            this.setSelection([entity]);
          }
        }
      } else if (!event.shiftKey) {
        this.setSelection([]);
      }
    }

    onMouseMove(wx, wy, event) {
      this.cursorX = wx;
      this.cursorY = wy;
      if (this.dragging) {
        // Box select preview
        const x = Math.min(this.dragStartX, wx);
        const y = Math.min(this.dragStartY, wy);
        const w = Math.abs(wx - this.dragStartX);
        const h = Math.abs(wy - this.dragStartY);
        if (w > 2 || h > 2) {
          this.preview = [{
            type: 'rectangle', x: x, y: y, width: w, height: h,
            _preview: true, _selectBox: true
          }];
        }
      }
    }

    onMouseUp(wx, wy, event) {
      if (this.dragging) {
        const dx = Math.abs(wx - this.dragStartX);
        const dy = Math.abs(wy - this.dragStartY);
        if (dx > 2 || dy > 2) {
          // Box select
          const bx1 = Math.min(this.dragStartX, wx);
          const by1 = Math.min(this.dragStartY, wy);
          const bx2 = Math.max(this.dragStartX, wx);
          const by2 = Math.max(this.dragStartY, wy);

          const entities = this.getEntities();
          const selected = entities.filter(function (e) {
            return entityInBox(e, bx1, by1, bx2, by2);
          });

          if (event.shiftKey) {
            const cur = this.getSelection();
            for (const s of selected) {
              if (cur.indexOf(s) < 0) cur.push(s);
            }
            this.setSelection(cur);
          } else {
            this.setSelection(selected);
          }
        }
        this.dragging = false;
        this.preview = [];
      }
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        this.setSelection([]);
        this.preview = [];
      }
    }
  }

  /**
   * Check if an entity's representative point is inside a box.
   */
  function entityInBox(entity, bx1, by1, bx2, by2) {
    function inside(x, y) {
      return x >= bx1 && x <= bx2 && y >= by1 && y <= by2;
    }
    switch (entity.type) {
      case 'point':
        return inside(entity.x, entity.y);
      case 'line':
        return inside(entity.x1, entity.y1) && inside(entity.x2, entity.y2);
      case 'circle':
        return inside(entity.cx - entity.r, entity.cy - entity.r) &&
               inside(entity.cx + entity.r, entity.cy + entity.r);
      case 'rectangle':
        return inside(entity.x, entity.y) &&
               inside(entity.x + entity.width, entity.y + entity.height);
      case 'polyline':
        return entity.points.every(function (p) { return inside(p.x, p.y); });
      case 'polygon':
      case 'arc':
      case 'ellipse':
        return inside(entity.cx, entity.cy);
      case 'spline':
        return entity.points.every(function (p) { return inside(p.x, p.y); });
      default:
        return false;
    }
  }

  // ---- Move Tool ----
  class MoveTool extends BaseTool {
    activate() {
      super.activate();
      this.state = 'idle'; // idle | moving
      this.startX = 0;
      this.startY = 0;
    }

    onMouseDown(wx, wy, event) {
      const selection = this.getSelection();
      if (selection.length === 0) {
        // Try to select under cursor
        const entity = this.findEntityAt(wx, wy);
        if (entity) {
          this.setSelection([entity]);
        } else {
          return;
        }
      }

      if (this.state === 'idle') {
        this.startX = wx;
        this.startY = wy;
        this.state = 'moving';
      } else {
        const dx = wx - this.startX;
        const dy = wy - this.startY;
        this._applyMove(dx, dy);
        this.state = 'idle';
        this.preview = [];
      }
    }

    onMouseMove(wx, wy, event) {
      if (this.state === 'moving') {
        const dx = wx - this.startX;
        const dy = wy - this.startY;
        // Preview moved entities
        const selection = this.getSelection();
        this.preview = selection.map(function (e) {
          const c = cloneEntity(e);
          moveEntityBy(c, dx, dy);
          c._preview = true;
          return c;
        });
      }
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        this.state = 'idle';
        this.preview = [];
      }
    }

    _applyMove(dx, dy) {
      const selection = this.getSelection();
      for (const e of selection) {
        moveEntityBy(e, dx, dy);
      }
      this.notifyModified(selection);
    }
  }

  function moveEntityBy(entity, dx, dy) {
    switch (entity.type) {
      case 'point':
        entity.x += dx; entity.y += dy; break;
      case 'line':
        entity.x1 += dx; entity.y1 += dy;
        entity.x2 += dx; entity.y2 += dy; break;
      case 'polyline':
      case 'spline':
        entity.points.forEach(function (p) { p.x += dx; p.y += dy; }); break;
      case 'rectangle':
        entity.x += dx; entity.y += dy; break;
      case 'circle':
      case 'arc':
      case 'ellipse':
      case 'polygon':
        entity.cx += dx; entity.cy += dy; break;
    }
  }

  // ---- Copy Tool ----
  class CopyTool extends BaseTool {
    activate() {
      super.activate();
      this.state = 'idle';
      this.startX = 0;
      this.startY = 0;
    }

    onMouseDown(wx, wy, event) {
      const selection = this.getSelection();
      if (selection.length === 0) {
        const entity = this.findEntityAt(wx, wy);
        if (entity) {
          this.setSelection([entity]);
        } else {
          return;
        }
      }

      if (this.state === 'idle') {
        this.startX = wx;
        this.startY = wy;
        this.state = 'placing';
      } else {
        const dx = wx - this.startX;
        const dy = wy - this.startY;
        const selection2 = this.getSelection();
        for (const e of selection2) {
          const copy = cloneEntity(e);
          delete copy.id;
          moveEntityBy(copy, dx, dy);
          this.commit(copy);
        }
        this.state = 'idle';
        this.preview = [];
      }
    }

    onMouseMove(wx, wy, event) {
      if (this.state === 'placing') {
        const dx = wx - this.startX;
        const dy = wy - this.startY;
        const selection = this.getSelection();
        this.preview = selection.map(function (e) {
          const c = cloneEntity(e);
          moveEntityBy(c, dx, dy);
          c._preview = true;
          return c;
        });
      }
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        this.state = 'idle';
        this.preview = [];
      }
    }
  }

  // ---- Delete Tool ----
  class DeleteTool extends BaseTool {
    onMouseDown(wx, wy, event) {
      const selection = this.getSelection();
      if (selection.length > 0) {
        // Delete all selected
        this._deleteEntities(selection);
        this.setSelection([]);
      } else {
        const entity = this.findEntityAt(wx, wy);
        if (entity) {
          this._deleteEntities([entity]);
        }
      }
    }

    _deleteEntities(toDelete) {
      const entities = this.getEntities();
      for (const e of toDelete) {
        const idx = entities.indexOf(e);
        if (idx >= 0) {
          entities.splice(idx, 1);
        }
      }
      this.notifyModified(toDelete);
    }
  }

  // ---- Trim Tool ----
  class TrimTool extends BaseTool {
    onMouseDown(wx, wy, event) {
      const entity = this.findEntityAt(wx, wy);
      if (!entity) return;

      if (entity.type === 'line') {
        const intersections = this._findIntersections(entity);
        if (intersections.length < 1) return;

        // Find which segment the click is on and trim
        // Project click onto line to find parameter
        const dx = entity.x2 - entity.x1;
        const dy = entity.y2 - entity.y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return;
        const t = ((wx - entity.x1) * dx + (wy - entity.y1) * dy) / lenSq;

        // Sort intersection parameters
        const params = intersections.map(function (pt) {
          return ((pt.x - entity.x1) * dx + (pt.y - entity.y1) * dy) / lenSq;
        }).filter(function (p) { return p > 0.001 && p < 0.999; })
          .sort(function (a, b) { return a - b; });

        if (params.length === 0) return;

        // Find bounding parameters around click
        let lower = 0, upper = 1;
        for (const p of params) {
          if (p < t) lower = p;
          if (p > t && upper === 1) upper = p;
        }

        // Trim: remove the segment between lower and upper
        // by modifying the entity to keep portions outside
        if (lower > 0.001) {
          entity.x2 = entity.x1 + lower * dx;
          entity.y2 = entity.y1 + lower * dy;
        } else {
          entity.x1 = entity.x1 + upper * dx;
          entity.y1 = entity.y1 + upper * dy;
        }
        this.notifyModified([entity]);
      }
    }

    _findIntersections(target) {
      const entities = this.getEntities();
      const results = [];
      for (const e of entities) {
        if (e === target || e.id === target.id) continue;
        if (e.type === 'line' && target.type === 'line') {
          const pt = lineLineIntersection(
            target.x1, target.y1, target.x2, target.y2,
            e.x1, e.y1, e.x2, e.y2
          );
          if (pt) results.push(pt);
        }
      }
      return results;
    }
  }

  // ---- Extend Tool ----
  class ExtendTool extends BaseTool {
    onMouseDown(wx, wy, event) {
      const entity = this.findEntityAt(wx, wy);
      if (!entity || entity.type !== 'line') return;

      // Determine which endpoint is closer to click
      const d1 = dist(wx, wy, entity.x1, entity.y1);
      const d2 = dist(wx, wy, entity.x2, entity.y2);
      const extendEnd = d2 < d1; // extend the end closer to click

      // Find nearest intersection in the extension direction
      const entities = this.getEntities();
      let bestPt = null;
      let bestDist = Infinity;

      const dx = entity.x2 - entity.x1;
      const dy = entity.y2 - entity.y1;

      for (const e of entities) {
        if (e === entity || e.id === entity.id) continue;
        if (e.type === 'line') {
          const pt = lineLineIntersection(
            entity.x1, entity.y1, entity.x2, entity.y2,
            e.x1, e.y1, e.x2, e.y2
          );
          if (!pt) continue;
          // Check if intersection is in the extension direction
          const t = dx !== 0 ? (pt.x - entity.x1) / dx : (pt.y - entity.y1) / dy;
          if (extendEnd && t > 1) {
            const d = dist(entity.x2, entity.y2, pt.x, pt.y);
            if (d < bestDist) { bestDist = d; bestPt = pt; }
          } else if (!extendEnd && t < 0) {
            const d = dist(entity.x1, entity.y1, pt.x, pt.y);
            if (d < bestDist) { bestDist = d; bestPt = pt; }
          }
        }
      }

      if (bestPt) {
        if (extendEnd) {
          entity.x2 = bestPt.x;
          entity.y2 = bestPt.y;
        } else {
          entity.x1 = bestPt.x;
          entity.y1 = bestPt.y;
        }
        this.notifyModified([entity]);
      }
    }
  }

  // ---- Offset Tool ----
  class OffsetTool extends BaseTool {
    onMouseDown(wx, wy, event) {
      const entity = this.findEntityAt(wx, wy);
      if (!entity) return;

      const self = this;
      const result = this.promptValue('Enter offset distance:', '10');
      if (result === null || result === undefined) return;
      const distance = parseFloat(result);
      if (isNaN(distance) || distance === 0) return;

      const copy = cloneEntity(entity);
      delete copy.id;

      switch (copy.type) {
        case 'line': {
          const dx = copy.x2 - copy.x1;
          const dy = copy.y2 - copy.y1;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len === 0) return;
          // Determine offset direction based on which side the click is on
          const nx = -dy / len;
          const ny = dx / len;
          const side = (wx - copy.x1) * nx + (wy - copy.y1) * ny;
          const sign = side >= 0 ? 1 : -1;
          const off = distance * sign;
          copy.x1 += nx * off; copy.y1 += ny * off;
          copy.x2 += nx * off; copy.y2 += ny * off;
          break;
        }
        case 'circle': {
          const side = dist(wx, wy, copy.cx, copy.cy) > copy.r ? 1 : -1;
          copy.r += distance * side;
          if (copy.r < 0) copy.r = Math.abs(copy.r);
          break;
        }
        case 'rectangle': {
          // Simple outward offset
          copy.x -= distance;
          copy.y -= distance;
          copy.width += distance * 2;
          copy.height += distance * 2;
          break;
        }
        default:
          return; // Offset not supported for this entity type
      }

      this.commit(copy);
    }
  }

  // ---- Mirror Tool ----
  class MirrorTool extends BaseTool {
    activate() {
      super.activate();
      this.state = 'idle'; // idle | got_first_point
      this.p1x = 0;
      this.p1y = 0;
    }

    onMouseDown(wx, wy, event) {
      const selection = this.getSelection();
      if (selection.length === 0) {
        const entity = this.findEntityAt(wx, wy);
        if (entity) {
          this.setSelection([entity]);
        }
        return;
      }

      if (this.state === 'idle') {
        this.p1x = wx;
        this.p1y = wy;
        this.state = 'got_first_point';
      } else {
        // Mirror across line from p1 to (wx, wy)
        const sel = this.getSelection();
        for (const e of sel) {
          const copy = cloneEntity(e);
          delete copy.id;
          this._mirrorEntity(copy, this.p1x, this.p1y, wx, wy);
          this.commit(copy);
        }
        this.state = 'idle';
        this.preview = [];
      }
    }

    onMouseMove(wx, wy, event) {
      if (this.state === 'got_first_point') {
        // Preview mirror line
        this.preview = [{
          type: 'line',
          x1: this.p1x, y1: this.p1y,
          x2: wx, y2: wy,
          _preview: true, _mirrorLine: true
        }];
        // Preview mirrored entities
        const selection = this.getSelection();
        for (const e of selection) {
          const c = cloneEntity(e);
          this._mirrorEntity(c, this.p1x, this.p1y, wx, wy);
          c._preview = true;
          this.preview.push(c);
        }
      }
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        this.state = 'idle';
        this.preview = [];
      }
    }

    _mirrorEntity(entity, lx1, ly1, lx2, ly2) {
      switch (entity.type) {
        case 'point': {
          const r = reflectPoint(entity.x, entity.y, lx1, ly1, lx2, ly2);
          entity.x = r.x; entity.y = r.y; break;
        }
        case 'line': {
          const r1 = reflectPoint(entity.x1, entity.y1, lx1, ly1, lx2, ly2);
          const r2 = reflectPoint(entity.x2, entity.y2, lx1, ly1, lx2, ly2);
          entity.x1 = r1.x; entity.y1 = r1.y;
          entity.x2 = r2.x; entity.y2 = r2.y; break;
        }
        case 'polyline':
        case 'spline':
          entity.points = entity.points.map(function (p) {
            return reflectPoint(p.x, p.y, lx1, ly1, lx2, ly2);
          }); break;
        case 'rectangle': {
          const c1 = reflectPoint(entity.x, entity.y, lx1, ly1, lx2, ly2);
          const c2 = reflectPoint(entity.x + entity.width, entity.y + entity.height, lx1, ly1, lx2, ly2);
          entity.x = Math.min(c1.x, c2.x);
          entity.y = Math.min(c1.y, c2.y);
          entity.width = Math.abs(c2.x - c1.x);
          entity.height = Math.abs(c2.y - c1.y);
          break;
        }
        case 'circle':
        case 'arc':
        case 'ellipse':
        case 'polygon': {
          const rc = reflectPoint(entity.cx, entity.cy, lx1, ly1, lx2, ly2);
          entity.cx = rc.x; entity.cy = rc.y;
          if (entity.rotation !== undefined) {
            // Mirror rotation angle
            const lineAngle = Math.atan2(ly2 - ly1, lx2 - lx1);
            entity.rotation = 2 * lineAngle - entity.rotation;
          }
          if (entity.startAngle !== undefined) {
            const la = Math.atan2(ly2 - ly1, lx2 - lx1);
            const sa = 2 * la - entity.startAngle;
            const ea = 2 * la - entity.endAngle;
            entity.startAngle = ea;
            entity.endAngle = sa;
          }
          break;
        }
      }
    }
  }

  // ---- Fillet Tool ----
  class FilletTool extends BaseTool {
    activate() {
      super.activate();
      this.state = 'idle'; // idle | got_first_line
      this.firstEntity = null;
    }

    onMouseDown(wx, wy, event) {
      const entity = this.findEntityAt(wx, wy);
      if (!entity || entity.type !== 'line') return;

      if (this.state === 'idle') {
        this.firstEntity = entity;
        this.state = 'got_first_line';
      } else {
        const result = this.promptValue('Enter fillet radius:', '5');
        if (result === null || result === undefined) {
          this.state = 'idle';
          return;
        }
        const radius = parseFloat(result);
        if (isNaN(radius) || radius <= 0) {
          this.state = 'idle';
          return;
        }

        this._createFillet(this.firstEntity, entity, radius);
        this.state = 'idle';
      }
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        this.state = 'idle';
        this.firstEntity = null;
      }
    }

    _createFillet(line1, line2, radius) {
      // Find intersection of the two lines
      const ip = lineLineIntersection(
        line1.x1, line1.y1, line1.x2, line1.y2,
        line2.x1, line2.y1, line2.x2, line2.y2
      );
      if (!ip) return;

      // Compute directions away from intersection
      const d1x = line1.x2 - line1.x1;
      const d1y = line1.y2 - line1.y1;
      const d2x = line2.x2 - line2.x1;
      const d2y = line2.y2 - line2.y1;

      const len1 = Math.sqrt(d1x * d1x + d1y * d1y);
      const len2 = Math.sqrt(d2x * d2x + d2y * d2y);
      if (len1 === 0 || len2 === 0) return;

      const u1x = d1x / len1, u1y = d1y / len1;
      const u2x = d2x / len2, u2y = d2y / len2;

      // Angle bisector to find arc center
      const cross = u1x * u2y - u1y * u2x;
      const dot = u1x * u2x + u1y * u2y;
      const halfAngle = Math.acos(Math.max(-1, Math.min(1, dot))) / 2;
      if (Math.abs(Math.sin(halfAngle)) < 1e-10) return;

      const d = radius / Math.sin(halfAngle);

      // Bisector direction
      let bx = u1x + u2x, by = u1y + u2y;
      const blen = Math.sqrt(bx * bx + by * by);
      if (blen < 1e-10) return;
      bx /= blen; by /= blen;

      const cx = ip.x + bx * d;
      const cy = ip.y + by * d;

      // Tangent points
      const t1dist = radius / Math.tan(halfAngle);
      const tp1 = { x: ip.x + u1x * t1dist, y: ip.y + u1y * t1dist };
      const tp2 = { x: ip.x + u2x * t1dist, y: ip.y + u2y * t1dist };

      const startAngle = angleFromCenter(cx, cy, tp1.x, tp1.y);
      const endAngle = angleFromCenter(cx, cy, tp2.x, tp2.y);

      // Trim lines to tangent points
      // Adjust the endpoint of each line closer to intersection
      const t1_1 = ((ip.x - line1.x1) * d1x + (ip.y - line1.y1) * d1y) / (len1 * len1);
      if (t1_1 > 0.5) {
        line1.x2 = tp1.x; line1.y2 = tp1.y;
      } else {
        line1.x1 = tp1.x; line1.y1 = tp1.y;
      }

      const t2_1 = ((ip.x - line2.x1) * d2x + (ip.y - line2.y1) * d2y) / (len2 * len2);
      if (t2_1 > 0.5) {
        line2.x2 = tp2.x; line2.y2 = tp2.y;
      } else {
        line2.x1 = tp2.x; line2.y1 = tp2.y;
      }

      this.notifyModified([line1, line2]);

      this.commit({
        type: 'arc',
        cx: cx, cy: cy, r: radius,
        startAngle: startAngle, endAngle: endAngle
      });
    }
  }

  // ---- Chamfer Tool ----
  class ChamferTool extends BaseTool {
    activate() {
      super.activate();
      this.state = 'idle';
      this.firstEntity = null;
    }

    onMouseDown(wx, wy, event) {
      const entity = this.findEntityAt(wx, wy);
      if (!entity || entity.type !== 'line') return;

      if (this.state === 'idle') {
        this.firstEntity = entity;
        this.state = 'got_first_line';
      } else {
        const result = this.promptValue('Enter chamfer distance:', '5');
        if (result === null || result === undefined) {
          this.state = 'idle';
          return;
        }
        const chamferDist = parseFloat(result);
        if (isNaN(chamferDist) || chamferDist <= 0) {
          this.state = 'idle';
          return;
        }

        this._createChamfer(this.firstEntity, entity, chamferDist);
        this.state = 'idle';
      }
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        this.state = 'idle';
        this.firstEntity = null;
      }
    }

    _createChamfer(line1, line2, chamferDist) {
      const ip = lineLineIntersection(
        line1.x1, line1.y1, line1.x2, line1.y2,
        line2.x1, line2.y1, line2.x2, line2.y2
      );
      if (!ip) return;

      const d1x = line1.x2 - line1.x1, d1y = line1.y2 - line1.y1;
      const d2x = line2.x2 - line2.x1, d2y = line2.y2 - line2.y1;
      const len1 = Math.sqrt(d1x * d1x + d1y * d1y);
      const len2 = Math.sqrt(d2x * d2x + d2y * d2y);
      if (len1 === 0 || len2 === 0) return;

      const u1x = d1x / len1, u1y = d1y / len1;
      const u2x = d2x / len2, u2y = d2y / len2;

      // Points at chamfer distance from intersection along each line
      const cp1 = { x: ip.x + u1x * chamferDist, y: ip.y + u1y * chamferDist };
      const cp2 = { x: ip.x + u2x * chamferDist, y: ip.y + u2y * chamferDist };

      // Also consider the opposite direction
      const cp1b = { x: ip.x - u1x * chamferDist, y: ip.y - u1y * chamferDist };
      const cp2b = { x: ip.x - u2x * chamferDist, y: ip.y - u2y * chamferDist };

      // Pick the chamfer point on each line that lies within the segment
      const t1a = ((cp1.x - line1.x1) * d1x + (cp1.y - line1.y1) * d1y) / (len1 * len1);
      const t1b = ((cp1b.x - line1.x1) * d1x + (cp1b.y - line1.y1) * d1y) / (len1 * len1);
      const useA1 = (t1a >= 0 && t1a <= 1);
      const p1 = useA1 ? cp1 : cp1b;

      const t2a = ((cp2.x - line2.x1) * d2x + (cp2.y - line2.y1) * d2y) / (len2 * len2);
      const useA2 = (t2a >= 0 && t2a <= 1);
      const p2 = useA2 ? cp2 : cp2b;

      // Trim lines
      const t1_ip = ((ip.x - line1.x1) * d1x + (ip.y - line1.y1) * d1y) / (len1 * len1);
      if (t1_ip > 0.5) {
        line1.x2 = p1.x; line1.y2 = p1.y;
      } else {
        line1.x1 = p1.x; line1.y1 = p1.y;
      }

      const t2_ip = ((ip.x - line2.x1) * d2x + (ip.y - line2.y1) * d2y) / (len2 * len2);
      if (t2_ip > 0.5) {
        line2.x2 = p2.x; line2.y2 = p2.y;
      } else {
        line2.x1 = p2.x; line2.y1 = p2.y;
      }

      this.notifyModified([line1, line2]);

      // Create chamfer line
      this.commit({
        type: 'line',
        x1: p1.x, y1: p1.y,
        x2: p2.x, y2: p2.y
      });
    }
  }

  // ---- Rotate Tool ----
  class RotateTool extends BaseTool {
    onMouseDown(wx, wy, event) {
      const selection = this.getSelection();
      if (selection.length === 0) {
        const entity = this.findEntityAt(wx, wy);
        if (entity) {
          this.setSelection([entity]);
        }
        return;
      }

      // Click defines center of rotation
      const result = this.promptValue('Enter rotation angle (degrees):', '90');
      if (result === null || result === undefined) return;
      const angleDeg = parseFloat(result);
      if (isNaN(angleDeg)) return;
      const angleRad = (angleDeg * Math.PI) / 180;

      const cx = wx, cy = wy;
      const sel = this.getSelection();
      for (const e of sel) {
        this._rotateEntity(e, cx, cy, angleRad);
      }
      this.notifyModified(sel);
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        this.preview = [];
      }
    }

    _rotateEntity(entity, cx, cy, angle) {
      switch (entity.type) {
        case 'point': {
          const r = rotatePoint(entity.x, entity.y, cx, cy, angle);
          entity.x = r.x; entity.y = r.y; break;
        }
        case 'line': {
          const r1 = rotatePoint(entity.x1, entity.y1, cx, cy, angle);
          const r2 = rotatePoint(entity.x2, entity.y2, cx, cy, angle);
          entity.x1 = r1.x; entity.y1 = r1.y;
          entity.x2 = r2.x; entity.y2 = r2.y; break;
        }
        case 'polyline':
        case 'spline':
          entity.points = entity.points.map(function (p) {
            return rotatePoint(p.x, p.y, cx, cy, angle);
          }); break;
        case 'rectangle': {
          // Rotate the two corners and recompute
          const c1 = rotatePoint(entity.x, entity.y, cx, cy, angle);
          const c2 = rotatePoint(entity.x + entity.width, entity.y + entity.height, cx, cy, angle);
          entity.x = Math.min(c1.x, c2.x);
          entity.y = Math.min(c1.y, c2.y);
          entity.width = Math.abs(c2.x - c1.x);
          entity.height = Math.abs(c2.y - c1.y);
          break;
        }
        case 'circle': {
          const rc = rotatePoint(entity.cx, entity.cy, cx, cy, angle);
          entity.cx = rc.x; entity.cy = rc.y; break;
        }
        case 'arc':
        case 'ellipse':
        case 'polygon': {
          const rc2 = rotatePoint(entity.cx, entity.cy, cx, cy, angle);
          entity.cx = rc2.x; entity.cy = rc2.y;
          if (entity.rotation !== undefined) entity.rotation += angle;
          if (entity.startAngle !== undefined) {
            entity.startAngle += angle;
            entity.endAngle += angle;
          }
          break;
        }
      }
    }
  }

  // ---- Scale Tool ----
  class ScaleTool extends BaseTool {
    onMouseDown(wx, wy, event) {
      const selection = this.getSelection();
      if (selection.length === 0) {
        const entity = this.findEntityAt(wx, wy);
        if (entity) {
          this.setSelection([entity]);
        }
        return;
      }

      const result = this.promptValue('Enter scale factor:', '2');
      if (result === null || result === undefined) return;
      const factor = parseFloat(result);
      if (isNaN(factor) || factor === 0) return;

      const cx = wx, cy = wy;
      const sel = this.getSelection();
      for (const e of sel) {
        this._scaleEntity(e, cx, cy, factor);
      }
      this.notifyModified(sel);
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        this.preview = [];
      }
    }

    _scaleEntity(entity, cx, cy, factor) {
      switch (entity.type) {
        case 'point': {
          const s = scalePoint(entity.x, entity.y, cx, cy, factor);
          entity.x = s.x; entity.y = s.y; break;
        }
        case 'line': {
          const s1 = scalePoint(entity.x1, entity.y1, cx, cy, factor);
          const s2 = scalePoint(entity.x2, entity.y2, cx, cy, factor);
          entity.x1 = s1.x; entity.y1 = s1.y;
          entity.x2 = s2.x; entity.y2 = s2.y; break;
        }
        case 'polyline':
        case 'spline':
          entity.points = entity.points.map(function (p) {
            return scalePoint(p.x, p.y, cx, cy, factor);
          }); break;
        case 'rectangle': {
          const s1r = scalePoint(entity.x, entity.y, cx, cy, factor);
          const s2r = scalePoint(entity.x + entity.width, entity.y + entity.height, cx, cy, factor);
          entity.x = Math.min(s1r.x, s2r.x);
          entity.y = Math.min(s1r.y, s2r.y);
          entity.width = Math.abs(s2r.x - s1r.x);
          entity.height = Math.abs(s2r.y - s1r.y);
          break;
        }
        case 'circle': {
          const sc = scalePoint(entity.cx, entity.cy, cx, cy, factor);
          entity.cx = sc.x; entity.cy = sc.y;
          entity.r *= Math.abs(factor);
          break;
        }
        case 'arc': {
          const sa = scalePoint(entity.cx, entity.cy, cx, cy, factor);
          entity.cx = sa.x; entity.cy = sa.y;
          entity.r *= Math.abs(factor);
          break;
        }
        case 'ellipse': {
          const se = scalePoint(entity.cx, entity.cy, cx, cy, factor);
          entity.cx = se.x; entity.cy = se.y;
          entity.rx *= Math.abs(factor);
          entity.ry *= Math.abs(factor);
          break;
        }
        case 'polygon': {
          const sp = scalePoint(entity.cx, entity.cy, cx, cy, factor);
          entity.cx = sp.x; entity.cy = sp.y;
          entity.r *= Math.abs(factor);
          break;
        }
      }
    }
  }

  // ──────────────────────────────────────────────
  // ToolManager
  // ──────────────────────────────────────────────
  class ToolManager {
    constructor() {
      /** @type {Array} Entity storage reference (set by the app) */
      this.entities = [];

      /** @type {Array} Currently selected entities */
      this.selection = [];

      /** @type {Function|null} Called when a new entity is committed */
      this.onEntityCreated = null;

      /** @type {Function|null} Called when entities are modified in place */
      this.onEntitiesModified = null;

      /**
       * Called when a tool needs user input (distance, angle, etc.).
       * Signature: promptValue(message, defaultValue) => string|null
       * The app can override this with a custom dialog.
       * @type {Function|null}
       */
      this.promptValue = null;

      /** @type {number} Number of sides for the polygon tool (default 6) */
      this.polygonSides = 6;

      // Register all tools
      this._tools = {
        // Drawing tools
        point:     new PointTool(this),
        line:      new LineTool(this),
        polyline:  new PolylineTool(this),
        rectangle: new RectangleTool(this),
        circle:    new CircleTool(this),
        arc:       new ArcTool(this),
        ellipse:   new EllipseTool(this),
        polygon:   new PolygonTool(this),
        spline:    new SplineTool(this),
        // Editing tools
        select:    new SelectTool(this),
        move:      new MoveTool(this),
        copy:      new CopyTool(this),
        delete:    new DeleteTool(this),
        trim:      new TrimTool(this),
        extend:    new ExtendTool(this),
        offset:    new OffsetTool(this),
        mirror:    new MirrorTool(this),
        fillet:    new FilletTool(this),
        chamfer:   new ChamferTool(this),
        rotate:    new RotateTool(this),
        scale:     new ScaleTool(this)
      };

      /** @type {BaseTool|null} */
      this._activeTool = null;
      this._activeToolName = null;
    }

    /**
     * Switch to a tool by name.
     * @param {string} toolName
     */
    setTool(toolName) {
      if (this._activeTool) {
        this._activeTool.deactivate();
      }
      const tool = this._tools[toolName];
      if (!tool) {
        console.warn('ToolManager: unknown tool "' + toolName + '"');
        this._activeTool = null;
        this._activeToolName = null;
        return;
      }
      this._activeTool = tool;
      this._activeToolName = toolName;
      tool.activate();
    }

    /**
     * Get the name of the currently active tool.
     * @returns {string|null}
     */
    getActiveTool() {
      return this._activeToolName;
    }

    /**
     * Dispatch mouse-down to active tool.
     */
    onMouseDown(worldX, worldY, event) {
      if (this._activeTool) {
        this._activeTool.onMouseDown(worldX, worldY, event);
      }
    }

    /**
     * Dispatch mouse-move to active tool.
     */
    onMouseMove(worldX, worldY, event) {
      if (this._activeTool) {
        this._activeTool.onMouseMove(worldX, worldY, event);
      }
    }

    /**
     * Dispatch mouse-up to active tool.
     */
    onMouseUp(worldX, worldY, event) {
      if (this._activeTool) {
        this._activeTool.onMouseUp(worldX, worldY, event);
      }
    }

    /**
     * Dispatch key-down to active tool.
     */
    onKeyDown(event) {
      if (this._activeTool) {
        this._activeTool.onKeyDown(event);
      }
    }

    /**
     * Get preview geometry from the active tool.
     * Returns an array of temporary shape objects to render.
     * Each shape has a `_preview: true` flag.
     * @returns {Array}
     */
    getPreview() {
      if (this._activeTool) {
        return this._activeTool.getPreview();
      }
      return [];
    }
  }

  // ──────────────────────────────────────────────
  // Export
  // ──────────────────────────────────────────────
  window.ToolManager = ToolManager;

})();
