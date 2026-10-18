/* ============================================================
   FaceSwap Studio — face detection wrapper
   Loads MediaPipe Face Landmarker (WASM) from CDN once,
   caches it, and returns normalized landmark arrays.
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
            numFaces: 1,
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

  /* Detect one face. `source` is an HTMLImageElement or HTMLCanvasElement.
     Returns [{x,y}...] normalized 0..1, or null when no face is found. */
  function detect(source) {
    return init().then(function (l) {
      var result = l.detect(source);
      if (!result.faceLandmarks || result.faceLandmarks.length === 0) return null;
      return result.faceLandmarks[0].map(function (p) {
        return { x: p.x, y: p.y };
      });
    });
  }

  return { init: init, detect: detect };
})();
