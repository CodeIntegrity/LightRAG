type XYPosition = {
  x: number
  y: number
}

type LinkedDragMovementInput = {
  positions: Record<string, XYPosition>
  draggedNodeId: string
  linkedNodeIds: string[]
  nextPosition: XYPosition
}

export const applyLinkedDragMovement = ({
  positions,
  draggedNodeId,
  linkedNodeIds,
  nextPosition
}: LinkedDragMovementInput): Record<string, XYPosition> => {
  const draggedPosition = positions[draggedNodeId]
  if (!draggedPosition) {
    return positions
  }

  const deltaX = nextPosition.x - draggedPosition.x
  const deltaY = nextPosition.y - draggedPosition.y
  const movedPositions: Record<string, XYPosition> = {
    ...positions,
    [draggedNodeId]: nextPosition
  }

  for (const nodeId of linkedNodeIds) {
    const position = positions[nodeId]
    if (!position) {
      continue
    }

    movedPositions[nodeId] = {
      x: position.x + deltaX,
      y: position.y + deltaY
    }
  }

  return movedPositions
}
