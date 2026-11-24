# Estimating π

Drop matches on a floor ruled with lines exactly one match-length apart, and count how many land across a line. A match crosses a line **2/π** of the time, so twice the number of drops divided by the number of crossings closes in on **π = 3.14159…**

This is Buffon's needle (1777), done as an interactive Monte Carlo estimator: matches falling on the floor, a dot plot of every drop by angle and distance, a running-average trace that zooms in on π, and synthesized sound effects. Below the simulation there's a "notebook" section that works out where 2/π comes from and compares your first 3,408 matches with Lazzarini's famous 1901 result.

The maths follows my notes from *Mathematics for Understanding AI*, a course by Alexandru Negrescu.

## Use it

| Control | What it does |
| --- | --- |
| **Drop a match** / `Space` / `N` / tap the floor | Drops one match |
| **Drop 10** / `D` | Drops ten in a quick shower |
| **Run** / `Enter` / `P` | Runs on its own. With *auto-accelerate* on, it speeds up from a couple of matches a second to tens of millions a second and stops at 100 million matches |
| Speed slider | Sets a fixed speed (turns auto-accelerate off) |
| **Floor / Average** / `V` | Switches between the floor and the running-average trace |
| Sound button / `M` | Mutes or unmutes |
| Reset / `R` | Starts over |

Milestones: the exact 2/π share shows up next to the dot plot after 100,000 matches, and π itself shows up after 1,000,000.

## How the simulation avoids "cheating"

Picking each match's angle with `Math.random() * Math.PI` would put π into the experiment you're using to measure π. Instead the direction comes from a random point inside the unit circle (rejection sampling), so π only ever appears in the final estimate.

## Run locally

It's a static site with no build step. Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
```

then visit http://localhost:8000.

## Put it on GitHub Pages

1. Create a GitHub repository and push this folder to its `main` branch.
2. In the repository, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, pick `main` and `/ (root)`, and save.
3. After a minute the site is live at `https://<your-username>.github.io/<repository-name>/`.

## How it's built

- `index.html`: page structure and the maths notebook
- `styles.css`: the dark, glowing look
- `js/app.js`: the simulation, canvas drawing, and controls
- `js/audio.js`: the sound engine. Every sound is synthesized with the Web Audio API (a wooden knock for each landing, a bell on the D♭ major pentatonic scale when a match crosses a line, and a match-strike scratch when a run starts), so there are no audio files

Fonts (Inter, Caveat) come from Google Fonts and the maths is typeset with KaTeX from cdnjs.
