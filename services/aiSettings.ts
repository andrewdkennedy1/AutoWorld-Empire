export type ProviderId = 'gemini' | 'openai' | 'grok' | 'lmstudio' | 'litellm' | 'custom';

export type ProviderOption = {
  id: ProviderId;
  label: string;
  requiresKey: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  supportsResponseFormat: boolean;
};

export const API_KEY_REQUIRED_MESSAGE = 'An API Key must be set when running in a browser';

export const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    id: 'gemini',
    label: 'Gemini',
    requiresKey: true,
    defaultBaseUrl: '',
    defaultModel: 'gemini-3-pro-preview',
    supportsResponseFormat: false,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    requiresKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    supportsResponseFormat: true,
  },
  {
    id: 'grok',
    label: 'Grok (xAI)',
    requiresKey: true,
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2-latest',
    supportsResponseFormat: true,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    requiresKey: false,
    defaultBaseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    supportsResponseFormat: false,
  },
  {
    id: 'litellm',
    label: 'LiteLLM',
    requiresKey: true,
    defaultBaseUrl: 'http://localhost:4000/v1',
    defaultModel: 'gpt-4.1-mini',
    supportsResponseFormat: true,
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    requiresKey: true,
    defaultBaseUrl: '',
    defaultModel: 'custom-model',
    supportsResponseFormat: true,
  },
];

const PROVIDER_STORAGE_KEY = 'auto_world_provider';
const BASE_URL_STORAGE_KEY = 'auto_world_provider_base_url';
const MODEL_STORAGE_KEY = 'auto_world_provider_model';
const apiKeyStorageKey = (providerId: ProviderId) => `auto_world_api_key_${providerId}`;

const isProviderId = (value: string | null): value is ProviderId => {
  return PROVIDER_OPTIONS.some(option => option.id === value);
};

const readStorage = (key: string) => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(key);
};

const writeStorage = (key: string, value: string) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, value);
};

export const getProviderOption = (providerId: ProviderId) => {
  return PROVIDER_OPTIONS.find(option => option.id === providerId) || PROVIDER_OPTIONS[0];
};

export const getProviderId = (): ProviderId => {
  const stored = readStorage(PROVIDER_STORAGE_KEY);
  return isProviderId(stored) ? stored : 'gemini';
};

export const getProviderConfig = () => {
  const providerId = getProviderId();
  const option = getProviderOption(providerId);
  const storedBaseUrl = readStorage(BASE_URL_STORAGE_KEY);
  const storedModel = readStorage(MODEL_STORAGE_KEY);

  return {
    providerId,
    label: option.label,
    requiresKey: option.requiresKey,
    supportsResponseFormat: option.supportsResponseFormat,
    baseUrl: storedBaseUrl || option.defaultBaseUrl,
    model: storedModel || option.defaultModel,
  };
};

export const setProviderConfig = (config: { providerId: ProviderId; baseUrl?: string; model?: string }) => {
  const option = getProviderOption(config.providerId);
  writeStorage(PROVIDER_STORAGE_KEY, config.providerId);
  writeStorage(BASE_URL_STORAGE_KEY, (config.baseUrl || option.defaultBaseUrl).trim());
  writeStorage(MODEL_STORAGE_KEY, (config.model || option.defaultModel).trim());
};

export const getStoredApiKey = (providerId: ProviderId) => {
  const stored = readStorage(apiKeyStorageKey(providerId));
  if (!stored) return null;
  const trimmed = stored.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const setStoredApiKey = (providerId: ProviderId, key: string) => {
  const trimmed = key.trim();
  if (!trimmed) return;
  writeStorage(apiKeyStorageKey(providerId), trimmed);
};

export const resolveApiKey = (providerId: ProviderId) => {
  const stored = getStoredApiKey(providerId);
  if (stored) return stored;
  if (providerId === 'gemini') {
    return process.env.API_KEY || process.env.GEMINI_API_KEY || null;
  }
  return null;
};

export const hasApiKey = () => {
  const { providerId, requiresKey } = getProviderConfig();
  if (!requiresKey) return true;
  return Boolean(resolveApiKey(providerId));
};
