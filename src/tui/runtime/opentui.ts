import type { JSX } from "solid-js";

type RendererHandle = {
  destroy: () => void | Promise<void>;
};

export interface TuiRenderer {
  destroy: () => void | Promise<void>;
  onDestroy?: () => void;
}

const dynamicImport = new Function(
  "specifier",
  "return import(specifier).then((mod) => mod as any).catch(() => null);",
);

export async function createTuiRenderer(App: () => JSX.Element): Promise<TuiRenderer> {
  const names = ["@opentui/solid", "opentui-solid", "opentui", "@opentui/core"];

  for (const name of names) {
    const mod = (await dynamicImport(name)) as any;
    if (!mod) {
      continue;
    }

    if (typeof mod.render === "function") {
      const result: RendererHandle = await mod.render(App, {
        fullScreen: true,
        stdin: process.stdin,
        stdout: process.stdout,
      });
      if (result && typeof result.destroy === "function") {
        return {
          destroy: () => result.destroy(),
          onDestroy() {},
        };
      }
    }

    if (typeof mod.createRenderer === "function") {
      const result: RendererHandle = await mod.createRenderer({
        root: App,
        input: process.stdin,
        output: process.stdout,
      });
      if (result && typeof result.destroy === "function") {
        return {
          destroy: () => result.destroy(),
          onDestroy() {},
        };
      }
    }
  }

  console.warn("No OpenTUI runtime found. Falling back to non-rendered shell.");
  return {
    destroy() {
      // noop for fallback mode.
    },
  };
}
