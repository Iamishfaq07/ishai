// The few extension APIs used here (Chrome and Edge, Manifest V3), typed by hand instead of a dependency.
declare namespace chrome {
  namespace runtime {
    const onInstalled: { addListener(cb: (details: { reason: string }) => void): void };
  }
  namespace storage {
    const local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    };
  }
  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
    }
    function query(q: { active: boolean; currentWindow: boolean }): Promise<Tab[]>;
    function create(p: { url: string }): Promise<Tab>;
  }
  namespace scripting {
    function executeScript<R>(details: {
      target: { tabId: number };
      files?: string[];
      func?: (...args: never[]) => R;
      args?: unknown[];
    }): Promise<{ result?: R }[]>;
  }
}
