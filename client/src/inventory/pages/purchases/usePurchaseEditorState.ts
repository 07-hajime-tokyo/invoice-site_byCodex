import { createEmptyEditState } from "./editState";
import { useState } from "react";
import { type EditState } from "./types";

export function usePurchaseEditorState() {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState>(createEmptyEditState());
  return { editingId, setEditingId, editState, setEditState };
}
