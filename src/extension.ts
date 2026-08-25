import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
} from 'vscode-languageclient/node';
import { Discovery, discoverEchoc } from './echoc';

let client: LanguageClient | undefined;
let output: vscode.OutputChannel | undefined;
let warnedMissing = false;
let inflight: Promise<void> = Promise.resolve();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    output = vscode.window.createOutputChannel('Echo');
    context.subscriptions.push(output);

    context.subscriptions.push(
        vscode.commands.registerCommand('echo.restartLanguageServer', () => requestStart()),
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
    await enqueue(stopClient);
}

function requestStart(): Promise<void> {
    return enqueue(runStart);
}

function enqueue(op: () => Promise<void>): Promise<void> {
    inflight = inflight.then(op, op);
    return inflight;
}

async function stopClient(): Promise<void> {
    if (client === undefined) {
        return;
    }
    const current = client;
    client = undefined;
    try {
        await current.stop();
    } catch {
        // already dead
    }
}

async function runStart(): Promise<void> {
    await stopClient();

    const configured = vscode.workspace.getConfiguration('echo').get<string>('echocPath');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const found = await discoverEchoc(configured, workspaceRoot);
    if (found.kind !== 'found') {
        notifyUnavailable(found);
        return;
    }

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
        command: found.bin,
        args: ['lsp'],
        options: { env },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ language: 'echo' }],
        outputChannel: output,
        traceOutputChannel: output,
    };

    const next = new LanguageClient('echo', 'Echo Language Server', serverOptions, clientOptions);
    try {
        await next.start();
    } catch (error) {
        try {
            await next.stop();
        } catch {
            // already dead
        }
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showWarningMessage(
            `Could not start echoc lsp (${message}). If this echoc is older than 0.3 it has no 'lsp' command — upgrade, then run Echo: Restart Language Server.`,
        );
        output?.appendLine(`failed to start: ${message}`);
        return;
    }

    client = next;
    output?.appendLine(`started echoc lsp from ${found.bin}`);
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
