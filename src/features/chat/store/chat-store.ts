import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "pending" | "complete" | "error";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  status?: MessageStatus;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface ChatState {
  messages: ChatMessage[];

  // Actions
  addMessage: (msg: Omit<ChatMessage, "id" | "createdAt">) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  clearMessages: () => void;
}

let msgCounter = 0;
function nextId(): string {
  msgCounter += 1;
  return `msg-${Date.now()}-${msgCounter}`;
}

export const useChatStore = create<ChatState>()((set) => ({
  messages: [],

  addMessage: (msg) => {
    const newMsg: ChatMessage = {
      ...msg,
      id: nextId(),
      createdAt: Date.now(),
    };
    set((state) => ({
      messages: [...state.messages, newMsg],
    }));
  },

  updateMessage: (id, updates) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m,
      ),
    }));
  },

  clearMessages: () => set({ messages: [] }),
}));
