import { beforeEach, describe, expect, it } from 'vitest'
import { useQAStore } from './qaStore'

beforeEach(() => {
  useQAStore.setState({ datasetId: null, activeConversationId: null, conversations: [] })
})

describe('QA conversation store', () => {
  it('keeps conversations isolated per dataset', () => {
    useQAStore.getState().setDataset('dataset-1')
    useQAStore.getState().addTurn({ question: 'Q1', answer: 'A1', evidence: [] })
    const firstConversationId = useQAStore.getState().activeConversationId
    useQAStore.getState().setDataset('dataset-2')

    expect(useQAStore.getState().datasetId).toBe('dataset-2')
    expect(useQAStore.getState().conversations.find((item) => item.id === firstConversationId)?.turns).toHaveLength(1)
    expect(useQAStore.getState().conversations.find((item) => item.datasetId === 'dataset-2')?.turns).toEqual([])
  })

  it('creates, renames and selects conversations', () => {
    useQAStore.getState().setDataset('dataset-1')
    const createdId = useQAStore.getState().createConversation('趋势分析')
    useQAStore.getState().renameConversation(createdId!, '月度趋势')
    useQAStore.getState().selectConversation(createdId!)

    const conversation = useQAStore.getState().conversations.find((item) => item.id === createdId)
    expect(useQAStore.getState().activeConversationId).toBe(createdId)
    expect(conversation?.name).toBe('月度趋势')
  })

  it('deletes and replaces turns', () => {
    useQAStore.getState().setDataset('dataset-1')
    useQAStore.getState().addTurn({ question: 'Q1', answer: 'A1', evidence: [] })
    useQAStore.getState().addTurn({ question: 'Q2', answer: 'A2', evidence: [] })
    useQAStore.getState().replaceTurn(0, { question: 'Q1', answer: 'A1 updated', evidence: [] })
    useQAStore.getState().deleteTurn(1)

    const activeId = useQAStore.getState().activeConversationId
    expect(useQAStore.getState().conversations.find((item) => item.id === activeId)?.turns).toEqual([
      { question: 'Q1', answer: 'A1 updated', evidence: [] },
    ])
  })
})
