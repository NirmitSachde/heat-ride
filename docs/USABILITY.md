# Usability test

## Protocol (5 people, about 15 minutes each)
Open the live site on the tester's own phone or laptop. Do not explain anything first. Ask them to think aloud.
1. "What is this page about?" (after 60 seconds of scrolling, ask them to say the main finding in one sentence)
2. "Which place had the warmest streets?"
3. "Find a street where a tree would help."
4. "Use the slider to show where the plants are."
Note where they hesitate, misread, or give up. Fix the top 3 issues.

## Simulated test with 5 virtual testers (2026-11-25)
This is NOT a test with real people. Five scripted first-time visitors, each an AI persona driving a real browser engine headless on a different device, did the four tasks above cold (no access to the code or docs, only the page). Their notes are useful for finding problems; they do not replace the real test below.

Testers
- Margriet, 64, retired teacher · iPhone size (WebKit, 390x844, touch)
- Daan, 41, municipal planner · desktop Chrome (1440x900)
- Priya, 22, student skimming on a bus · Android size (Chromium, 412x915, touch)
- Tom, 35, science journalist · iPad size (WebKit, 820x1180, touch)
- Lena, 30, data-viz researcher · desktop Firefox (1280x800, mouse and keyboard)

Results before changes
- Task 1, main finding: 5 of 5 stated it correctly in one sentence (3 after some hesitation).
- Task 2, warmest place: 0 of 5. The page cannot answer it by design (warmth is only compared within a place and hour), and it never said so plainly. All five asked for that sentence.
- Task 3, a street where a tree would help: 5 of 5 found one, but 4 of 5 pointed out that the list put a village street first, right after saying green made no clear difference in the village, and that the order looked unsorted.
- Task 4, slider: 4 of 5 succeeded after hesitating (handles started stacked at the screen edge and could cross); keyboard-only use failed in Firefox.

Top problems, most serious first
1. No plain statement that the four places cannot be ranked against each other.
2. The tree list contradicted the finding (ranked streets in places where green showed no clear effect) and did not explain its order.
3. The slider was hard to find and grab, could hide the middle view, and was not keyboard operable.
4. Text cards and the legend overlapped charts and lists on phones; the intro animation and title were hard to read.

What changed
1. A new step, "Which place was warmest? We can't say.", plus a note on the legend: places are ridden on different days with a camera whose absolute readings drift, so streets are only compared within one place and hour.
2. The tree list now ranks only places where green made a measurable difference (the town and the small city), needs at least 4 photos per stretch, at least 1.5 C warmer and under 25% green, shows each stretch's photo count, and says how it is ranked. It is framed as "places worth a closer look, not a planting plan".
3. The slider was rebuilt: handles start at a third and two thirds, never clip or cross, a drag anywhere moves the nearest one, the caption follows the view, a hint shows until first use, and each handle works with Tab and arrow keys.
4. On screens up to 900 px, step text sits in its own box above charts and lists, so nothing overlaps. The legend moved out of the way of axis labels.
5. Plainer words ("for every 10 more percent of the view that is green", "°C cooler", a note that every °C is on the camera's own scale), a "Scroll" cue on the intro, ringed dots in explore for spots that have all three photos, and a fuller method section.

Retest after changes (same simulated testers, iPhone and Firefox keyboard)
- Margriet (iPhone): all four tasks better; "Now it tells me honestly that the towns cannot be compared."
- Lena (Firefox, keyboard first): warmest-place question now answered honestly, slider reachable by keyboard, legend collision gone. Her remaining notes (small arrow-key steps, missing focus rings on map controls, a card over the legend in the tree chapter, a top-ranked stretch with only 3 photos) were then fixed.


## Real test with 5 people
Not run yet. Record each tester here as: date, device, task results (success / hesitated / failed), one quote, then a 5-line "what I changed" note.
