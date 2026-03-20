/**
 * AutoConstraintEngine - SolidWorks-style automatic constraint detection
 * and suggestion while drawing.
 *
 * Detects geometric relationships in real-time during entity creation,
 * renders visual indicators, and returns constraint objects when the
 * user commits an entity.
 *
 * Attach: window.AutoConstraintEngine
 */
(function () {
  "use strict";

  // ───────────────────── math constants & helpers ─────────────────────

  var DEG = Math.PI / 180;
  var TWO_PI = 2 * Math.PI;

  function dist(x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function distSq(x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    return dx * dx + dy * dy;
  }

  /** Normalize angle to [0, PI) — used for undirected line angles. */
  function normalizeLineAngle(a) {
    a = a % Math.PI;
    if (a < 0) a += Math.PI;
    return a;
  }

  /** Smallest unsigned angle between two undirected line angles. */
  function angleDiff(a, b) {
    var d = Math.abs(normalizeLineAngle(a) - normalizeLineAngle(b));
    if (d > Math.PI / 2) d = Math.PI - d;
    return d;
  }

  /** Get the angle of a line entity (atan2). */
  function lineAngle(e) {
    return Math.atan2(e.y2 - e.y1, e.x2 - e.x1);
  }

  /** Length of a line entity. */
  function lineLength(e) {
    return dist(e.x1, e.y1, e.x2, e.y2);
  }

  /** Midpoint of a line entity. */
  function lineMidpoint(e) {
    return { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
  }

  /**
   * Return all endpoints of an entity as [{x, y, which}].
   * `which` identifies the point (for building entityId references).
   */
  function getEndpoints(entity) {
    var pts = [];
    if (entity.type === "line") {
      pts.push({ x: entity.x1, y: entity.y1, which: "start" });
      pts.push({ x: entity.x2, y: entity.y2, which: "end" });
    } else if (entity.type === "arc") {
      var sa = entity.startAngle;
      var ea = entity.endAngle;
      pts.push({
        x: entity.cx + entity.r * Math.cos(sa),
        y: entity.cy + entity.r * Math.sin(sa),
        which: "start",
      });
      pts.push({
        x: entity.cx + entity.r * Math.cos(ea),
        y: entity.cy + entity.r * Math.sin(ea),
        which: "end",
      });
    } else if (entity.type === "point") {
      pts.push({ x: entity.x, y: entity.y, which: "point" });
    }
    return pts;
  }

  /**
   * Distance from point (px, py) to line through (x1,y1)-(x2,y2)
   * (infinite line, not segment).
   */
  function pointToLineDist(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-12) return dist(px, py, x1, y1);
    return Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len;
  }

  // ───────────────────── AutoConstraintEngine ─────────────────────

  class AutoConstraintEngine {
    constructor(opts) {
      opts = opts || {};

      // Master enable flag
      this.enabled = opts.enabled !== undefined ? opts.enabled : true;

      // Tolerances
      this.hvAngleTolerance = (opts.hvAngleTolerance || 3) * DEG;
      this.relAngleTolerance = (opts.relAngleTolerance || 5) * DEG;
      this.distanceTolerance = opts.distanceTolerance || 10; // in world units — caller should set based on snap radius / scale
      this.lengthEqualPercent = opts.lengthEqualPercent || 0.05; // 5%
      this.collinearDistFactor = opts.collinearDistFactor || 0.5; // world units

      // Individual constraint type toggles (all on by default)
      this.typeEnabled = {
        coincident: true,
        horizontal: true,
        vertical: true,
        perpendicular: true,
        parallel: true,
        tangent: true,
        equal: true,
        collinear: true,
        midpoint: true,
        concentric: true,
      };

      // Override toggles from opts
      if (opts.typeEnabled) {
        for (var k in opts.typeEnabled) {
          if (opts.typeEnabled.hasOwnProperty(k)) {
            this.typeEnabled[k] = opts.typeEnabled[k];
          }
        }
      }

      // Cached suggestions (set after detect)
      this._suggestions = [];
    }

    // ─────────────────── public API ───────────────────

    /**
     * Detect auto-constraints for the entity currently being drawn.
     *
     * @param {Object}   currentEntity  The entity-in-progress (preview).
     *                                  Must have at least {type, ...coords}.
     * @param {Object[]} allEntities    All committed entities in the sketch.
     * @param {{x:number,y:number}} cursorWorld  Current cursor in world coords.
     * @param {number}   tolerance      Snap tolerance in world units.
     * @returns {Object[]} Array of suggestion objects.
     */
    detect(currentEntity, allEntities, cursorWorld, tolerance) {
      if (!this.enabled || !currentEntity) return [];

      if (tolerance !== undefined) {
        this.distanceTolerance = tolerance;
      }

      var suggestions = [];
      var tol = this.distanceTolerance;
      var tolSq = tol * tol;

      // ----- 1. Coincident -----
      if (this.typeEnabled.coincident) {
        this._detectCoincident(
          currentEntity,
          allEntities,
          cursorWorld,
          tolSq,
          suggestions
        );
      }

      // For lines we can detect H/V/perpendicular/parallel/equal/collinear
      if (currentEntity.type === "line") {
        var dx = currentEntity.x2 - currentEntity.x1;
        var dy = currentEntity.y2 - currentEntity.y1;
        var len = Math.sqrt(dx * dx + dy * dy);

        if (len > 1e-9) {
          var angle = Math.atan2(dy, dx);

          // ----- 2. Horizontal -----
          if (this.typeEnabled.horizontal) {
            this._detectHorizontal(currentEntity, angle, suggestions);
          }

          // ----- 3. Vertical -----
          if (this.typeEnabled.vertical) {
            this._detectVertical(currentEntity, angle, suggestions);
          }

          // ----- 4. Perpendicular -----
          if (this.typeEnabled.perpendicular) {
            this._detectPerpendicular(
              currentEntity,
              angle,
              allEntities,
              suggestions
            );
          }

          // ----- 5. Parallel -----
          if (this.typeEnabled.parallel) {
            this._detectParallel(
              currentEntity,
              angle,
              allEntities,
              suggestions
            );
          }

          // ----- 6. Tangent -----
          if (this.typeEnabled.tangent) {
            this._detectTangent(
              currentEntity,
              angle,
              allEntities,
              tol,
              suggestions
            );
          }

          // ----- 7. Equal length -----
          if (this.typeEnabled.equal) {
            this._detectEqual(currentEntity, len, allEntities, suggestions);
          }

          // ----- 8. Collinear -----
          if (this.typeEnabled.collinear) {
            this._detectCollinear(
              currentEntity,
              angle,
              allEntities,
              suggestions
            );
          }
        }
      }

      // ----- 9. Midpoint -----
      if (this.typeEnabled.midpoint) {
        this._detectMidpoint(
          currentEntity,
          allEntities,
          cursorWorld,
          tolSq,
          suggestions
        );
      }

      // ----- 10. Concentric -----
      if (this.typeEnabled.concentric) {
        this._detectConcentric(
          currentEntity,
          allEntities,
          tolSq,
          suggestions
        );
      }

      // Sort by priority (lower = higher priority)
      suggestions.sort(function (a, b) {
        return a.priority - b.priority;
      });

      this._suggestions = suggestions;
      return suggestions;
    }

    /**
     * Render visual indicators for the detected suggestions.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object[]} suggestions  Result from detect().
     * @param {Object}   canvasEngine CanvasEngine instance (for worldToScreen).
     */
    renderSuggestions(ctx, suggestions, canvasEngine) {
      if (!suggestions || suggestions.length === 0) return;

      ctx.save();

      for (var i = 0; i < suggestions.length; i++) {
        var s = suggestions[i];
        switch (s.type) {
          case "coincident":
            this._renderCoincident(ctx, s, canvasEngine);
            break;
          case "horizontal":
            this._renderHV(ctx, s, canvasEngine, "H");
            break;
          case "vertical":
            this._renderHV(ctx, s, canvasEngine, "V");
            break;
          case "perpendicular":
            this._renderSymbolAtMidpoint(ctx, s, canvasEngine, "\u22A5");
            break;
          case "parallel":
            this._renderSymbolAtMidpoint(ctx, s, canvasEngine, "\u2225");
            break;
          case "tangent":
            this._renderTangent(ctx, s, canvasEngine);
            break;
          case "equal":
            this._renderSymbolAtMidpoint(ctx, s, canvasEngine, "=");
            break;
          case "collinear":
            this._renderCollinear(ctx, s, canvasEngine);
            break;
          case "midpoint":
            this._renderMidpoint(ctx, s, canvasEngine);
            break;
          case "concentric":
            this._renderConcentric(ctx, s, canvasEngine);
            break;
        }
      }

      ctx.restore();
    }

    /**
     * Accept and filter suggestions to produce constraint objects for
     * the constraint manager. Called when the user commits an entity.
     *
     * @param {Object[]} suggestions
     * @returns {Object[]} Filtered constraint descriptors:
     *   { type, entityIds, value? }
     */
    acceptSuggestions(suggestions) {
      if (!suggestions || suggestions.length === 0) return [];

      var accepted = [];
      var hasHorizontal = false;
      var hasVertical = false;
      var hasPerpendicular = false;
      var hasParallel = false;
      var hasCollinear = false;

      for (var i = 0; i < suggestions.length; i++) {
        var s = suggestions[i];

        // Conflict rules:
        // - Don't apply both horizontal and vertical
        // - Don't apply parallel AND perpendicular to same reference
        // - Don't apply collinear AND parallel (collinear implies parallel)
        // - Horizontal/Vertical conflict with perpendicular/parallel to
        //   the same reference line

        if (s.type === "horizontal") {
          if (hasVertical || hasPerpendicular) continue;
          hasHorizontal = true;
        } else if (s.type === "vertical") {
          if (hasHorizontal || hasPerpendicular) continue;
          hasVertical = true;
        } else if (s.type === "perpendicular") {
          if (hasHorizontal || hasVertical || hasParallel) continue;
          hasPerpendicular = true;
        } else if (s.type === "parallel") {
          if (hasHorizontal || hasVertical || hasPerpendicular || hasCollinear)
            continue;
          hasParallel = true;
        } else if (s.type === "collinear") {
          if (hasParallel) continue;
          hasCollinear = true;
        }

        accepted.push({
          type: s.type,
          entityIds: s.entityIds ? s.entityIds.slice() : [],
          value: s.value !== undefined ? s.value : null,
        });
      }

      return accepted;
    }

    // ─────────────────── detection methods ───────────────────

    /** 1. Coincident: cursor near an existing endpoint. */
    _detectCoincident(entity, allEntities, cursor, tolSq, out) {
      var bestDistSq = tolSq;
      var bestPt = null;
      var bestEntityId = null;

      for (var i = 0; i < allEntities.length; i++) {
        var other = allEntities[i];
        if (other.id === entity.id || other._preview) continue;

        var pts = getEndpoints(other);
        for (var j = 0; j < pts.length; j++) {
          var dsq = distSq(cursor.x, cursor.y, pts[j].x, pts[j].y);
          if (dsq < bestDistSq) {
            bestDistSq = dsq;
            bestPt = pts[j];
            bestEntityId = other.id;
          }
        }
      }

      if (bestPt) {
        out.push({
          type: "coincident",
          entityIds: [entity.id, bestEntityId],
          indicator: "Coincident",
          snapPoint: { x: bestPt.x, y: bestPt.y },
          priority: 1,
          _screenHint: bestPt,
        });
      }
    }

    /** 2. Horizontal: line within hvAngleTolerance of horizontal. */
    _detectHorizontal(entity, angle, out) {
      // Check closeness to 0 or PI
      var absAngle = Math.abs(angle);
      if (absAngle < this.hvAngleTolerance || Math.abs(absAngle - Math.PI) < this.hvAngleTolerance) {
        // Snap: keep x1,y1; adjust y2 = y1
        out.push({
          type: "horizontal",
          entityIds: [entity.id],
          indicator: "H",
          snapPoint: { x: entity.x2, y: entity.y1 },
          priority: 2,
          _entity: entity,
        });
      }
    }

    /** 3. Vertical: line within hvAngleTolerance of vertical. */
    _detectVertical(entity, angle, out) {
      var dev = Math.abs(Math.abs(angle) - Math.PI / 2);
      if (dev < this.hvAngleTolerance) {
        // Snap: keep x1,y1; adjust x2 = x1
        out.push({
          type: "vertical",
          entityIds: [entity.id],
          indicator: "V",
          snapPoint: { x: entity.x1, y: entity.y2 },
          priority: 3,
          _entity: entity,
        });
      }
    }

    /** 4. Perpendicular: line ~90deg to a nearby committed line. */
    _detectPerpendicular(entity, angle, allEntities, out) {
      var tol = this.relAngleTolerance;
      var best = null;
      var bestDev = tol;

      for (var i = 0; i < allEntities.length; i++) {
        var other = allEntities[i];
        if (other.type !== "line" || other.id === entity.id || other._preview)
          continue;

        // Quick bounding box proximity check — skip distant lines
        if (this._linesFarApart(entity, other)) continue;

        var otherAngle = lineAngle(other);
        var diff = angleDiff(angle, otherAngle);
        var dev = Math.abs(diff - Math.PI / 2);
        if (dev < bestDev) {
          bestDev = dev;
          best = other;
        }
      }

      if (best) {
        // Compute snap: rotate endpoint around start to exact perpendicular
        var otherAngle = lineAngle(best);
        var perpAngle = otherAngle + Math.PI / 2;
        // Choose direction closer to current angle
        var a1 = normalizeLineAngle(perpAngle);
        var a2 = normalizeLineAngle(angle);
        if (Math.abs(a1 - a2) > Math.PI / 2) {
          perpAngle += Math.PI;
        }
        var len = lineLength(entity);
        var snappedX = entity.x1 + len * Math.cos(perpAngle);
        var snappedY = entity.y1 + len * Math.sin(perpAngle);

        out.push({
          type: "perpendicular",
          entityIds: [entity.id, best.id],
          indicator: "\u22A5",
          snapPoint: { x: snappedX, y: snappedY },
          priority: 4,
          _entity: entity,
          _refEntity: best,
        });
      }
    }

    /** 5. Parallel: line ~0deg angle difference to a nearby committed line. */
    _detectParallel(entity, angle, allEntities, out) {
      var tol = this.relAngleTolerance;
      var best = null;
      var bestDev = tol;

      for (var i = 0; i < allEntities.length; i++) {
        var other = allEntities[i];
        if (other.type !== "line" || other.id === entity.id || other._preview)
          continue;

        if (this._linesFarApart(entity, other)) continue;

        var diff = angleDiff(angle, lineAngle(other));
        if (diff < bestDev) {
          bestDev = diff;
          best = other;
        }
      }

      if (best) {
        var refAngle = lineAngle(best);
        // Choose direction closer to current
        var a1 = normalizeLineAngle(refAngle);
        var a2 = normalizeLineAngle(angle);
        var parAngle = refAngle;
        if (Math.abs(a1 - a2) > Math.PI / 2) {
          parAngle += Math.PI;
        }
        var len = lineLength(entity);
        var snappedX = entity.x1 + len * Math.cos(parAngle);
        var snappedY = entity.y1 + len * Math.sin(parAngle);

        out.push({
          type: "parallel",
          entityIds: [entity.id, best.id],
          indicator: "\u2225",
          snapPoint: { x: snappedX, y: snappedY },
          priority: 5,
          _entity: entity,
          _refEntity: best,
        });
      }
    }

    /**
     * 6. Tangent: line endpoint on/near a circle or arc AND angle matches
     *    the tangent direction at that point.
     */
    _detectTangent(entity, angle, allEntities, tol, out) {
      for (var i = 0; i < allEntities.length; i++) {
        var other = allEntities[i];
        if (other._preview) continue;
        if (other.type !== "circle" && other.type !== "arc") continue;

        var cx = other.cx,
          cy = other.cy,
          r = other.r;

        // Check if the line's endpoint (x2,y2) is near the circle
        var dEnd = Math.abs(dist(entity.x2, entity.y2, cx, cy) - r);
        // Also check start
        var dStart = Math.abs(dist(entity.x1, entity.y1, cx, cy) - r);

        var nearEnd = dEnd < tol;
        var nearStart = dStart < tol;
        if (!nearEnd && !nearStart) continue;

        // Use whichever endpoint is on/near the circle
        var px, py;
        if (nearEnd && nearStart) {
          px = dEnd <= dStart ? entity.x2 : entity.x1;
          py = dEnd <= dStart ? entity.y2 : entity.y1;
        } else if (nearEnd) {
          px = entity.x2;
          py = entity.y2;
        } else {
          px = entity.x1;
          py = entity.y1;
        }

        // Tangent angle at that point on the circle
        var radialAngle = Math.atan2(py - cy, px - cx);
        var tangentAngle = radialAngle + Math.PI / 2;

        var diff = angleDiff(angle, tangentAngle);
        if (diff < this.relAngleTolerance) {
          // Compute exact tangent point on circle
          var closestAngleOnCircle = Math.atan2(py - cy, px - cx);
          var snapX = cx + r * Math.cos(closestAngleOnCircle);
          var snapY = cy + r * Math.sin(closestAngleOnCircle);

          out.push({
            type: "tangent",
            entityIds: [entity.id, other.id],
            indicator: "T",
            snapPoint: { x: snapX, y: snapY },
            priority: 6,
            _entity: entity,
            _refEntity: other,
          });
          break; // one tangent suggestion is enough
        }
      }
    }

    /** 7. Equal length: current line has similar length to a nearby line. */
    _detectEqual(entity, len, allEntities, out) {
      var threshold = len * this.lengthEqualPercent;
      var best = null;
      var bestDiff = threshold;

      for (var i = 0; i < allEntities.length; i++) {
        var other = allEntities[i];
        if (other.type !== "line" || other.id === entity.id || other._preview)
          continue;

        var otherLen = lineLength(other);
        var diff = Math.abs(otherLen - len);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = other;
        }
      }

      if (best) {
        out.push({
          type: "equal",
          entityIds: [entity.id, best.id],
          indicator: "=",
          priority: 7,
          _entity: entity,
          _refEntity: best,
        });
      }
    }

    /**
     * 8. Collinear: current line lies on the same infinite line as another.
     *    Checks both angle alignment and distance from line.
     */
    _detectCollinear(entity, angle, allEntities, out) {
      var angleTol = this.relAngleTolerance;
      var distTol = this.collinearDistFactor;

      for (var i = 0; i < allEntities.length; i++) {
        var other = allEntities[i];
        if (other.type !== "line" || other.id === entity.id || other._preview)
          continue;

        // Quick angle check
        var diff = angleDiff(angle, lineAngle(other));
        if (diff > angleTol) continue;

        // Distance from entity's start to the other line (infinite)
        var d1 = pointToLineDist(
          entity.x1,
          entity.y1,
          other.x1,
          other.y1,
          other.x2,
          other.y2
        );
        var d2 = pointToLineDist(
          entity.x2,
          entity.y2,
          other.x1,
          other.y1,
          other.x2,
          other.y2
        );

        if (d1 < distTol && d2 < distTol) {
          out.push({
            type: "collinear",
            entityIds: [entity.id, other.id],
            indicator: "collinear",
            priority: 8,
            _entity: entity,
            _refEntity: other,
          });
          break; // one is enough
        }
      }
    }

    /** 9. Midpoint: cursor near the midpoint of an existing line. */
    _detectMidpoint(entity, allEntities, cursor, tolSq, out) {
      for (var i = 0; i < allEntities.length; i++) {
        var other = allEntities[i];
        if (other.type !== "line" || other.id === entity.id || other._preview)
          continue;

        var mid = lineMidpoint(other);
        var dsq = distSq(cursor.x, cursor.y, mid.x, mid.y);
        if (dsq < tolSq) {
          out.push({
            type: "midpoint",
            entityIds: [entity.id, other.id],
            indicator: "midpoint",
            snapPoint: { x: mid.x, y: mid.y },
            priority: 9,
            _midpoint: mid,
          });
          break;
        }
      }
    }

    /** 10. Concentric: circle/arc center near another circle/arc center. */
    _detectConcentric(entity, allEntities, tolSq, out) {
      if (entity.type !== "circle" && entity.type !== "arc") return;

      var cx = entity.cx,
        cy = entity.cy;

      for (var i = 0; i < allEntities.length; i++) {
        var other = allEntities[i];
        if (other.type !== "circle" && other.type !== "arc") continue;
        if (other.id === entity.id || other._preview) continue;

        var dsq = distSq(cx, cy, other.cx, other.cy);
        if (dsq < tolSq) {
          out.push({
            type: "concentric",
            entityIds: [entity.id, other.id],
            indicator: "concentric",
            snapPoint: { x: other.cx, y: other.cy },
            priority: 10,
            _center: { x: other.cx, y: other.cy },
          });
          break;
        }
      }
    }

    // ─────────────────── rendering helpers ───────────────────

    /** Coincident: small filled dot at snap point. */
    _renderCoincident(ctx, s, ce) {
      var pt = ce.worldToScreen(s.snapPoint.x, s.snapPoint.y);
      ctx.fillStyle = "#ffd700";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5, 0, TWO_PI);
      ctx.fill();

      // Label
      this._drawLabel(ctx, pt.x + 10, pt.y - 6, "Coincident");
    }

    /** Horizontal / Vertical: symbol near the midpoint of the line. */
    _renderHV(ctx, s, ce, label) {
      var e = s._entity;
      if (!e) return;
      var mx = (e.x1 + e.x2) / 2;
      var my = (e.y1 + e.y2) / 2;
      var pt = ce.worldToScreen(mx, my);

      // Draw a guide line showing the snapped direction
      if (s.snapPoint) {
        var sp = ce.worldToScreen(e.x1, e.y1);
        var ep = ce.worldToScreen(s.snapPoint.x, s.snapPoint.y);
        ctx.strokeStyle = "rgba(255, 215, 0, 0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(ep.x, ep.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Symbol box
      this._drawSymbolBox(ctx, pt.x, pt.y - 16, label);
    }

    /** Generic symbol rendered at the midpoint of the current entity. */
    _renderSymbolAtMidpoint(ctx, s, ce, symbol) {
      var e = s._entity;
      if (!e) return;
      var mx = (e.x1 + e.x2) / 2;
      var my = (e.y1 + e.y2) / 2;
      var pt = ce.worldToScreen(mx, my);

      this._drawSymbolBox(ctx, pt.x, pt.y - 16, symbol);
    }

    /** Tangent: "T" symbol near the tangent point. */
    _renderTangent(ctx, s, ce) {
      if (!s.snapPoint) return;
      var pt = ce.worldToScreen(s.snapPoint.x, s.snapPoint.y);

      ctx.fillStyle = "#ffd700";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, TWO_PI);
      ctx.fill();

      this._drawSymbolBox(ctx, pt.x + 10, pt.y - 10, "T");
    }

    /** Collinear: dashed extension line. */
    _renderCollinear(ctx, s, ce) {
      var ref = s._refEntity;
      if (!ref) return;

      // Draw a dashed extension of the reference line
      var angle = lineAngle(ref);
      var mid = lineMidpoint(ref);
      var ext = 1000; // large screen extent
      var cos = Math.cos(angle);
      var sin = Math.sin(angle);

      var p1 = ce.worldToScreen(mid.x - ext * cos, mid.y - ext * sin);
      var p2 = ce.worldToScreen(mid.x + ext * cos, mid.y + ext * sin);

      ctx.strokeStyle = "rgba(255, 215, 0, 0.25)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    /** Midpoint: small triangle at the midpoint. */
    _renderMidpoint(ctx, s, ce) {
      var mid = s._midpoint;
      if (!mid) return;
      var pt = ce.worldToScreen(mid.x, mid.y);

      ctx.fillStyle = "#ffd700";
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y - 6);
      ctx.lineTo(pt.x - 5, pt.y + 4);
      ctx.lineTo(pt.x + 5, pt.y + 4);
      ctx.closePath();
      ctx.fill();

      this._drawLabel(ctx, pt.x + 8, pt.y + 2, "Midpoint");
    }

    /** Concentric: small concentric circles icon at center. */
    _renderConcentric(ctx, s, ce) {
      var c = s._center;
      if (!c) return;
      var pt = ce.worldToScreen(c.x, c.y);

      ctx.strokeStyle = "#ffd700";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, TWO_PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8, 0, TWO_PI);
      ctx.stroke();

      this._drawLabel(ctx, pt.x + 12, pt.y - 4, "Concentric");
    }

    // ─────────────────── rendering primitives ───────────────────

    /** Draw a small rounded box with a symbol character. */
    _drawSymbolBox(ctx, x, y, symbol) {
      var w = 18;
      var h = 18;
      var r = 3;

      // Background
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.beginPath();
      ctx.moveTo(x - w / 2 + r, y - h / 2);
      ctx.lineTo(x + w / 2 - r, y - h / 2);
      ctx.arcTo(x + w / 2, y - h / 2, x + w / 2, y - h / 2 + r, r);
      ctx.lineTo(x + w / 2, y + h / 2 - r);
      ctx.arcTo(x + w / 2, y + h / 2, x + w / 2 - r, y + h / 2, r);
      ctx.lineTo(x - w / 2 + r, y + h / 2);
      ctx.arcTo(x - w / 2, y + h / 2, x - w / 2, y + h / 2 - r, r);
      ctx.lineTo(x - w / 2, y - h / 2 + r);
      ctx.arcTo(x - w / 2, y - h / 2, x - w / 2 + r, y - h / 2, r);
      ctx.closePath();
      ctx.fill();

      // Border
      ctx.strokeStyle = "#ffd700";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Symbol text
      ctx.fillStyle = "#ffd700";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(symbol, x, y);
    }

    /** Draw a small text label. */
    _drawLabel(ctx, x, y, text) {
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#ffd700";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      // Background for readability
      var metrics = ctx.measureText(text);
      var pad = 3;
      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
      ctx.fillRect(
        x - pad,
        y - 7 - pad,
        metrics.width + pad * 2,
        14 + pad * 2
      );

      ctx.fillStyle = "#ffd700";
      ctx.fillText(text, x, y);
    }

    // ─────────────────── spatial helpers ───────────────────

    /**
     * Quick bounding-box check: are two lines far enough apart that
     * they can't possibly be related? Used for early-exit.
     */
    _linesFarApart(a, b) {
      // Expand bounding boxes by a generous margin and check overlap
      var margin = 50; // world units — generous
      var aMinX = Math.min(a.x1, a.x2) - margin;
      var aMaxX = Math.max(a.x1, a.x2) + margin;
      var aMinY = Math.min(a.y1, a.y2) - margin;
      var aMaxY = Math.max(a.y1, a.y2) + margin;

      var bMinX = Math.min(b.x1, b.x2);
      var bMaxX = Math.max(b.x1, b.x2);
      var bMinY = Math.min(b.y1, b.y2);
      var bMaxY = Math.max(b.y1, b.y2);

      return aMaxX < bMinX || bMaxX < aMinX || aMaxY < bMinY || bMaxY < aMinY;
    }
  }

  // ─────────────────── export ───────────────────

  window.AutoConstraintEngine = AutoConstraintEngine;
})();
