import * as fs from 'fs';
import * as path from 'path';

const MANIFEST = 'module.eco';

// directory -> the directory of the nearest module.eco at or above it, null for none. a
// project is what `echoc build` in that directory compiles, so each one gets its own server
const nearest = new Map<string, string | null>();

export function projectDirAt(dir: string): string | undefined {
    let found = nearest.get(dir);
    if (found === undefined) {
        const parent = path.dirname(dir);
        found = fs.existsSync(path.join(dir, MANIFEST)) ? dir
            : parent === dir ? null
            : projectDirAt(parent) ?? null;
        nearest.set(dir, found);
    }
    return found ?? undefined;
}

export function projectDirOf(file: string): string | undefined {
    return projectDirAt(path.dirname(file));
}

export function isManifest(file: string): boolean {
    return path.basename(file) === MANIFEST;
}

// a module.eco created or deleted moves files between projects
export function forgetProjects(): void {
    nearest.clear();
}
