/* ============================================================
   FaceSwap Studio — script
   1. Mobile navigation toggle
   2. Scroll-reveal animations
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 1. mobile nav ---------- */
  var burger = document.getElementById("burger");
  var navLinks = document.getElementById("navlinks");

  if (burger && navLinks) {
    burger.addEventListener("click", function () {
      navLinks.classList.toggle("open");
      burger.setAttribute(
        "aria-expanded",
        navLinks.classList.contains("open") ? "true" : "false"
      );
    });

    navLinks.addEventListener("click", function (e) {
      if (e.target.tagName === "A") navLinks.classList.remove("open");
    });
  }

  /* ---------- 2. scroll reveal ---------- */
  var revealEls = document.querySelectorAll(".rv");

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("on");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    revealEls.forEach(function (el, i) {
      el.style.transitionDelay = (i % 4) * 70 + "ms";
      observer.observe(el);
    });
  } else {
    revealEls.forEach(function (el) {
      el.classList.add("on");
    });
  }
})();
