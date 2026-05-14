import { Settings as SigmaSettings } from 'sigma/settings'
import { EdgeArrowProgram, NodePointProgram, NodeCircleProgram } from 'sigma/rendering'
import { NodeBorderProgram } from '@sigma/node-border'
import { EdgeCurvedArrowProgram, createEdgeCurveProgram } from '@sigma/edge-curve'

import { labelColorDarkTheme, labelColorLightTheme } from '@/lib/constants'
import { getGraphInteractionSettings } from '@/utils/graphInteractionSettings'
import { getGraphEdgeType } from '@/utils/graphEdgeType'
import {
  DEFAULT_GRAPH_LABEL_FONT_SIZE,
  getEdgeLabelFontSize
} from '@/utils/graphLabelSize'

export const createSigmaSettings = (
  isDarkTheme: boolean,
  graphLabelFontSize: number = DEFAULT_GRAPH_LABEL_FONT_SIZE,
  enableEdgeEvents: boolean,
  showDirectionalArrows: boolean
): Partial<SigmaSettings> => ({
  allowInvalidContainer: true,
  defaultNodeType: 'default',
  defaultEdgeType: getGraphEdgeType(showDirectionalArrows),
  renderEdgeLabels: false,
  edgeProgramClasses: {
    arrow: EdgeArrowProgram,
    curvedArrow: EdgeCurvedArrowProgram,
    curvedNoArrow: createEdgeCurveProgram()
  },
  nodeProgramClasses: {
    default: NodeBorderProgram,
    circel: NodeCircleProgram,
    point: NodePointProgram
  },
  labelGridCellSize: 60,
  labelRenderedSizeThreshold: 12,
  ...getGraphInteractionSettings(enableEdgeEvents),
  labelColor: {
    color: isDarkTheme ? labelColorDarkTheme : labelColorLightTheme,
    attribute: 'labelColor'
  },
  edgeLabelColor: {
    color: isDarkTheme ? labelColorDarkTheme : labelColorLightTheme,
    attribute: 'labelColor'
  },
  edgeLabelSize: getEdgeLabelFontSize(graphLabelFontSize),
  labelSize: graphLabelFontSize
})
