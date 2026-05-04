import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';
import Pango from 'gi://Pango';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { DataClient } from './dataClient.js';

const CACHE_TTL_MS = 60_000;
const TOP_ACTIVITIES = 5;
const CHART_HEIGHT = 52;
const CHART_BAR_WIDTH = 12;
const BAR_TRACK_WIDTH = 240;

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: '7 Days' },
  { id: '30days', label: '30 Days' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All' },
];

const INSIGHTS = [
  { id: 'activity', label: 'Activity' },
  { id: 'trend', label: 'Trend' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'stats', label: 'Stats' },
  { id: 'plan', label: 'Plan' },
];

const PROVIDERS = [
  { id: 'all', label: 'All' },
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'pi', label: 'Pi' },
  { id: 'droid', label: 'Droid' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'kilo-code', label: 'Kilo Code' },
  { id: 'kiro', label: 'Kiro' },
  { id: 'roo-code', label: 'Roo Code' },
];

const CURRENCIES = [
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' },
  { code: 'CAD', symbol: 'C$' },
  { code: 'AUD', symbol: 'A$' },
  { code: 'JPY', symbol: '¥' },
  { code: 'INR', symbol: '₹' },
  { code: 'BRL', symbol: 'R$' },
  { code: 'CHF', symbol: 'CHF ' },
  { code: 'SEK', symbol: 'kr ' },
  { code: 'SGD', symbol: 'S$' },
  { code: 'HKD', symbol: 'HK$' },
  { code: 'KRW', symbol: '₩' },
  { code: 'MXN', symbol: 'MX$' },
  { code: 'ZAR', symbol: 'R ' },
  { code: 'DKK', symbol: 'kr ' },
  { code: 'CNY', symbol: '¥' },
];

const PROVIDER_PATHS = {
  claude: '.claude/projects',
  codex: '.codex/sessions',
  cursor: '.config/Cursor/User/globalStorage/state.vscdb',
  copilot: '.copilot/session-state',
  pi: '.pi/agent/sessions',
};

function formatCost(value, currency, rate = 1) {
  const n = (Number(value) || 0) * (Number(rate) || 1);
  const abs = Math.abs(n);
  const symbol = currency?.symbol || '$';
  if (abs >= 1000) return `${symbol}${(n / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `${symbol}${n.toFixed(2)}`;
}

function formatTokensCompact(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function formatTime(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString();
}

export const CodeBurnIndicator = GObject.registerClass(
class CodeBurnIndicator extends PanelMenu.Button {
  _init(extension) {
    super._init(0.0, 'CodeBurn');

    this._extension = extension;
    this._settings = extension.getSettings();
    this._dataClient = new DataClient(this._settings.get_string('codeburn-path'));
    this._settingsChangedIds = [];

    this._period = this._settings.get_string('default-period') || 'today';
    this._insight = 'activity';
    this._availableProviders = this._detectProviders();
    this._provider = this._availableProviders.length === 1 ? this._availableProviders[0] : 'all';

    this._currency = this._loadCurrency();
    this._fxRate = 1;
    this._fxCache = { USD: 1 };
    this._soupSession = new Soup.Session();
    this._payload = null;
    this._payloadCache = new Map();
    this._inFlightKeys = new Set();
    this._refreshGen = 0;
    this._refreshSourceId = 0;

    this._themeSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    this._themeSignal = this._themeSettings.connect('changed::color-scheme', () => this._applyThemeClass());
    this._applyThemeClass();
    this._updateFxRate();

    this._buildPanelButton();
    this._buildPopup();
    this._connectSettings();
    this._startRefreshLoop();
    this._refresh();
  }

  // -- Panel button --

  _buildPanelButton() {
    const box = new St.BoxLayout({ style_class: 'panel-status-menu-box codeburn-panel' });
    this._panelIcon = new St.Label({
      text: '🔥',
      y_align: Clutter.ActorAlign.CENTER,
      style_class: 'codeburn-flame',
    });
    this._panelLabel = new St.Label({
      text: '...',
      y_align: Clutter.ActorAlign.CENTER,
      style_class: 'codeburn-label',
    });
    box.add_child(this._panelIcon);
    box.add_child(this._panelLabel);
    this._panelLabel.visible = !this._settings.get_boolean('compact-mode');
    this.add_child(box);
  }

  // -- Popup --

  _buildPopup() {
    this.menu.box.add_style_class_name('codeburn-menu');
    this._popupHost = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
    this._popupHost.add_style_class_name('codeburn-host');
    this.menu.addMenuItem(this._popupHost);

    this._root = new St.BoxLayout({ vertical: true, style_class: 'codeburn-root', x_expand: true });
    this._popupHost.add_child(this._root);

    this._buildBrandHeader();
    this._buildAgentTabs();
    this._buildHero();
    this._buildPeriodTabs();
    this._buildInsightPills();
    this._buildTokenChart();
    this._buildContentArea();
    this._buildBudgetAlert();
    this._buildFindingsSection();
    this._buildFooter();
  }

  _buildBrandHeader() {
    const header = new St.BoxLayout({ vertical: true, style_class: 'codeburn-brand-header' });
    const title = new St.BoxLayout({ style_class: 'codeburn-brand-row' });
    title.add_child(new St.Label({ text: 'Code', style_class: 'codeburn-brand-primary' }));
    title.add_child(new St.Label({ text: 'Burn', style_class: 'codeburn-brand-accent' }));
    header.add_child(title);
    header.add_child(new St.Label({ text: 'AI Coding Cost Tracker', style_class: 'codeburn-brand-subhead' }));
    this._root.add_child(header);
  }

  _buildAgentTabs() {
    const detected = this._availableProviders;
    this._agentTabs = new Map();
    this._agentTabRow = null;
    if (detected.length === 0) return;

    const disabled = this._getDisabledProviders();
    const tabs = detected.length === 1
      ? PROVIDERS.filter(p => p.id === detected[0])
      : [PROVIDERS[0], ...PROVIDERS.slice(1).filter(p => detected.includes(p.id) && !disabled.has(p.id))];

    if (tabs.length === 1) {
      const badge = new St.Label({ text: tabs[0].label, style_class: 'codeburn-agent-badge' });
      const row = new St.BoxLayout({ style_class: 'codeburn-tab-row' });
      row.add_child(badge);
      this._root.add_child(row);
      return;
    }

    this._agentTabRow = new St.BoxLayout({ style_class: 'codeburn-tab-row' });
    for (const p of tabs) {
      const btn = new St.Button({ label: p.label, style_class: 'codeburn-tab', can_focus: true, x_expand: true });
      btn.connect('clicked', () => {
        this._provider = p.id;
        this._updateAgentTabStyle();
        this._refresh();
      });
      this._agentTabRow.add_child(btn);
      this._agentTabs.set(p.id, btn);
    }
    this._root.add_child(this._agentTabRow);
    this._updateAgentTabStyle();
  }

  _updateAgentTabStyle() {
    for (const [id, btn] of this._agentTabs) {
      if (id === this._provider) btn.add_style_class_name('codeburn-tab-active');
      else btn.remove_style_class_name('codeburn-tab-active');
    }
  }

  _buildHero() {
    const hero = new St.BoxLayout({ vertical: true, style_class: 'codeburn-hero' });
    const topLine = new St.BoxLayout({ style_class: 'codeburn-hero-top' });
    this._heroDot = new St.Widget({ style_class: 'codeburn-hero-dot' });
    this._heroLabel = new St.Label({ text: 'Loading...', style_class: 'codeburn-hero-label' });
    topLine.add_child(this._heroDot);
    topLine.add_child(this._heroLabel);
    this._heroAmount = new St.Label({ text: '$0.00', style_class: 'codeburn-hero-amount' });
    this._heroMeta = new St.Label({ text: '', style_class: 'codeburn-hero-meta' });
    hero.add_child(topLine);
    hero.add_child(this._heroAmount);
    hero.add_child(this._heroMeta);
    this._root.add_child(hero);
  }

  _buildPeriodTabs() {
    const row = new St.BoxLayout({ style_class: 'codeburn-tab-row codeburn-period-row' });
    this._periodTabs = new Map();
    for (const p of PERIODS) {
      const btn = new St.Button({ label: p.label, style_class: 'codeburn-period', can_focus: true, x_expand: true });
      btn.connect('clicked', () => {
        this._period = p.id;
        this._updatePeriodTabStyle();
        this._refresh();
      });
      row.add_child(btn);
      this._periodTabs.set(p.id, btn);
    }
    this._root.add_child(row);
    this._updatePeriodTabStyle();
  }

  _updatePeriodTabStyle() {
    for (const [id, btn] of this._periodTabs) {
      if (id === this._period) btn.add_style_class_name('codeburn-period-active');
      else btn.remove_style_class_name('codeburn-period-active');
    }
  }

  _buildInsightPills() {
    const row = new St.BoxLayout({ style_class: 'codeburn-insight-row' });
    this._insightPills = new Map();
    for (const i of INSIGHTS) {
      const btn = new St.Button({ label: i.label, style_class: 'codeburn-insight-pill', can_focus: true, x_expand: true });
      btn.connect('clicked', () => {
        this._insight = i.id;
        this._updateInsightPillStyle();
        this._renderContent();
      });
      row.add_child(btn);
      this._insightPills.set(i.id, btn);
    }
    this._root.add_child(row);
    this._updateInsightPillStyle();
  }

  _updateInsightPillStyle() {
    for (const [id, btn] of this._insightPills) {
      if (id === this._insight) btn.add_style_class_name('codeburn-insight-pill-active');
      else btn.remove_style_class_name('codeburn-insight-pill-active');
    }
  }

  _buildTokenChart() {
    const chart = new St.BoxLayout({ vertical: true, style_class: 'codeburn-chart' });
    const header = new St.BoxLayout({ style_class: 'codeburn-chart-header' });
    this._chartLabel = new St.Label({ text: 'Tokens', style_class: 'codeburn-chart-label', x_expand: true });
    this._chartTotal = new St.Label({ text: '', style_class: 'codeburn-chart-total' });
    header.add_child(this._chartLabel);
    header.add_child(this._chartTotal);
    chart.add_child(header);
    this._chartBars = new St.BoxLayout({ style_class: 'codeburn-chart-bars' });
    chart.add_child(this._chartBars);
    this._root.add_child(chart);
  }

  _buildContentArea() {
    this._contentArea = new St.BoxLayout({ vertical: true, style_class: 'codeburn-content' });
    this._root.add_child(this._contentArea);
  }

  _buildBudgetAlert() {
    this._budgetLabel = new St.Label({ text: '', style_class: 'codeburn-budget-warning', visible: false });
    this._root.add_child(this._budgetLabel);
  }

  _buildFindingsSection() {
    this._findingsBtn = new St.Button({ style_class: 'codeburn-findings', visible: false });
    const box = new St.BoxLayout({ style_class: 'codeburn-findings-inner' });
    this._findingsCount = new St.Label({ text: '', style_class: 'codeburn-findings-count' });
    this._findingsSavings = new St.Label({ text: '', style_class: 'codeburn-findings-savings' });
    box.add_child(this._findingsCount);
    box.add_child(this._findingsSavings);
    this._findingsBtn.set_child(box);
    this._findingsBtn.connect('clicked', () => this._spawnTerminal(['codeburn', 'optimize']));
    this._root.add_child(this._findingsBtn);
  }

  _buildFooter() {
    const footer = new St.BoxLayout({ style_class: 'codeburn-footer' });

    const currencyBox = new St.BoxLayout({ vertical: true, style_class: 'codeburn-currency-box' });
    this._currencyBtn = new St.Button({
      label: `${this._currency.code} ⌄`,
      style_class: 'codeburn-footer-btn codeburn-currency-btn',
      can_focus: true,
    });
    this._currencyBtn.connect('clicked', () => this._toggleCurrencyPicker());
    currencyBox.add_child(this._currencyBtn);
    this._currencyPicker = new St.BoxLayout({ vertical: true, style_class: 'codeburn-currency-picker', visible: false });
    for (const c of CURRENCIES) {
      const item = new St.Button({ label: `${c.symbol}${c.code}`, style_class: 'codeburn-currency-item', can_focus: true });
      if (c.code === this._currency.code) item.add_style_class_name('codeburn-currency-item-active');
      item.connect('clicked', () => {
        this._setCurrency(c.code);
        this._currencyPicker.hide();
        this._currencyPicker.get_children().forEach(ch => ch.remove_style_class_name('codeburn-currency-item-active'));
        item.add_style_class_name('codeburn-currency-item-active');
      });
      this._currencyPicker.add_child(item);
    }
    currencyBox.add_child(this._currencyPicker);
    footer.add_child(currencyBox);

    const refreshBtn = new St.Button({ label: 'Refresh', style_class: 'codeburn-footer-btn', can_focus: true, x_expand: true });
    refreshBtn.connect('clicked', () => this._refresh(true));
    footer.add_child(refreshBtn);

    const reportBtn = new St.Button({ label: 'Open Full Report', style_class: 'codeburn-footer-btn codeburn-footer-cta', can_focus: true, x_expand: true });
    reportBtn.connect('clicked', () => this._spawnTerminal(['codeburn', 'report', '--period', this._period, '--provider', this._provider]));
    footer.add_child(reportBtn);

    const prefsBtn = new St.Button({ style_class: 'codeburn-footer-btn codeburn-prefs-btn', can_focus: true });
    prefsBtn.set_child(new St.Icon({ icon_name: 'emblem-system-symbolic', style_class: 'codeburn-prefs-icon' }));
    prefsBtn.connect('clicked', () => {
      this._extension.openPreferences();
      this.menu.close();
    });
    footer.add_child(prefsBtn);

    this._root.add_child(footer);
    this._updatedLabel = new St.Label({ text: '', style_class: 'codeburn-updated' });
    this._root.add_child(this._updatedLabel);
  }

  // -- Settings --

  _connectSettings() {
    const watch = (key, cb) => {
      const id = this._settings.connect(`changed::${key}`, cb);
      this._settingsChangedIds.push(id);
    };
    watch('refresh-interval', () => this._restartRefreshLoop());
    watch('compact-mode', () => { this._panelLabel.visible = !this._settings.get_boolean('compact-mode'); });
    watch('codeburn-path', () => {
      this._dataClient.setCodeburnPath(this._settings.get_string('codeburn-path'));
      this._refresh(true);
    });
    watch('default-period', () => {
      this._period = this._settings.get_string('default-period');
      this._updatePeriodTabStyle();
      this._refresh();
    });
    watch('budget-threshold', () => this._updateBudget());
    watch('budget-alert-enabled', () => this._updateBudget());
    watch('disabled-providers', () => {
      if (this._payload) this._render(this._payload);
    });
  }

  _getDisabledProviders() {
    return new Set(this._settings.get_strv('disabled-providers'));
  }

  // -- Provider detection --

  _detectProviders() {
    const home = GLib.get_home_dir();
    const xdgData = GLib.getenv('XDG_DATA_HOME') || `${home}/.local/share`;
    const checks = Object.fromEntries(
      Object.entries(PROVIDER_PATHS).map(([id, rel]) => [id, `${home}/${rel}`])
    );
    checks.opencode = `${xdgData}/opencode`;
    const out = [];
    for (const [id, path] of Object.entries(checks)) {
      if (Gio.File.new_for_path(path).query_exists(null)) out.push(id);
    }
    return out;
  }

  // -- Refresh loop --

  _startRefreshLoop() {
    const interval = this._settings.get_uint('refresh-interval') || 30;
    this._refreshSourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
      this._refresh();
      return GLib.SOURCE_CONTINUE;
    });
  }

  _restartRefreshLoop() {
    if (this._refreshSourceId) {
      GLib.Source.remove(this._refreshSourceId);
      this._refreshSourceId = 0;
    }
    this._startRefreshLoop();
  }

  // -- Data fetching with cache --

  _cacheKey() {
    return `${this._period}|${this._provider}`;
  }

  async _refresh(force = false) {
    const key = this._cacheKey();
    const cached = this._payloadCache.get(key);
    if (!force && cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
      this._payload = cached.payload;
      this._render(this._payload);
      return;
    }
    if (this._inFlightKeys.has(key)) return;
    this._inFlightKeys.add(key);
    const gen = ++this._refreshGen;

    try {
      const payload = await this._dataClient.fetch(this._period, this._provider);
      this._inFlightKeys.delete(key);
      if (gen !== this._refreshGen) return;
      this._payloadCache.set(key, { payload, fetchedAt: Date.now() });
      if (this._cacheKey() === key) {
        this._payload = payload;
        this._render(this._payload);
      }
    } catch (e) {
      this._inFlightKeys.delete(key);
      if (gen !== this._refreshGen) return;
      if (e.message?.includes('cancelled')) return;
      log(`CodeBurn: refresh error: ${e.message}`);
      if (!this._payload) this._renderError(e.message);
    }
  }

  // -- Rendering --

  _render(payload) {
    const current = payload?.current ?? {};
    const cost = Number(current.cost ?? 0);

    this._panelLabel.set_text(formatCost(cost, this._currency, this._fxRate));
    this._heroLabel.set_text(current.label || '');
    this._heroAmount.set_text(formatCost(cost, this._currency, this._fxRate));

    const calls = Number(current.calls ?? 0);
    const sessions = Number(current.sessions ?? 0);
    this._heroMeta.set_text(`${calls.toLocaleString()} calls   ${sessions} sessions`);

    this._renderChart(payload?.history?.daily ?? []);
    this._renderContent();
    this._renderFindings(payload?.optimize ?? {});
    this._updateBudget();

    const updated = payload?.generated ? formatTime(new Date(payload.generated)) : '';
    this._updatedLabel.set_text(updated ? `Updated ${updated}` : '');
  }

  _renderChart(daily) {
    this._chartBars.destroy_all_children();
    const days = Array.isArray(daily) ? daily.slice(-19) : [];
    if (days.length === 0) {
      this._chartTotal.set_text('no history yet');
      return;
    }
    const totals = days.map(d => {
      return (Number(d?.inputTokens) || 0) + (Number(d?.outputTokens) || 0) +
        (Number(d?.cacheReadTokens) || 0) + (Number(d?.cacheWriteTokens) || 0);
    });
    let maxTotal = 1;
    let totalAll = 0;
    for (const t of totals) {
      if (t > maxTotal) maxTotal = t;
      totalAll += t;
    }
    this._chartTotal.set_text(`${formatTokensCompact(totalAll)} tokens`);
    for (let i = 0; i < days.length; i++) {
      const h = Math.max(2, Math.round((totals[i] / maxTotal) * CHART_HEIGHT));
      const col = new St.BoxLayout({ vertical: true, style_class: 'codeburn-chart-col' });
      const spacer = new St.Widget({ style_class: 'codeburn-chart-spacer' });
      spacer.set_height(CHART_HEIGHT - h);
      const bar = new St.Widget({ style_class: 'codeburn-chart-bar' });
      bar.set_width(CHART_BAR_WIDTH);
      bar.set_height(h);
      col.add_child(spacer);
      col.add_child(bar);
      this._chartBars.add_child(col);
    }
  }

  _renderContent() {
    this._contentArea.destroy_all_children();
    switch (this._insight) {
      case 'trend': return this._renderTrendView();
      case 'forecast': return this._renderForecastView();
      case 'pulse': return this._renderPulseView();
      case 'stats': return this._renderStatsView();
      case 'plan': return this._renderPlanView();
      default: return this._renderActivityView();
    }
  }

  _renderActivityView() {
    const current = this._payload?.current ?? {};
    this._contentArea.add_child(this._sectionTitle('Activity'));
    const actHeader = new St.BoxLayout({ style_class: 'codeburn-table-header' });
    actHeader.add_child(new St.Label({ text: 'Name', style_class: 'codeburn-th', x_expand: true }));
    actHeader.add_child(new St.Label({ text: 'Cost', style_class: 'codeburn-th codeburn-th-right', min_width: 64 }));
    actHeader.add_child(new St.Label({ text: 'Turns', style_class: 'codeburn-th codeburn-th-right', min_width: 40 }));
    actHeader.add_child(new St.Label({ text: '1-shot', style_class: 'codeburn-th codeburn-th-right', min_width: 40 }));
    this._contentArea.add_child(actHeader);
    const rows = new St.BoxLayout({ vertical: true, style_class: 'codeburn-activity-rows' });
    const activities = Array.isArray(current.topActivities) ? current.topActivities : [];
    if (!activities.length) {
      rows.add_child(new St.Label({ text: 'No activity for this period', style_class: 'codeburn-empty' }));
    } else {
      const maxCost = activities.reduce((m, a) => Math.max(m, Number(a.cost) || 0), 0) || 1;
      for (const a of activities.slice(0, TOP_ACTIVITIES)) {
        rows.add_child(this._buildActivityRow(a, maxCost));
      }
    }
    this._contentArea.add_child(rows);

    const models = Array.isArray(current.topModels) ? current.topModels : [];
    if (models.length) {
      this._contentArea.add_child(this._sectionTitle('Models'));
      const modHeader = new St.BoxLayout({ style_class: 'codeburn-table-header' });
      modHeader.add_child(new St.Label({ text: 'Model', style_class: 'codeburn-th', x_expand: true }));
      modHeader.add_child(new St.Label({ text: 'Cost', style_class: 'codeburn-th codeburn-th-right', min_width: 64 }));
      modHeader.add_child(new St.Label({ text: 'Calls', style_class: 'codeburn-th codeburn-th-right', min_width: 50 }));
      this._contentArea.add_child(modHeader);
      const mrows = new St.BoxLayout({ vertical: true, style_class: 'codeburn-models-rows' });
      for (const m of models.slice(0, 3)) mrows.add_child(this._buildModelRow(m));
      this._contentArea.add_child(mrows);
    }
  }

  _renderTrendView() {
    const daily = this._payload?.history?.daily ?? [];
    this._contentArea.add_child(this._sectionTitle('Trend'));
    if (!daily.length) {
      this._contentArea.add_child(new St.Label({ text: 'Not enough history yet', style_class: 'codeburn-empty' }));
      return;
    }
    for (const d of daily.slice(-7).reverse()) {
      const row = new St.BoxLayout({ style_class: 'codeburn-trend-row' });
      row.add_child(new St.Label({ text: d.date, style_class: 'codeburn-trend-date', x_expand: true }));
      row.add_child(new St.Label({ text: formatCost(d.cost, this._currency, this._fxRate), style_class: 'codeburn-trend-cost' }));
      row.add_child(new St.Label({ text: `${Number(d.calls).toLocaleString()} calls`, style_class: 'codeburn-trend-calls' }));
      this._contentArea.add_child(row);
    }
  }

  _renderForecastView() {
    const daily = this._payload?.history?.daily ?? [];
    this._contentArea.add_child(this._sectionTitle('Forecast'));
    if (daily.length < 3) {
      this._contentArea.add_child(new St.Label({ text: 'Need at least 3 days of history', style_class: 'codeburn-empty' }));
      return;
    }
    const last7 = daily.slice(-7);
    const avg = last7.reduce((s, d) => s + Number(d.cost || 0), 0) / last7.length;
    const yesterday = daily.at(-2);
    const yestCost = Number(yesterday?.cost || 0);
    const todCost = Number(daily.at(-1)?.cost || 0);
    const dod = yestCost > 0 ? ((todCost - yestCost) / yestCost) * 100 : 0;
    const now = new Date();
    const dayOfMonth = now.getUTCDate();
    const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();

    this._contentArea.add_child(this._kvRow('7-day avg', formatCost(avg, this._currency, this._fxRate)));
    this._contentArea.add_child(this._kvRow('Yesterday', yesterday ? formatCost(yestCost, this._currency, this._fxRate) : '-'));
    this._contentArea.add_child(this._kvRow('Day-over-day', `${dod > 0 ? '+' : ''}${dod.toFixed(1)}%`));
    this._contentArea.add_child(this._kvRow('Month projection', formatCost(avg * daysInMonth, this._currency, this._fxRate)));
    this._contentArea.add_child(this._kvRow('Days elapsed', `${dayOfMonth} of ${daysInMonth}`));
  }

  _renderPulseView() {
    const current = this._payload?.current ?? {};
    const daily = this._payload?.history?.daily ?? [];
    this._contentArea.add_child(this._sectionTitle('Pulse'));
    const row = new St.BoxLayout({ style_class: 'codeburn-pulse-row' });
    row.add_child(this._pulseTile(formatCost(current.cost, this._currency, this._fxRate), 'cost'));
    row.add_child(this._pulseTile(Number(current.calls || 0).toLocaleString(), 'calls'));
    row.add_child(this._pulseTile(`${Number(current.cacheHitPercent || 0).toFixed(0)}%`, 'cache hit'));
    this._contentArea.add_child(row);

    if (daily.length) {
      this._contentArea.add_child(this._sectionTitle('Last 7 days'));
      const last7 = daily.slice(-7);
      const sumCost = last7.reduce((s, d) => s + Number(d.cost || 0), 0);
      const sumCalls = last7.reduce((s, d) => s + Number(d.calls || 0), 0);
      const peakDay = last7.reduce((best, d) => Number(d.cost || 0) > Number(best.cost || 0) ? d : best, last7[0]);
      this._contentArea.add_child(this._kvRow('Total spend', formatCost(sumCost, this._currency, this._fxRate)));
      this._contentArea.add_child(this._kvRow('Total calls', Number(sumCalls).toLocaleString()));
      this._contentArea.add_child(this._kvRow('Peak day', `${peakDay?.date || '-'}  ${formatCost(peakDay?.cost, this._currency, this._fxRate)}`));
    }
  }

  _renderStatsView() {
    const current = this._payload?.current ?? {};
    const daily = this._payload?.history?.daily ?? [];
    this._contentArea.add_child(this._sectionTitle('Stats'));
    const models = Array.isArray(current.topModels) ? current.topModels : [];
    const favModel = models[0]?.name ?? '-';
    const activeDays = daily.filter(d => Number(d.cost || 0) > 0).length;
    const peakDay = daily.reduce((best, d) => Number(d.cost || 0) > Number((best || {}).cost || 0) ? d : best, null);
    let streak = 0;
    for (let i = daily.length - 1; i >= 0; i--) {
      if (Number(daily[i].cost || 0) > 0) streak++;
      else break;
    }
    this._contentArea.add_child(this._kvRow('Favorite model', favModel));
    this._contentArea.add_child(this._kvRow('Active days', `${activeDays}`));
    this._contentArea.add_child(this._kvRow('Current streak', `${streak} days`));
    if (peakDay) this._contentArea.add_child(this._kvRow('Peak day', `${peakDay.date}  ${formatCost(peakDay.cost, this._currency, this._fxRate)}`));
  }

  _renderPlanView() {
    this._contentArea.add_child(this._sectionTitle('Plan'));
    const msg = new St.Label({
      text: 'Subscription tracking coming to Linux in a future release.',
      style_class: 'codeburn-empty',
      x_expand: true,
    });
    msg.clutter_text.line_wrap = true;
    msg.clutter_text.line_wrap_mode = Pango.WrapMode.WORD;
    msg.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    this._contentArea.add_child(msg);
  }

  _renderFindings(optimize) {
    const count = Number(optimize?.findingCount ?? 0);
    if (count === 0) {
      this._findingsBtn.hide();
      return;
    }
    const savings = Number(optimize?.savingsUSD ?? 0);
    this._findingsCount.set_text(`${count} optimize findings`);
    this._findingsSavings.set_text(`save ~${formatCost(savings, this._currency, this._fxRate)}`);
    this._findingsBtn.show();
  }

  _renderError(message) {
    this._panelLabel.set_text('!');
    if (message?.includes('not found') || message?.includes('No such file')) {
      this._heroLabel.set_text('CodeBurn CLI not found');
      this._heroMeta.set_text('Install: npm i -g codeburn');
    } else {
      this._heroLabel.set_text('Error loading data');
      this._heroMeta.set_text(message?.substring(0, 80) || 'Unknown error');
    }
    this._heroAmount.set_text('');
    this._findingsBtn.hide();
  }

  // -- Budget --

  _updateBudget() {
    const enabled = this._settings.get_boolean('budget-alert-enabled');
    const threshold = this._settings.get_double('budget-threshold');
    if (!enabled || threshold <= 0 || !this._payload?.current) {
      this._budgetLabel.visible = false;
      return;
    }
    const cost = Number(this._payload.current.cost ?? 0) * this._fxRate;
    const thresholdConverted = threshold * this._fxRate;
    if (cost >= thresholdConverted) {
      this._budgetLabel.set_text(`Budget exceeded: ${formatCost(cost, this._currency, 1)} / ${formatCost(thresholdConverted, this._currency, 1)}`);
      this._budgetLabel.visible = true;
    } else {
      this._budgetLabel.visible = false;
    }
  }

  // -- Currency --

  _loadCurrency() {
    const configPath = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'codeburn', 'config.json']);
    try {
      const [ok, contents] = GLib.file_get_contents(configPath);
      if (ok) {
        const config = JSON.parse(new TextDecoder().decode(contents));
        if (config.currency?.code) {
          const known = CURRENCIES.find(c => c.code === config.currency.code);
          if (known) return known;
          return { code: config.currency.code, symbol: config.currency.symbol || `${config.currency.code} ` };
        }
      }
    } catch (_) { /* default */ }
    return CURRENCIES[0];
  }

  _toggleCurrencyPicker() {
    this._currencyPicker.visible = !this._currencyPicker.visible;
  }

  _setCurrency(code) {
    try {
      Gio.Subprocess.new(['codeburn', 'currency', code], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    } catch (_) { /* CLI missing */ }
    const known = CURRENCIES.find(c => c.code === code);
    this._currency = known || { code, symbol: `${code} ` };
    this._currencyBtn.set_label(`${this._currency.code} ⌄`);
    this._updateFxRate();
  }

  _updateFxRate() {
    const code = this._currency?.code || 'USD';
    if (this._fxCache[code] !== undefined) {
      this._fxRate = this._fxCache[code];
      if (this._payload) this._render(this._payload);
      return;
    }
    const url = `https://api.frankfurter.app/latest?from=USD&to=${code}`;
    const msg = Soup.Message.new('GET', url);
    this._soupSession.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (session, result) => {
      try {
        const bytes = session.send_and_read_finish(result);
        if (!bytes) return;
        const json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
        const rate = json?.rates?.[code];
        if (typeof rate === 'number' && rate > 0) {
          this._fxCache[code] = rate;
          this._fxRate = rate;
          if (this._payload) this._render(this._payload);
        }
      } catch (_) { /* FX fetch failed */ }
    });
  }

  // -- UI helpers --

  _sectionTitle(text) {
    return new St.Label({ text, style_class: 'codeburn-section-title' });
  }

  _kvRow(label, value) {
    const row = new St.BoxLayout({ style_class: 'codeburn-kv-row' });
    row.add_child(new St.Label({ text: label, style_class: 'codeburn-kv-label', x_expand: true }));
    row.add_child(new St.Label({ text: String(value ?? '-'), style_class: 'codeburn-kv-value' }));
    return row;
  }

  _pulseTile(value, label) {
    const tile = new St.BoxLayout({ vertical: true, style_class: 'codeburn-pulse-tile', x_expand: true });
    tile.add_child(new St.Label({ text: value, style_class: 'codeburn-pulse-value' }));
    tile.add_child(new St.Label({ text: label, style_class: 'codeburn-pulse-label' }));
    return tile;
  }

  _buildActivityRow(activity, maxCost) {
    const row = new St.BoxLayout({ vertical: true, style_class: 'codeburn-activity-row' });
    const topLine = new St.BoxLayout({ style_class: 'codeburn-activity-top' });
    topLine.add_child(new St.Label({ text: activity.name, style_class: 'codeburn-activity-name', x_expand: true }));
    topLine.add_child(new St.Label({ text: formatCost(activity.cost, this._currency, this._fxRate), style_class: 'codeburn-activity-cost' }));
    topLine.add_child(new St.Label({ text: `${Number(activity.turns) || 0}t`, style_class: 'codeburn-activity-turns' }));
    const osText = activity.oneShotRate != null ? `${Math.round(Number(activity.oneShotRate) * 100)}%` : '--';
    topLine.add_child(new St.Label({ text: osText, style_class: 'codeburn-activity-oneshot' }));
    row.add_child(topLine);

    const track = new St.BoxLayout({ style_class: 'codeburn-bar-track' });
    const pct = Math.max(0.02, Math.min(1, Number(activity.cost) / maxCost));
    const fill = new St.Widget({ style_class: 'codeburn-bar-fill' });
    fill.set_width(Math.round(BAR_TRACK_WIDTH * pct));
    track.add_child(fill);
    row.add_child(track);
    return row;
  }

  _buildModelRow(model) {
    const row = new St.BoxLayout({ style_class: 'codeburn-model-row' });
    row.add_child(new St.Label({ text: model.name, style_class: 'codeburn-model-name', x_expand: true }));
    row.add_child(new St.Label({ text: formatCost(model.cost, this._currency, this._fxRate), style_class: 'codeburn-model-cost' }));
    row.add_child(new St.Label({ text: `${Number(model.calls || 0).toLocaleString()}`, style_class: 'codeburn-model-calls' }));
    return row;
  }

  // -- Theme --

  _applyThemeClass() {
    const scheme = this._themeSettings.get_string('color-scheme');
    const isDark = scheme === 'prefer-dark';
    this.add_style_class_name(isDark ? 'codeburn-dark' : 'codeburn-light');
    this.remove_style_class_name(isDark ? 'codeburn-light' : 'codeburn-dark');
  }

  // -- Terminal spawning --

  _spawnTerminal(argv) {
    const command = `${argv.join(' ')}; echo; read -n 1 -s -r -p 'Press any key to close...'`;
    try {
      Gio.Subprocess.new(['gnome-terminal', '--', 'bash', '-lc', command], Gio.SubprocessFlags.NONE);
    } catch (e) {
      log(`CodeBurn: terminal spawn error: ${e.message}`);
    }
    this.menu.close();
  }

  // -- Cleanup --

  destroy() {
    if (this._refreshSourceId) {
      GLib.Source.remove(this._refreshSourceId);
      this._refreshSourceId = 0;
    }
    if (this._themeSettings && this._themeSignal) {
      this._themeSettings.disconnect(this._themeSignal);
      this._themeSignal = null;
      this._themeSettings = null;
    }
    for (const id of this._settingsChangedIds) this._settings.disconnect(id);
    this._settingsChangedIds = [];
    this._dataClient?.destroy();
    this._soupSession = null;
    super.destroy();
  }
});
