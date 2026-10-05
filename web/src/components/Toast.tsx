export interface ToastState {
  text: string;
  onShow?: (() => void) | null;
  kind?: string;
}

export function Toast({ toast, onHide }: { toast: ToastState | null; onHide(): void }) {
  return (
    <div id="toast" role="status" hidden={!toast} className={toast && toast.kind ? toast.kind : ""}>
      {toast ? (
        <>
          <span>{toast.text}</span>
          {toast.onShow ? <button className="btn" type="button" onClick={() => { onHide(); toast.onShow!(); }}>Show</button> : null}
          <button className="linkish" type="button" onClick={onHide}>Dismiss</button>
        </>
      ) : null}
    </div>
  );
}
