# Echo for Visual Studio Code

Syntax highlighting, inline diagnostics, hover, go-to-definition and the outline for [Echo](https://echoc.dev).

The language server is `echoc lsp`, so this extension is a client. Point it at a working `echoc` and the rest follows.

## Using it

1. Install a recent `echoc` (the `lsp` subcommand landed in 0.3).
2. Install this extension.
3. Open a `.eco` file.

If `echoc` is not on the `PATH` that the GUI sees (common on macOS), set **Echo: Echoc Path** to the binary:

```
~/Developer/echo/build/echoc
```

or `/usr/local/bin/echoc`, `/opt/homebrew/bin/echoc`, `~/.echo/bin/echoc`. A `~` is expanded. A path like `build/echoc` is resolved from the workspace folder. A bare name like `echoc` is still looked up on `PATH`.

If the setting is wrong, the extension stops and offers **Open Settings**. Highlighting still works with no binary at all; you get one polite notice per session.

**Echo: Restart Language Server** rediscovers the binary after you fix the setting, without reloading the window.

## Developing the extension

```bash
npm install
npm run build
npm run check
npm test
```

F5 launches an Extension Development Host. Open any `.eco` in `tests/` as a fixture workspace, or a real Echo project. Set `echo.echocPath` to the compiler checkout's `build/echoc` (absolute, `~/...`, or workspace-relative) so the development host talks to the server you just built.

`vsce package --no-dependencies` is `npm run package`. `vsce ls` should list `dist/extension.js` and the grammars, and nothing from `src/` or `node_modules/`.
