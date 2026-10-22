// Keyboard-first (product rule 9): CAD shortcuts work everywhere except inside text fields, and
// any letter typed on the canvas goes to the command line.

import { useEffect } from 'react';
import { useStore } from './state/store';

const isTextField = (el: EventTarget | null): boolean => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);

export function focusCommandLine(prefill = ''): void {
  const input = document.querySelector<HTMLInputElement>('.command-line input');
  if (!input) return;
  input.focus();
  if (prefill) input.value = input.value + prefill;
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        if (isTextField(e.target)) (e.target as HTMLElement).blur();
        s.cancelTool();
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        s.undo();
        return;
      }
      if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void s.saveFile(e.shiftKey);
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void s.openFile();
        return;
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        s.newDocument();
        return;
      }
      if (isTextField(e.target)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s.deleteSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        s.select(s.editor.doc.entityOrder);
        return;
      }
      // Any printable character starts typing in the command line.
      if (!mod && !e.altKey && e.key.length === 1 && /[\w@.,\-]/.test(e.key)) {
        e.preventDefault();
        focusCommandLine(e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
