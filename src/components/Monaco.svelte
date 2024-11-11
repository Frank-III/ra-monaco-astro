<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
  import { type WorldState } from "../lib/wasm_demo/wasm_demo";
  import exampleCode from "../lib/example-code.rs?raw";
  import fake_std from "../lib/fake_std.rs?raw";
  import fake_core from "../lib/fake_core.rs?raw";
  import fake_alloc from "../lib/fake_alloc.rs?raw";
  import rustWorker from "../lib/ra-worker.js?worker";
  import { conf, grammar } from "../lib/rust-grammar";
  import { AnsiUp } from "ansi_up";
  import { Interpreter } from "../lib/interpreter";
  import { ConsoleStore } from "./console.svelte";
  let isAnalyzing = $state(false);
  let isLoading = $state(true);
  let isExecuting = $state(false);
  let editorContainer: HTMLElement;
  let editor: Monaco.editor.IStandaloneCodeEditor;
  let state_: WorldState;
  let monaco: typeof Monaco;
  let allTokens;
  let interpreter: Interpreter;
  let ansiUp = new AnsiUp();
  const modeId = "rust";
  let consoleStore = new ConsoleStore();

  $effect(() => {
    if (consoleStore.messages.length) {
      const console = document.querySelector(".console-output");
      if (console) {
        console.scrollTop = console.scrollHeight;
      }
    }
  });

  // class TokenState {
  //     constructor(line = 0) {
  //         this.line = line;
  //         this.equals = () => true;
  //     }

  //     clone() {
  //         const res = new TokenState(this.line);
  //         res.line += 1;
  //         return res;
  //     }
  // }
  async function handleConsoleToggle() {
    consoleStore.isVisible = !consoleStore.isVisible;
    await tick(); // Wait for DOM update
    editor.layout();
  }
  onMount(async () => {
    // Initialize Monaco Environment
    interpreter = new Interpreter();
    monaco = (await import("../lib/monaco")).default;

    interpreter.onLoaded(() => {
      console.log("interpreter loaded");
    });
    interpreter.onRun(() => {
      consoleStore.clear();
      isExecuting = true;
      console.log("interpreter running");
    });
    interpreter.onResult((result) => {
      isExecuting = false;
      consoleStore.addMessage(
        ansiUp.ansi_to_html(result).replace(/\n/g, "<br>")
      );
    });

    interpreter.onAssetDownloaded((lib) => {
      console.log(`Loaded: ${lib}`);
    });

    // Your existing initialization code
    // For example:
    monaco.languages.register({ id: modeId });
    monaco.languages.onLanguage(modeId, async () => {
      // @ts-ignore
      monaco.languages.setLanguageConfiguration(modeId, conf);
      // @ts-ignore
      monaco.languages.setMonarchTokensProvider(modeId, grammar);
    });

    monaco.editor.defineTheme("vscode-dark-plus", {
      base: "vs-dark",
      inherit: true,
      colors: {
        "editorInlayHint.foreground": "#A0A0A0F0",
        "editorInlayHint.background": "#11223300",
        "editorInlayHint.typeForeground": "#A0A0A0F0",
        "editorInlayHint.parameterForeground": "#A0A0A0F0",
      },
      rules: [
        { token: "keyword.control", foreground: "C586C0" },
        { token: "variable", foreground: "9CDCFE" },
        { token: "support.function", foreground: "DCDCAA" },
      ],
    });

    async function update() {
      isAnalyzing = true;
      const res = await state_.update(model.getValue());
      console.log("diagnostics: ", res.diagnostics);
      monaco.editor.setModelMarkers(model, modeId, res.diagnostics);
      allTokens = res.highlights;
      isAnalyzing = false;
    }
    const initRA = async () => {
      state_ = (await createRA()) as WorldState;
      await registerRA();
      await state_.init(model.getValue(), fake_std, fake_core, fake_alloc);
      await update();
      model.onDidChangeContent(update);
    };

    // Create the editor instance
    const model = monaco.editor.createModel(exampleCode, modeId);

    initRA();
    editor = monaco.editor.create(editorContainer, {
      theme: "vscode-dark-plus",
      model: model,
      inlayHints: {
        enabled: "on",
      },
    });
    isLoading = false;
  });

  onDestroy(() => {
    monaco?.editor.getModels().forEach((model) => model.dispose());
    editor?.dispose();
  });

  // Define your functions (e.g., createRA, registerRA, update)
  // Ensure they are within the <script> scope
  const createRA = async () => {
    // const worker = new Worker(new URL('../lib/ra-worker.js'));
    const worker = new rustWorker();
    const pendingResolve = {};

    let id = 1;
    let ready;

    const callWorker = async (which, ...args) => {
      return new Promise((resolve, _) => {
        pendingResolve[id] = resolve;
        worker.postMessage({
          which: which,
          args: args,
          id: id,
        });
        id += 1;
      });
    };

    const proxyHandler = {
      get: (target, prop, _receiver) => {
        if (prop == "then") {
          return Reflect.get(target, prop, _receiver);
        }
        return async (...args) => {
          return callWorker(prop, ...args);
        };
      },
    };

    worker.onmessage = (e) => {
      if (e.data.id == "ra-worker-ready") {
        ready(new Proxy({}, proxyHandler));
        return;
      }
      const pending = pendingResolve[e.data.id];
      if (pending) {
        pending(e.data.result);
        delete pendingResolve[e.data.id];
      }
    };

    return new Promise((resolve, _) => {
      ready = resolve;
    });
  };
  const registerRA = async () => {
    monaco.languages.registerHoverProvider(modeId, {
      provideHover: (_, pos) => state_.hover(pos.lineNumber, pos.column),
    });
    monaco.languages.registerCodeLensProvider(modeId, {
      async provideCodeLenses(m) {
        const code_lenses = await state_.code_lenses();
        const lenses = code_lenses.map(({ range, command }) => {
          const position = {
            column: range.startColumn,
            lineNumber: range.startLineNumber,
          };

          const references = command.positions.map((pos) => ({
            range: pos,
            uri: m.uri,
          }));
          return {
            range,
            command: {
              id: command.id,
              title: command.title,
              arguments: [m.uri, position, references],
            },
          };
        });

        return { lenses, dispose() {} };
      },
    });
    monaco.languages.registerReferenceProvider(modeId, {
      async provideReferences(m, pos, { includeDeclaration }) {
        const references = await state_.references(
          pos.lineNumber,
          pos.column,
          includeDeclaration
        );
        if (references) {
          return references.map(({ range }) => ({ uri: m.uri, range }));
        }
      },
    });
    monaco.languages.registerInlayHintsProvider(modeId, {
      async provideInlayHints(model, range, token) {
        let hints = await state_.inlay_hints();
        console.log("hints: ", hints);
        return {
          hints: hints.map((hint) => {
            if (hint.hint_type == 1) {
              return {
                kind: 1,
                position: {
                  column: hint.range.endColumn,
                  lineNumber: hint.range.endLineNumber,
                },
                label: `: ${hint.label}`,
              };
            }
            if (hint.hint_type == 2) {
              return {
                kind: 2,
                position: {
                  column: hint.range.startColumn,
                  lineNumber: hint.range.startLineNumber,
                },
                label: `${hint.label}:`,
                paddingRight: true,
              };
            }
          }) as Monaco.languages.InlayHint,
        };
      },
    });
    monaco.languages.registerDocumentHighlightProvider(modeId, {
      async provideDocumentHighlights(_, pos) {
        return await state_.references(pos.lineNumber, pos.column, true);
      },
    });
    monaco.languages.registerRenameProvider(modeId, {
      async provideRenameEdits(m, pos, newName) {
        const edits = await state_.rename(pos.lineNumber, pos.column, newName);
        console.log("rename: ", edits);
        if (edits) {
          return {
            // @ts-ignore
            edits: edits.map((edit) => ({
              resource: m.uri,
              textEdit: edit,
            })),
          };
        }
      },
      async resolveRenameLocation(_, pos) {
        console.log("resolveRenameLocation: ", pos);
        return state_.prepare_rename(pos.lineNumber, pos.column);
      },
    });
    monaco.languages.registerCompletionItemProvider(modeId, {
      triggerCharacters: [".", ":", "="],
      async provideCompletionItems(_m, pos) {
        const suggestions = await state_.completions(
          pos.lineNumber,
          pos.column
        );
        if (suggestions) {
          return { suggestions };
        }
      },
    });
    monaco.languages.registerSignatureHelpProvider(modeId, {
      signatureHelpTriggerCharacters: ["(", ","],
      async provideSignatureHelp(_m, pos) {
        const value = await state_.signature_help(pos.lineNumber, pos.column);
        if (!value) return null;
        return {
          value,
          dispose() {},
        };
      },
    });
    monaco.languages.registerDefinitionProvider(modeId, {
      async provideDefinition(m, pos) {
        const list = await state_.definition(pos.lineNumber, pos.column);
        if (list) {
          return list.map((def) => ({ ...def, uri: m.uri }));
        }
      },
    });
    monaco.languages.registerTypeDefinitionProvider(modeId, {
      async provideTypeDefinition(m, pos) {
        const list = await state_.type_definition(pos.lineNumber, pos.column);
        if (list) {
          return list.map((def) => ({ ...def, uri: m.uri }));
        }
      },
    });
    monaco.languages.registerImplementationProvider(modeId, {
      async provideImplementation(m, pos) {
        const list = await state_.goto_implementation(
          pos.lineNumber,
          pos.column
        );
        if (list) {
          return list.map((def) => ({ ...def, uri: m.uri }));
        }
      },
    });
    monaco.languages.registerDocumentSymbolProvider(modeId, {
      async provideDocumentSymbols() {
        return await state_.document_symbols();
      },
    });
    monaco.languages.registerOnTypeFormattingEditProvider(modeId, {
      autoFormatTriggerCharacters: [".", "="],
      async provideOnTypeFormattingEdits(_, pos, ch) {
        return await state_.type_formatting(pos.lineNumber, pos.column, ch);
      },
    });
    monaco.languages.registerFoldingRangeProvider(modeId, {
      async provideFoldingRanges() {
        return await state_.folding_ranges();
      },
    });
    // function fixTag(tag) {
    //     switch (tag) {
    //         case 'builtin': return 'variable.predefined';
    //         case 'attribute': return 'key';
    //         case 'macro': return 'number.hex';
    //         case 'literal': return 'number';
    //         default: return tag;
    //     }
    // }
    /*monaco.languages.setTokensProvider(modeId, {
        getInitialState: () => new TokenState(),
        tokenize(_, st) {
            const filteredTokens = allTokens
                .filter((token) => token.range.startLineNumber === st.line);

            const tokens = filteredTokens.map((token) => ({
                startIndex: token.range.startColumn - 1,
                scopes: fixTag(token.tag),
            }));
            tokens.sort((a, b) => a.startIndex - b.startIndex);

            return {
                tokens,
                endState: new TokenState(st.line + 1),
            };
        },
    });*/
  };

  async function runCode() {
    if (isExecuting) return;
    const code = editor.getValue();
    await interpreter.run(code);
  }
</script>

<svelte:window on:resize={() => editor.layout()} />
<main class="h-[calc(100vh-4rem)]">
  {#if isLoading}
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p>Loading editor...</p>
    </div>
  {/if}

  <div class="h-full flex flex-col">
    <div
      class="bg-gray-800 border-b border-gray-700 p-2 flex items-center gap-2"
    >
      <button
        class="bg-green-600 hover:bg-green-700 text-white px-4 py-1 rounded-md text-sm font-medium disabled:opacity-50"
        onclick={runCode}
        disabled={isExecuting || isLoading}
      >
        {#if isExecuting}
          Running...
        {:else}
          Run ▶
        {/if}
      </button>
    </div>

    <!-- Editor Container -->
    <div
      class="flex-1 relative"
      class:h-0.66={consoleStore.isVisible}
      class:h-full={!consoleStore.isVisible}
    >
      <div bind:this={editorContainer} class="absolute inset-0"></div>
    </div>
    {#if consoleStore.isVisible}
      <div class="h-1/3 bg-gray-900 border-t border-gray-700">
        <div
          class="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700"
        >
          <span class="text-gray-200 font-medium">Console</span>
          <div class="flex gap-2">
            <button
              class="text-gray-400 hover:text-white px-2 py-1 text-sm"
              onclick={() => consoleStore.clear()}
            >
              Clear
            </button>
            <button
              class="text-gray-400 hover:text-white px-2 py-1 text-sm"
              onclick={handleConsoleToggle}
            >
              Hide
            </button>
          </div>
        </div>
        <div
          class="console-output overflow-y-auto h-[calc(100%-2.5rem)] p-4 font-mono text-sm"
        >
          {#each consoleStore.messages as message}
            <div class="text-gray-300 pb-1">{@html message}</div>
          {/each}
        </div>
      </div>
    {:else}
      <button
        class="fixed bottom-4 right-4 bg-gray-800 text-gray-200 px-4 py-2 rounded-md shadow-lg hover:bg-gray-700 z-50"
        onclick={handleConsoleToggle}
      >
        Show Console
      </button>
    {/if}
  </div>
</main>

<style>
  :global(.monaco-editor) {
    height: 100% !important;
  }

  .console-output :global(span) {
    display: inline;
  }

  .loading-container {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    z-index: 10;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid #f3f3f3;
    border-top: 4px solid #3498db;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  } /* Include any additional styles */
</style>
