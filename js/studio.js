/* ============================================================
   FaceSwap Studio — studio page logic
   1. uploads + previews
   2. consent gate
   3. detection + swap job
   4. before / after comparison + download
   ============================================================ */
(function () {
  "use strict";

  var MAX_SOURCE = 1600;
  var MAX_TARGET = 2400;

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- refs ---------- */
  var srcInput = $("srcInput"), tgtInput = $("tgtInput");
  var srcSlot = $("srcSlot"), tgtSlot = $("tgtSlot");
  var srcPreview = $("srcPreview"), tgtPreview = $("tgtPreview");
  var consent = $("consent"), swapBtn = $("swapBtn");
  var modelChip = $("modelChip"), jobStatus = $("jobStatus");
  var feather = $("feather"), featherVal = $("featherVal");
  var optColor = $("optColor"), optMark = $("optMark");
  var notice = $("notice");
  var result = $("result"), cmpBase = $("cmpBase"), cmpTop = $("cmpTop");
  var cmpWrap = $("cmpWrap"), cmpHandle = $("cmpHandle"), cmpLine = $("cmpLine");
  var downloadBtn = $("downloadBtn"), resetBtn = $("resetBtn");

  /* ---------- state ---------- */
  var state = {
    sourceImg: null,
    targetImg: null,
    sourceFit: null,
    targetFit: null,
    resultCanvas: null,
    busy: false
  };

  /* ---------- notices ---------- */
  function showNotice(msg, kind) {
    if (!msg) { notice.hidden = true; notice.textContent = ""; return; }
    notice.hidden = false;
    notice.textContent = msg;
    notice.className = "notice " + (kind || "info");
  }

  /* ---------- model status ---------- */
  function setChip(text, cls) {
    modelChip.textContent = text;
    modelChip.className = "chip " + cls;
  }

  setChip("Loading face detector…", "chip-busy");
  FaceDetector.init()
    .then(function () { setChip("Detector ready — runs on your device", "chip-ok"); })
    .catch(function () {
      setChip("Detector failed to load (check connection)", "chip-err");
      showNotice("The face detector could not be downloaded. It is fetched once from a CDN and cached — this page needs internet the first time only.", "warn");
    });

  /* ---------- uploads ---------- */
  function bindSlot(slot, input, key) {
    slot.addEventListener("click", function () { input.click(); });
    slot.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        input.click();
      }
    });

    slot.addEventListener("dragover", function (e) { e.preventDefault(); slot.classList.add("over"); });
    slot.addEventListener("dragleave", function () { slot.classList.remove("over"); });
    slot.addEventListener("drop", function (e) {
      e.preventDefault();
      slot.classList.remove("over");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
    });

    input.addEventListener("change", function () {
      if (input.files && input.files[0]) load(input.files[0]);
    });

    function load(file) {
      if (!/^image\//.test(file.type)) {
        showNotice("Please choose an image file (JPG / PNG / WebP).", "warn");
        return;
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        state[key + "Img"] = img;
        state[key + "Fit"] = SwapEngine.fitImage(img, key === "source" ? MAX_SOURCE : MAX_TARGET);
        var prev = key === "source" ? srcPreview : tgtPreview;
        prev.src = url;
        prev.hidden = false;
        slot.querySelector(".slot-hint").hidden = true;
        slot.classList.add("filled");
        showNotice(null);
        refreshButton();
        markStale();
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        showNotice("That image could not be opened.", "warn");
      };
      img.src = url;
    }
  }

  bindSlot(srcSlot, srcInput, "source");
  bindSlot(tgtSlot, tgtInput, "target");

  /* ---------- consent gate ---------- */
  consent.addEventListener("change", function () {
    refreshButton();
    if (consent.checked) showNotice(null);
  });

  function refreshButton() {
    var ready = consent.checked && state.sourceImg && state.targetImg && !state.busy;
    swapBtn.disabled = !ready;
  }

  /* ---------- options ---------- */
  feather.addEventListener("input", function () { featherVal.textContent = feather.value; });
  feather.addEventListener("change", markStale);
  optColor.addEventListener("change", markStale);
  optMark.addEventListener("change", markStale);

  function markStale() {
    if (state.resultCanvas) {
      showNotice("Options changed — press Swap faces again to apply them.", "info");
    }
  }

  /* ---------- swap job ---------- */
  swapBtn.addEventListener("click", function () {
    if (swapBtn.disabled) return;

    if (!consent.checked) {
      showNotice("Please confirm you have permission before swapping.", "warn");
      return;
    }
    if (!state.sourceFit || !state.targetFit) {
      showNotice("Add both a source face and a target image.", "warn");
      return;
    }

    state.busy = true;
    refreshButton();
    result.hidden = true;
    jobStatus.hidden = false;
    jobStatus.textContent = "Detecting faces…";
    showNotice(null);

    var srcMarks = null, tgtMarks = null;

    FaceDetector.detect(state.sourceFit)
      .then(function (marks) {
        if (!marks) throw new Error("NO_SOURCE");
        srcMarks = marks;
        jobStatus.textContent = "Detecting target face…";
        return FaceDetector.detect(state.targetFit);
      })
      .then(function (marks) {
        if (!marks) throw new Error("NO_TARGET");
        tgtMarks = marks;
        jobStatus.textContent = "Swapping…";
        return new Promise(function (r) { setTimeout(r, 30); });
      })
      .then(function () {
        var out = SwapEngine.swap({
          sourceCanvas: state.sourceFit,
          sourceMarks: srcMarks,
          targetCanvas: state.targetFit,
          targetMarks: tgtMarks,
          feather: parseInt(feather.value, 10),
          colorMatch: optColor.checked,
          watermark: optMark.checked
        });
        state.resultCanvas = out;
        showResult(state.targetFit, out);
        jobStatus.textContent = "Done";
        setTimeout(function () { jobStatus.hidden = true; }, 1600);
      })
      .catch(function (err) {
        jobStatus.hidden = true;
        if (err && err.message === "NO_SOURCE") showNotice("No face found in the SOURCE image — try a clearer, front-facing photo.", "warn");
        else if (err && err.message === "NO_TARGET") showNotice("No face found in the TARGET image.", "warn");
        else showNotice("Something went wrong while swapping. Try again with smaller images.", "warn");
        if (window.console) console.error(err);
      })
      .then(function () {
        state.busy = false;
        refreshButton();
      });
  });

  /* ---------- result + compare slider ---------- */
  function showResult(base, out) {
    cmpBase.width = base.width; cmpBase.height = base.height;
    cmpBase.getContext("2d").drawImage(base, 0, 0);
    cmpTop.width = out.width; cmpTop.height = out.height;
    cmpTop.getContext("2d").drawImage(out, 0, 0);
    result.hidden = false;
    setSplit(50);
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function setSplit(pct) {
    pct = Math.max(0, Math.min(100, pct));
    cmpTop.style.clipPath = "inset(0 " + (100 - pct) + "% 0 0)";
    cmpHandle.style.left = pct + "%";
    cmpLine.style.left = pct + "%";
    cmpWrap.dataset.pct = pct;
  }

  var dragging = false;

  function pointFromEvent(e) {
    var rect = cmpWrap.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * 100;
  }

  cmpWrap.addEventListener("pointerdown", function (e) {
    if (result.hidden) return;
    dragging = true;
    cmpWrap.setPointerCapture(e.pointerId);
    setSplit(pointFromEvent(e));
  });
  cmpWrap.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    setSplit(pointFromEvent(e));
  });
  cmpWrap.addEventListener("pointerup", function () { dragging = false; });
  cmpWrap.addEventListener("pointercancel", function () { dragging = false; });

  /* ---------- download / reset ---------- */
  downloadBtn.addEventListener("click", function () {
    if (!state.resultCanvas) return;
    state.resultCanvas.toBlob(function (blob) {
      if (!blob) { showNotice("Could not export the image.", "warn"); return; }
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "faceswap-result.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }, "image/png");
  });

  resetBtn.addEventListener("click", function () {
    result.hidden = true;
    state.resultCanvas = null;
    jobStatus.hidden = true;
    showNotice(null);
    document.querySelector(".editor").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  featherVal.textContent = feather.value;
  refreshButton();
})();
