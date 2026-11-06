export type MessageValues = Record<string, string | number>;
export type MessageTranslator = (key: string, values?: MessageValues) => string;

/** The English source is also the fallback for pure presentation builders. */
export const englishMessage: MessageTranslator = (key, values) =>
  values ? key.replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token)) : key;
