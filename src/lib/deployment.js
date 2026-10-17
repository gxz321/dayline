export const IS_PAGES = typeof __DAYLINE_PAGES__ !== 'undefined' && __DAYLINE_PAGES__;
export const APP_BASE = import.meta.env?.BASE_URL || '/';
export const storageKey = legacy => IS_PAGES ? `dayline:pages:${APP_BASE}:${legacy}` : legacy;
export const pagesChatStatus = () => ({authenticated:false,configured:false,enabled:false,allowed:false,provider:'',model:'',reason:'私人 AI 尚未连接；本机计划工具可直接使用。',limits:{daily:null,remaining:null}});
