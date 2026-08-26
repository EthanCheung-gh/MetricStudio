import { create } from 'zustand'
import { generateId } from '@/utils/id'

export interface QAEvidence {
  id?: string
  kind: string
  detail: string
  source?: { datasetId?: string; snapshotId?: string; field?: string; row?: string | number }
}

export interface QAFilter {
  field: string
  op: 'range' | 'in'
  range?: [string | number | null, string | number | null]
  values?: string[]
}

export interface QAContext {
  datasetId: string
  snapshotId?: string
  filters?: QAFilter[]
  model?: string
}

export interface QATurn {
  question: string
  answer: string
  evidence: QAEvidence[]
  context?: QAContext
  generatedAt?: string
}

export interface QAConversation {
  id: string
  datasetId: string
  name: string
  turns: QATurn[]
  createdAt: string
  updatedAt: string
}

interface QAState {
  datasetId: string | null
  snapshotId: string | null
  activeConversationId: string | null
  conversations: QAConversation[]
  setDataset: (datasetId: string | null) => void
  setSnapshotId: (snapshotId: string | null) => void
  createConversation: (name?: string) => string | null
  selectConversation: (id: string) => void
  renameConversation: (id: string, name: string) => void
  deleteConversation: (id: string) => void
  addTurn: (turn: QATurn) => void
  deleteTurn: (index: number) => void
  replaceTurn: (index: number, turn: QATurn) => void
  hydrate: (conversations: QAConversation[], activeConversationId?: string | null) => void
  clear: () => void
}

function newConversation(datasetId: string, name = '新建问答'): QAConversation {
  const now = new Date().toISOString()
  return { id: generateId(), datasetId, name, turns: [], createdAt: now, updatedAt: now }
}

export const useQAStore = create<QAState>((set) => ({
  datasetId: null,
  snapshotId: null,
  activeConversationId: null,
  conversations: [],

  setDataset: (datasetId) =>
    set((state) => {
      if (state.datasetId === datasetId) return state
      if (!datasetId) return { datasetId: null, snapshotId: null, activeConversationId: null }
      const existing = state.conversations.find((item) => item.datasetId === datasetId)
      if (existing) return { datasetId, snapshotId: null, activeConversationId: existing.id }
      const conversation = newConversation(datasetId)
      return {
        datasetId,
        snapshotId: null,
        activeConversationId: conversation.id,
        conversations: [...state.conversations, conversation],
      }
    }),

  setSnapshotId: (snapshotId) => set({ snapshotId }),

  createConversation: (name) => {
    let createdId: string | null = null
    set((state) => {
      if (!state.datasetId) return state
      const conversation = newConversation(state.datasetId, name?.trim() || '新建问答')
      createdId = conversation.id
      return {
        activeConversationId: conversation.id,
        conversations: [...state.conversations, conversation],
      }
    })
    return createdId
  },

  selectConversation: (id) =>
    set((state) => {
      const conversation = state.conversations.find((item) => item.id === id && item.datasetId === state.datasetId)
      return conversation ? { activeConversationId: id } : state
    }),

  renameConversation: (id, name) =>
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === id && name.trim() ? { ...item, name: name.trim(), updatedAt: new Date().toISOString() } : item,
      ),
    })),

  deleteConversation: (id) =>
    set((state) => {
      const remaining = state.conversations.filter((item) => item.id !== id)
      if (state.activeConversationId !== id) return { conversations: remaining }
      const next = remaining.find((item) => item.datasetId === state.datasetId)
      if (next) return { conversations: remaining, activeConversationId: next.id }
      if (!state.datasetId) return { conversations: remaining, activeConversationId: null }
      const conversation = newConversation(state.datasetId)
      return { conversations: [...remaining, conversation], activeConversationId: conversation.id }
    }),

  addTurn: (turn) =>
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === state.activeConversationId
          ? { ...item, turns: [...item.turns, turn], updatedAt: new Date().toISOString() }
          : item,
      ),
    })),

  deleteTurn: (index) =>
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === state.activeConversationId
          ? { ...item, turns: item.turns.filter((_, turnIndex) => turnIndex !== index), updatedAt: new Date().toISOString() }
          : item,
      ),
    })),

  replaceTurn: (index, turn) =>
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === state.activeConversationId
          ? { ...item, turns: item.turns.map((current, turnIndex) => (turnIndex === index ? turn : current)), updatedAt: new Date().toISOString() }
          : item,
      ),
    })),

  hydrate: (conversations, activeConversationId = null) =>
    set(() => {
      const datasetId = conversations.find((item) => item.id === activeConversationId)?.datasetId
        ?? conversations[0]?.datasetId
        ?? null
      const activeId = conversations.some((item) => item.id === activeConversationId)
        ? activeConversationId
        : conversations.find((item) => item.datasetId === datasetId)?.id ?? null
      return { conversations, datasetId, snapshotId: null, activeConversationId: activeId }
    }),

  clear: () =>
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === state.activeConversationId ? { ...item, turns: [], updatedAt: new Date().toISOString() } : item,
      ),
    })),
}))
