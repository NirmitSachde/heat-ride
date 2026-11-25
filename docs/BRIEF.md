# Street Skin
### What a bicycle sees beyond the visible

## One line
A scroll story that rides through four Dutch places, from a village to a city, with three cameras (normal color, near-infrared, thermal), and asks one question: do greener streets run cooler?

## Why this project
- It follows the MIT Senseable City Lab workflow: a sensor on a moving vehicle, then image processing, then a map, then a story. Their Purple Tree project measures tree health with near-infrared cameras on cars. Shaded Politics compares shade and income across 9 cities. The lab runs Senseable City Amsterdam and lists thermal imagery under its sensing positions.
- It starts with a question and ends with an answer and a "so what".
- All data is open. No hardware to buy.

## The question
Main: on the same day, are greener streets cooler at street level, and does that hold from a village to a big city?
Backup stories, depending on what the data shows:
- If greener streets ARE cooler: "Trees are the cheapest air conditioner, and here is where one is missing."
- If they are NOT clearly cooler (it was autumn): "Even on a mild autumn day, asphalt runs X degrees warmer than the air. Imagine July."
- Either way: "A camera you can't see with your eyes shows a street you've never seen."
Never force the pattern. The headline is chosen from what the data actually shows (see data/story.json).

## Audience
Curious general readers first, city planners second, the lab third. No jargon on screen. Method details go in a "How this was made" section at the end.

## Story outline (scroll chapters)
0. Hook. A full-screen thermal frame of one street. Sunlit asphalt glows, the shade under a tree is dark. Text: "In autumn 2025, a bicycle rode through four Dutch places carrying three cameras. One of them saw heat."
1. Beyond visible. One scene shown three ways, with a slider: normal color, near-infrared (plants light up), thermal (heat lights up). One sentence per view.
2. The ride. A map of Arnhem. The route draws itself in the order it was ridden (real timestamps), colored by street warmth.
3. The question. Each photo becomes a dot: how green the view is against how warm the street is. Hovering a dot shows its photos.
4. Four places. The same chart for the village, the town, the small city and the big city, side by side. Does the pattern hold?
5. Tired trees (optional). Near-infrared also shows how healthy plants are. Are trees on the warmest streets less healthy? Only if the data shows something.
6. (Dropped unless data supports it: neighborhood income.)
7. So what. The 10 warmest, least green stretches of street are marked "a tree here would help most".
8. Explore. Free map, click any point to see its photos.
9. How this was made. Data, method, limits, credits.

## Visual identity
- Background: night ink #0E1116. Text #E8E6E3, secondary text #8A8F98.
- Heat scale (one ramp used everywhere): #1B1F3B, #6A2C70, #E1534A, #F9C74F, #FFF6D5.
- Plant color (near-infrared): #6EE7B7.
- Fonts: Fraunces (headlines, editorial), Inter (body), JetBrains Mono (numbers and labels).
- Motion: one master clock drives every animation. Transitions are 600 ms, ease-in-out. Nothing moves without a reason.
- Signature element: the three-way slider (normal, near-infrared, thermal) appears in the hook, the explore mode and the video.
- Writing rule: never use em dashes anywhere in UI copy or docs. Use a period, comma, colon, parentheses or a middle dot instead.

## What success looks like
- A first-time reader can say the main finding in one sentence after 60 seconds.
- Works on a phone.
- A 60 second narrated video version.
- Tested with 5 people, with a short note on what changed.

## Data and credits
- Spectrascapes dataset: Gupta, Timmermans, Biljecki, Uijlenhoet (2026). DOI 10.5281/zenodo.19440802. CC BY 4.0. 5,906 photo spots (5,192 with usable GPS), each with color, near-infrared and thermal photos. Arnhem, Delft, Oirschot and Middelbeers, September to October 2025.
- Weather on each ride day: Open-Meteo historical archive.
- Streets: OpenStreetMap contributors (ODbL). Basemap: CARTO.

## Ethics and limits (say these openly on the page)
- Thermal values are 8-bit photos mapped from 0 to 40 C. Read as relative surface warmth, not lab-grade temperature.
- The rides were in autumn, around midday, one or two days per place.
- Color photos can show people and license plates. Only a small set of hand-checked photos is published, small and blurred where needed.
- Findings are shown per street stretch, never per person or per house.
- Delft has many missing GPS points.
