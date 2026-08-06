"use client";

// ---------------------------------------------------------------------------
// MyBlocksRoot — mounts every My Blocks dialog + toast in one place.
// Rendered once in the editor shell so every entry point shares the same
// dialogs. The library is purely an overlay — it never touches the project
// model, history, or autosave.
// ---------------------------------------------------------------------------

import { MyBlocksLibrary } from "./MyBlocksLibrary";
import { SaveMyBlockDialog } from "./SaveMyBlockDialog";
import { MyBlockDetailsDialog } from "./MyBlockDetailsDialog";
import { RenameMyBlockDialog } from "./RenameMyBlockDialog";
import { DeleteMyBlockDialog } from "./DeleteMyBlockDialog";
import { ImportMyBlockDialog } from "./ImportMyBlockDialog";
import { MyBlocksToast } from "./MyBlocksToast";

export function MyBlocksRoot() {
  return (
    <>
      <MyBlocksLibrary />
      <SaveMyBlockDialog />
      <MyBlockDetailsDialog />
      <RenameMyBlockDialog />
      <DeleteMyBlockDialog />
      <ImportMyBlockDialog />
      <MyBlocksToast />
    </>
  );
}
