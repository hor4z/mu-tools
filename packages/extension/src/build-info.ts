/** Lo pone build.ts al compilar: la versión del manifest y el commit y la fecha del build. */
declare const __EXT_VERSION__: string;
declare const __EXT_BUILD__: string;

export const EXT_VERSION = typeof __EXT_VERSION__ === 'string' ? __EXT_VERSION__ : 'dev';
export const EXT_BUILD = typeof __EXT_BUILD__ === 'string' ? __EXT_BUILD__ : '';
