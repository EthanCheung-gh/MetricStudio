import { create } from 'zustand'
import { generateId } from '@/utils/id'

export interface QAEvidence {
  kind: string
  detail: string
}

export interface QATurn {
  question: string
  answer: string
  evidence: QAEvidence[]
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
  activeConversationId: string | null
  conversations: QAConversation[]
  setDataset: (datasetId: string | null) => void
  createConversation: (name?: string) => string | null
  selectConversation: (id: string) => void
  renameConversation: (id: string, name: string) => void
  deleteConversation: (id: string) => void
  addTurn: (turn: QATurn) => void
  deleteTurn: (index: number) => void
  replaceTurn: (index: number, turn: QATurn) => void
  clear: () => void
}

function newConversation(datasetId: string, name = '新建问答'): QAConversation {
  const now = new Date().toISOString()
  return { id: generateId(), datasetId, name, turns: [], createdAt: now, updatedAt: now }
}

export const useQAStore = create<QAState>((set) => ({
  datasetId: null,
  activeConversationId: null,
  conversations: [],

  setDataset: (datasetId) =>
    set((state) => {
      if (state.datasetId === datasetId) return state
      if (!datasetId) return { datasetId: null, activeConversationId: null }
      const existing = state.conversations.find((item) => item.datasetId === datasetId)
      if (existing) return { datasetId, activeConversationId: existing.id }
      const conversation = newConversation(datasetId)
      return {
        datasetId,
        activeConversationId: conversation.id,
        conversations: [...state.conversations, conversation],
      }
    }),

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

  clear: () =>
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === state.activeConversationId ? { ...item, turns: [], updatedAt: new Date().toISOString() } : item,
      ),
    })),
}))
