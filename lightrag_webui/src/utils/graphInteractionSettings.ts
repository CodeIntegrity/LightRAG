export const getGraphInteractionSettings = (enableEdgeEvents: boolean) => ({
  enableEdgeEvents,
  enableEdgeClickEvents: enableEdgeEvents,
  enableEdgeHoverEvents: enableEdgeEvents,
  enableEdgeWheelEvents: enableEdgeEvents
})
