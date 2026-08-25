import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const WELL_KNOWN = [
    '/usr/local/bin/echoc',
    '/opt/homebrew/bin/echoc',
    path.join(os.homedir(), '.echo', 'bin', 'echoc'),
];

function expandHome(value: string): string {
    if (value === '~') {
        return os.homedir();
    }
    if (value.startsWith('~/') || value.startsWith('~\\')) {
        return path.join(os.homedir(), value.slice(2));
    }
    return value;
}

function looksLikePath(value: string): boolean {
    return value.includes('/') || value.includes('\\') || value.startsWith('.');
}

function resolveConfigured(configured: string, workspaceRoot: string | undefined): string {
    const expanded = expandHome(configured);
    if (path.isAbsolute(expanded)) {
        return expanded;
    }
    if (looksLikePath(expanded) && workspaceRoot !== undefined) {
        return path.resolve(workspaceRoot, expanded);
    }
    return expanded;
}

async function looksLikeEchoc(bin: string): Promise<boolean> {
    try {
        await execFileAsync(bin, ['--version'], { timeout: 3000 });
        return true;
    } catch {
        return false;
    }
}

export type Discovery =
    | { kind: 'found'; bin: string }
    | { kind: 'invalid-setting'; bin: string }
    | { kind: 'missing' };

export async function discoverEchoc(
    configured: string | undefined,
    workspaceRoot: string | undefined,
): Promise<Discovery> {
    const trimmed = configured?.trim();
    if (trimmed) {
        const bin = resolveConfigured(trimmed, workspaceRoot);
        return (await looksLikeEchoc(bin))
            ? { kind: 'found', bin }
            : { kind: 'invalid-setting', bin };
    }

    for (const candidate of ['echoc', ...WELL_KNOWN]) {
        if (await looksLikeEchoc(candidate)) {
            return { kind: 'found', bin: candidate };
        }
    }

    return { kind: 'missing' };
}
