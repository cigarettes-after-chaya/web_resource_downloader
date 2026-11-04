import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { WfButton, WfDialog, WfListView, type LvRow } from "./controls";
import { useMessageBox } from "./MessageBox";

/**
 * Web equivalent of the original FolderBrowserDialog
 * ("Select output folder for downloaded website"). The desktop app browsed
 * the local disk; here downloads live in a server-managed area, so the
 * dialog picks or creates a named subfolder of it.
 */
export function BrowseFolderDialog({
  current,
  onSelect,
  onClose,
}: {
  current: string;
  onSelect: (folder: string) => void;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const foldersQuery = trpc.folders.list.useQuery();
  const createMutation = trpc.folders.create.useMutation({
    onSuccess: (_d, vars) => {
      utils.folders.list.invalidate();
      onSelect(vars.name);
      onClose();
    },
    onError: (e) => show(e.message, "Error", "error"),
  });
  const [selected, setSelected] = useState<LvRow | null>(null);
  const [newName, setNewName] = useState("");
  const { show, messageBox } = useMessageBox();

  const folders = foldersQuery.data?.folders ?? [];
  const rows: LvRow[] = folders.map((f) => ({
    key: f,
    data: f,
    cells: ["📁", f],
    className: f === current ? undefined : undefined,
  }));

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    createMutation.mutate({ name });
  };

  return (
    <WfDialog title="Browse For Folder" onClose={onClose} width={420}>
      <div className="wf-dialog-body">
        <div className="wf-label">Select output folder for downloaded website</div>
        <div className="wf-hint" style={{ marginBottom: 8 }}>
          Downloads are stored on the server under this folder; finished sites
          are delivered to your browser as a ZIP archive.
        </div>
        <div style={{ height: 200, display: "flex" }}>
          <WfListView
            columns={[
              { title: "", width: 30 },
              { title: "Folder", width: 320 },
            ]}
            rows={rows}
            selectedKey={selected?.key ?? null}
            onSelect={setSelected}
            onDoubleClick={(r) => {
              onSelect(String(r.data));
              onClose();
            }}
            emptyText="No folders yet — create one below"
          />
        </div>
        <div className="wf-field-row" style={{ marginTop: 10, marginBottom: 0 }}>
          <span className="wf-label">New folder:</span>
          <input
            className="wf-input"
            style={{ flex: 1, height: 23, fontSize: 13 }}
            value={newName}
            placeholder="my-site"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <WfButton onClick={handleCreate} disabled={!newName.trim() || createMutation.isPending}>
            Create
          </WfButton>
        </div>
      </div>
      <div className="wf-dialog-footer" style={{ justifyContent: "flex-end", paddingTop: 10 }}>
        <WfButton
          className="default"
          onClick={() => {
            if (selected) {
              onSelect(String(selected.data));
              onClose();
            }
          }}
          disabled={!selected}
          style={{ width: 88 }}
        >
          OK
        </WfButton>
        <WfButton onClick={onClose} style={{ width: 88 }}>
          Cancel
        </WfButton>
      </div>
      {messageBox}
    </WfDialog>
  );
}
