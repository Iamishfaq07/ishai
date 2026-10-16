// Injected into the tab the person clicked the extension on (activeTab), in the extension's isolated world. The popup
// then calls these through chrome.scripting. No other page is ever touched.
import { extractJob } from "./extract";
import { fillForm } from "./fill";

(globalThis as unknown as { __orbitExtension: unknown }).__orbitExtension = { extractJob, fillForm };
