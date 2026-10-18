/* ============================================================
   FaceSwap Studio — face detection wrapper
   Loads MediaPipe Face Landmarker (WASM) from CDN once,
   caches it, and returns normalized landmark arrays.
   Detection is forgiving:
     - low confidence thresholds, up to 3 candidate faces
       (largest wins)
     - retry passes at 1024px and 640px for large photos
     - full CPU-delegate fallback when the GPU path finds
       nothing (GPU backends silently return empty on some
       machines)
   ============================================================ */
var FaceDetector = (function () {
  "use strict";

  var CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  var MODEL =
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

  var fileset = null;
  var gpuLandmarker = null;
  var cpuLandmarker = null;
  var loading = null;
  var cpuLoading = null;

  var OPTIONS = {
    runningMode: "IMAGE",
    numFaces: 3,
    minFaceDetectionConfidence: 0.2,
    minFacePresenceConfidence: 0.2,
    minTrackingConfidence: 0.2,
    outputFaceBlendshapes: false
  };

  function init() {
    if (gpuLandmarker) return Promise.resolve(gpuLandmarker);
    if (loading) return loading;

    loading = import(CDN + "/vision_bundle.mjs")
      .then(function (mod) {
        return mod.FilesetResolver.forVisionTasks(CDN + "/wasm").then(function (fs) {
          fileset = { mod: mod, fs: fs };
          return mod.FaceLandmarker.createFromOptions(fs, Object.assign({
            baseOptions: { modelAssetPath: MODEL, delegate: "GPU" }
          }, OPTIONS));
        });
      })
      .then(function (l) {
        gpuLandmarker = l;
        return gpuLandmarker;
      })
      .catch(function (err) {
        loading = null;
        throw err;
      });

    return loading;
  }

  function initCpu() {
    if (cpuLandmarker) return Promise.resolve(cpuLandmarker);
    if (cpuLoading) return cpuLoading;

    cpuLoading = init().then(function () {
      return fileset.mod.FaceLandmarker.createFromOptions(fileset.fs, Object.assign({
        baseOptions: { modelAssetPath: MODEL, delegate: "CPU" }
      }, OPTIONS));
    }).then(function (l) {
      cpuLandmarker = l;
      return cpuLandmarker;
    });

    return cpuLoading;
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

  /* copy the input onto a max-sized canvas (used for retry passes) */
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

  /* all size passes for one landmarker instance */
  function detectWith(l, source) {
    var face = pickFace(l.detect(source));
    if (face) return face;

    var small = resized(source, 1024);
    if (small) {
      face = pickFace(l.detect(small));
      if (face) return face;
    }

    var smaller = resized(source, 640);
    if (smaller) face = pickFace(l.detect(smaller));
    return face;
  }

  /* Detect one face. `source` is an HTMLImageElement or HTMLCanvasElement.
     Returns [{x,y}...] normalized 0..1, or null when no face is found. */
  function detect(source) {
    return init().then(function (l) {
      var face = detectWith(l, source);
      if (face) return face;

      /* GPU path found nothing — retry the whole ladder on CPU */
      return initCpu().then(function (c) { return detectWith(c, source); });
    });
  }

  return { init: init, detect: detect };
})();
