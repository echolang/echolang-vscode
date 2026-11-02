import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    FileChangeType,
    FileEvent,
    LanguageClient,
    LanguageClientOptions,
    Middleware,
    ServerOptions,
} from 'vscode-languageclient/node';
import { Discovery, discoverEchoc } from './echoc';
import { forgetProjects, isManifest, projectDirAt, projectDirOf } from './projects';

// one server per project, keyed by the directory of its module.eco. echoc analyses the one
// project it is started in, so a nested module.eco (an example app inside a library) needs a
// server of its own to see its own dependencies.
//
// known limit: text sync goes to the owning server only. another project that compiles the same
// file reads it from disk, so it sees an edit on save, through the watched-file events
const clients = new Map<string, LanguageClient>();

let output: vscode.OutputChannel | undefined;
let warnedMissing = false;
let warnedStart = false;
let inflight: Promise<void> = Promise.resolve();

// the echoc the running servers were started from, settled once per start
let echoc: string | undefined;

// shared by every client: the server reads every file it is not told about from disk, and
// expands `#[sources:]` and resolves packages from it. these tell it when disk moved
let watchers: vscode.FileSystemWatcher[] = [];

let restartTimer: NodeJS.Timeout | undefined;
let reapTimer: NodeJS.Timeout | undefined;

// how long a burst of file events (a checkout, an epm install) has to go quiet before
// the fallback restarts the servers once for all of it
const RESTART_DEBOUNCE_MS = 500;

// how long a server with no open document of its project is kept, so closing and reopening
// a file does not recompile the project from scratch
const REAP_DELAY_MS = 30_000;

// the providers that take a document first. each asks only the server that owns it, or every
// project that also compiles the file would answer a second time. a hook the server does not
// offer is never called, so the list covers what echoc may add, not only what it has
const DOCUMENT_PROVIDERS = [
    'provideHover',
    'provideDefinition',
    'provideDeclaration',
    'provideTypeDefinition',
    'provideImplementation',
    'provideReferences',
    'provideDocumentHighlights',
    'provideDocumentSymbols',
    'provideSignatureHelp',
    'provideInlayHints',
    'prepareRename',
    'provideRenameEdits',
    'provideCodeActions',
    'provideCodeLenses',
    'provideDocumentLinks',
    'provideFoldingRanges',
    'provideSelectionRanges',
    'provideLinkedEditingRange',
    'provideDocumentFormattingEdits',
    'provideDocumentRangeFormattingEdits',
    'provideOnTypeFormattingEdits',
    'provideDocumentSemanticTokens',
    'provideDocumentRangeSemanticTokens',
    'prepareCallHierarchy',
    'prepareTypeHierarchy',
] as const satisfies readonly (keyof Middleware)[];

// the prefixes contributed by snippets/echo.json. a server keyword with the same label
// would sit next to the snippet in the list and do less, so it is dropped
let snippetPrefixes = new Set<string>();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    output = vscode.window.createOutputChannel('Echo');
    context.subscriptions.push(output);

    snippetPrefixes = readSnippetPrefixes(path.join(context.extensionPath, 'snippets', 'echo.json'));

    const sources = vscode.workspace.createFileSystemWatcher('**/*.{eco,echo}');
    const lock = vscode.workspace.createFileSystemWatcher('**/epm.lock.json');
    watchers = [sources, lock];
    context.subscriptions.push(sources, lock);

    // a module.eco that appears or goes away moves files from one project to another
    const manifestMoved = (uri: vscode.Uri, change: FileChangeType) => {
        if (isManifest(uri.fsPath)) {
            forgetProjects();
            scheduleRestart(`${uri.fsPath} ${DISK_CHANGE[change]}`);
        }
    };
    context.subscriptions.push(
        sources.onDidCreate((uri) => manifestMoved(uri, FileChangeType.Created)),
        sources.onDidDelete((uri) => manifestMoved(uri, FileChangeType.Deleted)),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('echo.restartLanguageServer', () => requestStart()),
    );

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (isEcho(document)) {
                void enqueue(() => startClientFor(document));
            }
        }),
        vscode.workspace.onDidCloseTextDocument((document) => {
            if (isEcho(document)) {
                scheduleReap();
            }
        }),
    );

    // a file outside every project is checked by the server of its workspace folder
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => void requestStart()),
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('echo.echocPath')
                || event.affectsConfiguration('echo.lsp.debug')) {
                void requestStart();
            }
        }),
    );

    await requestStart();
}

export async function deactivate(): Promise<void> {
    await enqueue(stopAll);
}

function requestStart(): Promise<void> {
    return enqueue(runStart);
}

function enqueue(op: () => Promise<void>): Promise<void> {
    inflight = inflight.then(op, op);
    return inflight;
}

// the directory whose server answers for this document: its nearest module.eco, or for a
// file in no project its workspace folder, which the server then checks on its own
function ownerOf(uri: vscode.Uri): string | undefined {
    if (uri.scheme === 'file') {
        return projectDirOf(uri.fsPath)
            ?? vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath
            ?? path.dirname(uri.fsPath);
    }

    const first = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return first === undefined ? undefined : projectDirAt(first) ?? first;
}

function isEcho(document: vscode.TextDocument): boolean {
    return document.languageId === 'echo';
}

function echoDocuments(): readonly vscode.TextDocument[] {
    return vscode.workspace.textDocuments.filter(isEcho);
}

async function stopClient(dir: string): Promise<void> {
    const current = clients.get(dir);
    if (current === undefined) {
        return;
    }
    clients.delete(dir);
    try {
        await current.stop();
    } catch {
        // already dead
    }
}

async function stopAll(): Promise<void> {
    clearTimeout(restartTimer);
    restartTimer = undefined;
    clearTimeout(reapTimer);
    reapTimer = undefined;
    await Promise.all([...clients.keys()].map(stopClient));
}

async function runStart(): Promise<void> {
    await stopAll();
    forgetProjects();
    echoc = undefined;
    warnedStart = false;

    const configured = vscode.workspace.getConfiguration('echo').get<string>('echocPath');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const found = await discoverEchoc(configured, workspaceRoot);
    if (found.kind !== 'found') {
        notifyUnavailable(found);
        return;
    }
    echoc = found.bin;

    // projects start side by side; each initialize can load a whole project
    const dirs = new Set(echoDocuments()
        .map((document) => ownerOf(document.uri))
        .filter((dir): dir is string => dir !== undefined));
    await Promise.all([...dirs].map((dir) => startClient(dir, found.bin)));
}

async function startClientFor(document: vscode.TextDocument): Promise<void> {
    const dir = ownerOf(document.uri);
    if (dir !== undefined && echoc !== undefined && !clients.has(dir)) {
        await startClient(dir, echoc);
    }
}

async function startClient(dir: string, bin: string): Promise<void> {
    // stdio is the default for a command executable. Setting `transport: stdio`
    // is not that default: vscode-languageclient appends `--stdio` to argv, and
    // echoc already speaks stdio under `lsp` without being told.
    const debug = vscode.workspace.getConfiguration('echo').get<boolean>('lsp.debug') === true;
    const env = { ...process.env };
    if (debug) {
        env.ECO_LSP_DEBUG = '1';
    } else {
        delete env.ECO_LSP_DEBUG;
    }

    const serverOptions: ServerOptions = {
        command: bin,
        args: ['lsp'],
        options: { env, cwd: dir },
    };

    const name = path.basename(dir);
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ language: 'echo' }],
        // the server takes its project root from `initialize`, which takes it from here
        workspaceFolder: { uri: vscode.Uri.file(dir), name, index: 0 },
        outputChannel: output,
        traceOutputChannel: output,
        synchronize: { fileEvents: watchers },
        middleware: {
            ...projectMiddleware(dir),
            workspace: {
                // events only arrive once `initialize` has answered, so the capability is known
                didChangeWatchedFile: async (event, send) =>
                    acceptsWatchedFiles(next) ? send(event) : restartOnDiskChange(event),
            },
        },
    };

    const next = new LanguageClient('echo', `Echo Language Server (${name})`, serverOptions, clientOptions);
    try {
        await next.start();
    } catch (error) {
        try {
            await next.stop();
        } catch {
            // already dead
        }
        const message = error instanceof Error ? error.message : String(error);
        if (!warnedStart) {
            warnedStart = true;
            void vscode.window.showWarningMessage(
                `Could not start echoc lsp (${message}). If this echoc is older than 0.3 it has no 'lsp' command — upgrade, then run Echo: Restart Language Server.`,
            );
        }
        output?.appendLine(`failed to start for ${dir}: ${message}`);
        return;
    }

    clients.set(dir, next);
    output?.appendLine(`started echoc lsp for ${dir} from ${bin}`);

    if (!acceptsWatchedFiles(next)) {
        output?.appendLine('this echoc does not take file events; restarting it when the project changes on disk.');
    }
}

// every document reaches every client, since a selector cannot leave out a nested project.
// this keeps each one to the documents its project owns
function projectMiddleware(dir: string): Middleware {
    const owns = (uri: vscode.Uri) => ownerOf(uri) === dir;

    // the documents this server was told about. ownership can move while one is open (a new
    // module.eco), and a change or close has to follow what the server was actually sent
    const opened = new Set<string>();

    const guard = (...args: unknown[]) => {
        const document = args[0] as vscode.TextDocument;
        const forward = args[args.length - 1] as (...rest: unknown[]) => unknown;
        return owns(document.uri) ? forward(...args.slice(0, -1)) : undefined;
    };
    const providers = Object.fromEntries(DOCUMENT_PROVIDERS.map((name) => [name, guard])) as Middleware;

    return {
        ...providers,
        didOpen: (document, next) => {
            if (!owns(document.uri)) {
                return Promise.resolve();
            }
            opened.add(document.uri.toString());
            return next(document);
        },
        didChange: (event, next) =>
            opened.has(event.document.uri.toString()) ? next(event) : Promise.resolve(),
        didSave: (document, next) =>
            opened.has(document.uri.toString()) ? next(document) : Promise.resolve(),
        didClose: (document, next) =>
            opened.delete(document.uri.toString()) ? next(document) : Promise.resolve(),
        // a dependency's files are compiled by every project that uses it. their problems
        // are reported by the dependency's own server, once. a manifest is the exception: a
        // dependency's module.eco that fails to resolve from this project is why this project
        // went red, and only this server knows it
        handleDiagnostics: (uri, diagnostics, next) =>
            next(uri, owns(uri) || isManifest(uri.fsPath) ? diagnostics : []),
        // a dependency's symbols come from its own server when one runs, else from whoever compiles it
        provideWorkspaceSymbols: async (query, token, next) => {
            const symbols = await next(query, token);
            return symbols?.filter((symbol) => {
                const owner = ownerOf(symbol.location.uri);
                return owner === dir || owner === undefined || !clients.has(owner);
            });
        },
        provideCompletionItem: async (document, position, context, token, next) => {
            if (!owns(document.uri)) {
                return undefined;
            }
            const result = await next(document, position, context, token);
            if (!result) {
                return result;
            }
            const items = Array.isArray(result) ? result : result.items;
            const kept = items.filter((item) => !isSnippetKeyword(item)).map(withParameterHints);
            return Array.isArray(result) ? kept : new vscode.CompletionList(kept, result.isIncomplete);
        },
    };
}

// a server whose project has no open document left is stopped, after a grace period
function scheduleReap(): void {
    clearTimeout(reapTimer);
    reapTimer = setTimeout(() => {
        reapTimer = undefined;
        void enqueue(async () => {
            const live = new Set(echoDocuments().map((document) => ownerOf(document.uri)));
            const idle = [...clients.keys()].filter((dir) => !live.has(dir));
            for (const dir of idle) {
                output?.appendLine(`no open file of ${dir} left, stopping its echoc lsp`);
            }
            await Promise.all(idle.map(stopClient));
        });
    }, REAP_DELAY_MS);
}

// an echoc that handles workspace/didChangeWatchedFiles says so. one that does not
// (0.7.0 and older) never re-reads its project, and restarting is the only refresh
function acceptsWatchedFiles(running: LanguageClient): boolean {
    const experimental = running.initializeResult?.capabilities.experimental as
        { echoWatchedFiles?: boolean } | undefined;
    return experimental?.echoWatchedFiles === true;
}

const DISK_CHANGE: Record<FileChangeType, string> = {
    [FileChangeType.Created]: 'was created',
    [FileChangeType.Changed]: 'changed on disk',
    [FileChangeType.Deleted]: 'was deleted',
};

function restartOnDiskChange(event: FileEvent): void {
    const uri = vscode.Uri.parse(event.uri);
    const name = path.basename(uri.fsPath);

    // an open Echo document is the editor's: its edits already reach the server. not so
    // a manifest - echoc resolves the project from module.eco on disk, so a save counts
    const synced = event.type === FileChangeType.Changed
        && !isManifest(uri.fsPath)
        && echoDocuments().some((doc) => doc.uri.toString() === uri.toString());
    if (synced) {
        return;
    }

    scheduleRestart(`${name} ${DISK_CHANGE[event.type]}`);
}

function scheduleRestart(reason: string): void {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
        restartTimer = undefined;
        output?.appendLine(`${reason}, restarting echoc lsp`);
        void requestStart();
    }, RESTART_DEBOUNCE_MS);
}

function readSnippetPrefixes(file: string): Set<string> {
    try {
        const snippets = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { prefix: string | string[] }>;
        return new Set(Object.values(snippets).flatMap((snippet) => snippet.prefix));
    } catch {
        return new Set();
    }
}

function isSnippetKeyword(item: vscode.CompletionItem): boolean {
    const label = typeof item.label === 'string' ? item.label : item.label.label;
    return item.kind === vscode.CompletionItemKind.Keyword && snippetPrefixes.has(label);
}

// a call completes to `name()` with the cursor between the parens; signature help then
// shows the parameters right away instead of after the first keystroke
function withParameterHints(item: vscode.CompletionItem): vscode.CompletionItem {
    const callable = item.kind === vscode.CompletionItemKind.Function
        || item.kind === vscode.CompletionItemKind.Method;
    if (callable && item.command === undefined) {
        item.command = { command: 'editor.action.triggerParameterHints', title: 'Parameter hints' };
    }
    return item;
}

function notifyUnavailable(found: Exclude<Discovery, { kind: 'found' }>): void {
    if (found.kind === 'invalid-setting') {
        const open = 'Open Settings';
        void vscode.window
            .showErrorMessage(
                `echo.echocPath is set to '${found.bin}', which is not a working echoc.`,
                open,
            )
            .then((choice) => {
                if (choice === open) {
                    void vscode.commands.executeCommand(
                        'workbench.action.openSettings',
                        'echo.echocPath',
                    );
                }
            });
        return;
    }

    if (!warnedMissing) {
        warnedMissing = true;
        void vscode.window.showInformationMessage(
            'echoc was not found, so Echo highlighting still works but there is no language server. Set echo.echocPath or put echoc on your PATH.',
        );
    }
    output?.appendLine('echoc not found; language server not started.');
}
