/*
 * Smooth scrolling.
 *
 * Wheel input normally jumps the scroll position in steps, which makes the
 * scroll-driven cameras step with it. This eases the position toward where the
 * wheel is asking to be, so the cameras glide.
 *
 * Only the wheel is taken over — touch, keyboard, and the scrollbar stay
 * native, and any of them simply re-syncs the target. Off entirely under a
 * reduced-motion preference.
 */
(function () {
  'use strict';

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /*
   * Fraction of the remaining distance covered per frame. Low enough to take
   * the step out of a wheel notch, high enough that the page has arrived by
   * the time the hand has stopped — a longer tail does not read as smoother,
   * it reads as the page moving on its own after you have let go.
   */
  var EASE = 0.12;
  var target = window.scrollY;
  var current = window.scrollY;
  var raf = null;

  function maxScroll() {
    return document.documentElement.scrollHeight - window.innerHeight;
  }

  /*
   * The hero holds the window and says so with a class on the root.
   * `overflow: hidden` stops the browser scrolling the page, but not this —
   * scrollTo goes through regardless — so the hold has to be honoured here
   * too, or the wheel would walk straight out of a section that is supposed to
   * be waiting to be let go.
   */
  function held() {
    return document.documentElement.classList.contains('is-held');
  }

  function tick() {
    /* A hold can land mid-glide; give the page up rather than coasting on. */
    if (held()) {
      raf = null;
      target = window.scrollY;
      return;
    }
    current += (target - current) * EASE;
    if (Math.abs(target - current) < 0.5) {
      current = target;
      raf = null;
    } else {
      raf = requestAnimationFrame(tick);
    }
    window.scrollTo(0, Math.round(current));
  }

  window.addEventListener(
    'wheel',
    function (event) {
      /* Pinch-zoom arrives as a ctrl-wheel — leave it to the browser. */
      if (event.ctrlKey) return;
      event.preventDefault();
      if (held()) {
        target = window.scrollY;
        return;
      }

      var delta = event.deltaY;
      if (event.deltaMode === 1) delta *= 16; // lines -> px
      else if (event.deltaMode === 2) delta *= window.innerHeight;

      target = Math.min(Math.max(target + delta, 0), maxScroll());
      if (raf === null) {
        current = window.scrollY;
        raf = requestAnimationFrame(tick);
      }
    },
    { passive: false }
  );

  /* Scrolling by any other means moves the page directly — follow it. */
  window.addEventListener(
    'scroll',
    function () {
      if (raf === null) target = window.scrollY;
    },
    { passive: true }
  );
})();
