import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Section, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ChevronRight, Trash2 } from "../../components/icons";
import { useLocale } from "../../i18n";
import type { useWorkerPeers } from "../../lib/automation/useWorkerPeers";
import { discoveredWorkerLabel } from "../../lib/automation/workerDiscovery";
import { SettingsStatus } from "./shared";

type Props = {
  workers: ReturnType<typeof useWorkerPeers>;
  disabled: boolean;
  selectDiscovered?: (hostId: string, url: string) => void;
  pairing?: {
    address: string;
    code: string;
    name: string;
    busy: boolean;
    setAddress: (value: string) => void;
    setCode: (value: string) => void;
    setName: (value: string) => void;
    pair: () => Promise<void>;
  };
};

/** Both wide and compact layouts use the same actual registry and actions. */
export function WorkerPeersSection({ workers, disabled, pairing, selectDiscovered }: Props) {
  const { t } = useLocale();
  const locked = disabled || !!workers.busy;
  return (
    <Section variant="section" padding={3}>
      <VStack gap={3} width="100%">
        <Heading level={4}>{t("settings.workerPeersTitle")}</Heading>
        {selectDiscovered ? (
          <VStack gap={2} width="100%">
            <Button
              label={t("settings.workerDiscoveryScan")}
              size="lg"
              variant="secondary"
              isLoading={workers.busy === "discover"}
              isDisabled={locked}
              onClick={() => void workers.discover().catch(() => {})}
            />
            {workers.discovered?.length ? (
              <List density="spacious" hasDividers>
                {workers.discovered.flatMap((service) =>
                  service.urls.map((url) => (
                    <ListItem
                      key={`${service.hostId}:${url}`}
                      label={discoveredWorkerLabel(service)}
                      endContent={<Icon icon={ChevronRight} size="sm" />}
                      description={
                        <Text type="supporting" color="secondary" wordBreak="break-word">
                          {url}
                        </Text>
                      }
                      isDisabled={locked}
                      onClick={() => {
                        if (workers.hasDiscoveredEndpoint(service.hostId, url))
                          selectDiscovered(service.hostId, url);
                      }}
                    />
                  )),
                )}
              </List>
            ) : workers.discoveryAttempted && !workers.busy ? (
              <Text type="supporting">{t("settings.workerDiscoveryEmpty")}</Text>
            ) : null}
          </VStack>
        ) : null}
        {pairing ? (
          <VStack gap={3} width="100%">
            <TextInput
              label={t("settings.accessComputerAddress")}
              value={pairing.address}
              onChange={pairing.setAddress}
              width="100%"
              isDisabled={locked}
              placeholder="http://192.168.1.2:28367"
            />
            <Grid columns={{ minWidth: 180, max: 2, repeat: "fit" }} gap={3} width="100%">
              <TextInput
                label={t("settings.accessLanPairingCode")}
                value={pairing.code}
                onChange={(value) => pairing.setCode(value.replace(/\D/g, "").slice(0, 6))}
                type="password"
                width="100%"
                isDisabled={locked}
                {...({
                  inputMode: "numeric",
                  autoComplete: "one-time-code",
                  maxLength: 6,
                } as const)}
              />
              <TextInput
                label={t("settings.accessLanDeviceName")}
                value={pairing.name}
                onChange={pairing.setName}
                width="100%"
                isDisabled={locked}
              />
            </Grid>
            <Button
              label={t("settings.accessPairComputer")}
              variant="primary"
              isLoading={pairing.busy}
              isDisabled={
                locked ||
                !pairing.address.trim() ||
                pairing.code.length !== 6 ||
                !pairing.name.trim()
              }
              onClick={() => void pairing.pair()}
            />
          </VStack>
        ) : null}
        <Button
          label={t("settings.workerPeersRefresh")}
          size="lg"
          variant="secondary"
          isLoading={workers.busy === "refresh"}
          isDisabled={locked}
          onClick={() => void workers.refresh().catch(() => {})}
        />
        {workers.registrationError ? (
          <Banner status="warning" title={workers.registrationError} collapsible={false} />
        ) : null}
        {workers.error ? <Banner status="error" title={workers.error} collapsible={false} /> : null}
        {workers.peers.length ? (
          <VStack gap={3} width="100%">
            {workers.peers.map((peer) => (
              <Section key={peer.peerId} variant="muted" padding={3}>
                <VStack gap={2} width="100%">
                  <Text
                    type="label"
                    wordBreak="break-word"
                  >{`${peer.host.platform} · ${peer.peerId}`}</Text>
                  <SettingsStatus
                    variant={peer.online ? "success" : "warning"}
                    label={t(
                      peer.online ? "settings.workerPeerOnline" : "settings.workerPeerOffline",
                    )}
                  />
                  {peer.online ? (
                    <Text type="supporting" color="secondary" wordBreak="break-word">
                      {t(
                        peer.host.executorReady &&
                          peer.host.acceptsBackgroundTasks &&
                          peer.host.workspaceAvailable
                          ? "settings.workerPeerReady"
                          : "settings.workerPeerNotReady",
                      )}
                    </Text>
                  ) : null}
                  <List
                    header={<Text type="label">{t("settings.workerPeerEndpoints")}</Text>}
                    hasDividers
                  >
                    {(
                      peer.endpoints ?? [
                        {
                          baseUrl: peer.baseUrl,
                          network: "other",
                          online: peer.online,
                          error: peer.error,
                        },
                      ]
                    ).map((endpoint) => (
                      <ListItem
                        key={endpoint.baseUrl}
                        endContent={
                          <IconButton
                            label={`${t("settings.workerEndpointForget")} ${endpoint.baseUrl}`}
                            icon={<Icon icon={Trash2} size="sm" />}
                            variant="ghost"
                            size="lg"
                            isDisabled={locked}
                            onClick={() =>
                              void workers
                                .forgetEndpoint(peer.peerId, endpoint.baseUrl)
                                .catch(() => {})
                            }
                          />
                        }
                        label={
                          <Text type="body" wordBreak="break-word">
                            {endpoint.baseUrl}
                          </Text>
                        }
                        description={
                          <Text type="supporting" wordBreak="break-word">
                            {`${t(`settings.workerNetwork${endpoint.network}`)} · ${t(endpoint.online ? "settings.workerPeerOnline" : "settings.workerPeerOffline")}${endpoint.online && peer.online && endpoint.baseUrl === peer.baseUrl ? ` · ${t("settings.workerPeerSelected")}` : ""}`}
                            {endpoint.error ? `\n${endpoint.error}` : ""}
                          </Text>
                        }
                      />
                    ))}
                  </List>
                  {peer.error ? (
                    <Banner status="error" title={peer.error} collapsible={false} />
                  ) : null}
                  <Button
                    label={t("settings.workerPeerForget")}
                    variant="secondary"
                    isDisabled={locked}
                    isLoading={workers.busy === `forget:${peer.peerId}`}
                    onClick={() => void workers.forget(peer.peerId).catch(() => {})}
                  />
                </VStack>
              </Section>
            ))}
          </VStack>
        ) : !workers.busy && !workers.error ? (
          <Text type="supporting" color="secondary">
            {t("settings.workerPeersEmpty")}
          </Text>
        ) : null}
      </VStack>
    </Section>
  );
}
