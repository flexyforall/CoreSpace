/**
 * Guards against a camera stepping backwards.
 *
 * A move should only ever run forwards, or backwards because the scroll went
 * backwards — never on its own. Two things have caused it to:
 *
 *   - stopping playback on `timeupdate`, which fires about four times a second
 *     and so lets a clip overshoot the mark before being rewound onto it
 *   - issuing a fresh seek while the last one is still in flight
 *
 * Both show up here as a backward step in `currentTime`.
 *
 *   cd tools && npm install && npm run playback
 *
 * Optional tooling — the site itself needs none of this.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOLERANCE = 0.005; // seconds; below a tenth of a frame
const FRAME = 1 / 24;
const ALLOWED_OFF_TARGET = FRAME * 1.5;

/*
 * Every camera here must come to rest exactly where the scroll asks: the
 * hero's transition and the tunnel are both scrubbed from first frame to last.
 */
const SCENES = [
  { name: 'role', video: '[data-role-video]', restsOnTarget: true },
  /*
   * The flight is one clip scrubbed across the whole section, out of the
   * cupola and across to the satellite: ramping the section must take it
   * clean to its last frame and leave it there.
   */
  {
    name: 'flight',
    label: 'cupola',
    video: '[data-flight-video]',
    restsOnTarget: true,
  },
  /*
   * The FAQ's field loops behind the questions and is only taken by the
   * scroll for the last quarter of the section, so ramping the whole of it
   * crosses a loop's worth of wraps before the scrub begins. Those wraps are
   * the clip doing its job; what has to hold is that once the scroll has it,
   * it only ever goes forward and comes to rest on its last frame.
   */
  {
    name: 'faq',
    label: 'field',
    video: '[data-faq-field]',
    restsOnTarget: true,
    returnsToZero: true,
  },
  /*
   * ...and the clip it hands over to, which is held on its own first frame
   * until the field has reached its last. Ramping the section runs it out to
   * its end and leaves it there for the copy to arrive over.
   */
  {
    name: 'faq',
    label: 'coin',
    video: '[data-faq-coin]',
    restsOnTarget: true,
    returnsToZero: true,
  },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
await page.goto(pathToFileURL(path.join(root, 'index.html')).href, {
  waitUntil: 'load',
});

/*
 * Largest backward step in a run of currentTime samples. With `allowWraps` a
 * drop that lands back near 0 is not a rewind — only partial jumps backwards
 * count. Two things do that legitimately: a clip on a loop cycling, and a
 * clip that is held on its first frame until its turn comes, which has to be
 * put back there when the scroll leaves its leg.
 */
function worstDrop(samples, allowWraps) {
  let worst = 0;
  let at = null;
  let wraps = 0;
  for (let i = 1; i < samples.length; i++) {
    const drop = samples[i - 1][1] - samples[i][1];
    if (drop <= 0) continue;
    if (allowWraps && samples[i][1] < 0.3) {
      wraps++;
      continue;
    }
    if (drop > worst) {
      worst = drop;
      at = samples[i][0];
    }
  }
  return { worst, at, wraps };
}

const failures = [];

/*
 * 1. The hero background: a 12s clip on loop. Wraps back to 0 are the loop
 *    working; anything else backwards is a rewind. It must actually cycle.
 */
const intro = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const video = document.querySelector('[data-hero-video]');
      const a = [];
      const t0 = performance.now();
      (function tick() {
        const elapsed = performance.now() - t0;
        a.push([Math.round(elapsed), video.currentTime]);
        if (elapsed < 16500) requestAnimationFrame(tick);
        else resolve({ a });
      })();
    })
);

const heroDrop = worstDrop(intro.a, true);
console.log(`
idle    hero clip wrapped ${heroDrop.wraps}x, largest non-wrap backward step ${heroDrop.worst.toFixed(4)}s`);

if (heroDrop.worst > TOLERANCE) failures.push('the hero clip rewinds mid-loop');
if (heroDrop.wraps === 0) failures.push('the hero loop never cycles');

/*
 * 2. The hero's run. It is not scrolled through — a click sets it going and a
 *    clock carries it — so it is driven by clicking the section and sampled
 *    until it has landed. It picks the clip up from whatever frame the loop
 *    was on and plays it at its own speed, so neither where it starts nor how
 *    long it takes is fixed; where it comes to rest is, and it must get there
 *    without ever stepping back.
 */
const heroRun = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const video = document.querySelector('[data-hero-video]');
      const scene = document.querySelector('[data-scene="hero"]');
      const out = [];
      const t0 = performance.now();
      scene.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      (function tick() {
        const elapsed = performance.now() - t0;
        out.push([Math.round(elapsed), video.currentTime]);
        if (elapsed < 12000) requestAnimationFrame(tick);
        else resolve({ samples: out, end: video.duration || 0 });
      })();
    })
);

{
  const drop = worstDrop(heroRun.samples, false);
  /*
   * The hero is put back to its idle state once the page has moved on, which
   * is a deliberate rewind — so the run is judged up to where it lands, not
   * past it.
   */
  let far = 0;
  for (let i = 1; i < heroRun.samples.length; i++) {
    if (heroRun.samples[i][1] > heroRun.samples[far][1]) far = i;
  }
  const landed = heroRun.samples.slice(0, far + 1);
  const settled = landed[landed.length - 1][1];
  const offTarget = Math.abs(settled - heroRun.end);
  const dropUpToLanding = worstDrop(landed, false);

  console.log(`
hero    click ran the clip to ${settled.toFixed(3)}s of ${heroRun.end.toFixed(3)}s
        largest backward step ${dropUpToLanding.worst.toFixed(4)}s${dropUpToLanding.at !== null ? ` at ${dropUpToLanding.at}ms` : ''}
        off by ${offTarget.toFixed(3)}s (${(offTarget / FRAME).toFixed(1)} frames)`);

  if (dropUpToLanding.worst > TOLERANCE) failures.push('the hero run steps backwards');
  if (offTarget > ALLOWED_OFF_TARGET) {
    failures.push('the hero camera rests off its last frame');
  }
  if (drop.worst > 0 && dropUpToLanding.worst === 0) {
    console.log('        (and rewinds to its idle loop afterwards, as it should)');
  }
}

/*
 * 3. Each scrub: ramp the scroll across the section, then hold.
 *
 * It must not step backwards, and it must come to rest on the frame the scroll
 * is asking for. Settling forwards after the scrolling stops is expected — the
 * last seek is still in flight and lands a moment later — so what is checked is
 * where it ends up, not that it stops moving instantly. Asking for the very end
 * lands on the last frame, which starts up to a frame earlier.
 */
for (const scene of SCENES) {
  const run = await page.evaluate(
    ({ name, video }) =>
      new Promise(async (resolve) => {
        const el = document.querySelector(video);
        const section = document.querySelector(`[data-scene="${name}"]`);
        const top = section.getBoundingClientRect().top + window.scrollY;
        const travel = section.offsetHeight - window.innerHeight;
        const out = [];
        /*
         * Park at the section's top and let the camera get there before the
         * clock starts. The hero's click leaves the page a little way into
         * this section, so sampling straight away would record the rewind
         * this test itself asked for.
         */
        window.scrollTo(0, top);
        await new Promise((r) => setTimeout(r, 400));
        const t0 = performance.now();
        let landed = false;
        (function tick() {
          const elapsed = performance.now() - t0;
          if (elapsed < 2000) {
            window.scrollTo(0, Math.round(top + travel * (elapsed / 2000)));
          } else if (!landed) {
            /*
             * Under load the frame clock skips, so the ramp's last step can
             * stop short of the section's end. Real scrolling has no such
             * quantization — finish on the exact end before judging where
             * the camera rests.
             */
            landed = true;
            /*
             * ...and the section's own top is read again rather than reused.
             * A section below others that are still settling — the FAQ sits
             * under a newsroom that pulls itself up as its cards open — moves
             * by the best part of a window between the first reading and
             * this one, and finishing on the stale number stops the ramp
             * short of the end by exactly that much.
             */
            const end = section.getBoundingClientRect().top + window.scrollY;
            window.scrollTo(0, Math.round(end + section.offsetHeight - window.innerHeight));
          }
          out.push([Math.round(elapsed), el.currentTime]);
          if (elapsed < 3200) requestAnimationFrame(tick);
          else resolve({ samples: out, end: el.duration || 0 });
        })();
      }),
    scene
  );

  const label = scene.label || scene.name;
  /*
   * Going back to zero and resting on a target are separate questions, and
   * the FAQ's two clips are the first cameras to answer yes to both — the
   * field because it loops behind the questions, the coin because it is held
   * on its first frame until the field has run out. Drops to zero are those
   * clips doing their job; that each then runs forward to its last frame and
   * stays there is what has to hold.
   */
  const drop = worstDrop(run.samples, scene.returnsToZero || !scene.restsOnTarget);
  const atScrollEnd = run.samples.find((s) => s[0] >= 2000)[1];
  const settled = run.samples[run.samples.length - 1][1];
  const offTarget = Math.abs(settled - run.end);

  console.log(`
${label.padEnd(7)} ${atScrollEnd.toFixed(3)}s when the scroll stopped, settled at ${settled.toFixed(3)}s
        largest backward step ${drop.worst.toFixed(4)}s${drop.at !== null ? ` at ${drop.at}ms` : ''}`);

  if (drop.worst > TOLERANCE) failures.push(`the ${label} scrub steps backwards`);
  if (scene.restsOnTarget) {
    console.log(`        asked for ${run.end.toFixed(3)}s — off by ${offTarget.toFixed(3)}s (${(offTarget / FRAME).toFixed(1)} frames)`);
    if (offTarget > ALLOWED_OFF_TARGET) {
      failures.push(`the ${label} camera rests off the frame the scroll asked for`);
    }
  }
}

/* Nothing anywhere should be running under its own power except the idle loop. */
const running = await page.evaluate(() => {
  const idle = document.querySelector('[data-hero-video]');
  return [...document.querySelectorAll('video')]
    .filter((v) => !v.paused && v !== idle)
    .map((v) => v.className || 'video');
});
console.log(`
cameras playing on their own: ${running.length}`);
if (running.length) failures.push(`a camera is running on its own (${running.join(', ')})`);

await browser.close();

console.log(
  failures.length
    ? `\nFAIL — ${failures.join('; ')}\n`
    : '\nEvery camera only ever moves forwards, and rests where the scroll asks.\n'
);
process.exit(failures.length ? 1 : 0);
