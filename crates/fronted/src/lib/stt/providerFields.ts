import type { SttProviderId, SttProviderSettings } from "../settings";
import type { SttSecretField } from "./types";

export type SttProviderField = {
  key: keyof SttProviderSettings;
  label: string;
  secret?: SttSecretField;
};

// The native and Astryx forms edit the same provider schema and secret fields.
export const STT_PROVIDER_FIELDS: Record<SttProviderId, readonly SttProviderField[]> = {
  aliyun_dashscope: [
    { key: "websocketUrl", label: "WebSocket URL" },
    { key: "model", label: "Model" },
    { key: "apiKey", label: "API Key", secret: "apiKey" },
  ],
  tencent_cloud: [
    { key: "appId", label: "AppId" },
    { key: "engineModelType", label: "Engine Model Type" },
    { key: "secretId", label: "SecretId", secret: "secretId" },
    { key: "secretKey", label: "SecretKey", secret: "secretKey" },
  ],
  volcengine_v2: [
    { key: "websocketUrl", label: "WebSocket URL" },
    { key: "appId", label: "App ID" },
    { key: "cluster", label: "Cluster" },
    { key: "accessToken", label: "Access Token", secret: "accessToken" },
  ],
  volcengine_seed_v3: [
    { key: "websocketUrl", label: "WebSocket URL" },
    { key: "appId", label: "App ID" },
    { key: "resourceId", label: "Resource ID" },
    { key: "accessToken", label: "Access Token", secret: "accessToken" },
  ],
  baidu_cloud: [
    { key: "websocketUrl", label: "WebSocket URL" },
    { key: "baiduAppId", label: "App ID" },
    { key: "devPid", label: "dev_pid" },
    { key: "baiduApiKey", label: "API Key", secret: "baiduApiKey" },
  ],
};
