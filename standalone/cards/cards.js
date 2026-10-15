/*
 * Core Space — the cards section, on its own.
 *
 * Everything here is the homepage's own code (js/scene.js), lifted with the
 * same marks and nothing from the other sections:
 *
 *   heading   fills in reading order as it comes up the window
 *   cards     rise in one after another, each one's copy wiped on line by
 *             line; they come up equal and the right-hand one swells open
 *             on the way up
 *   held      as the row comes to rest the section below pins and holds it
 *             in view while the open width flows right to left, slowing as
 *             each card comes fully open — and each card's copy, inactive
 *             until then, fills in reading order as the width comes to it
 *   dive      the left card takes the whole row, opens out into the window,
 *             and its clip runs to its last frame
 *
 * Every move is read off the scroll rather than run on a clock, so
 * scrolling back undoes it exactly.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Marks
   * ------------------------------------------------------------------ */

  /* The heading. The section is not pinned; these are shares of the window. */
  var CARDS_FILL_FROM = 0.92; // the heading starts filling as it enters...
  var CARDS_FILL_BY = 0.16; // ...and is only fully read once it is near the top
  var CARDS_RISE_FROM = 0.92; // the first card rises as its top reaches here...
  var CARDS_RISE_STEP = 0.1; // ...and each after it this much further up

  var CARD_OPEN = 631; // 1486:22522 — the open card's width...
  var CARD_GAP = 16; // ...and the air between each card
  /*
   * The left card's picture rests where the design frames the still it
   * opens on, on the card's own corner — the same rectangle .card__clip
   * puts it in. Opening out into the window carries it from here to covering
   * the card.
   */
  var CLIP_REST = { x: -191.48, y: -63.95, w: 1281.96, h: 853.18 };
  var CLIP_ASPECT = 3256 / 2160; // the clip's own, until it reports it

  var REVEAL_MS = 950; // one line's wipe — unhurried enough to be watched
  var REVEAL_STAGGER = 220; // ms between lines setting off

  /*
   * The dive section's scroll, read as three legs. The lengths are the ones
   * --scene-length-dive is built out of — one window of pin, then these —
   * so change them together. They are the homepage's, so the clip runs here
   * at the pace it runs there.
   */
  var DIVE_CARDS_VH = 160; // the cards held in view while the width flows
  var DIVE_OPEN_VH = 420; // the left card opening out, the shot leaving the cupola
  var DIVE_ON_VH = 560; // the shot carrying on across to the satellite
  var DIVE_CARDS_SPLIT = DIVE_CARDS_VH / (DIVE_CARDS_VH + DIVE_OPEN_VH + DIVE_ON_VH);
  /* The opening leg's end, as a share of what is left after the cards. */
  var DIVE_OPEN_SPLIT = DIVE_OPEN_VH / (DIVE_OPEN_VH + DIVE_ON_VH);

  /*
   * The cards never stand still. They come up the window three equal and
   * the right one opens as they rise — from the row's top at the window's
   * foot to the row coming to rest, where it is fully open.
   */
  var CARDS_LIFT_FROM = 1;
  /*
   * Then, held in view, the open width flows on right to left without
   * stopping: slowed as each card comes fully open, so its copy can be read,
   * and quickened between — the speed swings this far either side of even,
   * and never to nothing.
   */
  var CARDS_LINGER = 0.6;
  /*
   * A card's copy fills in reading order as the card opens, from the
   * inactive ink to the full — the soft edge between them is this wide, and
   * is .card .rv-text's 32px in the stylesheet.
   */
  var CARD_FILL_EDGE = 32;

  /* Fractions of the opening leg. */
  var DIVE_PREROLL = 1.2; // seconds the clip creeps through while the card scales
  var DIVE_WIDEN_BY = 0.09; // the left card has taken the whole row by here...
  var DIVE_OPEN_BY = 0.24; // ...and has taken the whole window by here

  var SEEK_EPSILON = 0.008; // ignore seeks smaller than a third of a frame

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------ *
   * Plumbing
   * ------------------------------------------------------------------ */

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /**
   * How far a block that is not pinned has travelled up the window, 0 to 1 —
   * measured from its top passing `from` to its top passing `to`, both as a
   * fraction of the window's height.
   */
  function progressUp(el, from, to) {
    var h = window.innerHeight;
    var top = el.getBoundingClientRect().top;
    return clamp01((h * from - top) / (h * from - h * to));
  }

  /** How far through a pinned section the scroll has travelled, 0 to 1. */
  function progressOf(scene) {
    var travel = scene.offsetHeight - window.innerHeight;
    if (travel <= 0) return 0;
    return clamp01(-scene.getBoundingClientRect().top / travel);
  }

  /*
   * Seeks are asynchronous, and issuing a new one while the last is still in
   * flight makes the browser drop frames. So only the most recent request is
   * kept, it goes out as soon as the video is free, and it re-fires on `seeked`
   * so the final position lands even after the scrolling has stopped.
   */
  function seeker(video) {
    var pending = null;

    function flush() {
      if (pending === null || video.seeking) return;
      var t = pending;
      pending = null;
      if (Math.abs(video.currentTime - t) > SEEK_EPSILON) video.currentTime = t;
    }

    video.addEventListener('seeked', flush);
    return function (t) {
      pending = t;
      flush();
    };
  }

  /* Every move is a painter, run together once per frame the scroll asks for. */
  var painters = [];
  var queued = false;

  function paint() {
    queued = false;
    for (var i = 0; i < painters.length; i++) painters[i]();
  }

  function onScroll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(paint);
  }

  function register(fn) {
    painters.push(fn);
    fn();
  }

  /* ------------------------------------------------------------------ *
   * Text
   * ------------------------------------------------------------------ */

  /**
   * Wraps every character in its own span so a line can be filled one
   * character at a time. Spaces stay as bare text nodes so lines still
   * break normally.
   */
  function splitCharacters(el) {
    var text = el.textContent;
    var frag = document.createDocumentFragment();
    var spans = [];

    for (var i = 0; i < text.length; i++) {
      if (text[i] === ' ') {
        frag.appendChild(document.createTextNode(' '));
        continue;
      }
      var span = document.createElement('span');
      span.textContent = text[i];
      frag.appendChild(span);
      spans.push(span);
    }

    el.textContent = '';
    el.appendChild(frag);
    return spans;
  }

  /*
   * Splits a piece of copy into its rendered lines: each word measured in a
   * probe span, grouped by the row it landed on, then rebuilt as one span
   * per line — its text, and the rectangle that wipes it on.
   */
  function splitIntoLines(el) {
    var lines = [];

    function buildLine(nodes) {
      var line = document.createElement('span');
      line.className = 'rv-line';
      var text = document.createElement('span');
      text.className = 'rv-text';
      for (var i = 0; i < nodes.length; i++) text.appendChild(nodes[i]);
      var block = document.createElement('span');
      block.className = 'rv-block';
      line.appendChild(text);
      line.appendChild(block);
      el.appendChild(line);
      lines.push({ line: line, text: text, block: block });
    }

    var words = el.textContent.split(/\s+/).filter(Boolean);
    el.textContent = '';
    var probes = [];
    for (var k = 0; k < words.length; k++) {
      var probe = document.createElement('span');
      probe.style.display = 'inline-block';
      probe.textContent = words[k];
      el.appendChild(probe);
      el.appendChild(document.createTextNode(' '));
      probes.push(probe);
    }
    var groups = [];
    for (var m = 0; m < probes.length; m++) {
      var top = probes[m].offsetTop;
      if (!groups.length || Math.abs(top - groups[groups.length - 1].top) > 2) {
        groups.push({ top: top, words: [] });
      }
      groups[groups.length - 1].words.push(probes[m].textContent);
    }
    el.textContent = '';
    for (var n = 0; n < groups.length; n++) {
      buildLine([document.createTextNode(groups[n].words.join(' '))]);
    }
    return lines;
  }

  /** The not-yet-revealed state — also what makes a replay possible. */
  function hideReveal(lines) {
    for (var i = 0; i < lines.length; i++) {
      lines[i].text.style.clipPath = 'inset(-0.25em 101% -0.25em 0)';
      lines[i].block.style.display = '';
      lines[i].block.style.opacity = '0';
      lines[i].block.style.transform = '';
    }
  }

  /*
   * The wipe: each line is uncovered left to right, the white rectangle
   * riding the reveal's edge and stepping off past the end of the text; the
   * lines set off REVEAL_STAGGER apart. When the last one lands, the clips
   * come off entirely.
   */
  function runReveal(lines) {
    var t0 = null;
    function frame(now) {
      if (t0 === null) t0 = now;
      var settled = true;
      for (var i = 0; i < lines.length; i++) {
        var raw = (now - t0 - i * REVEAL_STAGGER) / REVEAL_MS;
        if (raw < 1) settled = false;
        var k = 1 - Math.pow(1 - clamp01(raw), 3);
        var l = lines[i];
        l.text.style.clipPath = 'inset(-0.25em ' + ((1 - k) * 101).toFixed(2) + '% -0.25em 0)';
        l.block.style.transform =
          'translateX(' + (l.text.offsetLeft + k * l.text.offsetWidth).toFixed(1) + 'px)';
        l.block.style.opacity = raw >= 0 && raw < 1 ? '1' : '0';
      }
      if (!settled) {
        requestAnimationFrame(frame);
      } else {
        for (var j = 0; j < lines.length; j++) {
          lines[j].text.style.clipPath = '';
          lines[j].block.style.display = 'none';
        }
      }
    }
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ *
   * Geometry
   * ------------------------------------------------------------------ */

  /*
   * The cards' widths across a row `row` wide.
   *
   * `open` is which card stands open — its index, and in between while one
   * hands its width to the next. Each card's share of the open width falls
   * away linearly either side of its own index, so the shares always add up
   * to exactly one open card and the row never changes length while the
   * width moves along it.
   *
   * `lift` is how open that card is: at nothing the cards stand equal, and
   * the open one swells out of them. Both ends sum to the same row.
   *
   * `take` is card `dive` taking the whole row on its way into the window:
   * the others and the air between them close up together, and it gains
   * exactly what they give, so its far edge sweeps over to the row's.
   */
  function cardWidths(row, count, open, lift, take, dive) {
    var shut = (row - CARD_OPEN - (count - 1) * CARD_GAP) / (count - 1);
    var even = (row - (count - 1) * CARD_GAP) / count;
    var gap = CARD_GAP * (1 - take);
    var out = [];
    var rest = row - (count - 1) * gap;
    for (var i = 0; i < count; i++) {
      if (i === dive) {
        out.push(0);
        continue;
      }
      var share = Math.max(0, 1 - Math.abs(open - i));
      var settled = shut + (CARD_OPEN - shut) * share;
      var w = (even + (settled - even) * lift) * (1 - take);
      /*
       * Too thin to draw — and hidden for it — a closing card's last sliver
       * goes to the one opening rather than standing as a gap at the row's
       * edge.
       */
      out.push(w < 0.5 ? 0 : w);
      rest -= out[i];
    }
    out[dive] = rest;
    return { widths: out, gap: gap };
  }

  /* The rectangle a picture of `aspect` takes to cover a `w` x `h` box. */
  function coverRect(w, h, aspect) {
    if (w / h > aspect) return { x: 0, y: (h - w / aspect) / 2, w: w, h: w / aspect };
    return { x: (w - h * aspect) / 2, y: 0, w: h * aspect, h: h };
  }

  /* Writes a box only where it has changed, so a still frame costs nothing. */
  function place(el, box) {
    var l = box.x.toFixed(1) + 'px';
    var t = box.y.toFixed(1) + 'px';
    var w = box.w.toFixed(1) + 'px';
    var h = box.h.toFixed(1) + 'px';
    if (el.style.left !== l) el.style.left = l;
    if (el.style.top !== t) el.style.top = t;
    if (el.style.width !== w) el.style.width = w;
    if (el.style.height !== h) el.style.height = h;
  }

  function unplace(el) {
    el.style.left = el.style.top = el.style.width = el.style.height = '';
  }

  /* ------------------------------------------------------------------ *
   * The heading, and the cards rising in
   * ------------------------------------------------------------------ */

  function setUpCards() {
    var section = document.querySelector('[data-cards]');
    if (!section) return;

    var heading = section.querySelector('[data-cards-text]');
    var cards = section.querySelectorAll('[data-card]');
    var track = section.querySelector('[data-card-track]');
    var cardOn = [];
    var cardLines = [];
    if (!heading) return;

    var letters = splitCharacters(heading);

    if (reduced) {
      for (var i = 0; i < letters.length; i++) letters[i].className = 'is-read';
      return;
    }

    register(function () {
      /*
       * The heading fills in reading order: read characters go transparent
       * and let the paragraph's gradient through, the rest keep their grey.
       */
      var fill = progressUp(heading, CARDS_FILL_FROM, CARDS_FILL_BY);
      var read = Math.round(fill * letters.length);
      for (var i = 0; i < letters.length; i++) {
        var want = i < read ? 'is-read' : '';
        if (letters[i].className !== want) letters[i].className = want;
      }

      /*
       * Read off the track, which stands where the cards do but never moves
       * with them: a card's own rect carries the 40px it rises through, and
       * once the row is held for the dive it says nothing about the scroll.
       */
      var rowTop = track ? track.getBoundingClientRect().top : 0;
      for (var c = 0; c < cards.length; c++) {
        /*
         * Each card waits its turn, a tenth of a window after the one before.
         * As one comes on, its copy is wiped in by the block reveal — and
         * reset on the way back out, so scrolling through again replays it.
         */
        var on = rowTop < window.innerHeight * (CARDS_RISE_FROM - c * CARDS_RISE_STEP);
        if (on !== cardOn[c]) {
          cardOn[c] = on;
          cards[c].classList.toggle('is-in', on);
          if (on) {
            if (!cardLines[c]) {
              cardLines[c] = [];
              cards[c].querySelectorAll('.card__overline, .card__body').forEach(function (el) {
                cardLines[c] = cardLines[c].concat(splitIntoLines(el));
              });
            }
            hideReveal(cardLines[c]);
            runReveal(cardLines[c]);
          } else if (cardLines[c]) {
            hideReveal(cardLines[c]);
          }
        }
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * The width flowing along the row, the copy filling, and the dive
   * ------------------------------------------------------------------ */

  function setUpDive() {
    var scene = document.querySelector('[data-scene="dive"]');
    var video = document.querySelector('[data-flight-video]');
    var card = video ? video.closest('[data-card]') : null;
    var row = card ? card.closest('[data-card-row]') : null;
    var track = row ? row.closest('[data-card-track]') : null;
    var stand = track ? track.closest('[data-cards]') : null;
    if (!scene || !video || !card || !track || !stand) return;

    var cards = [].slice.call(row.querySelectorAll('[data-card]'));
    var clips = [].slice.call(card.querySelectorAll('.card__clip'));
    var seek = seeker(video);
    video.pause();

    if (reduced) return;

    /*
     * A card's copy filling, in reading order: `filled` of the way through
     * all its lines laid end to end, overline first. Each line runs from its
     * soft edge wholly before it (all inactive) to wholly past its end (all
     * full ink), so a line is never half-lit at rest.
     *
     * The lines are the ones the block reveal split the copy into as the
     * card first rose — it keeps the same ones for every replay — and they
     * are read once they exist. The copy keeps its own width whatever the
     * card's, so a line's width never changes after.
     */
    var copyLines = [];
    function fillCopy(c, filled) {
      var lines = copyLines[c];
      if (!lines) {
        var texts = cards[c].querySelectorAll('.rv-text');
        if (!texts.length) return;
        lines = copyLines[c] = [].map.call(texts, function (el) {
          return { el: el, w: el.offsetWidth + CARD_FILL_EDGE };
        });
        lines.total = lines.reduce(function (sum, l) {
          return sum + l.w;
        }, 0);
      }
      var reach = filled * lines.total;
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        var at = (clamp01(reach / l.w) * l.w - CARD_FILL_EDGE).toFixed(1) + 'px';
        if (l.el.style.getPropertyValue('--fill-at') !== at) l.el.style.setProperty('--fill-at', at);
        reach -= l.w;
      }
    }

    register(function () {
      var whole = progressOf(scene);
      /*
       * The cards held in view while the width flows along them; then the
       * left card opening out, and its clip running on across what is left.
       */
      var pk = clamp01(whole / DIVE_CARDS_SPLIT);
      var p = clamp01((whole - DIVE_CARDS_SPLIT) / (1 - DIVE_CARDS_SPLIT));
      var pc = clamp01(p / DIVE_OPEN_SPLIT);

      /*
       * The left card opens out in two moves, and it is the whole card that
       * moves — frame, ticks and copy together, with the clip filling it.
       *
       *   first   it takes the whole row, the other two and the air between
       *           them closing up to the right as it does
       *   then    it carries on into the window, and its copy fades as it goes
       *           so that by the time the clip has the screen nothing is left
       *           of the card but the picture
       */
      var widen = clamp01(pc / DIVE_WIDEN_BY);
      var zoom = clamp01((pc - DIVE_WIDEN_BY) / (DIVE_OPEN_BY - DIVE_WIDEN_BY));
      var open = pc >= DIVE_OPEN_BY ? 1 : 0;
      /*
       * Where the pinned section's own top is: 0 while it owns the window,
       * and riding up with the page once it starts leaving — so the opened
       * card, which is fixed, leaves with it rather than being cut away.
       */
      var away = Math.min(0, scene.getBoundingClientRect().bottom - window.innerHeight);
      var vw = window.innerWidth;
      var vh = window.innerHeight;
      var aspect = video.videoWidth ? video.videoWidth / video.videoHeight : CLIP_ASPECT;

      /*
       * Measured off the track, never off the row: the row is fixed while it
       * is held, so its own rect would report back the position this code
       * gave it. The track stays in the page and keeps telling the truth.
       *
       * Everything here happens where the row stood when the scene began —
       * the page goes on scrolling underneath while the row is held. That
       * start is recovered rather than captured: the scene's own top is how
       * far the scroll has come into it, so adding it back to the track's
       * current top gives where it stood at zero.
       */
      var tb = track.getBoundingClientRect();
      var x0 = tb.left;
      var y0 = tb.top - scene.getBoundingClientRect().top;
      var h0 = tb.height;

      /*
       * How open the right-hand card is, read off the row's way up: from its
       * top passing CARDS_LIFT_FROM to where it rests as the dive pins — the
       * cards section's foot level with the window's.
       */
      var restTop = vh - (stand.getBoundingClientRect().bottom - tb.top);
      var liftFrom = vh * CARDS_LIFT_FROM;
      var lift = clamp01((liftFrom - tb.top) / (liftFrom - restTop));
      /*
       * Which card stands open, right to left over the cards' leg. One
       * unbroken flow, slowed as it passes each card so the card can be read
       * and quickened between them; the sine is nothing at every whole card,
       * so each still lands exactly.
       */
      var last = cards.length - 1;
      var flow = last * pk;
      var which = last - (flow - (CARDS_LINGER * Math.sin(2 * Math.PI * flow)) / (2 * Math.PI));
      var share = cardWidths(tb.width, cards.length, which, lift, widen, cards.indexOf(card));

      if (whole > 0) {
        row.classList.add('is-held');
        place(row, { x: x0, y: y0, w: tb.width, h: h0 });
      } else {
        row.classList.remove('is-held');
        unplace(row);
      }
      var gap = share.gap.toFixed(1) + 'px';
      if (row.style.gap !== gap) row.style.gap = gap;

      for (var c = 0; c < cards.length; c++) {
        var w = share.widths[c];
        var flat = w.toFixed(1) + 'px';
        if (cards[c].style.flex !== '0 0 auto') cards[c].style.flex = 'none';
        if (cards[c] !== card || (!zoom && !open)) {
          if (cards[c].style.width !== flat) cards[c].style.width = flat;
        }
        /* A card closed right up would still draw its hairline. */
        var gone = w < 0.5 ? 'hidden' : '';
        if (cards[c].style.visibility !== gone) cards[c].style.visibility = gone;

        /*
         * How far its copy has filled: a card fills as the open width comes
         * to it and stays filled once it has been opened, so it is only the
         * cards still to come that stand back. The right-hand card has no
         * card to its right; it fills as it swells open on the way up.
         */
        fillCopy(c, clamp01(c + 1 - which) * (c === last ? lift : 1));
      }

      /*
       * The left card, and the clip inside it. In the row the card is sized
       * with the others and the clip carried from the design's framing to
       * covering the whole row — where the card is going — so the picture's
       * edge keeps ahead of the card's the whole way. From there the card
       * leaves the row for the window and the clip simply covers it.
       */
      var box;
      if (zoom > 0 && !open) {
        box = {
          x: x0 * (1 - zoom),
          y: y0 * (1 - zoom),
          w: tb.width + (vw - tb.width) * zoom,
          h: h0 + (vh - h0) * zoom,
        };
        card.classList.add('is-opening');
        place(card, box);
      } else if (open) {
        box = { x: 0, y: away, w: vw, h: vh };
        card.classList.add('is-opening');
        place(card, box);
      } else {
        card.classList.remove('is-opening');
        card.style.left = card.style.top = card.style.height = '';
        box = { w: tb.width, h: h0 };
      }

      var cover = coverRect(box.w, box.h, aspect);
      var t = zoom > 0 || open ? 1 : widen;
      var clip = {
        x: CLIP_REST.x + (cover.x - CLIP_REST.x) * t,
        y: CLIP_REST.y + (cover.y - CLIP_REST.y) * t,
        w: CLIP_REST.w + (cover.w - CLIP_REST.w) * t,
        h: CLIP_REST.h + (cover.h - CLIP_REST.h) * t,
      };
      for (var k = 0; k < clips.length; k++) place(clips[k], clip);

      /* The copy goes over the second move only, and is gone by the end of it. */
      card.style.setProperty('--card-copy', String(1 - zoom));

      /*
       * While the card scales, the clip creeps a few frames forward — still
       * well inside the cupola. Once the card has the window the clip runs on
       * from exactly where the creep left off, so the playhead never jumps,
       * evenly across everything left of the section to its last frame.
       */
      if (video.duration) {
        var creep = clamp01(pc / DIVE_OPEN_BY);
        var runFrom = DIVE_OPEN_SPLIT * DIVE_OPEN_BY;
        var run = clamp01((p - runFrom) / (1 - runFrom));
        seek(
          run > 0
            ? DIVE_PREROLL + run * (video.duration - DIVE_PREROLL)
            : creep * DIVE_PREROLL
        );
      }
    });
  }

  /* ------------------------------------------------------------------ */

  setUpCards();
  setUpDive();

  if (!reduced) {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    /* Durations arrive late; repaint once they do so the maps are right. */
    document.querySelectorAll('video').forEach(function (video) {
      video.addEventListener('loadedmetadata', paint);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(paint);
  }
})();
