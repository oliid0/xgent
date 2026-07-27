import type { AppSettings } from "./index";

export type SshSecretUpdates = Record<
  string,
  {
    password?: string;
    privateKey?: string;
    privateKeyPassphrase?: string;
    proxyPassword?: string;
  }
>;

export type SshSettingsPatch = {
  hostChanges?: {
    id: string;
    before: AppSettings["ssh"]["hosts"][number] | null;
    after: AppSettings["ssh"]["hosts"][number] | null;
  }[];
  projectAssociationChanges?: {
    pathKey: string;
    before: string[];
    after: string[];
  }[];
  hostOrderChange?: {
    before: string[];
    after: string[];
  };
};

export type SshSettingsUpdate = {
  sshPatch?: SshSettingsPatch;
  sshSecretUpdates?: SshSecretUpdates;
};

function redactHost(host: AppSettings["ssh"]["hosts"][number]) {
  const interactive = host.authType === "keyboardInteractive";
  return {
    ...host,
    password: "",
    passwordConfigured:
      !interactive && (host.password.trim().length > 0 || host.passwordConfigured === true),
    privateKey: "",
    privateKeyConfigured:
      !interactive &&
      (host.privateKey.trim().length > 0 ||
        host.privateKeyPath.trim().length > 0 ||
        host.privateKeyConfigured === true),
    privateKeyPassphrase: "",
    privateKeyPassphraseConfigured:
      !interactive &&
      (host.privateKeyPassphrase.trim().length > 0 || host.privateKeyPassphraseConfigured === true),
    proxy: {
      ...host.proxy,
      password: "",
      passwordConfigured:
        host.proxy.password.trim().length > 0 || host.proxy.passwordConfigured === true,
    },
  };
}

function readSecret(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function collectChangedSecrets(
  previous: AppSettings["ssh"],
  next: AppSettings["ssh"],
): SshSecretUpdates | undefined {
  const previousById = new Map(previous.hosts.map((host) => [host.id, host]));
  const updates: SshSecretUpdates = {};

  for (const host of next.hosts) {
    const id = host.id.trim();
    if (!id) continue;
    const oldHost = previousById.get(id);
    const update: SshSecretUpdates[string] = {};

    if (host.authType === "password") {
      const password = readSecret(host.password);
      if (
        password !== readSecret(oldHost?.password) ||
        (oldHost?.passwordConfigured === true && host.passwordConfigured === false)
      ) {
        update.password = password;
      }
    }

    if (host.authType === "privateKey") {
      const privateKey = readSecret(host.privateKey);
      const passphrase = readSecret(host.privateKeyPassphrase);
      if (
        privateKey !== readSecret(oldHost?.privateKey) ||
        (oldHost?.privateKeyConfigured === true && host.privateKeyConfigured === false)
      ) {
        update.privateKey = privateKey;
      }
      if (
        passphrase !== readSecret(oldHost?.privateKeyPassphrase) ||
        (oldHost?.privateKeyPassphraseConfigured === true &&
          host.privateKeyPassphraseConfigured === false)
      ) {
        update.privateKeyPassphrase = passphrase;
      }
    }

    const proxyPassword = readSecret(host.proxy.password);
    if (
      proxyPassword !== readSecret(oldHost?.proxy.password) ||
      (oldHost?.proxy.passwordConfigured === true && host.proxy.passwordConfigured === false)
    ) {
      update.proxyPassword = proxyPassword;
    }
    if (Object.keys(update).length > 0) updates[id] = update;
  }

  return Object.keys(updates).length > 0 ? updates : undefined;
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildMetadataPatch(
  previous: AppSettings["ssh"],
  next: AppSettings["ssh"],
): SshSettingsPatch | undefined {
  const previousHosts = previous.hosts.map(redactHost);
  const nextHosts = next.hosts.map(redactHost);
  const previousById = new Map(previousHosts.map((host) => [host.id, host]));
  const nextById = new Map(nextHosts.map((host) => [host.id, host]));
  const hostChanges: NonNullable<SshSettingsPatch["hostChanges"]> = [];
  const hostIds = new Set([...previousById.keys(), ...nextById.keys()]);

  for (const id of hostIds) {
    const before = previousById.get(id) ?? null;
    const after = nextById.get(id) ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) hostChanges.push({ id, before, after });
  }

  const previousOrder = previousHosts.map((host) => host.id);
  const nextOrder = nextHosts.map((host) => host.id);
  const sameHostSet =
    previousOrder.length === nextOrder.length && previousOrder.every((id) => nextById.has(id));
  const pathKeys = new Set([
    ...Object.keys(previous.projectHostAssociations),
    ...Object.keys(next.projectHostAssociations),
  ]);
  const projectAssociationChanges: NonNullable<SshSettingsPatch["projectAssociationChanges"]> = [];

  for (const pathKey of [...pathKeys].sort()) {
    const before = previous.projectHostAssociations[pathKey] ?? [];
    const after = next.projectHostAssociations[pathKey] ?? [];
    if (!arraysEqual(before, after)) projectAssociationChanges.push({ pathKey, before, after });
  }

  const patch: SshSettingsPatch = {};
  if (hostChanges.length > 0) patch.hostChanges = hostChanges;
  if (projectAssociationChanges.length > 0) {
    patch.projectAssociationChanges = projectAssociationChanges;
  }
  if (sameHostSet && !arraysEqual(previousOrder, nextOrder)) {
    patch.hostOrderChange = { before: previousOrder, after: nextOrder };
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

export function buildSshSettingsPatch(
  previous: AppSettings["ssh"],
  next: AppSettings["ssh"],
): SshSettingsUpdate {
  return {
    sshPatch: buildMetadataPatch(previous, next),
    sshSecretUpdates: collectChangedSecrets(previous, next),
  };
}
