export declare function atomicWriteFileSync(filePath: string, content: string, options?: {
    mode?: number;
    mtimeMs?: number;
}): void;
export declare function sweepCacheDirSync(cacheDir: string, options: {
    maxAgeMs: number;
    maxEntries: number;
    now?: number;
    suffix?: string;
}): void;
//# sourceMappingURL=cache.d.ts.map