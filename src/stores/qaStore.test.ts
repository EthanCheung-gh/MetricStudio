import { beforeEach, describe, expect, it } from 'vitest'
import { useQAStore } from './qaStore'

beforeEach(() => {
  useQAStore.setState({ datasetId: null, snapshotId: null, activeConversationId: null, conversations: [] })
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

  it('compacts a run of turns into one compaction turn', () => {
    useQAStore.getState().setDataset('dataset-1')
    for (let i = 1; i <= 5; i++) {
      useQAStore.getState().addTurn({ question: `Q${i}`, answer: `A${i}`, evidence: [] })
    }
    useQAStore.getState().compactTurns(0, 3, '前四轮摘要')

    const activeId = useQAStore.getState().activeConversationId
    const turns = useQAStore.getState().conversations.find((item) => item.id === activeId)?.turns ?? []
    expect(turns).toHaveLength(2)
    expect(turns[0].kind).toBe('compaction')
    expect(turns[0].summary).toBe('前四轮摘要')
    expect(turns[0].compactedRange).toEqual([1, 4])
    expect(turns[1].question).toBe('Q5')
  })

  it('compacts over an existing compaction turn', () => {
    useQAStore.getState().setDataset('dataset-1')
    for (let i = 1; i <= 6; i++) {
      useQAStore.getState().addTurn({ question: `Q${i}`, answer: `A${i}`, evidence: [] })
    }
    // First pass: turns 1-4 collapse into one compaction turn.
    useQAStore.getState().compactTurns(0, 3, '第一轮摘要')
    // After that: [compaction(1-4), Q5, Q6]. Compacting again over the old
    // summary plus Q5 leaves only Q6 outside.
    useQAStore.getState().compactTurns(0, 1, '合并后的摘要')

    const activeId = useQAStore.getState().activeConversationId
    const turns = useQAStore.getState().conversations.find((item) => item.id === activeId)?.turns ?? []
    expect(turns).toHaveLength(2)
    expect(turns[0].summary).toBe('合并后的摘要')
    expect(turns[0].compactedRange).toEqual([1, 2])
    expect(turns[1].question).toBe('Q6')
  })

  it('clears the selected snapshot when switching datasets', () => {
    useQAStore.getState().setDataset('dataset-1')
    useQAStore.getState().setSnapshotId('snapshot-1')
    useQAStore.getState().setDataset('dataset-2')

    expect(useQAStore.getState().snapshotId).toBeNull()
  })
})
