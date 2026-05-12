export const DEFAULT_GRAPH_LABEL_FONT_SIZE = 12
const EDGE_LABEL_SIZE_OFFSET = 4

export const getEdgeLabelFontSize = (nodeLabelFontSize: number): number =>
  Math.max(1, nodeLabelFontSize - EDGE_LABEL_SIZE_OFFSET)
