/* ============================================================
   FaceSwap Studio — face detection wrapper
   Loads MediaPipe Face Landmarker (WASM) from CDN once,
   caches it, and returns normalized landmark arrays.
   Detection is forgiving: low confidence thresholds, up to
   3 candidate faces (largest wins), and a 1024px retry pass
   for photos the first pass misses.
   ============================================================ */
var FaceDetector = (function () {
  "use strict";

  var CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  var MODEL =
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

  var landmarker = null;
  var loading = null;

  function init() {
    if (landmarker) return Promise.resolve(landmarker);
    if (loading) return loading;

    loading = import(CDN + "/vision_bundle.mjs")
      .then(function (mod) {
        return mod.FilesetResolver.forVisionTasks(CDN + "/wasm").then(function (fileset) {
          return mod.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
            runningMode: "IMAGE",
            numFaces: 3,
            minFaceDetectionConfidence: 0.2,
            minFacePresenceConfidence: 0.2,
            minTrackingConfidence: 0.2,
            outputFaceBlendshapes: false
          });
        });
      })
      .then(function (l) {
        landmarker = l;
        return landmarker;
      })
      .catch(function (err) {
        loading = null;
        throw err;
      });

    return loading;
  }

  function bboxArea(marks) {
    var x1 = 1, y1 = 1, x2 = 0, y2 = 0;
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].x < x1) x1 = marks[i].x;
      if (marks[i].y < y1) y1 = marks[i].y;
      if (marks[i].x > x2) x2 = marks[i].x;
      if (marks[i].y > y2) y2 = marks[i].y;
    }
    return (x2 - x1) * (y2 - y1);
  }

  /* pick the biggest face from a detection result */
  function pickFace(result) {
    if (!result.faceLandmarks || result.faceLandmarks.length === 0) return null;
    var best = null, bestArea = -1;
    for (var i = 0; i < result.faceLandmarks.length; i++) {
      var a = bboxArea(result.faceLandmarks[i]);
      if (a > bestArea) { bestArea = a; best = result.faceLandmarks[i]; }
    }
    return best.map(function (p) { return { x: p.x, y: p.y }; });
  }

  /* copy the input onto a max-sized canvas (used for the retry pass) */
  function resized(source, maxSide) {
    var sw = source.naturalWidth || source.videoWidth || source.width;
    var sh = source.naturalHeight || source.videoHeight || source.height;
    if (!sw || !sh || Math.max(sw, sh) <= maxSide) return null;
    var scale = maxSide / Math.max(sw, sh);
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * scale));
    c.height = Math.max(1, Math.round(sh * scale));
    c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  /* Detect one face. `source` is an HTMLImageElement or HTMLCanvasElement.
     Returns [{x,y}...] normalized 0..1, or null when no face is found. */
  function detect(source) {
    return init().then(function (l) {
      var face = pickFace(l.detect(source));
      if (face) return face;

      /* retry pass — some photos are missed at very large sizes */
      var small = resized(source, 1024);
      if (small) face = pickFace(l.detect(small));
      if (face) return face;

      var smaller = resized(source, 640);
      if (smaller) face = pickFace(l.detect(smaller));
      return face;
    });
  }

  return { init: init, detect: detect };
})();
