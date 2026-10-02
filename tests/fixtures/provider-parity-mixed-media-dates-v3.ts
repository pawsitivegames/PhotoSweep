export const providerParityMixedMediaDatesV3 = {
  dateRange: {
    from: "2024-06-01",
    to: "2024-06-30"
  },
  items: [
    { name: "pair-landscape-canoe-a.png", mediaType: "photo", captureTimeLocal: null },
    { name: "pair-landscape-canoe-b.png", mediaType: "photo", captureTimeLocal: null },
    { name: "pair-portrait-bicycle-a.png", mediaType: "photo", captureTimeLocal: null },
    { name: "pair-portrait-bicycle-b.png", mediaType: "photo", captureTimeLocal: null },
    { name: "pair-square-teapot-a.png", mediaType: "photo", captureTimeLocal: null },
    { name: "pair-square-teapot-b.png", mediaType: "photo", captureTimeLocal: null },
    { name: "pair-wide-bridge-a.png", mediaType: "photo", captureTimeLocal: null },
    { name: "pair-wide-bridge-b.png", mediaType: "photo", captureTimeLocal: null },
    { name: "control-pear-bowl.png", mediaType: "photo", captureTimeLocal: null },
    { name: "control-coastal-tent.png", mediaType: "photo", captureTimeLocal: null },
    { name: "boundary-start.png", mediaType: "photo", captureTimeLocal: "2024-06-01T00:00:00" },
    { name: "boundary-end.jpeg", mediaType: "photo", captureTimeLocal: "2024-06-30T23:59:59" },
    { name: "boundary-outside.png", mediaType: "photo", captureTimeLocal: "2024-05-31T23:59:59" },
    { name: "pair-video-a.mp4", mediaType: "video", captureTimeLocal: "2024-06-15T12:00:00" },
    { name: "pair-video-b.mp4", mediaType: "video", captureTimeLocal: "2024-06-15T12:00:01" }
  ],
  expected: {
    itemCount: 15,
    photoCount: 13,
    videoCount: 2,
    includedNames: [
      "boundary-start.png",
      "boundary-end.jpeg",
      "pair-video-a.mp4",
      "pair-video-b.mp4"
    ],
    itemsVisited: 15,
    itemsReturned: 4,
    itemsSkipped: 11,
    unknownDateItemsSkipped: 10,
    outOfRangeDateItems: 1
  }
} as const

export function providerParityFixtureTimestamp(
  captureTimeLocal: string | null
): number {
  return captureTimeLocal === null
    ? Number.NaN
    : new Date(captureTimeLocal).getTime()
}
