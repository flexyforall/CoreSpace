# Cards section — standalone

The homepage's three-card section on its own: the heading filling as it is
read, the cards rising in, the open width flowing right to left with each
card's copy filling as it comes to it, and the left card diving into the
cupola clip.

Open `index.html` straight from the repository (double-click — no build, no
server).

| File | What it is |
| --- | --- |
| `index.html` | The section's markup, between two spacers, and the empty `[data-scene="dive"]` whose scroll drives the hold and the dive |
| `cards.css` | Fonts, tokens and every rule the section uses — copied from `css/style.css` |
| `cards.js` | The whole animation — copied from `js/scene.js`, same marks, nothing from other sections |
| `smooth.js` | The homepage's wheel smoothing — optional, the animation works without it |

Pictures, the clip and the fonts are read from the repository's `assets/`
two folders up (`../../assets/`). To take the folder anywhere else, copy
these alongside it and change the paths in `index.html` and `cards.css`:

- `assets/images/card-orbit.jpg`, `assets/images/card-power.jpg`
- `assets/videos/video-cupola.mp4`, `.webm`, `-poster.jpg`
- `assets/fonts/StackSansHeadline.woff2`, `GeistMono-Regular.woff2`, `GeistMono-Medium.woff2`

The timing lives at the top of `cards.js` (`DIVE_CARDS_VH`, `DIVE_OPEN_VH`,
`DIVE_ON_VH`, `CARDS_LINGER` and the rest) and in `--scene-length-dive` in
`cards.css`; the three lengths and that custom property have to be changed
together.
