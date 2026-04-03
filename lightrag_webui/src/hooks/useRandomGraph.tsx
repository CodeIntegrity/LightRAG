import { Faker, en, faker } from '@faker-js/faker'
import Graph, { UndirectedGraph } from 'graphology'
import erdosRenyi from 'graphology-generators/random/erdos-renyi'
import seedrandom from 'seedrandom'
import { randomColor } from '@/lib/utils'
import * as Constants from '@/lib/constants'
import { useGraphStore } from '@/stores/graph'

export type NodeType = {
  x: number
  y: number
  label: string
  size: number
  color: string
  highlighted?: boolean
}
export type EdgeType = { label: string }

/**
 * Generate a random graph for development/testing.
 * Exported as default so it can be dynamically imported to avoid bundling
 * @faker-js/faker (~3MB) in production builds.
 */
export default function generateRandomGraph(): Graph<NodeType, EdgeType> {
  useGraphStore.getState().reset()

  // Seed from URL query param if present
  const params = new URLSearchParams(document.location.search)
  const seed = params.get('seed')
  let f: Faker = faker
  if (seed) {
    seedrandom(seed, { global: true })
    f = new Faker({ locale: en })
    f.seed(Math.random())
  }

  const graph = erdosRenyi(UndirectedGraph, { order: 100, probability: 0.1 })
  graph.nodes().forEach((node: string) => {
    graph.mergeNodeAttributes(node, {
      label: f.person.fullName(),
      size: f.number.int({ min: Constants.minNodeSize, max: Constants.maxNodeSize }),
      color: randomColor(),
      x: Math.random(),
      y: Math.random(),
      borderColor: randomColor(),
      borderSize: f.number.float({ min: 0, max: 1, multipleOf: 0.1 }),
      pictoColor: randomColor(),
      image: f.image.urlLoremFlickr()
    })
  })

  graph.edges().forEach((edge: string) => {
    graph.mergeEdgeAttributes(edge, {
      label: f.lorem.words(f.number.int({ min: 1, max: 3 })),
      size: f.number.float({ min: 1, max: 5 }),
      color: randomColor()
    })
  })

  return graph as Graph<NodeType, EdgeType>
}
