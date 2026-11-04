import { useState } from "react";
import { trpc } from "@/providers/trpc";
import type { DownloadHistoryItem } from "@contracts/types";
import { WfButton, WfDialog, WfListView, type LvRow } from "./controls";
import { useMessageBox } from "./MessageBox";

function formatDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function formatDuration(sec: number): string {
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(Math.floor(sec % 60)).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** HistoryForm reconstruction (Download History dialog). */
export function HistoryDialog({
  onPick,
  onClose,
}: {
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const historyQuery = trpc.history.list.useQuery();
  const clearMutation = trpc.history.clear.useMutation({
    onSuccess: () => utils.history.list.invalidate(),
  });
  const [selected, setSelected] = useState<LvRow | null>(null);
  const { confirm, messageBox } = useMessageBox();

  const items = (historyQuery.data ?? []) as DownloadHistoryItem[];
  const rows: LvRow[] = items.map((item) => ({
    key: item.id,
    className: item.success ? "lv-ok" : "lv-fail",
    data: item.url,
    cells: [
      formatDate(item.downloadDate),
      item.url,
      item.success ? "✓ Success" : "✗ Failed",
      formatDuration(item.durationSec),
    ],
  }));

  const pick = (row: LvRow | null) => {
    if (row?.data) {
      onPick(String(row.data));
      onClose();
    }
  };

  const handleClear = async () => {
    if (
      await confirm(
        "Are you sure you want to clear all download history?",
        "Clear History",
        "question",
      )
    ) {
      clearMutation.mutate();
      setSelected(null);
    }
  };

  return (
    <WfDialog title="Download History" onClose={onClose} width={584} height="min(430px, calc(100dvh - 32px))">
      <div className="wf-dialog-body" style={{ gap: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, padding: "0 0 10px" }}>
          Download History
        </div>
        <WfListView
          columns={[
            { title: "Date", width: 120 },
            { title: "URL", width: 280 },
            { title: "Status", width: 80 },
            { title: "Duration", width: 70 },
          ]}
          rows={rows}
          selectedKey={selected?.key ?? null}
          onSelect={setSelected}
          onDoubleClick={pick}
          emptyText={historyQuery.isLoading ? "Loading..." : "No download history yet"}
        />
      </div>
      <div className="wf-dialog-footer" style={{ justifyContent: "space-between", paddingTop: 10 }}>
        <WfButton
          onClick={handleClear}
          disabled={rows.length === 0}
          style={{ width: 100, height: 35, fontSize: 13.3 }}
        >
          Clear History
        </WfButton>
        <span style={{ display: "flex", gap: 10 }}>
          <WfButton
            onClick={() => pick(selected)}
            disabled={!selected}
            style={{ width: 130, height: 35, fontSize: 13.3 }}
          >
            Use Selected URL
          </WfButton>
          <WfButton onClick={onClose} style={{ width: 140, height: 35, fontSize: 13.3 }}>
            Close
          </WfButton>
        </span>
      </div>
      {messageBox}
    </WfDialog>
  );
}
