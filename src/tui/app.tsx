import { createTuiRenderer } from "./runtime/opentui";
import { createAppStore } from "./state/store";
import { HomeRoute } from "./routes/Home";
import { SessionRoute } from "./routes/Session";
import { ResultsRoute } from "./routes/Results";
import { HeaderBar } from "./components/HeaderBar";
import { WorkerSidebar } from "./components/WorkerSidebar";
import { MessageStream } from "./components/MessageStream";
import { CommandDock } from "./components/CommandDock";

export async function createTuiApp() {
  let terminate: () => void | Promise<void> = () => {};
  const store = createAppStore({
    onExit: async () => {
      await terminate();
    },
  });

  const renderer = await createTuiRenderer(() => <App store={store} />);
  terminate = () => renderer.destroy();
  store.actions.seedWelcome();

  return renderer;
}

function App(props: { store: ReturnType<typeof createAppStore> }) {
  const store = props.store;

  return (
    <div
      style={{ height: "100%", display: "flex", flexDirection: "column", padding: "1" }}
    >
      <HeaderBar runState={store.state.runState} />

      <div style={{ flex: 1, display: "flex", padding: "1" }}>
        <WorkerSidebar workers={store.state.workers} />

        <main style={{ flex: 1, paddingLeft: "1" }}>
          {store.state.route() === "home" && <HomeRoute />}
          {store.state.route() === "session" && (
            <SessionRoute messages={store.state.messages} />
          )}
          {store.state.route() === "results" && <ResultsRoute />}
        </main>
      </div>

      <CommandDock
        commandBuffer={store.state.commandBuffer}
        commandMode={store.state.commandMode}
        isBusy={store.state.runBusy}
        onCommandBuffer={store.actions.updateCommandBuffer}
        onSubmit={() => store.actions.submitCommand()}
        onCancelCommand={store.actions.cancelCommand}
        onClear={() => store.actions.clearCommandBuffer()}
        suggestions={store.state.commandSuggestions}
        onSuggestionSelect={store.actions.selectSuggestion}
      />

      <MessageStream messages={store.state.messages} toasts={store.state.toasts} />
    </div>
  );
}
