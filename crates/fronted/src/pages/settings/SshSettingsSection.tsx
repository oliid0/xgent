import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  FileText,
  Key,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Upload,
} from "../../components/icons";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useLocale } from "../../i18n";
import { type SshHostConfig, updateSsh } from "../../lib/settings";
import { createUuid } from "../../lib/shared/id";
import {
  scanSshImportCandidates,
  sshHostIdentityKey,
  type SshImportCandidate,
} from "../../lib/ssh/scan";
import type { SettingsSectionProps } from "./types";
import { ConfirmActionPopover } from "./shared";

type SshSettingsView = "list" | "edit" | "import";

function createEmptyHost(): SshHostConfig {
  return {
    id: createUuid(),
    name: "",
    description: "",
    host: "",
    port: 22,
    username: "",
    authType: "privateKey",
    password: "",
    passwordConfigured: false,
    privateKey: "",
    privateKeyPath: "",
    privateKeyConfigured: false,
    privateKeyPassphrase: "",
    privateKeyPassphraseConfigured: false,
    proxy: {
      type: "socks5",
      url: "",
      port: 0,
      username: "",
      password: "",
      passwordConfigured: false,
    },
  };
}

function fieldClassName() {
  return "space-y-1.5 text-xs font-medium text-muted-foreground";
}

export function SshSettingsSection(props: SettingsSectionProps) {
  const { settings, setSettings } = props;
  const { t } = useLocale();
  const [view, setView] = useState<SshSettingsView>("list");
  const [draft, setDraft] = useState<SshHostConfig>(() => createEmptyHost());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [importCandidates, setImportCandidates] = useState<SshImportCandidate[]>([]);
  const [selectedImports, setSelectedImports] = useState<Set<string>>(() => new Set());
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const keyInputRef = useRef<HTMLInputElement | null>(null);

  const existingIdentityKeys = useMemo(
    () => new Set(settings.ssh.hosts.map(sshHostIdentityKey)),
    [settings.ssh.hosts],
  );

  const openCreate = () => {
    setEditingId(null);
    setDraft(createEmptyHost());
    setFormError("");
    setView("edit");
  };

  const openEdit = (host: SshHostConfig) => {
    setEditingId(host.id);
    setDraft({ ...host, proxy: { ...host.proxy } });
    setFormError("");
    setView("edit");
  };

  const saveDraft = () => {
    const name = draft.name.trim();
    const host = draft.host.trim();
    if (!name || !host) {
      setFormError(t("settings.sshRequired"));
      return;
    }
    const normalized: SshHostConfig = {
      ...draft,
      name,
      description: draft.description.trim(),
      host,
      username: draft.username.trim(),
      port: Math.min(65_535, Math.max(1, Math.floor(Number(draft.port) || 22))),
      privateKeyConfigured:
        Boolean(draft.privateKey.trim() || draft.privateKeyPath.trim()) ||
        draft.privateKeyConfigured,
      privateKeyPassphraseConfigured:
        Boolean(draft.privateKeyPassphrase) || draft.privateKeyPassphraseConfigured,
      passwordConfigured: Boolean(draft.password) || draft.passwordConfigured,
      proxy: {
        ...draft.proxy,
        url: draft.proxy.url.trim(),
        username: draft.proxy.username.trim(),
        port: Math.min(65_535, Math.max(0, Math.floor(Number(draft.proxy.port) || 0))),
        passwordConfigured: Boolean(draft.proxy.password) || draft.proxy.passwordConfigured,
      },
    };
    setSettings((previous) =>
      updateSsh(previous, {
        hosts: editingId
          ? previous.ssh.hosts.map((item) => (item.id === editingId ? normalized : item))
          : [...previous.ssh.hosts, normalized],
      }),
    );
    setView("list");
  };

  const removeHost = (hostId: string) => {
    setSettings((previous) => {
      const projectHostAssociations = Object.fromEntries(
        Object.entries(previous.ssh.projectHostAssociations).map(([path, ids]) => [
          path,
          ids.filter((id) => id !== hostId),
        ]),
      );
      return updateSsh(previous, {
        hosts: previous.ssh.hosts.filter((host) => host.id !== hostId),
        projectHostAssociations,
      });
    });
  };

  const scanImports = async () => {
    setImportLoading(true);
    setImportError("");
    try {
      const result = await scanSshImportCandidates(settings.ssh.hosts);
      setImportCandidates(result.candidates);
      setSelectedImports(
        new Set(result.candidates.filter((candidate) => !candidate.duplicate).map((item) => item.id)),
      );
    } catch (cause) {
      setImportCandidates([]);
      setSelectedImports(new Set());
      setImportError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImportLoading(false);
    }
  };

  useEffect(() => {
    if (view !== "import") return;
    void scanImports();
  }, [view]);

  const importSelected = () => {
    const selected = importCandidates.filter(
      (candidate) => selectedImports.has(candidate.id) && !existingIdentityKeys.has(sshHostIdentityKey(candidate)),
    );
    if (selected.length === 0) return;
    setSettings((previous) =>
      updateSsh(previous, {
        hosts: [
          ...previous.ssh.hosts,
          ...selected.map(({ source: _source, duplicate: _duplicate, ...candidate }) => ({
            ...candidate,
            id: createUuid(),
          })),
        ],
      }),
    );
    setView("list");
  };

  if (view === "edit") {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setView("list")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">
              {editingId ? t("settings.sshEdit") : t("settings.sshAdd")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("settings.sshDesc")}</p>
          </div>
        </div>

        <div className="grid gap-4 rounded-xl border border-border bg-background p-4 sm:grid-cols-2">
          <label className={fieldClassName()}>
            <span>{t("settings.sshName")}</span>
            <Input
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.currentTarget.value }))}
              placeholder={t("settings.sshNamePlaceholder")}
            />
          </label>
          <label className={fieldClassName()}>
            <span>{t("settings.sshHost")}</span>
            <Input
              value={draft.host}
              onChange={(event) => setDraft((current) => ({ ...current, host: event.currentTarget.value }))}
              placeholder={t("settings.sshHostPlaceholder")}
            />
          </label>
          <label className={fieldClassName()}>
            <span>{t("settings.sshUsername")}</span>
            <Input
              value={draft.username}
              onChange={(event) =>
                setDraft((current) => ({ ...current, username: event.currentTarget.value }))
              }
              placeholder={t("settings.sshUsernamePlaceholder")}
            />
          </label>
          <label className={fieldClassName()}>
            <span>{t("settings.sshPort")}</span>
            <Input
              type="number"
              min={1}
              max={65_535}
              value={draft.port}
              onChange={(event) =>
                setDraft((current) => ({ ...current, port: Number(event.currentTarget.value) }))
              }
            />
          </label>
          <label className={`${fieldClassName()} sm:col-span-2`}>
            <span>{t("settings.sshDescription")}</span>
            <Input
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.currentTarget.value,
                }))
              }
              placeholder={t("settings.sshDescriptionPlaceholder")}
            />
          </label>
          <label className={`${fieldClassName()} sm:col-span-2`}>
            <span>{t("settings.sshAuthMethod")}</span>
            <select
              value={draft.authType}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  authType: event.currentTarget.value as SshHostConfig["authType"],
                }))
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="privateKey">{t("settings.sshAuthPrivateKey")}</option>
              <option value="password">{t("settings.sshAuthPassword")}</option>
              <option value="keyboardInteractive">
                {t("settings.sshAuthKeyboardInteractive")}
              </option>
            </select>
          </label>

          {draft.authType === "password" ? (
            <label className={`${fieldClassName()} sm:col-span-2`}>
              <span>{t("settings.sshPassword")}</span>
              <Input
                type="password"
                value={draft.password}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, password: event.currentTarget.value }))
                }
                placeholder={
                  draft.passwordConfigured
                    ? t("settings.sshPasswordConfigured")
                    : t("settings.sshPasswordPlaceholder")
                }
              />
            </label>
          ) : null}

          {draft.authType === "privateKey" ? (
            <div className="space-y-3 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("settings.sshPrivateKey")}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => keyInputRef.current?.click()}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  {t("settings.sshPrivateKeyImport")}
                </Button>
                <input
                  ref={keyInputRef}
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (!file) return;
                    void file.text().then((content) =>
                      setDraft((current) => ({
                        ...current,
                        privateKey: content,
                        privateKeyPath: file.name,
                        privateKeyConfigured: true,
                      })),
                    );
                    event.currentTarget.value = "";
                  }}
                />
              </div>
              <Input
                value={draft.privateKeyPath}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, privateKeyPath: event.currentTarget.value }))
                }
                placeholder={t("settings.sshPrivateKeyPathPlaceholder")}
              />
              <textarea
                value={draft.privateKey}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, privateKey: event.currentTarget.value }))
                }
                placeholder={t("settings.sshPrivateKeyPlaceholder")}
                className="min-h-32 w-full resize-y rounded-lg border border-input bg-background p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/30"
              />
              <Input
                type="password"
                value={draft.privateKeyPassphrase}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    privateKeyPassphrase: event.currentTarget.value,
                  }))
                }
                placeholder={
                  draft.privateKeyPassphraseConfigured
                    ? t("settings.sshPrivateKeyPassphraseConfigured")
                    : t("settings.sshPrivateKeyPassphrase")
                }
              />
            </div>
          ) : null}
        </div>

        <section className="space-y-3 rounded-xl border border-border bg-background p-4">
          <div>
            <h3 className="text-sm font-semibold">{t("settings.sshAdvancedProxy")}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.sshProxyOptionalHint")}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={fieldClassName()}>
              <span>{t("settings.sshProxyType")}</span>
              <select
                value={draft.proxy.type}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    proxy: {
                      ...current.proxy,
                      type: event.currentTarget.value as SshHostConfig["proxy"]["type"],
                    },
                  }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="socks5">{t("settings.sshProxyTypeSocks5")}</option>
                <option value="http">{t("settings.sshProxyTypeHttp")}</option>
              </select>
            </label>
            <label className={fieldClassName()}>
              <span>{t("settings.sshProxyPort")}</span>
              <Input
                type="number"
                min={0}
                max={65_535}
                value={draft.proxy.port}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    proxy: { ...current.proxy, port: Number(event.currentTarget.value) },
                  }))
                }
              />
            </label>
            <label className={`${fieldClassName()} sm:col-span-2`}>
              <span>{t("settings.sshProxyUrl")}</span>
              <Input
                value={draft.proxy.url}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    proxy: { ...current.proxy, url: event.currentTarget.value },
                  }))
                }
                placeholder={
                  draft.proxy.type === "http"
                    ? t("settings.sshProxyUrlHttpPlaceholder")
                    : t("settings.sshProxyUrlSocks5Placeholder")
                }
              />
            </label>
            <label className={fieldClassName()}>
              <span>{t("settings.sshProxyUsername")}</span>
              <Input
                value={draft.proxy.username}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    proxy: { ...current.proxy, username: event.currentTarget.value },
                  }))
                }
                placeholder={t("settings.sshProxyUsernamePlaceholder")}
              />
            </label>
            <label className={fieldClassName()}>
              <span>{t("settings.sshProxyPassword")}</span>
              <Input
                type="password"
                value={draft.proxy.password}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    proxy: { ...current.proxy, password: event.currentTarget.value },
                  }))
                }
                placeholder={
                  draft.proxy.passwordConfigured
                    ? t("settings.sshProxyPasswordConfigured")
                    : t("settings.sshProxyPasswordPlaceholder")
                }
              />
            </label>
          </div>
        </section>

        {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setView("list")}>
            {t("settings.cancel")}
          </Button>
          <Button type="button" onClick={saveDraft}>
            {t("settings.save")}
          </Button>
        </div>
      </div>
    );
  }

  if (view === "import") {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setView("list")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{t("settings.sshImport")}</h2>
            <p className="text-xs text-muted-foreground">{t("settings.sshImportDesc")}</p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={importLoading} onClick={() => void scanImports()}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${importLoading ? "animate-spin" : ""}`} />
            {t("settings.sshImport")}
          </Button>
        </div>

        {importLoading ? (
          <div className="flex items-center gap-2 rounded-xl border border-border p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("settings.sshImportScanning")}
          </div>
        ) : null}
        {importError ? <div className="rounded-xl border border-destructive/30 p-4 text-xs text-destructive">{importError}</div> : null}
        {!importLoading && !importError && importCandidates.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <FileText className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">{t("settings.sshImportEmpty")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.sshImportEmptyHint")}</p>
          </div>
        ) : null}
        <div className="space-y-2">
          {importCandidates.map((candidate) => {
            const duplicate = candidate.duplicate || existingIdentityKeys.has(sshHostIdentityKey(candidate));
            return (
              <label key={candidate.id} className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
                <input
                  type="checkbox"
                  checked={!duplicate && selectedImports.has(candidate.id)}
                  disabled={duplicate}
                  onChange={(event) =>
                    setSelectedImports((current) => {
                      const next = new Set(current);
                      if (event.currentTarget.checked) next.add(candidate.id);
                      else next.delete(candidate.id);
                      return next;
                    })
                  }
                />
                <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{candidate.name}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {candidate.username ? `${candidate.username}@` : ""}{candidate.host}:{candidate.port}
                  </span>
                </span>
                {duplicate ? <span className="text-xs text-muted-foreground">{t("settings.sshImportDuplicate")}</span> : null}
              </label>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button type="button" disabled={selectedImports.size === 0} onClick={importSelected}>
            {t("settings.sshImport")} ({selectedImports.size})
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Key className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t("settings.sshTitle")}</h2>
            <p className="text-xs text-muted-foreground">{t("settings.sshDesc")}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setView("import")}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.sshImport")}
          </Button>
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.sshAdd")}
          </Button>
        </div>
      </div>

      {settings.ssh.hosts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Server className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
          <p className="text-sm font-medium">{t("settings.sshNoHosts")}</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
            {t("settings.sshNoHostsHint")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {settings.ssh.hosts.map((host) => (
            <article key={host.id} className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Server className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{host.name}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {host.username ? `${host.username}@` : ""}{host.host}:{host.port}
                </div>
              </div>
              <button type="button" onClick={() => openEdit(host)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" aria-label={t("settings.sshEdit")}>
                <Pencil className="h-4 w-4" />
              </button>
              <ConfirmActionPopover
                title={t("settings.deleteConfirm")}
                description={`${host.name} · ${t("settings.deleteConfirmDesc")}`}
                confirmLabel={t("settings.deleteConfirmYes")}
                onConfirm={() => removeHost(host.id)}
              >
                {(open) => (
                  <button type="button" onClick={open} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={t("settings.delete")}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </ConfirmActionPopover>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
