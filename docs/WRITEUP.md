# Street Skin: one-page write-up

## Question
On the same day, are greener streets cooler at street level, and does that hold from a village to a big city?

## Data
- Spectrascapes (Gupta, Timmermans, Biljecki, Uijlenhoet, 2026; CC BY 4.0; DOI 10.5281/zenodo.19440802). A bicycle carried a normal camera, a near-infrared camera and a thermal camera (FLIR Lepton, 160x120) through four Dutch places in autumn 2025: Middelbeers (village), Oirschot (town), Delft (small city), Arnhem (big city).
- 5,906 photo spots, 5,192 with usable GPS. All 5,192 were measured by streaming single photos out of the 34 GB archive with HTTP range requests (about 24 GB read, under 100 MB kept).
- Hourly weather from the Open-Meteo archive. Street network from OpenStreetMap.

## Method
- **Green view.** For each near-infrared photo, the share of pixels with NDVI above 0.3 (living plants reflect near-infrared strongly). Checked by eye on overlays. Photos whose near-infrared exposure was too dark (23%, mostly Arnhem's first day) shifted the camera's colour balance so plants no longer separated from walls; they were excluded from every plant measure.
- **Warmth.** The thermal camera turned out to be aimed higher and narrower than the colour cameras: by eye it mostly sees facades, trees and cars, little pavement. So the measure is the median warmth of everything in the thermal view that is not sky (sky found per photo with a two-class split), the street's "skin". Its absolute values sit about 16 C above the air temperature even under full cloud, which real surfaces cannot do, so absolute numbers are not used. Each spot is compared with the other spots ridden in the same place within the same hour (relative warmth, in camera degrees; one step of the 8-bit image is 0.16 C).
- **Streets.** Each photo snapped to its nearest OpenStreetMap bike-network edge (median distance 2 m).
- **Controls.** Looking at the warmest photos showed many were taken riding into the low autumn sun. So the test is a regression of relative warmth on green view, riding direction relative to the sun (computed from GPS heading and solar position) and open sky, per place. 95% intervals come from a bootstrap that resamples whole streets, because photos on one street are not independent.

## Finding
Greener streets were only a little cooler, and only in two of the four places.
- Oirschot (town): about 0.23 C cooler for every 10 more percent of the view that is green (95% interval 0.06 to 0.38).
- Delft (small city): about 0.24 C cooler per 10 percent (0.05 to 0.40).
- Arnhem (big city): no clear difference (-0.18 to +0.08).
- Middelbeers (village): no clear difference (-0.20 to +0.77). Its raw numbers even point the other way, but those spots were mostly trees lit from behind by the sun.
- Across all places, the greenest fifth of spots read 0.8 C cooler than the least green fifth, while spots ridden in the same hour spread over about 7.5 C (10th to 90th percentile). Green explains a small part of how warm a street's surfaces were in autumn.
- Plant health (median NDVI of plant pixels) showed no meaningful link with warmth (Spearman -0.05), so that chapter was dropped.

## So what
Only in the two places where green made a measurable difference (Oirschot and Delft), six named street stretches are marked as places where a tree would likely help most: at least 4 photos, at least 1.5 C warmer than the streets ridden that hour, and less than 25% green, ranked by warmth and bareness together (Oude Grintweg, Spoordonkseweg, Castaert, Rijkesluisstraat and Zoete Ermgaard in Oirschot, Stieltjesweg in Delft). The village and the big city are not ranked, because there the data shows no clear link between green and warmth. The four places cannot be ranked against each other either: each was ridden on different days with a camera whose absolute readings drift. In October the effect of green is small; shade does most of its work in summer, so this is a lower bound, not a forecast.

## Limits
- Autumn, around midday, one or two days per place; two places were mostly overcast (Delft, Arnhem) and two mostly sunny (Oirschot, Middelbeers).
- Thermal values are 8-bit images on a 0 to 40 C scale from an uncalibrated small sensor: relative, not lab-grade.
- The thermal and colour cameras do not see exactly the same scene.
- Photos are shown per street stretch, never per person or house. Only about 230 normal-colour photos are published, small, with faces and plates blurred.

## Credits
Spectrascapes dataset (CC BY 4.0). OpenStreetMap contributors (ODbL). Open-Meteo. Basemap by CARTO.
