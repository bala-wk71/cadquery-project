/**
 * SnapSystem — Intelligent snap engine for the parametric 2D sketcher.
 * Finds the best snap target near a world-space cursor position based on
 * configurable snap types and a priority ordering.
 */
(function () {
  "use strict";

  // ───────────── helpers ─────────────

  function dist(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function nearestPointOnSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { x: ax, y: ay };
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = clamp(t, 0, 1);
    return { x: ax + t * dx, y: ay + t * dy };
  }

  // ───────────── default config ─────────────

  const SNAP_TYPES = [
    "endpoint",
    "intersection",
    "midpoint",
    "center",
    "perpendicular",
    "tangent",
    "nearest",
    "grid",
  ];

  // ───────────── SnapSystem ─────────────

  class SnapSystem {
    /**
     * @param {Object} [opts]
     * @param {number} [opts.gridSpacing=1]
     * @param {boolean} [opts.gridEnabled=true]
     */
    constructor(opts) {
      opts = opts || {};

      this.gridSpacing = opts.gridSpacing || 1;

      // individual enables (all on by default)
      this.enabled = {};
      for (const t of SNAP_TYPES) {
        this.enabled[t] = true;
      }
      if (opts.gridEnabled === false) this.enabled.grid = false;
    }

    /**
     * Enable or disable a snap type.
     * @param {string} type
     * @param {boolean} on
     */
    setEnabled(type, on) {
      if (this.enabled.hasOwnProperty(type)) {
        this.enabled[type] = !!on;
      }
    }

    /**
     * Toggle a snap type.
     */
    toggle(type) {
      if (this.enabled.hasOwnProperty(type)) {
        this.enabled[type] = !this.enabled[type];
      }
    }

    /**
     * Main snap entry point.
     *
     * @param {number} worldX
     * @param {number} worldY
     * @param {Array}  entities — array of entity objects
     * @param {number} snapRadius — radius in world units
     * @returns {{ x: number, y: number, type: string, entityId: string|null } | null}
     */
    findSnap(worldX, worldY, entities, snapRadius) {
      const candidates = [];

      if (this.enabled.endpoint) {
        this._collectEndpoints(worldX, worldY, entities, snapRadius, candidates);
      }
      if (this.enabled.intersection) {
        this._collectIntersections(worldX, worldY, entities, snapRadius, candidates);
      }
      if (this.enabled.midpoint) {
        this._collectMidpoints(worldX, worldY, entities, snapRadius, candidates);
      }
      if (this.enabled.center) {
        this._collectCenters(worldX, worldY, entities, snapRadius, candidates);
      }
      if (this.enabled.perpendicular) {
        this._collectPerpendiculars(worldX, worldY, entities, snapRadius, candidates);
      }
      if (this.enabled.tangent) {
        this._collectTangents(worldX, worldY, entities, snapRadius, candidates);
      }
      if (this.enabled.nearest) {
        this._collectNearest(worldX, worldY, entities, snapRadius, candidates);
      }
      if (this.enabled.grid) {
        this._collectGrid(worldX, worldY, snapRadius, candidates);
      }

      if (candidates.length === 0) return null;

      // sort by priority then distance
      const priorityOrder = {};
      SNAP_TYPES.forEach((t, i) => { priorityOrder[t] = i; });

      candidates.sort((a, b) => {
        const pa = priorityOrder[a.type] !== undefined ? priorityOrder[a.type] : 99;
        const pb = priorityOrder[b.type] !== undefined ? priorityOrder[b.type] : 99;
        if (pa !== pb) return pa - pb;
        return a.dist - b.dist;
      });

      const best = candidates[0];
      return { x: best.x, y: best.y, type: best.type, entityId: best.entityId };
    }

    // ───────────── collectors ─────────────

    _addCandidate(candidates, x, y, type, entityId, worldX, worldY, snapRadius) {
      const d = dist(x, y, worldX, worldY);
      if (d <= snapRadius) {
        candidates.push({ x, y, type, entityId: entityId || null, dist: d });
      }
    }

    // — endpoints —

    _collectEndpoints(wx, wy, entities, sr, out) {
      for (const e of entities) {
        const pts = this._getEndpoints(e);
        for (const p of pts) {
          this._addCandidate(out, p.x, p.y, "endpoint", e.id, wx, wy, sr);
        }
      }
    }

    _getEndpoints(e) {
      switch (e.type) {
        case "point":
          return [{ x: e.x, y: e.y }];
        case "line":
          return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
        case "arc":
          return [
            { x: e.cx + e.r * Math.cos(e.startAngle), y: e.cy + e.r * Math.sin(e.startAngle) },
            { x: e.cx + e.r * Math.cos(e.endAngle),   y: e.cy + e.r * Math.sin(e.endAngle) },
          ];
        case "rectangle":
          return [
            { x: e.x, y: e.y },
            { x: e.x + e.width, y: e.y },
            { x: e.x + e.width, y: e.y + e.height },
            { x: e.x, y: e.y + e.height },
          ];
        case "polygon":
        case "polyline":
        case "spline":
          return (e.points || []).map((p) => ({ x: p.x, y: p.y }));
        default:
          return [];
      }
    }

    // — midpoints —

    _collectMidpoints(wx, wy, entities, sr, out) {
      for (const e of entities) {
        if (e.type === "line") {
          const mx = (e.x1 + e.x2) / 2;
          const my = (e.y1 + e.y2) / 2;
          this._addCandidate(out, mx, my, "midpoint", e.id, wx, wy, sr);
        } else if (e.type === "polyline" && e.points && e.points.length >= 2) {
          for (let i = 0; i < e.points.length - 1; i++) {
            const a = e.points[i];
            const b = e.points[i + 1];
            this._addCandidate(out, (a.x + b.x) / 2, (a.y + b.y) / 2, "midpoint", e.id, wx, wy, sr);
          }
        } else if (e.type === "rectangle") {
          const sides = [
            [e.x, e.y, e.x + e.width, e.y],
            [e.x + e.width, e.y, e.x + e.width, e.y + e.height],
            [e.x + e.width, e.y + e.height, e.x, e.y + e.height],
            [e.x, e.y + e.height, e.x, e.y],
          ];
          for (const s of sides) {
            this._addCandidate(out, (s[0] + s[2]) / 2, (s[1] + s[3]) / 2, "midpoint", e.id, wx, wy, sr);
          }
        }
      }
    }

    // — centers —

    _collectCenters(wx, wy, entities, sr, out) {
      for (const e of entities) {
        if (e.type === "circle" || e.type === "arc") {
          this._addCandidate(out, e.cx, e.cy, "center", e.id, wx, wy, sr);
        } else if (e.type === "ellipse") {
          this._addCandidate(out, e.cx, e.cy, "center", e.id, wx, wy, sr);
        }
      }
    }

    // — intersections —

    _collectIntersections(wx, wy, entities, sr, out) {
      // check all pairs of line-type entities
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const pts = this._intersect(entities[i], entities[j]);
          for (const p of pts) {
            this._addCandidate(out, p.x, p.y, "intersection", null, wx, wy, sr);
          }
        }
      }
    }

    _intersect(a, b) {
      const segsA = this._toSegments(a);
      const segsB = this._toSegments(b);
      const results = [];

      for (const sa of segsA) {
        for (const sb of segsB) {
          const p = this._segSegIntersect(sa, sb);
          if (p) results.push(p);
        }
      }

      // line-circle and circle-circle cases
      if (a.type === "line" && (b.type === "circle" || b.type === "arc")) {
        results.push(...this._lineCircleIntersect(a.x1, a.y1, a.x2, a.y2, b.cx, b.cy, b.r, b));
      }
      if (b.type === "line" && (a.type === "circle" || a.type === "arc")) {
        results.push(...this._lineCircleIntersect(b.x1, b.y1, b.x2, b.y2, a.cx, a.cy, a.r, a));
      }

      return results;
    }

    _toSegments(e) {
      switch (e.type) {
        case "line":
          return [{ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 }];
        case "rectangle":
          return [
            { x1: e.x, y1: e.y, x2: e.x + e.width, y2: e.y },
            { x1: e.x + e.width, y1: e.y, x2: e.x + e.width, y2: e.y + e.height },
            { x1: e.x + e.width, y1: e.y + e.height, x2: e.x, y2: e.y + e.height },
            { x1: e.x, y1: e.y + e.height, x2: e.x, y2: e.y },
          ];
        case "polyline":
        case "polygon":
        case "spline": {
          const segs = [];
          if (e.points && e.points.length >= 2) {
            const n = e.type === "polygon" ? e.points.length : e.points.length - 1;
            for (let i = 0; i < n; i++) {
              const a = e.points[i];
              const b = e.points[(i + 1) % e.points.length];
              segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
            }
          }
          return segs;
        }
        default:
          return [];
      }
    }

    _segSegIntersect(s1, s2) {
      const dx1 = s1.x2 - s1.x1, dy1 = s1.y2 - s1.y1;
      const dx2 = s2.x2 - s2.x1, dy2 = s2.y2 - s2.y1;
      const denom = dx1 * dy2 - dy1 * dx2;
      if (Math.abs(denom) < 1e-12) return null;
      const t = ((s2.x1 - s1.x1) * dy2 - (s2.y1 - s1.y1) * dx2) / denom;
      const u = ((s2.x1 - s1.x1) * dy1 - (s2.y1 - s1.y1) * dx1) / denom;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return { x: s1.x1 + t * dx1, y: s1.y1 + t * dy1 };
      }
      return null;
    }

    _lineCircleIntersect(x1, y1, x2, y2, cx, cy, r, arcEntity) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const fx = x1 - cx;
      const fy = y1 - cy;
      const a = dx * dx + dy * dy;
      const b = 2 * (fx * dx + fy * dy);
      const c = fx * fx + fy * fy - r * r;
      let disc = b * b - 4 * a * c;
      if (disc < 0) return [];
      disc = Math.sqrt(disc);
      const results = [];
      for (const sign of [-1, 1]) {
        const t = (-b + sign * disc) / (2 * a);
        if (t >= 0 && t <= 1) {
          const px = x1 + t * dx;
          const py = y1 + t * dy;
          // if arc, check angle range
          if (arcEntity && arcEntity.type === "arc") {
            const angle = Math.atan2(py - cy, px - cx);
            if (!this._angleInRange(angle, arcEntity.startAngle, arcEntity.endAngle)) continue;
          }
          results.push({ x: px, y: py });
        }
      }
      return results;
    }

    _angleInRange(a, start, end) {
      const TWO_PI = Math.PI * 2;
      const normalize = (v) => ((v % TWO_PI) + TWO_PI) % TWO_PI;
      const ns = normalize(start);
      const ne = normalize(end);
      const na = normalize(a);
      if (ns <= ne) return na >= ns && na <= ne;
      return na >= ns || na <= ne;
    }

    // — perpendicular —

    _collectPerpendiculars(wx, wy, entities, sr, out) {
      for (const e of entities) {
        if (e.type === "line") {
          const p = this._perpPoint(wx, wy, e.x1, e.y1, e.x2, e.y2);
          if (p) {
            this._addCandidate(out, p.x, p.y, "perpendicular", e.id, wx, wy, sr);
          }
        } else if (e.type === "rectangle") {
          const sides = [
            [e.x, e.y, e.x + e.width, e.y],
            [e.x + e.width, e.y, e.x + e.width, e.y + e.height],
            [e.x + e.width, e.y + e.height, e.x, e.y + e.height],
            [e.x, e.y + e.height, e.x, e.y],
          ];
          for (const s of sides) {
            const p = this._perpPoint(wx, wy, s[0], s[1], s[2], s[3]);
            if (p) {
              this._addCandidate(out, p.x, p.y, "perpendicular", e.id, wx, wy, sr);
            }
          }
        }
      }
    }

    _perpPoint(px, py, ax, ay, bx, by) {
      const np = nearestPointOnSegment(px, py, ax, ay, bx, by);
      // only return if the foot is strictly interior (not an endpoint)
      const dA = dist(np.x, np.y, ax, ay);
      const dB = dist(np.x, np.y, bx, by);
      const segLen = dist(ax, ay, bx, by);
      if (segLen < 1e-12) return null;
      if (dA < 1e-9 || dB < 1e-9) return null; // it's an endpoint, not a perpendicular
      return np;
    }

    // — tangent —

    _collectTangents(wx, wy, entities, sr, out) {
      for (const e of entities) {
        if (e.type === "circle" || e.type === "arc") {
          const dc = dist(wx, wy, e.cx, e.cy);
          if (dc < e.r) continue; // inside circle — no tangent from interior
          if (dc < 1e-12) continue;

          // tangent point: foot of perpendicular from center to line (cursor->tangent)
          // The tangent points are where angle center-tangent-cursor = 90 degrees.
          const angle = Math.acos(e.r / dc);
          const baseAngle = Math.atan2(e.cy - wy, e.cx - wx);

          for (const sign of [-1, 1]) {
            const ta = baseAngle + sign * angle;
            const tx = e.cx - e.r * Math.cos(ta - sign * angle + sign * (Math.PI / 2 - angle) + Math.PI);
            // simpler: tangent point
            const tAngle = baseAngle + Math.PI + sign * angle;
            const tpx = e.cx + e.r * Math.cos(tAngle);
            const tpy = e.cy + e.r * Math.sin(tAngle);

            if (e.type === "arc") {
              if (!this._angleInRange(tAngle, e.startAngle, e.endAngle)) continue;
            }

            this._addCandidate(out, tpx, tpy, "tangent", e.id, wx, wy, sr);
          }
        }
      }
    }

    // — nearest —

    _collectNearest(wx, wy, entities, sr, out) {
      for (const e of entities) {
        const p = this._nearestOnEntity(wx, wy, e);
        if (p) {
          this._addCandidate(out, p.x, p.y, "nearest", e.id, wx, wy, sr);
        }
      }
    }

    _nearestOnEntity(px, py, e) {
      switch (e.type) {
        case "point":
          return { x: e.x, y: e.y };

        case "line":
          return nearestPointOnSegment(px, py, e.x1, e.y1, e.x2, e.y2);

        case "circle": {
          const d = dist(px, py, e.cx, e.cy);
          if (d < 1e-12) return { x: e.cx + e.r, y: e.cy };
          return {
            x: e.cx + (px - e.cx) / d * e.r,
            y: e.cy + (py - e.cy) / d * e.r,
          };
        }

        case "arc": {
          const d = dist(px, py, e.cx, e.cy);
          if (d < 1e-12) {
            return { x: e.cx + e.r * Math.cos(e.startAngle), y: e.cy + e.r * Math.sin(e.startAngle) };
          }
          const angle = Math.atan2(py - e.cy, px - e.cx);
          if (this._angleInRange(angle, e.startAngle, e.endAngle)) {
            return {
              x: e.cx + (px - e.cx) / d * e.r,
              y: e.cy + (py - e.cy) / d * e.r,
            };
          }
          // closest arc endpoint
          const p1 = { x: e.cx + e.r * Math.cos(e.startAngle), y: e.cy + e.r * Math.sin(e.startAngle) };
          const p2 = { x: e.cx + e.r * Math.cos(e.endAngle),   y: e.cy + e.r * Math.sin(e.endAngle) };
          return dist(px, py, p1.x, p1.y) < dist(px, py, p2.x, p2.y) ? p1 : p2;
        }

        case "ellipse": {
          // approximate: project onto ellipse along radial from center
          const rot = e.rotation || 0;
          const dx = px - e.cx;
          const dy = py - e.cy;
          const cosR = Math.cos(-rot);
          const sinR = Math.sin(-rot);
          const lx = dx * cosR - dy * sinR;
          const ly = dx * sinR + dy * cosR;
          const angle = Math.atan2(ly / e.ry, lx / e.rx);
          const nx = e.rx * Math.cos(angle);
          const ny = e.ry * Math.sin(angle);
          const cosR2 = Math.cos(rot);
          const sinR2 = Math.sin(rot);
          return {
            x: e.cx + nx * cosR2 - ny * sinR2,
            y: e.cy + nx * sinR2 + ny * cosR2,
          };
        }

        case "rectangle": {
          const sides = [
            [e.x, e.y, e.x + e.width, e.y],
            [e.x + e.width, e.y, e.x + e.width, e.y + e.height],
            [e.x + e.width, e.y + e.height, e.x, e.y + e.height],
            [e.x, e.y + e.height, e.x, e.y],
          ];
          let best = null, bestD = Infinity;
          for (const s of sides) {
            const np = nearestPointOnSegment(px, py, s[0], s[1], s[2], s[3]);
            const d = dist(px, py, np.x, np.y);
            if (d < bestD) { bestD = d; best = np; }
          }
          return best;
        }

        case "polygon":
        case "polyline":
        case "spline": {
          if (!e.points || e.points.length < 2) return null;
          let best = null, bestD = Infinity;
          const n = e.type === "polygon" ? e.points.length : e.points.length - 1;
          for (let i = 0; i < n; i++) {
            const a = e.points[i];
            const b = e.points[(i + 1) % e.points.length];
            const np = nearestPointOnSegment(px, py, a.x, a.y, b.x, b.y);
            const d = dist(px, py, np.x, np.y);
            if (d < bestD) { bestD = d; best = np; }
          }
          return best;
        }

        default:
          return null;
      }
    }

    // — grid —

    _collectGrid(wx, wy, sr, out) {
      const g = this.gridSpacing;
      if (g <= 0) return;
      const gx = Math.round(wx / g) * g;
      const gy = Math.round(wy / g) * g;
      this._addCandidate(out, gx, gy, "grid", null, wx, wy, sr);
    }
  }

  // expose globally
  window.SnapSystem = SnapSystem;
})();
