import { beforeEach, describe, expect, it } from 'vitest'
import { useQAStore } from './qaStore'

beforeEach(() => {
  useQAStore.setState({ datasetId: null, turns: [] })
})

describe('QA conversation store', () => {
  it('shares turns for the active dataset', () => {
    useQAStore.getState().setDataset('dataset-1')
    useQAStore.getState().addTurn({ question: 'Q1', answer: 'A1', evidence: [] })

    expect(useQAStore.getState().datasetId).toBe('dataset-1')
    expect(useQAStore.getState().turns).toHaveLength(1)
  })

  it('clears turns when switching datasets', () => {
    useQAStore.getState().setDataset('dataset-1')
    useQAStore.getState().addTurn({ question: 'Q1', answer: 'A1', evidence: [] })
    useQAStore.getState().setDataset('dataset-2')

    expect(useQAStore.getState().datasetId).toBe('dataset-2')
    expect(useQAStore.getState().turns).toEqual([])
  })
})
