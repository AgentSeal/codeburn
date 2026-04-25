export const AUGGIE_TOKENS = {
  black: '#212121',
  white: '#eeffff',
  whiteDim: '#c1c1c1',
  gray: '#848484',
  grayBright: '#b2b2b2',
  grayMid: '#80838D',
  grayDim: '#4e4e4e',
  red: '#ff4a65',
  redBright: '#ff4040',
  redDim: '#de6969',
  green: '#4Eba65',
  greenBright: '#C3E88D',
  greenDim: '#4e4e4e',
  yellow: '#ffd452',
  yellowBright: '#ffc109',
  yellowDim: '#ffdc9c',
  blue: '#2088ffff',
  blueBright: '#80d8ff',
  blueDim: '#65737e',
  magenta: '#6d5fff',
  magentaBright: '#5242ff',
  magentaDim: '#818bf7',
  cyan: '#82aaff',
  cyanBright: '#80d8f',
  cyanDim: '#b2ccd6',
  orange: '#ff9800',
  orangeBright: '#ffb74d',
  orangeDim: '#f57c00',
  purple: '#9c27b0',
  purpleBright: '#ba68c8',
  purpleDim: '#7b1fa2',
  pink: '#e91e63',
  pinkBright: '#f06292',
  pinkDim: '#c2185b',
  brand: '#6d5fff',
  brandBanner: '#B8BAF8',
  brandGradient: ['#c5bfff', '#9a8ff9', '#818bf7'],
  inputGradient: ['#F9503B', '#A7A5F8'],
} as const

export const TUI_THEME = {
  accent: {
    primary: AUGGIE_TOKENS.brand,
    bright: AUGGIE_TOKENS.magentaBright,
    muted: AUGGIE_TOKENS.magentaDim,
    banner: AUGGIE_TOKENS.brandBanner,
  },
  text: {
    primary: AUGGIE_TOKENS.white,
    dim: AUGGIE_TOKENS.whiteDim,
    label: AUGGIE_TOKENS.grayBright,
    neutral: AUGGIE_TOKENS.gray,
  },
  chrome: {
    border: AUGGIE_TOKENS.brand,
    borderMuted: AUGGIE_TOKENS.magentaDim,
    borderNeutral: AUGGIE_TOKENS.gray,
    rule: AUGGIE_TOKENS.grayDim,
    disabled: AUGGIE_TOKENS.grayDim,
  },
  value: {
    primary: AUGGIE_TOKENS.yellowBright,
    secondary: AUGGIE_TOKENS.yellow,
  },
  state: {
    success: AUGGIE_TOKENS.greenBright,
    warning: AUGGIE_TOKENS.orangeBright,
    error: AUGGIE_TOKENS.red,
    errorStrong: AUGGIE_TOKENS.redBright,
    disabled: AUGGIE_TOKENS.grayDim,
  },
  burn: {
    primary: AUGGIE_TOKENS.orange,
    bright: AUGGIE_TOKENS.orangeBright,
    dim: AUGGIE_TOKENS.orangeDim,
  },
  bars: {
    usageGradient: AUGGIE_TOKENS.brandGradient,
    empty: AUGGIE_TOKENS.grayDim,
  },
  category: {
    'view/read': AUGGIE_TOKENS.cyan,
    'launch-process/terminal': AUGGIE_TOKENS.grayBright,
    'search/retrieval': AUGGIE_TOKENS.purpleBright,
    browser: AUGGIE_TOKENS.blueBright,
    'file/write/edit': AUGGIE_TOKENS.brandBanner,
    'agent/workspace': AUGGIE_TOKENS.pink,
    coding: AUGGIE_TOKENS.brandBanner,
    debugging: AUGGIE_TOKENS.pinkBright,
    feature: AUGGIE_TOKENS.magentaDim,
    refactoring: AUGGIE_TOKENS.blueBright,
    testing: AUGGIE_TOKENS.purpleBright,
    exploration: AUGGIE_TOKENS.cyan,
    planning: AUGGIE_TOKENS.magenta,
    delegation: AUGGIE_TOKENS.pink,
    git: AUGGIE_TOKENS.grayBright,
    'build/deploy': AUGGIE_TOKENS.blueDim,
    conversation: AUGGIE_TOKENS.gray,
    brainstorming: AUGGIE_TOKENS.purple,
    general: AUGGIE_TOKENS.grayMid,
  },
  action: {
    code: AUGGIE_TOKENS.brandBanner,
  },
} as const

function toHexByte(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0')
}

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!match) return [0, 0, 0]
  const value = match[1]
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ]
}

export function gradientColor(colors: readonly string[], pct: number): string {
  if (colors.length === 0) return TUI_THEME.chrome.disabled
  if (colors.length === 1) return colors[0]

  const clamped = Math.max(0, Math.min(1, pct))
  const scaled = clamped * (colors.length - 1)
  const index = Math.min(Math.floor(scaled), colors.length - 2)
  const localPct = scaled - index
  const start = hexToRgb(colors[index])
  const end = hexToRgb(colors[index + 1])

  return '#' + start.map((channel, i) => toHexByte(channel + (end[i] - channel) * localPct)).join('')
}