// The story as data. One config object per chapter; each step inside it can override
// the camera, the slider position, the highlighted frame and the chart state.
//
// layout:   which stage panels are visible ("image" | "map" | "split" | "chart" | "list" | "explore")
// camera:   { area } fits that place; { priority: true } fits the priority stretches
// layers:   dots ("all" | place name | null), progressive (dots appear in ride order),
//           trips (place name: the route draws itself), segments ("priority")
// time:     "scroll" maps chapter scroll progress to the ride clock; "full" shows it all
// slider:   [a, b] handle positions: [0,a) normal, [a,b) near-infrared, [b,1] thermal
// highlight: key of story.chapter_frames, or null
// copy:     key into COPY (story.js); `when` gates a whole chapter on a story.json flag

export const CHAPTERS = [
  {
    id: "hook",
    layout: "image",
    sliderHandles: false,
    steps: [
      { copy: "hook.intro", slider: [0, 0] },
      { copy: "hook.headline", slider: [0, 0] },
    ],
  },
  {
    id: "beyond",
    layout: "image",
    sliderHandles: true,
    steps: [
      { copy: "beyond.rgb", slider: [1, 1] },
      { copy: "beyond.nir", slider: [0, 1] },
      { copy: "beyond.thermal", slider: [0, 0] },
      { copy: "beyond.try", slider: [0.34, 0.67] },
    ],
  },
  {
    id: "ride",
    layout: "map",
    camera: { area: "Arnhem" },
    layers: { dots: "Arnhem", progressive: true, trips: "Arnhem" },
    time: "scroll",
    legend: true,
    steps: [{ copy: "ride.intro" }, { copy: "ride.color" }],
  },
  {
    id: "question",
    layout: "split",
    camera: { area: "Arnhem" },
    layers: { dots: "all" },
    legend: true,
    chart: "scatter",
    steps: [
      { copy: "question.intro", chartState: { median: false } },
      { copy: "question.answer", chartState: { median: true } },
      { copy: "question.spread", chartState: { median: true } },
      { copy: "question.hover", chartState: { median: true, interactive: true } },
    ],
  },
  {
    id: "places",
    layout: "chart",
    chart: "multiples",
    steps: [{ copy: "places.intro" }, { copy: "places.verdict" }],
  },
  {
    id: "trees",
    when: (story) => !!(story.trees && story.trees.show),
    layout: "chart",
    chart: "trees",
    steps: [{ copy: "trees.body" }],
  },
  {
    id: "sowhat",
    layout: "list",
    camera: { priority: true },
    layers: { segments: "priority" },
    legend: true,
    steps: [{ copy: "sowhat.body" }, { copy: "sowhat.list" }],
  },
  {
    id: "explore",
    layout: "explore",
    camera: { area: "Arnhem" },
    layers: { dots: "explore" },
    legend: true,
    interactive: true,
    steps: [{ copy: "explore.body", tall: true }],
  },
];

export const AREA_ORDER = ["Middelbeers", "Oirschot", "Delft", "Arnhem"];
