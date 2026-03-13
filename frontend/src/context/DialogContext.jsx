import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

const DialogContext = createContext(null);

function normalizeOptions(input, fallbackTitle) {
  if (typeof input === "string") {
    return {
      title: fallbackTitle,
      message: input
    };
  }

  return {
    title: input?.title || fallbackTitle,
    message: input?.message || "",
    confirmLabel: input?.confirmLabel || "OK",
    cancelLabel: input?.cancelLabel || "Cancelar"
  };
}

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);

  const closeDialog = useCallback((result) => {
    setDialog(null);
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  }, []);

  const showAlert = useCallback((options) => {
    const data = normalizeOptions(options, "Mensagem");
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog({
        type: "alert",
        title: data.title,
        message: data.message,
        confirmLabel: data.confirmLabel
      });
    });
  }, []);

  const showConfirm = useCallback((options) => {
    const data = normalizeOptions(options, "Confirmação");
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog({
        type: "confirm",
        title: data.title,
        message: data.message,
        confirmLabel: data.confirmLabel,
        cancelLabel: data.cancelLabel
      });
    });
  }, []);

  const value = useMemo(
    () => ({
      showAlert,
      showConfirm
    }),
    [showAlert, showConfirm]
  );

  return (
    <DialogContext.Provider value={value}>
      {children}
      {dialog ? (
        <div className="dialog-backdrop" role="dialog" aria-modal="true">
          <div className="dialog-card">
            <header className="dialog-header">
              <h3>{dialog.title}</h3>
            </header>
            <div className="dialog-body">
              <p>{dialog.message}</p>
            </div>
            <footer className="dialog-actions">
              {dialog.type === "confirm" ? (
                <button
                  className="button button-outline"
                  onClick={() => closeDialog(false)}
                  type="button"
                >
                  {dialog.cancelLabel}
                </button>
              ) : null}
              <button
                className="button button-primary"
                onClick={() => closeDialog(true)}
                type="button"
              >
                {dialog.confirmLabel}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("useDialog deve ser usado dentro de DialogProvider.");
  }
  return context;
}
