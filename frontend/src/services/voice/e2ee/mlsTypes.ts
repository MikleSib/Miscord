export interface MlsProvider {
  free(): void;
  export_state(): Uint8Array;
}

export interface MlsIdentity {
  free(): void;
  key_package(provider: MlsProvider): Uint8Array;
  signature_public_key(): Uint8Array;
  export_state(): Uint8Array;
}

export interface MlsAddTransition {
  free(): void;
  readonly commit: Uint8Array;
  readonly welcome: Uint8Array;
  readonly ratchet_tree: Uint8Array;
  readonly epoch: bigint;
}

export interface MlsRemoveTransition {
  free(): void;
  readonly commit: Uint8Array;
  readonly epoch: bigint;
}

export interface MlsGroup {
  free(): void;
  add_member(provider: MlsProvider, sender: MlsIdentity, keyPackage: Uint8Array): MlsAddTransition;
  remove_member(provider: MlsProvider, sender: MlsIdentity, credentialId: string): MlsRemoveTransition;
  rotate_epoch(provider: MlsProvider, sender: MlsIdentity): MlsRemoveTransition;
  process_commit(provider: MlsProvider, commit: Uint8Array): void;
  encrypt_message(provider: MlsProvider, sender: MlsIdentity, plaintext: Uint8Array): Uint8Array;
  decrypt_message(provider: MlsProvider, ciphertext: Uint8Array): Uint8Array;
  export_key(provider: MlsProvider, label: string, context: Uint8Array, length: number): Uint8Array;
  roster(): string[];
  epoch(): bigint;
}

export interface MlsModule {
  default(input?: unknown): Promise<unknown>;
  Provider: {
    new (): MlsProvider;
    import_state(state: Uint8Array): MlsProvider;
  };
  Identity: {
    new (provider: MlsProvider, credentialId: string): MlsIdentity;
    import_state(provider: MlsProvider, state: Uint8Array): MlsIdentity;
  };
  Group: {
    create(provider: MlsProvider, identity: MlsIdentity, groupId: Uint8Array): MlsGroup;
    join(provider: MlsProvider, welcome: Uint8Array, ratchetTree: Uint8Array): MlsGroup;
    load(provider: MlsProvider, groupId: Uint8Array): MlsGroup;
  };
}
