/* ============================================================
   FaceSwap Studio — swap engine (pure canvas, no dependencies)
   1. similarity warp  (eye-line rotation + scale + centroid)
   2. colour match     (per-channel mean/std inside the mask)
   3. feathered mask   (face-oval polygon + canvas blur)
   4. composite + optional watermark
   ============================================================ */
var SwapEngine = (function () {
  "use strict";

  /* MediaPipe face-oval contour (ordered, closed polygon) */
  var FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323,
    361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
    176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
    162, 21, 54, 103, 67, 109
  ];

  /* landmarks used to anchor the transform */
  var EYE_L = 33, EYE_R = 263, NOSE = 1, CHIN = 152, MOUTH_L = 61, MOUTH_R = 291;

  function centroid(pts) {
    var x = 0, y = 0;
    for (var i = 0; i < pts.length; i++) { x += pts[i].x; y += pts[i].y; }
    return { x: x / pts.length, y: y / pts.length };
  }

  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

  function angle(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }

  function scaledPoints(pts, factor) {
    var c = centroid(pts);
    return pts.map(function (p) {
      return { x: c.x + (p.x - c.x) * factor, y: c.y + (p.y - c.y) * factor };
    });
  }

  function toPixels(marks, w, h) {
    return marks.map(function (p) { return { x: p.x * w, y: p.y * h }; });
  }

  function makeCanvas(w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  /* similarity transform: rotate the eye-line, scale by eye distance,
     land the key-point centroid on the target centroid */
  function warp(sp, dp, w, h, sourceCanvas) {
    var layer = makeCanvas(w, h);
    var ctx = layer.getContext("2d");

    var ds = dist(sp[EYE_L], sp[EYE_R]);
    var dd = dist(dp[EYE_L], dp[EYE_R]);
    var scale = dd / Math.max(1, ds);
    var rot = angle(dp[EYE_L], dp[EYE_R]) - angle(sp[EYE_L], sp[EYE_R]);

    var keys = [EYE_L, EYE_R, MOUTH_L, MOUTH_R, CHIN];
    var sk = keys.map(function (i) { return sp[i]; });
    var dk = keys.map(function (i) { return dp[i]; });
    var cs = centroid(sk), cd = centroid(dk);

    ctx.translate(cd.x, cd.y);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.translate(-cs.x, -cs.y);
    ctx.drawImage(sourceCanvas, 0, 0);

    return layer;
  }

  /* mask: face-oval polygon, slightly expanded, blurred for feathering */
  function buildMask(dp, w, h, featherPx) {
    var mask = makeCanvas(w, h);
    var mctx = mask.getContext("2d");
    var oval = FACE_OVAL.map(function (i) { return dp[i]; });
    var expanded = scaledPoints(oval, 1.05);

    mctx.fillStyle = "#fff";
    mctx.beginPath();
    mctx.moveTo(expanded[0].x, expanded[0].y);
    for (var i = 1; i < expanded.length; i++) mctx.lineTo(expanded[i].x, expanded[i].y);
    mctx.closePath();
    mctx.fill();
    return mask;
  }

  function boundingBox(pts, pad) {
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].x < x1) x1 = pts[i].x;
      if (pts[i].y < y1) y1 = pts[i].y;
      if (pts[i].x > x2) x2 = pts[i].x;
      if (pts[i].y > y2) y2 = pts[i].y;
    }
    return {
      x: Math.max(0, Math.floor(x1 - pad)),
      y: Math.max(0, Math.floor(y1 - pad)),
      w: Math.ceil(x2 - x1 + pad * 2),
      h: Math.ceil(y2 - y1 + pad * 2)
    };
  }

  /* mean / std per channel, weighted by mask alpha */
  function stats(imgData, maskData) {
    var d = imgData.data, m = maskData.data;
    var sum = [0, 0, 0], sum2 = [0, 0, 0], wsum = 0;
    for (var i = 0; i < d.length; i += 4) {
      var w = m[i + 3] / 255;
      if (w <= 0) continue;
      wsum += w;
      for (var c = 0; c < 3; c++) {
        var v = d[i + c];
        sum[c] += v * w;
        sum2[c] += v * v * w;
      }
    }
    if (wsum < 1) return null;
    var mean = [], std = [];
    for (var c2 = 0; c2 < 3; c2++) {
      var mu = sum[c2] / wsum;
      mean.push(mu);
      std.push(Math.sqrt(Math.max(0, sum2[c2] / wsum - mu * mu)));
    }
    return { mean: mean, std: std };
  }

  function colorMatch(layerCtx, targetCtx, rect, mask) {
    var layerData = layerCtx.getImageData(rect.x, rect.y, rect.w, rect.h);
    var targetData = targetCtx.getImageData(rect.x, rect.y, rect.w, rect.h);
    var maskData = mask.getContext("2d").getImageData(rect.x, rect.y, rect.w, rect.h);

    var s = stats(layerData, maskData);
    var t = stats(targetData, maskData);
    if (!s || !t) return;

    var d = layerData.data;
    for (var i = 0; i < d.length; i += 4) {
      for (var c = 0; c < 3; c++) {
        var gain = t.std[c] / Math.max(1, s.std[c]);
        var v = (d[i + c] - s.mean[c]) * gain + t.mean[c];
        d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    layerCtx.putImageData(layerData, rect.x, rect.y);
  }

  function drawWatermark(ctx, w, h) {
    var size = Math.max(13, Math.round(w * 0.016));
    var pad = Math.round(size * 0.6);
    var text = "AI-GENERATED";
    ctx.save();
    ctx.font = "600 " + size + "px Consolas, Menlo, monospace";
    var tw = ctx.measureText(text).width;
    var bw = tw + pad * 2, bh = size + pad * 1.6;
    var bx = w - bw - pad, by = h - bh - pad;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#05070f";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, Math.round(size * 0.35));
    else ctx.rect(bx, by, bw, bh);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#5dffb0";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + pad, by + bh / 2 + 1);
    ctx.restore();
  }

  /* ----------------------------------------------------------
     main entry
     opts: { sourceCanvas, sourceMarks (normalized),
             targetCanvas, targetMarks (normalized),
             feather (px @ 1200w), colorMatch (bool),
             watermark (bool) }
     returns a canvas with the swapped result
  ---------------------------------------------------------- */
  function swap(opts) {
    var src = opts.sourceCanvas, tgt = opts.targetCanvas;
    var w = tgt.width, h = tgt.height;

    var sp = toPixels(opts.sourceMarks, src.width, src.height);
    var dp = toPixels(opts.targetMarks, w, h);

    var featherPx = Math.max(1, Math.round((opts.feather || 12) * (w / 1200)));
    var mask = buildMask(dp, w, h, featherPx);
    var layer = warp(sp, dp, w, h, src);
    var lctx = layer.getContext("2d");

    if (opts.colorMatch) {
      var rect = boundingBox(FACE_OVAL.map(function (i) { return dp[i]; }), featherPx * 3);
      colorMatch(lctx, tgt.getContext("2d"), rect, mask);
    }

    /* feathered composite of the mask into the layer */
    lctx.globalCompositeOperation = "destination-in";
    lctx.filter = "blur(" + featherPx + "px)";
    lctx.drawImage(mask, 0, 0);
    lctx.filter = "none";
    lctx.globalCompositeOperation = "source-over";

    var out = makeCanvas(w, h);
    var octx = out.getContext("2d");
    octx.drawImage(tgt, 0, 0);
    octx.drawImage(layer, 0, 0);

    if (opts.watermark) drawWatermark(octx, w, h);
    return out;
  }

  /* downscale helper so huge photos stay fast and memory-safe */
  function fitImage(img, maxW) {
    var nw = img.naturalWidth || img.width;
    var nh = img.naturalHeight || img.height;
    var scale = Math.min(1, maxW / Math.max(nw, nh));
    var c = makeCanvas(Math.max(1, Math.round(nw * scale)), Math.max(1, Math.round(nh * scale)));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  return { swap: swap, fitImage: fitImage };
})();
