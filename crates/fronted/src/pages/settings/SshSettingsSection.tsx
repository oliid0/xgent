import { invoke, isBrowserRuntime } from "@xagent/runtime";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Key,
  LayoutGrid,
  List,
  Lock,
  Pencil,
  Plus,
  Server,
  Shield,
  Terminal,
  Trash2,
  Upload,
} from "../../components/icons";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { useLocale } from "../../i18n";
import {
  removeSshHostFromProjectAssociations,
  type SshAuthType,
  type SshHostConfig,
  type SshProxyType,
  updateSsh,
} from "../../lib/settings";
import { createUuid } from "../../lib/shared/id";
import {
  type SshImportCandidate,
  type SshScanResult,
  scanSshImportCandidates,
} from "../../lib/ssh/scan";
import { ConfirmActionPopover, ConfirmDeletePopover, PromptTag } from "./shared";
import type { SettingsSectionProps } from "./types";
import { View as AstryxView, Inline as AstryxInline } from "@xagent/ui/components/ui/view";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import { Paragraph as AstryxParagraph } from "@xagent/ui/components/ui/view";
import { Heading as AstryxHeading } from "@xagent/ui/components/ui/view";

type SshViewMode = "list" | "grid";
type SshHostDraft = Omit<SshHostConfig, "id">;
type SshKnownHostResetStatus = {
  hostId: string;
  kind: "success" | "info" | "error";
  message: string;
};

type SshKnownHostResetResponse = {
  deleted: number;
};

function normalizePortInput(value: string) {
  const port = Number(value);
  if (!Number.isFinite(port)) return 22;
  const normalized = Math.floor(port);
  return normalized >= 1 && normalized <= 65535 ? normalized : 22;
}

function normalizeOptionalPortInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const port = Number(trimmed);
  if (!Number.isFinite(port)) return 0;
  const normalized = Math.floor(port);
  return normalized >= 1 && normalized <= 65535 ? normalized : 0;
}

function endpointLabel(host: SshHostConfig) {
  const userPrefix = host.username.trim() ? `${host.username.trim()}@` : "";
  return `${userPrefix}${host.host}:${host.port}`;
}

function authLabel(host: Pick<SshHostConfig, "authType">, t: (key: string) => string) {
  if (host.authType === "privateKey") return t("settings.sshAuthPrivateKey");
  if (host.authType === "keyboardInteractive") return t("settings.sshAuthKeyboardInteractive");
  return t("settings.sshAuthPassword");
}

function SshPasswordInput(props: {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { id, value, disabled = false, onChange } = props;
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? t("settings.sshHidePassword") : t("settings.sshShowPassword");

  return (
    <AstryxView layout="block" direction="horizontal" className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        disabled={disabled}
        className="pr-10"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
        title={toggleLabel}
        aria-label={toggleLabel}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
    </AstryxView>
  );
}

function SshHostModal(props: {
  initialData?: SshHostConfig;
  onSave: (data: SshHostDraft) => void;
  onClose: () => void;
}) {
  const browser = isBrowserRuntime();
  const { initialData, onSave, onClose } = props;
  const { t } = useLocale();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(initialData?.name ?? "");
  const [host, setHost] = useState(initialData?.host ?? "");
  const [port, setPort] = useState(String(initialData?.port ?? 22));
  const [username, setUsername] = useState(initialData?.username ?? "");
  const [authType, setAuthType] = useState<SshAuthType>(initialData?.authType ?? "password");
  const [password, setPassword] = useState(initialData?.password ?? "");
  const [privateKey, setPrivateKey] = useState(initialData?.privateKey ?? "");
  const [privateKeyPath, setPrivateKeyPath] = useState(initialData?.privateKeyPath ?? "");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState(
    initialData?.privateKeyPassphrase ?? "",
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [proxyType, setProxyType] = useState<SshProxyType>(initialData?.proxy.type ?? "socks5");
  const [proxyUrl, setProxyUrl] = useState(initialData?.proxy.url ?? "");
  const [proxyPort, setProxyPort] = useState(
    initialData?.proxy.port ? String(initialData.proxy.port) : "",
  );
  const [proxyUsername, setProxyUsername] = useState(initialData?.proxy.username ?? "");
  const [proxyPassword, setProxyPassword] = useState(initialData?.proxy.password ?? "");
  const isCompact = useMediaQuery("(max-width: 640px)");
  const isEditing = Boolean(initialData);
  const isPasswordAuth = authType === "password";
  const isPrivateKeyAuth = authType === "privateKey";
  const isKeyboardInteractiveAuth = authType === "keyboardInteractive";
  const passwordAuthPanelStyle: CSSProperties = {
    maxHeight: isPasswordAuth ? "7rem" : "0rem",
    opacity: isPasswordAuth ? 1 : 0,
    pointerEvents: isPasswordAuth ? "auto" : "none",
    transform: isPasswordAuth ? "translateY(0)" : "translateY(-4px)",
  };
  const privateKeyAuthPanelStyle: CSSProperties = {
    maxHeight: isPrivateKeyAuth ? "29rem" : "0rem",
    opacity: isPrivateKeyAuth ? 1 : 0,
    pointerEvents: isPrivateKeyAuth ? "auto" : "none",
    transform: isPrivateKeyAuth ? "translateY(0)" : "translateY(4px)",
  };

  function handleFileSelected(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      setPrivateKey(content.trim());
      setPrivateKeyPath(file.name);
      setAuthType("privateKey");
    };
    reader.readAsText(file);
  }

  function handleSave() {
    const trimmedName = name.trim();
    const trimmedHost = host.trim();
    if (!trimmedName || !trimmedHost) return;
    const trimmedPassword = password.trim();
    const trimmedPrivateKey = privateKey.trim();
    const trimmedPrivateKeyPath = privateKeyPath.trim();
    const trimmedPrivateKeyPassphrase = privateKeyPassphrase.trim();
    const trimmedProxyPassword = proxyPassword.trim();
    const nextPassword = isPasswordAuth ? trimmedPassword : "";
    const nextPrivateKey = isPrivateKeyAuth ? trimmedPrivateKey : "";
    const nextPrivateKeyPath = isPrivateKeyAuth ? trimmedPrivateKeyPath : "";
    const nextPrivateKeyPassphrase = isPrivateKeyAuth ? trimmedPrivateKeyPassphrase : "";
    onSave({
      name: trimmedName,
      description: initialData?.description ?? "",
      host: trimmedHost,
      port: normalizePortInput(port),
      username: username.trim(),
      authType,
      password: nextPassword,
      passwordConfigured:
        isPasswordAuth &&
        (nextPassword.length > 0 ||
          (initialData?.authType === "password" && initialData?.passwordConfigured === true)),
      privateKey: nextPrivateKey,
      privateKeyPath: nextPrivateKeyPath,
      privateKeyConfigured:
        isPrivateKeyAuth &&
        (nextPrivateKey.length > 0 ||
          nextPrivateKeyPath.length > 0 ||
          (initialData?.authType === "privateKey" && initialData?.privateKeyConfigured === true)),
      privateKeyPassphrase: nextPrivateKeyPassphrase,
      privateKeyPassphraseConfigured:
        isPrivateKeyAuth &&
        (nextPrivateKeyPassphrase.length > 0 ||
          (initialData?.authType === "privateKey" &&
            initialData?.privateKeyPassphraseConfigured === true)),
      proxy: {
        type: proxyType,
        url: proxyUrl.trim(),
        port: normalizeOptionalPortInput(proxyPort),
        username: proxyUsername.trim(),
        password: trimmedProxyPassword,
        passwordConfigured:
          trimmedProxyPassword.length > 0 || initialData?.proxy.passwordConfigured === true,
      },
    });
    onClose();
  }

  return (
    <Dialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      purpose="form"
      variant={isCompact ? "fullscreen" : "standard"}
      width={isCompact ? "100dvw" : "var(--xagent-content-width-md)"}
      maxHeight={isCompact ? "var(--xagent-viewport-height)" : "var(--xagent-dialog-height-lg)"}
      padding={0}
    >
      <AstryxView
        layout="flex"
        direction="vertical"
        className="flex h-full min-h-0 w-full flex-col overflow-hidden"
      >
        <DialogHeader
          title={isEditing ? t("settings.sshEdit") : t("settings.sshAdd")}
          subtitle={t("settings.sshDesc")}
          startContent={<Key className="h-5 w-5" />}
          onOpenChange={(isOpen) => {
            if (!isOpen) onClose();
          }}
        />

        <AstryxView
          layout="block"
          direction="horizontal"
          className="settings-modal-body flex-1 overflow-y-auto px-6 py-5"
        >
          <AstryxView layout="grid" direction="horizontal" className="grid grid-cols-2 gap-4">
            <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
              <Label htmlFor="ssh-name" className="text-xs font-medium text-muted-foreground">
                {t("settings.sshName")}
                <AstryxInline className="ml-0.5 text-red-500">*</AstryxInline>
              </Label>
              <Input
                id="ssh-name"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </AstryxView>
            <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
              <Label htmlFor="ssh-host" className="text-xs font-medium text-muted-foreground">
                {t("settings.sshHost")}
                <AstryxInline className="ml-0.5 text-red-500">*</AstryxInline>
              </Label>
              <Input
                id="ssh-host"
                value={host}
                onChange={(event) => setHost(event.currentTarget.value)}
              />
            </AstryxView>
            <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
              <Label htmlFor="ssh-username" className="text-xs font-medium text-muted-foreground">
                {t("settings.sshUsername")}
              </Label>
              <Input
                id="ssh-username"
                value={username}
                onChange={(event) => setUsername(event.currentTarget.value)}
              />
            </AstryxView>
            <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
              <Label htmlFor="ssh-port" className="text-xs font-medium text-muted-foreground">
                {t("settings.sshPort")}
              </Label>
              <Input
                id="ssh-port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(event) => setPort(event.currentTarget.value)}
              />
            </AstryxView>
          </AstryxView>

          <AstryxView layout="block" direction="horizontal" className="mt-4 space-y-2">
            <AstryxView
              layout="block"
              direction="horizontal"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("settings.sshAuthMethod")}
            </AstryxView>
            <AstryxView
              layout="grid"
              direction="horizontal"
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            >
              <AstryxButton
                type="button"
                onClick={() => setAuthType("password")}
                className={`group relative flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 ${
                  isPasswordAuth
                    ? "border-emerald-500/40 bg-emerald-500/[0.06] shadow-sm"
                    : "border-border/60 bg-card hover:border-border hover:bg-muted/20"
                }`}
              >
                <Lock
                  className={`h-4 w-4 shrink-0 text-emerald-500 transition-transform duration-200 ${
                    isPasswordAuth ? "scale-110" : "group-hover:scale-105"
                  }`}
                />
                <AstryxView layout="block" direction="horizontal" className="min-w-0">
                  <AstryxView layout="block" direction="horizontal" className="text-sm font-medium">
                    {t("settings.sshAuthPassword")}
                  </AstryxView>
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="text-xs text-muted-foreground"
                  >
                    {t("settings.sshAuthPasswordHint")}
                  </AstryxView>
                </AstryxView>
                <Check
                  aria-hidden="true"
                  className={`ml-auto h-4 w-4 shrink-0 text-emerald-500 transition-all duration-200 ${
                    isPasswordAuth ? "scale-100 opacity-100" : "scale-75 opacity-0"
                  }`}
                />
              </AstryxButton>
              <AstryxButton
                type="button"
                onClick={() => setAuthType("privateKey")}
                className={`group relative flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 ${
                  isPrivateKeyAuth
                    ? "border-emerald-500/40 bg-emerald-500/[0.06] shadow-sm"
                    : "border-border/60 bg-card hover:border-border hover:bg-muted/20"
                }`}
              >
                <Key
                  className={`h-4 w-4 shrink-0 text-emerald-500 transition-transform duration-200 ${
                    isPrivateKeyAuth ? "scale-110" : "group-hover:scale-105"
                  }`}
                />
                <AstryxView layout="block" direction="horizontal" className="min-w-0">
                  <AstryxView layout="block" direction="horizontal" className="text-sm font-medium">
                    {t("settings.sshAuthPrivateKey")}
                  </AstryxView>
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="text-xs text-muted-foreground"
                  >
                    {t("settings.sshAuthPrivateKeyHint")}
                  </AstryxView>
                </AstryxView>
                <Check
                  aria-hidden="true"
                  className={`ml-auto h-4 w-4 shrink-0 text-emerald-500 transition-all duration-200 ${
                    isPrivateKeyAuth ? "scale-100 opacity-100" : "scale-75 opacity-0"
                  }`}
                />
              </AstryxButton>
              <AstryxButton
                type="button"
                onClick={() => setAuthType("keyboardInteractive")}
                className={`group relative flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 ${
                  isKeyboardInteractiveAuth
                    ? "border-emerald-500/40 bg-emerald-500/[0.06] shadow-sm"
                    : "border-border/60 bg-card hover:border-border hover:bg-muted/20"
                }`}
              >
                <Terminal
                  className={`h-4 w-4 shrink-0 text-emerald-500 transition-transform duration-200 ${
                    isKeyboardInteractiveAuth ? "scale-110" : "group-hover:scale-105"
                  }`}
                />
                <AstryxView layout="block" direction="horizontal" className="min-w-0">
                  <AstryxView layout="block" direction="horizontal" className="text-sm font-medium">
                    {t("settings.sshAuthKeyboardInteractive")}
                  </AstryxView>
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="text-xs text-muted-foreground"
                  >
                    {t("settings.sshAuthKeyboardInteractiveHint")}
                  </AstryxView>
                </AstryxView>
                <Check
                  aria-hidden="true"
                  className={`ml-auto h-4 w-4 shrink-0 text-emerald-500 transition-all duration-200 ${
                    isKeyboardInteractiveAuth ? "scale-100 opacity-100" : "scale-75 opacity-0"
                  }`}
                />
              </AstryxButton>
            </AstryxView>
          </AstryxView>

          <AstryxView layout="block" direction="horizontal" className="mt-4">
            <AstryxView
              layout="block"
              direction="horizontal"
              aria-hidden={!isPasswordAuth}
              className="ssh-auth-panel ssh-auth-panel--password"
              data-state={isPasswordAuth ? "open" : "closed-up"}
              style={passwordAuthPanelStyle}
            >
              <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                <Label htmlFor="ssh-password" className="text-xs font-medium text-muted-foreground">
                  {t("settings.sshPassword")}
                </Label>
                <SshPasswordInput
                  id="ssh-password"
                  value={password}
                  disabled={!isPasswordAuth || browser}
                  onChange={setPassword}
                />
                {initialData?.passwordConfigured && !password.trim() ? (
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="text-[11px] text-muted-foreground"
                  >
                    {t("settings.sshPasswordConfigured")}
                  </AstryxView>
                ) : null}
              </AstryxView>
            </AstryxView>

            <AstryxView
              layout="block"
              direction="horizontal"
              aria-hidden={!isPrivateKeyAuth}
              className="ssh-auth-panel ssh-auth-panel--private-key"
              data-state={isPrivateKeyAuth ? "open" : "closed-down"}
              style={privateKeyAuthPanelStyle}
            >
              <AstryxView layout="block" direction="horizontal" className="space-y-3">
                <AstryxView layout="block" direction="horizontal" className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 z-10 h-7 w-7 rounded-md border border-transparent bg-background/80 p-0 text-muted-foreground shadow-none hover:border-border/70 hover:bg-muted/70 hover:text-foreground"
                    aria-label={t("settings.sshPrivateKeyImport")}
                    disabled={!isPrivateKeyAuth || browser}
                    onClick={() => fileInputRef.current?.click()}
                    title={t("settings.sshPrivateKeyImport")}
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    disabled={!isPrivateKeyAuth || browser}
                    onChange={(event) => handleFileSelected(event.currentTarget.files?.[0])}
                  />
                  <Textarea
                    id="ssh-private-key"
                    aria-label={t("settings.sshPrivateKey")}
                    value={privateKey}
                    disabled={!isPrivateKeyAuth || browser}
                    className="min-h-[180px] resize-y pr-12 font-mono text-xs leading-relaxed"
                    onChange={(event) => setPrivateKey(event.currentTarget.value)}
                  />
                </AstryxView>
                {initialData?.privateKeyConfigured && !privateKey.trim() ? (
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="text-[11px] text-muted-foreground"
                  >
                    {t("settings.sshPrivateKeyConfigured")}
                  </AstryxView>
                ) : null}
                <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                  <Label
                    htmlFor="ssh-private-key-passphrase"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t("settings.sshPrivateKeyPassphrase")}
                  </Label>
                  <SshPasswordInput
                    id="ssh-private-key-passphrase"
                    value={privateKeyPassphrase}
                    disabled={!isPrivateKeyAuth || browser}
                    onChange={setPrivateKeyPassphrase}
                  />
                  {initialData?.privateKeyPassphraseConfigured && !privateKeyPassphrase.trim() ? (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="text-[11px] text-muted-foreground"
                    >
                      {t("settings.sshPrivateKeyPassphraseConfigured")}
                    </AstryxView>
                  ) : null}
                </AstryxView>
              </AstryxView>
            </AstryxView>
          </AstryxView>

          <AstryxView
            layout="block"
            direction="horizontal"
            className="mt-5 overflow-hidden rounded-xl border border-border/60 bg-muted/10"
          >
            <AstryxButton
              type="button"
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/30"
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              <AstryxInline>{t("settings.sshAdvancedSettings")}</AstryxInline>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                  advancedOpen ? "rotate-180" : ""
                }`}
              />
            </AstryxButton>

            <AstryxView
              layout="block"
              direction="horizontal"
              className="ssh-collapsible"
              data-open={advancedOpen}
            >
              <AstryxView
                layout="block"
                direction="horizontal"
                aria-hidden={!advancedOpen}
                className={`ssh-collapsible-inner border-border/60 px-4 transition-[border-width,padding] duration-200 ease-out ${
                  advancedOpen ? "border-t py-4" : "border-t-0 py-0"
                }`}
                inert={!advancedOpen}
              >
                <AstryxView
                  layout="grid"
                  direction="horizontal"
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2"
                >
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="space-y-1.5 sm:col-span-2"
                  >
                    <Label className="text-xs font-medium text-muted-foreground">
                      {t("settings.sshProxyType")}
                    </Label>
                    <AstryxView
                      layout="grid"
                      direction="horizontal"
                      className="grid grid-cols-2 gap-2 rounded-xl border border-border/60 bg-background p-1"
                    >
                      {(["socks5", "http"] as SshProxyType[]).map((type) => (
                        <AstryxButton
                          key={type}
                          type="button"
                          className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                            proxyType === type
                              ? "bg-muted text-foreground shadow-sm"
                              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                          }`}
                          onClick={() => setProxyType(type)}
                        >
                          {type === "socks5"
                            ? t("settings.sshProxyTypeSocks5")
                            : t("settings.sshProxyTypeHttp")}
                        </AstryxButton>
                      ))}
                    </AstryxView>
                  </AstryxView>
                  <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                    <Label
                      htmlFor="ssh-proxy-url"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t("settings.sshProxyUrl")}
                    </Label>
                    <Input
                      id="ssh-proxy-url"
                      value={proxyUrl}
                      placeholder={t(
                        proxyType === "socks5"
                          ? "settings.sshProxyUrlSocks5Placeholder"
                          : "settings.sshProxyUrlHttpPlaceholder",
                      )}
                      onChange={(event) => setProxyUrl(event.currentTarget.value)}
                    />
                  </AstryxView>
                  <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                    <Label
                      htmlFor="ssh-proxy-port"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t("settings.sshProxyPort")}
                    </Label>
                    <Input
                      id="ssh-proxy-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={proxyPort}
                      onChange={(event) => setProxyPort(event.currentTarget.value)}
                    />
                  </AstryxView>
                  <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                    <Label
                      htmlFor="ssh-proxy-username"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t("settings.sshProxyUsername")}
                    </Label>
                    <Input
                      id="ssh-proxy-username"
                      value={proxyUsername}
                      onChange={(event) => setProxyUsername(event.currentTarget.value)}
                    />
                  </AstryxView>
                  <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                    <Label
                      htmlFor="ssh-proxy-password"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t("settings.sshProxyPassword")}
                    </Label>
                    <SshPasswordInput
                      id="ssh-proxy-password"
                      value={proxyPassword}
                      disabled={browser}
                      onChange={setProxyPassword}
                    />
                    {initialData?.proxy.passwordConfigured && !proxyPassword.trim() ? (
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="text-[11px] text-muted-foreground"
                      >
                        {t("settings.sshProxyPasswordConfigured")}
                      </AstryxView>
                    ) : null}
                  </AstryxView>
                </AstryxView>
              </AstryxView>
            </AstryxView>
          </AstryxView>
        </AstryxView>

        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-modal-footer flex items-center justify-end border-t px-6 py-4"
        >
          <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("settings.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={!name.trim() || !host.trim()}>
              {t("settings.save")}
            </Button>
          </AstryxView>
        </AstryxView>
      </AstryxView>
    </Dialog>
  );
}

function SshImportModal(props: {
  existingHosts: SshHostConfig[];
  onImport: (hosts: SshImportCandidate[]) => void;
  onClose: () => void;
}) {
  const { existingHosts, onImport, onClose } = props;
  const { t } = useLocale();
  const [result, setResult] = useState<SshScanResult | null>(null);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const isCompact = useMediaQuery("(max-width: 640px)");

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError("");
    scanSshImportCandidates(existingHosts)
      .then((scanResult) => {
        if (cancelled) return;
        setResult(scanResult);
        setSelectedIds(
          new Set(scanResult.candidates.filter((item) => !item.duplicate).map((item) => item.id)),
        );
      })
      .catch((scanError) => {
        if (cancelled) return;
        setError(scanError instanceof Error ? scanError.message : String(scanError));
      });
    return () => {
      cancelled = true;
    };
  }, [existingHosts]);

  const candidates = result?.candidates ?? [];
  const selected = candidates.filter((candidate) => selectedIds.has(candidate.id));

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Dialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      purpose="info"
      variant={isCompact ? "fullscreen" : "standard"}
      width={isCompact ? "100dvw" : "var(--xagent-content-width-md)"}
      maxHeight={isCompact ? "var(--xagent-viewport-height)" : "var(--xagent-dialog-height-lg)"}
      padding={0}
    >
      <AstryxView
        layout="flex"
        direction="vertical"
        className="flex h-full min-h-0 w-full flex-col overflow-hidden"
      >
        <DialogHeader
          title={t("settings.sshImport")}
          subtitle={t("settings.sshImportDesc")}
          startContent={<Upload className="h-5 w-5" />}
          onOpenChange={(isOpen) => {
            if (!isOpen) onClose();
          }}
        />

        <AstryxView
          layout="block"
          direction="horizontal"
          className="settings-modal-body flex-1 overflow-y-auto px-6 py-5"
        >
          {!result && !error ? (
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20 text-sm text-muted-foreground"
            >
              {t("settings.sshImportScanning")}
            </AstryxView>
          ) : null}

          {error ? (
            <AstryxView
              layout="block"
              direction="horizontal"
              className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
            >
              {t("settings.sshImportFailed")}: {error}
            </AstryxView>
          ) : null}

          {result ? (
            <AstryxView layout="block" direction="horizontal" className="space-y-4">
              <AstryxView
                layout="block"
                direction="horizontal"
                className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground"
              >
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="font-medium text-foreground"
                >
                  {result.sshDirPath}
                </AstryxView>
                <AstryxView layout="block" direction="horizontal" className="mt-1">
                  {t("settings.sshImportFound")
                    .replace("{count}", String(candidates.length))
                    .replace("{keys}", String(result.keyFiles.length))}
                </AstryxView>
              </AstryxView>

              {candidates.length === 0 ? (
                <AstryxView
                  layout="flex"
                  direction="vertical"
                  className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/60 bg-muted/20 py-12 text-center"
                >
                  <Key className="h-8 w-8 text-muted-foreground/50" />
                  <AstryxView layout="block" direction="horizontal">
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="text-sm font-medium"
                    >
                      {t("settings.sshImportEmpty")}
                    </AstryxView>
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="mt-1 text-xs text-muted-foreground"
                    >
                      {t("settings.sshImportEmptyHint")}
                    </AstryxView>
                  </AstryxView>
                </AstryxView>
              ) : (
                <AstryxView layout="block" direction="horizontal" className="space-y-2">
                  {candidates.map((candidate) => (
                    <AstryxButton
                      key={candidate.id}
                      type="button"
                      disabled={candidate.duplicate}
                      onClick={() => toggle(candidate.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                        selectedIds.has(candidate.id)
                          ? "border-emerald-500/40 bg-emerald-500/[0.06]"
                          : "border-border/60 bg-card hover:border-border"
                      } ${candidate.duplicate ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      <AstryxInline
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors duration-150 ${
                          selectedIds.has(candidate.id)
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : "border-border bg-background"
                        }`}
                      >
                        <Check
                          className={`h-3.5 w-3.5 transition-[transform,opacity] duration-150 ${
                            selectedIds.has(candidate.id)
                              ? "scale-100 opacity-100"
                              : "scale-90 opacity-0"
                          }`}
                        />
                      </AstryxInline>
                      <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
                        <AstryxView
                          layout="flex"
                          direction="horizontal"
                          className="flex items-center gap-2"
                        >
                          <AstryxInline className="truncate text-sm font-medium">
                            {candidate.name}
                          </AstryxInline>
                          <PromptTag label={authLabel(candidate, t)} />
                          {candidate.duplicate ? (
                            <PromptTag label={t("settings.sshImportDuplicate")} muted />
                          ) : null}
                        </AstryxView>
                        <AstryxView
                          layout="block"
                          direction="horizontal"
                          className="mt-1 truncate text-xs text-muted-foreground"
                        >
                          {candidate.username ? `${candidate.username}@` : ""}
                          {candidate.host}:{candidate.port}
                        </AstryxView>
                      </AstryxView>
                    </AstryxButton>
                  ))}
                </AstryxView>
              )}
            </AstryxView>
          ) : null}
        </AstryxView>

        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-modal-footer flex items-center justify-between border-t px-6 py-4"
        >
          <AstryxView
            layout="block"
            direction="horizontal"
            className="text-xs text-muted-foreground"
          >
            {t("settings.sshImportSelected").replace("{count}", String(selected.length))}
          </AstryxView>
          <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("settings.cancel")}
            </Button>
            <Button
              disabled={selected.length === 0}
              onClick={() => {
                onImport(selected);
                onClose();
              }}
            >
              {t("settings.sshImport")}
            </Button>
          </AstryxView>
        </AstryxView>
      </AstryxView>
    </Dialog>
  );
}

function SshHostCard(props: {
  host: SshHostConfig;
  viewMode: SshViewMode;
  resetStatus?: SshKnownHostResetStatus;
  resettingKnownHost: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onResetKnownHost: () => void;
}) {
  const { host, viewMode, resetStatus, resettingKnownHost, onEdit, onDelete, onResetKnownHost } =
    props;
  const { t } = useLocale();
  const showKeyPath = host.authType === "privateKey" && host.privateKeyPath.trim().length > 0;
  const showKeyConfigured = host.authType === "privateKey" && host.privateKeyConfigured;
  const showProxy =
    host.proxy.url.trim().length > 0 || host.proxy.port > 0 || host.proxy.passwordConfigured;
  const hasMeta = showKeyPath || showKeyConfigured;
  const hasFooter = hasMeta || resetStatus;

  const actions = (
    <AstryxView
      layout="flex"
      direction="horizontal"
      className="settings-hover-actions settings-ssh-host-actions flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
    >
      <ConfirmActionPopover
        title={t("settings.sshKnownHostResetTitle")}
        description={t("settings.sshKnownHostResetDesc")}
        confirmLabel={t("settings.sshKnownHostResetConfirm")}
        onConfirm={onResetKnownHost}
      >
        {(open) => (
          <Button
            variant="ghost"
            size="icon"
            className="settings-ssh-host-action h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={open}
            title={t("settings.sshKnownHostReset")}
            aria-label={t("settings.sshKnownHostReset")}
            disabled={resettingKnownHost}
          >
            <Shield className="h-3.5 w-3.5" />
          </Button>
        )}
      </ConfirmActionPopover>
      <Button
        variant="ghost"
        size="icon"
        className="settings-ssh-host-action h-7 w-7 text-muted-foreground hover:text-foreground"
        onClick={onEdit}
        title={t("settings.edit")}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <ConfirmDeletePopover name={host.name} onConfirm={onDelete}>
        {(open) => (
          <Button
            variant="ghost"
            size="icon"
            className="settings-ssh-host-action h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={open}
            title={t("settings.delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </ConfirmDeletePopover>
    </AstryxView>
  );

  const metaTags = (
    <AstryxView
      layout="flex"
      direction="horizontal"
      className="flex flex-wrap items-center gap-1.5"
    >
      {showKeyPath ? <PromptTag label={host.privateKeyPath} muted /> : null}
      {showKeyConfigured ? <PromptTag label={t("settings.sshPrivateKeyConfigured")} muted /> : null}
    </AstryxView>
  );

  const resetStatusNode = resetStatus ? (
    <AstryxView
      layout="block"
      direction="horizontal"
      className={`text-xs leading-relaxed ${
        resetStatus.kind === "error" ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {resetStatus.message}
    </AstryxView>
  ) : null;

  if (viewMode === "grid") {
    return (
      <AstryxView
        layout="flex"
        direction="vertical"
        className="settings-ssh-host-card group relative z-0 flex flex-col rounded-xl border border-border/60 bg-card p-4 transition-[border-color,box-shadow] duration-150 hover:z-10 hover:border-emerald-500/40 hover:shadow-md hover:shadow-emerald-500/10"
      >
        <AstryxView layout="block" direction="horizontal" className="absolute right-3 top-3">
          {actions}
        </AstryxView>
        <AstryxView layout="flex" direction="horizontal" className="flex items-start gap-3 pr-12">
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="settings-ssh-host-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500"
          >
            <Server className="h-[18px] w-[18px]" />
          </AstryxView>
          <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
            <AstryxView
              layout="block"
              direction="horizontal"
              className="truncate text-sm font-medium text-foreground"
            >
              {host.name}
            </AstryxView>
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="mt-1 flex flex-wrap items-center gap-1.5"
            >
              <PromptTag label={authLabel(host, t)} />
              {showProxy ? <PromptTag label={t("settings.sshAdvancedProxy")} muted /> : null}
            </AstryxView>
          </AstryxView>
        </AstryxView>
        <AstryxView
          layout="block"
          direction="horizontal"
          className="mt-3 truncate font-mono text-xs text-muted-foreground"
        >
          {endpointLabel(host)}
        </AstryxView>
        {hasFooter ? (
          <AstryxView layout="block" direction="horizontal" className="mt-auto space-y-2 pt-3">
            {hasMeta ? metaTags : null}
            {resetStatusNode}
          </AstryxView>
        ) : null}
      </AstryxView>
    );
  }

  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      className="settings-ssh-host-card group relative z-0 rounded-xl border border-border/60 bg-card transition-[border-color,box-shadow] duration-150 hover:z-10 hover:border-emerald-500/40 hover:shadow-md hover:shadow-emerald-500/10"
    >
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="settings-card-row flex items-center gap-3 px-4 py-3"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-ssh-host-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500"
        >
          <Server className="h-4 w-4" />
        </AstryxView>
        <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
          <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-2">
            <AstryxInline className="truncate text-sm font-medium text-foreground">
              {host.name}
            </AstryxInline>
            <PromptTag label={authLabel(host, t)} />
            {showProxy ? <PromptTag label={t("settings.sshAdvancedProxy")} muted /> : null}
          </AstryxView>
          <AstryxView
            layout="block"
            direction="horizontal"
            className="mt-1 truncate font-mono text-xs text-muted-foreground"
          >
            {endpointLabel(host)}
          </AstryxView>
        </AstryxView>
        {actions}
      </AstryxView>
      {hasFooter ? (
        <AstryxView
          layout="block"
          direction="horizontal"
          className="space-y-2 border-t border-border/40 px-4 py-2.5"
        >
          {hasMeta ? metaTags : null}
          {resetStatusNode}
        </AstryxView>
      ) : null}
    </AstryxView>
  );
}

function SshViewModeToggle(props: { value: SshViewMode; onChange: (value: SshViewMode) => void }) {
  const { value, onChange } = props;
  const { t } = useLocale();
  const groupLabel = `${t("settings.sshViewList")} / ${t("settings.sshViewGrid")}`;
  const options = [
    { value: "list" as const, label: t("settings.sshViewList"), icon: List },
    { value: "grid" as const, label: t("settings.sshViewGrid"), icon: LayoutGrid },
  ];

  return (
    <fieldset className="settings-ssh-view-toggle relative isolate grid min-w-0 grid-cols-2 rounded-lg border border-border/60 bg-muted/30 p-0.5 shadow-inner shadow-black/5">
      <legend className="sr-only">{groupLabel}</legend>
      <AstryxView
        as="span"
        layout="grid"
        direction="horizontal"
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 w-[calc(50%-0.125rem)] rounded-md bg-emerald-500/10 shadow-sm shadow-emerald-500/10 ring-1 ring-emerald-500/30 transition-transform duration-200 ease-out motion-reduce:transition-none ${
          value === "grid" ? "translate-x-full" : "translate-x-0"
        }`}
      />
      {options.map((option) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <AstryxButton
            key={option.value}
            type="button"
            className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none ${
              active ? "text-emerald-500" : "text-muted-foreground"
            }`}
            title={option.label}
            aria-label={option.label}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            <Icon className="h-3.5 w-3.5" />
          </AstryxButton>
        );
      })}
    </fieldset>
  );
}

export function SshSettingsSection(props: SettingsSectionProps) {
  const { settings, setSettings } = props;
  const { t } = useLocale();
  const [viewMode, setViewMode] = useState<SshViewMode>("list");
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<SshHostConfig | null>(null);
  const [knownHostResettingId, setKnownHostResettingId] = useState<string | null>(null);
  const [knownHostResetStatus, setKnownHostResetStatus] = useState<SshKnownHostResetStatus | null>(
    null,
  );
  const knownHostResetTimerRef = useRef<number | null>(null);
  const hosts = settings.ssh.hosts;

  useEffect(() => {
    return () => {
      if (knownHostResetTimerRef.current !== null) {
        window.clearTimeout(knownHostResetTimerRef.current);
      }
    };
  }, []);

  function showKnownHostResetStatus(status: SshKnownHostResetStatus) {
    if (knownHostResetTimerRef.current !== null) {
      window.clearTimeout(knownHostResetTimerRef.current);
    }
    setKnownHostResetStatus(status);
    knownHostResetTimerRef.current = window.setTimeout(() => {
      setKnownHostResetStatus((current) => (current?.hostId === status.hostId ? null : current));
      knownHostResetTimerRef.current = null;
    }, 5000);
  }

  function openAdd() {
    setEditingHost(null);
    setModalOpen(true);
  }

  function openEdit(host: SshHostConfig) {
    setEditingHost(host);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingHost(null);
  }

  function handleSave(data: SshHostDraft) {
    setSettings((prev) => {
      if (editingHost) {
        return updateSsh(prev, {
          hosts: prev.ssh.hosts.map((host) => {
            if (host.id !== editingHost.id) return host;
            const keepPasswordSecret = data.authType === "password" && host.authType === "password";
            const keepPrivateKeySecret =
              data.authType === "privateKey" && host.authType === "privateKey";
            const nextPassword =
              data.authType === "password"
                ? data.password || (keepPasswordSecret ? host.password : "")
                : "";
            const nextPrivateKey =
              data.authType === "privateKey"
                ? data.privateKey || (keepPrivateKeySecret ? host.privateKey : "")
                : "";
            const nextPrivateKeyPassphrase =
              data.authType === "privateKey"
                ? data.privateKeyPassphrase ||
                  (keepPrivateKeySecret ? host.privateKeyPassphrase : "")
                : "";
            return {
              ...host,
              ...data,
              password: nextPassword,
              privateKey: nextPrivateKey,
              privateKeyPassphrase: nextPrivateKeyPassphrase,
              passwordConfigured:
                data.authType === "password" &&
                (data.password.trim().length > 0 ||
                  (keepPasswordSecret && host.passwordConfigured === true)),
              privateKeyConfigured:
                data.authType === "privateKey" &&
                (data.privateKey.trim().length > 0 ||
                  data.privateKeyPath.trim().length > 0 ||
                  (keepPrivateKeySecret && host.privateKeyConfigured === true)),
              privateKeyPassphraseConfigured:
                data.authType === "privateKey" &&
                (data.privateKeyPassphrase.trim().length > 0 ||
                  (keepPrivateKeySecret && host.privateKeyPassphraseConfigured === true)),
              proxy: {
                ...data.proxy,
                password: data.proxy.password || host.proxy.password,
                passwordConfigured:
                  data.proxy.password.trim().length > 0 || host.proxy.passwordConfigured === true,
              },
            };
          }),
        });
      }
      return updateSsh(prev, {
        hosts: [
          ...prev.ssh.hosts,
          {
            id: createUuid(),
            ...data,
          },
        ],
      });
    });
  }

  function handleDelete(id: string) {
    setSettings((prev) =>
      removeSshHostFromProjectAssociations(
        updateSsh(prev, {
          hosts: prev.ssh.hosts.filter((host) => host.id !== id),
        }),
        id,
      ),
    );
  }

  async function handleResetKnownHost(host: SshHostConfig) {
    const targetHost = host.host.trim();
    if (!targetHost || host.port <= 0) {
      showKnownHostResetStatus({
        hostId: host.id,
        kind: "error",
        message: t("settings.sshKnownHostResetFailed").replace(
          "{error}",
          t("settings.sshRequired"),
        ),
      });
      return;
    }

    setKnownHostResettingId(host.id);
    try {
      const response = await invoke<SshKnownHostResetResponse>("settings_reset_ssh_known_host", {
        host: targetHost,
        port: host.port,
      });
      showKnownHostResetStatus({
        hostId: host.id,
        kind: response.deleted > 0 ? "success" : "info",
        message:
          response.deleted > 0
            ? t("settings.sshKnownHostResetSuccess")
            : t("settings.sshKnownHostResetEmpty"),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showKnownHostResetStatus({
        hostId: host.id,
        kind: "error",
        message: t("settings.sshKnownHostResetFailed").replace("{error}", message),
      });
    } finally {
      setKnownHostResettingId((current) => (current === host.id ? null : current));
    }
  }

  function handleImport(candidates: SshImportCandidate[]) {
    setSettings((prev) =>
      updateSsh(prev, {
        hosts: [
          ...prev.ssh.hosts,
          ...candidates.map((candidate) => {
            const { id: _id, source: _source, duplicate: _duplicate, ...host } = candidate;
            return {
              id: createUuid(),
              ...host,
            };
          }),
        ],
      }),
    );
  }

  return (
    <>
      <AstryxView layout="block" direction="horizontal" className="settings-ssh-section space-y-5">
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-section-heading-row flex items-center justify-between gap-4"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="settings-section-title-group flex items-center gap-3"
          >
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10"
            >
              <Key className="h-[18px] w-[18px] text-emerald-500" />
            </AstryxView>
            <AstryxView layout="block" direction="horizontal">
              <AstryxHeading level={3} className="text-sm font-semibold">
                {t("settings.sshTitle")}
              </AstryxHeading>
              <AstryxParagraph className="text-xs text-muted-foreground">
                {t("settings.sshDesc")}
              </AstryxParagraph>
            </AstryxView>
          </AstryxView>

          <AstryxView
            layout="flex"
            direction="horizontal"
            className="settings-section-actions settings-ssh-actions flex items-center gap-2"
          >
            {hosts.length > 0 ? (
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground"
              >
                <AstryxInline className="tabular-nums font-medium text-foreground">
                  {hosts.length}
                </AstryxInline>
                {t("settings.sshCount")}
              </AstryxView>
            ) : null}
            <SshViewModeToggle value={viewMode} onChange={setViewMode} />
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-3.5 w-3.5" />
              {t("settings.sshImport")}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" />
              {t("settings.sshAdd")}
            </Button>
          </AstryxView>
        </AstryxView>

        {hosts.length === 0 ? (
          <AstryxView
            layout="flex"
            direction="vertical"
            className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border/60 bg-muted/20 py-14 text-center"
          >
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10"
            >
              <Key className="h-6 w-6 text-emerald-400" />
            </AstryxView>
            <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
              <AstryxParagraph className="text-sm font-medium text-foreground">
                {t("settings.sshNoHosts")}
              </AstryxParagraph>
              <AstryxParagraph className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">
                {t("settings.sshNoHostsHint")}
              </AstryxParagraph>
            </AstryxView>
            <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setImportOpen(true)}
              >
                <Upload className="h-3.5 w-3.5" />
                {t("settings.sshImport")}
              </Button>
              <Button size="sm" className="gap-1.5" onClick={openAdd}>
                <Plus className="h-3.5 w-3.5" />
                {t("settings.sshAdd")}
              </Button>
            </AstryxView>
          </AstryxView>
        ) : (
          <AstryxView
            layout="grid"
            direction="horizontal"
            className={`settings-ssh-host-list ${
              viewMode === "grid" ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "space-y-2"
            }`}
          >
            {hosts.map((host) => (
              <SshHostCard
                key={host.id}
                host={host}
                viewMode={viewMode}
                resetStatus={
                  knownHostResetStatus?.hostId === host.id ? knownHostResetStatus : undefined
                }
                resettingKnownHost={knownHostResettingId === host.id}
                onEdit={() => openEdit(host)}
                onDelete={() => handleDelete(host.id)}
                onResetKnownHost={() => void handleResetKnownHost(host)}
              />
            ))}
          </AstryxView>
        )}
      </AstryxView>

      {modalOpen ? (
        <SshHostModal
          initialData={editingHost ?? undefined}
          onSave={handleSave}
          onClose={closeModal}
        />
      ) : null}
      {importOpen ? (
        <SshImportModal
          existingHosts={hosts}
          onImport={handleImport}
          onClose={() => setImportOpen(false)}
        />
      ) : null}
    </>
  );
}
