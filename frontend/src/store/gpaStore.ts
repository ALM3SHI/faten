import { create } from 'zustand'

interface GpaState {
  targetGpa: number | null
  setTargetGpa: (gpa: number) => void
}

export const useGpaStore = create<GpaState>((set) => ({
  targetGpa: null,
  setTargetGpa: (gpa) => set({ targetGpa: gpa }),
}))
