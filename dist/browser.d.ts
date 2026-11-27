import { summarize } from './index.js';
/**
 * window.Recap: the API itself, so a page can call Recap.init(), Recap.optIn(), Recap.status() and
 * the rest. The module's named exports are on it too (Recap.Recap, Recap.default, Recap.summarize),
 * as they were when window.Recap was the module namespace. The methods don't use `this`, so these
 * copies are the same functions.
 */
declare const api: {
    Recap: {
        init(config?: import("./types.js").RecapConfig): void;
        connect(config: import("./types.js").RemoteConfig): void;
        optIn(): void;
        optOut(): void;
        isRecording(): boolean;
        status(): import("./gate.js").RecapStatus;
        track(name: string, props?: Record<string, unknown>): void;
        flush(): Promise<void>;
        getSessionId(): string;
        openPanel(): Promise<void>;
        closePanel(): void;
        exportJSON(): void;
        exportCSV(): void;
        exportAI(): void;
        destroy(): void;
    };
    default: {
        init(config?: import("./types.js").RecapConfig): void;
        connect(config: import("./types.js").RemoteConfig): void;
        optIn(): void;
        optOut(): void;
        isRecording(): boolean;
        status(): import("./gate.js").RecapStatus;
        track(name: string, props?: Record<string, unknown>): void;
        flush(): Promise<void>;
        getSessionId(): string;
        openPanel(): Promise<void>;
        closePanel(): void;
        exportJSON(): void;
        exportCSV(): void;
        exportAI(): void;
        destroy(): void;
    };
    summarize: typeof summarize;
    init(config?: import("./types.js").RecapConfig): void;
    connect(config: import("./types.js").RemoteConfig): void;
    optIn(): void;
    optOut(): void;
    isRecording(): boolean;
    status(): import("./gate.js").RecapStatus;
    track(name: string, props?: Record<string, unknown>): void;
    flush(): Promise<void>;
    getSessionId(): string;
    openPanel(): Promise<void>;
    closePanel(): void;
    exportJSON(): void;
    exportCSV(): void;
    exportAI(): void;
    destroy(): void;
};
export default api;
