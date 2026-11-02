# Echo for Visual Studio Code

Syntax highlighting, snippets, completion, inline diagnostics, hover, go-to-definition, rename, highlights, inlay hints and the outline for [Echo](https://echoc.dev).

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

### What the server does

Completion, rename, highlights and inlay hints come from `echoc lsp`, so they need an echoc newer than 0.7.0. An older one still gives diagnostics, hover, go-to-definition and the outline.

- Completion after `$` (variables in scope), `->` (properties and methods), `::` (namespaces, statics, enum cases), `use`, `#[` and a leading `.` where the destination names the type.
- **F2** renames across files, or says why it will not.
- Inlay hints show the inferred type of `$x = ...`. Turn them off with `editor.inlayHints.enabled`.

### Snippets

Type the prefix and pick it from the suggestions: `function`, `sfunction`, `closure`, `constructor`, `destructor`, `struct`, `class`, `interface`, `enum`, `match`, `foreach`, `foreachk` (key and value), `for`, `while`, `if`, `ifelse`, `elseif`, `guard`, `unsafe`, `test`, `namespace`, `use`, and `cfg` for an `#[if: …] … #[end]` region. They work without `echoc`.

## Developing the extension

```bash
npm install
npm run build
npm run check
npm test
```

F5 launches an Extension Development Host. Open any `.eco` in `tests/` as a fixture workspace, or a real Echo project. Set `echo.echocPath` to the compiler checkout's `build/echoc` (absolute, `~/...`, or workspace-relative) so the development host talks to the server you just built.

`vsce package --no-dependencies` is `npm run package`. `vsce ls` should list `dist/extension.js` and the grammars, and nothing from `src/` or `node_modules/`.
