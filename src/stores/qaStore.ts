import { create } from 'zustand'

export interface QAEvidence {
  kind: string
  detail: string
}

export interface QATurn {
  question: string
  answer: string
  evidence: QAEvidence[]
}

interface QAState {
  datasetId: string | null
  turns: QATurn[]
  setDataset: (datasetId: string | null) => void
  addTurn: (turn: QATurn) => void
  clear: () => void
}

export const useQAStore = create<QAState>((set) => ({
  datasetId: null,
  turns: [],

  setDataset: (datasetId) =>
    set((state) => (state.datasetId === datasetId ? state : { datasetId, turns: [] })),

  addTurn: (turn) => set((state) => ({ turns: [...state.turns, turn] })),

  clear: () => set({ turns: [] }),
}))
