/* tslint:disable */
/* eslint-disable */

export class AddTransition {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly commit: Uint8Array;
    readonly epoch: bigint;
    readonly ratchet_tree: Uint8Array;
    readonly welcome: Uint8Array;
}

export class Group {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    add_member(provider: Provider, sender: Identity, key_package_bytes: Uint8Array): AddTransition;
    static create(provider: Provider, founder: Identity, group_id: Uint8Array): Group;
    decrypt_message(provider: Provider, ciphertext: Uint8Array): Uint8Array;
    encrypt_message(provider: Provider, sender: Identity, plaintext: Uint8Array): Uint8Array;
    epoch(): bigint;
    export_key(provider: Provider, label: string, context: Uint8Array, length: number): Uint8Array;
    static join(provider: Provider, welcome_bytes: Uint8Array, ratchet_tree_bytes: Uint8Array): Group;
    static load(provider: Provider, group_id: Uint8Array): Group;
    process_commit(provider: Provider, commit_bytes: Uint8Array): void;
    remove_member(provider: Provider, sender: Identity, credential_id: string): RemoveTransition;
    roster(): Array<any>;
    rotate_epoch(provider: Provider, sender: Identity): RotateTransition;
}

export class Identity {
    free(): void;
    [Symbol.dispose](): void;
    export_state(): Uint8Array;
    static import_state(provider: Provider, bytes: Uint8Array): Identity;
    key_package(provider: Provider): Uint8Array;
    constructor(provider: Provider, credential_id: string);
    signature_public_key(): Uint8Array;
}

export class Provider {
    free(): void;
    [Symbol.dispose](): void;
    export_state(): Uint8Array;
    static import_state(bytes: Uint8Array): Provider;
    constructor();
}

export class RemoveTransition {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly commit: Uint8Array;
    readonly epoch: bigint;
}

export class RotateTransition {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly commit: Uint8Array;
    readonly epoch: bigint;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_addtransition_free: (a: number, b: number) => void;
    readonly __wbg_group_free: (a: number, b: number) => void;
    readonly __wbg_identity_free: (a: number, b: number) => void;
    readonly __wbg_provider_free: (a: number, b: number) => void;
    readonly __wbg_removetransition_free: (a: number, b: number) => void;
    readonly addtransition_commit: (a: number, b: number) => void;
    readonly addtransition_ratchet_tree: (a: number, b: number) => void;
    readonly addtransition_welcome: (a: number, b: number) => void;
    readonly group_add_member: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly group_create: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly group_decrypt_message: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly group_encrypt_message: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly group_epoch: (a: number) => bigint;
    readonly group_export_key: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly group_join: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly group_load: (a: number, b: number, c: number, d: number) => void;
    readonly group_process_commit: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly group_remove_member: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly group_roster: (a: number) => number;
    readonly group_rotate_epoch: (a: number, b: number, c: number, d: number) => void;
    readonly identity_export_state: (a: number, b: number) => void;
    readonly identity_import_state: (a: number, b: number, c: number, d: number) => void;
    readonly identity_key_package: (a: number, b: number, c: number) => void;
    readonly identity_new: (a: number, b: number, c: number, d: number) => void;
    readonly identity_signature_public_key: (a: number, b: number) => void;
    readonly provider_export_state: (a: number, b: number) => void;
    readonly provider_import_state: (a: number, b: number, c: number) => void;
    readonly provider_new: () => number;
    readonly removetransition_commit: (a: number, b: number) => void;
    readonly addtransition_epoch: (a: number) => bigint;
    readonly removetransition_epoch: (a: number) => bigint;
    readonly rotatetransition_epoch: (a: number) => bigint;
    readonly __wbg_rotatetransition_free: (a: number, b: number) => void;
    readonly rotatetransition_commit: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export3: (a: number, b: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
