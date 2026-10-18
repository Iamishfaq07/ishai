// The few extension APIs used here (Chrome and Edge, Manifest V3), typed by hand instead of a dependency.
declare namespace chrome {
  interface Event<T extends (...args: never[]) => unknown> {
    addListener(cb: T): void;
    removeListener(cb: T): void;
  }
  namespace runtime {
    const onInstalled: Event<(details: { reason: string }) => void>;
    const onStartup: Event<() => void>;
    const onMessage: Event<(message: unknown, sender: { id?: string; url?: string; tab?: tabs.Tab }, sendResponse: (r?: unknown) => void) => boolean | void>;
    function sendMessage<R = unknown>(message: unknown): Promise<R>;
    function getPlatformInfo(): Promise<{ os: string }>;
    function getURL(path: string): string;
    const id: string;
  }
  namespace storage {
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }
    const local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    };
    const onChanged: Event<(changes: Record<string, StorageChange>, area: string) => void>;
  }
  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      status?: string;
      windowId?: number;
      active?: boolean;
    }
    function query(q: { active?: boolean; currentWindow?: boolean; windowId?: number }): Promise<Tab[]>;
    function create(p: { url: string; active?: boolean; windowId?: number }): Promise<Tab>;
    function get(tabId: number): Promise<Tab>;
    function remove(tabId: number): Promise<void>;
    function update(tabId: number, p: { active?: boolean; url?: string }): Promise<Tab>;
    function group(p: { tabIds: number[]; createProperties?: { windowId?: number } }): Promise<number>;
    function captureVisibleTab(windowId: number, options: { format: "png" | "jpeg"; quality?: number }): Promise<string>;
    const onRemoved: Event<(tabId: number) => void>;
  }
  namespace tabGroups {
    function update(groupId: number, p: { title?: string; color?: string; collapsed?: boolean }): Promise<unknown>;
  }
  namespace windows {
    interface Window {
      id?: number;
      tabs?: tabs.Tab[];
    }
    function create(p: { url?: string; focused?: boolean; type?: "normal" | "popup"; width?: number; height?: number }): Promise<Window>;
    function remove(windowId: number): Promise<void>;
  }
  namespace scripting {
    function executeScript<R>(details: {
      target: { tabId: number };
      files?: string[];
      func?: (...args: never[]) => R;
      args?: unknown[];
    }): Promise<{ result?: R }[]>;
  }
  namespace permissions {
    interface Permissions {
      origins?: string[];
      permissions?: string[];
    }
    function request(p: Permissions): Promise<boolean>;
    function remove(p: Permissions): Promise<boolean>;
    function contains(p: Permissions): Promise<boolean>;
    const onRemoved: Event<(p: Permissions) => void>;
  }
  namespace alarms {
    interface Alarm {
      name: string;
      scheduledTime: number;
    }
    function create(name: string, info: { when?: number; delayInMinutes?: number; periodInMinutes?: number }): Promise<void>;
    function clear(name: string): Promise<boolean>;
    function get(name: string): Promise<Alarm | undefined>;
    const onAlarm: Event<(alarm: Alarm) => void>;
  }
  namespace action {
    function setBadgeText(p: { text: string }): Promise<void>;
    function setBadgeBackgroundColor(p: { color: string }): Promise<void>;
    function setTitle(p: { title: string }): Promise<void>;
  }
}
