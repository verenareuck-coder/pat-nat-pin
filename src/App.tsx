// Panel de gestión — Patagonia Natural (salmón y frutos del mar ahumados)
//
// APP INDEPENDIENTE (React + TypeScript + Vite), pensada para correr fuera
// de Claude en tu propio servidor. Ver README.md para instalar.
//
// SEGURIDAD DEL PIN — léelo antes de confiar en esto para datos sensibles:
// el control de acceso de abajo es un filtro de interfaz (UX), no una capa
// de seguridad real. Los PIN están en el código JavaScript que se le envía
// al navegador de cualquiera que abra la app: son visibles para quien
// inspeccione el código fuente o las herramientas de desarrollador, y no
// hay nada del lado del servidor que impida saltárselo. Sirve para que el
// personal no entre "por accidente" a la vista de gerencia — no para
// proteger información realmente confidencial de alguien con curiosidad
// técnica. Si en algún momento esto necesita ser seguridad de verdad, hace
// falta un backend con autenticación real.
//
// NOTAS GENERALES:
// - GOOGLE_SCRIPT_URL ya tiene tu enlace de Apps Script. Si vuelves a
//   "Implementar" como una NUEVA implementación (no una versión de la
//   misma), la URL cambia y hay que actualizarla aquí.
// - Moneda: Real brasileño (BRL). Panel de SOLO LECTURA.
// - VENTAS: columnas verificadas contra un ejemplo real de tu API
//   (data_venda, dados_cliente, vendedor, tipo_venda, produto, kilos,
//   valor_kilo, pago, nro_nf_nfc_e, etc.).
// - INVENTARIO, COMISIONES, CLIENTES, PAGOS, COMPRAS (MMPP) y FLUJO usan
//   nombres de columna SIN VERIFICAR (buscar "SIN VERIFICAR" más abajo).
// - "Margen" y "Salarios" (mencionados como parte del acceso de Gerencia)
//   todavía no están implementados como módulos — no hay una fuente de
//   datos definida para ninguno de los dos todavía. Dime qué información
//   exacta quieres ver y en qué hoja vive, y los agrego.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  Search, Bell, Package, Users, ShoppingCart, TrendingUp, FileText,
  AlertTriangle, Truck, Wallet, BarChart3, RefreshCw, Wifi, WifiOff, LogOut,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

/* ---------------------------- tipos de dominio ---------------------------- */

type Role = 'trabajador' | 'gerencia';
type ConnectionStatus = 'live' | 'partial' | 'offline' | 'checking';
type DataSource = 'live' | 'cache' | 'seed';

interface Venta {
  id: string;
  fecha: string;
  vendedor: string;
  cliente: string;
  tipo: string;
  documento: string;
  producto: string;
  lote: string;
  origen: string;
  unidades: number;
  kilos: number;
  valorKilo: number;
  total: number;
  expedicao: string;
  fechaEntrega: string;
  metodoPago: string;
  pago: string;
  fechaVencimiento: string;
  fechaPago: string;
  facturado: string;
  detalle: string;
  estado: 'Pagada' | 'No pagada' | 'Sin definir';
}

interface InventarioItem {
  id: string;
  producto: string;
  categoria: string;
  cantidad: number;
  unidad: string;
}

interface Comision {
  id: string;
  vendedor: string;
  mes: string;
  monto: number;
}

interface Cliente {
  id: string;
  nombre: string;
  contacto: string;
  telefono: string;
  email: string;
  direccion: string;
  rubro: string;
}

interface Boleto {
  fechaVencimiento: string;
  valor: number;
  estado: string;
}

interface MmppNota {
  id: string;
  notaFiscal: string;
  proveedor: string;
  producto: string;
  fechaEmision: string;
  cantidadKg: number;
  valorNota: number;
  boletos: Boleto[];
}

interface Pago {
  id: string;
  mes: string;
  responsable: string;
  detalle: string;
  monto: number;
}

interface FlujoRow {
  mes: string;
  ingresos: number;
  egresos: number;
}

interface Alert {
  id: string;
  tipo: 'danger' | 'warning' | 'info';
  area: string;
  texto: string;
}

interface MenuItem {
  id: string;
  label: string;
  icon: any; // componentes de lucide-react — tipado laxo a propósito
}

/* ---------------------------- tokens de diseño --------------------------- */

const C = {
  navy: '#14283D',
  teal: '#2F6E6E',
  salmon: '#D9694A',
  bg: '#F5F6F4',
  surface: '#FFFFFF',
  border: '#E3E6E2',
  text: '#1F2A33',
  textMuted: '#5C6B70',
  success: '#2E7D5B',
  successBg: '#DCF3E6',
  warning: '#B8791E',
  warningBg: '#FBEBD1',
  danger: '#B94A3F',
  dangerBg: '#FBE2DF',
  neutralBg: '#EEF0EE',
};

const inputCls = 'w-full rounded outline-none text-sm px-2 py-1.5';
const inputStyle: React.CSSProperties = { border: `1px solid ${C.border}` };

/* --------------------------- PIN de acceso -------------------------------- */
// Ver la nota de seguridad al inicio del archivo antes de confiar en esto
// para proteger datos realmente sensibles.
const ROLE_PINS: Record<Role, string> = {
  gerencia: '4367',
  trabajador: '0000',
};

/* --------------------------- Google Sheets API ---------------------------- */

const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxC9gdvc7l5-KMPCFK9HjlS2Jq6IlWKWQ3jSeYmd3SPcmKArkM-m0hchfiB_84uTkJ54A/exec';

const SHEET_PARAMS: Record<string, string> = {
  ventas: 'Ventas',
  inventario: 'Inventario',
  comisiones: 'Comisiones',
  clientes: 'Clientes',
  pagos: 'Pagos',
  mmpp: 'Compras',
  flujo: 'Flujo',
};

async function fetchSheet(paramName: string): Promise<any[]> {
  const url = `${GOOGLE_SCRIPT_URL}?sheet=${encodeURIComponent(paramName)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('La API no devolvió una lista de filas');
  return data;
}

/* ------------------------------- utilidades ------------------------------ */

const addDays = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const monthKey = (offset = 0): string => {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d.toISOString().slice(0, 7);
};

const daysUntil = (dateStr?: string): number | null => {
  if (!dateStr) return null;
  const target = new Date(dateStr + 'T00:00:00');
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
};

const formatCurrency = (n: number | string | undefined): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);

function normalizeKey(s: any): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function cleanVal(v: any): any {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v.trim();
  return v;
}

function toDateOnly(v: any): string {
  // Acepta "2025-11-27T03:00:00.000Z" o "2025-11-27" y devuelve "2025-11-27".
  return String(v ?? '').slice(0, 10);
}

function toNumber(v: any): number {
  return Number(String(v ?? '').replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0;
}

/* --------------------- mapeo de columnas de cada hoja ---------------------- */
// Traduce los nombres de columna de tu API a los campos internos del panel.
// Las claves de ALIASES están normalizadas (minúsculas, sin tildes ni guiones
// bajos), así que "data_venda" se busca como "datavenda".

type RawRow = Record<string, any>;

const ALIASES: Record<string, Record<string, string[]>> = {
  // ── VERIFICADO contra un ejemplo real de tu API ──────────────────────────
  ventas: {
    fecha: ['datavenda', 'fecha'],
    vendedor: ['vendedor'],
    cliente: ['dadoscliente', 'cliente'],
    tipo: ['tipovenda', 'tipo'],
    documento: ['nronfnfce', 'notafiscal'],
    producto: ['produto', 'producto'],
    lote: ['lote'],
    origen: ['origen'],
    unidades: ['unidades'],
    kilos: ['kilos'],
    valorKilo: ['valorkilo'],
    valorVenta: ['valorvenda'],
    comision: ['comision', 'comissao'],
    frete: ['frete', 'flete'],
    totalNf: ['totalnf'],
    expedicao: ['expedicao'],
    fechaEntrega: ['dataentrega'],
    metodoPago: ['metodopagamento'],
    pago: ['pago'],
    fechaVencimiento: ['datavencimento'],
    fechaPago: ['datapagamento'],
    facturado: ['facturado'],
    detalle: ['detalle'],
  },
  // ── SIN VERIFICAR: suposición razonable, ajustar con un ejemplo real ────
  inventario: {
    producto: ['producto', 'item', 'articulo'],
    categoria: ['categoria', 'tipo'],
    cantidad: ['cantidad', 'stock', 'disponible'],
    unidad: ['unidad', 'um'],
  },
  comisiones: {
    vendedor: ['vendedor'],
    mes: ['mes'],
    monto: ['monto', 'comision', 'valor'],
  },
  clientes: {
    nombre: ['nombre', 'cliente', 'razonsocial'],
    contacto: ['contacto', 'encargado'],
    telefono: ['telefono', 'fono', 'celular'],
    email: ['email', 'correo'],
    direccion: ['direccion'],
    rubro: ['rubro', 'giro'],
  },
  pagos: {
    mes: ['mes'],
    responsable: ['responsable', 'socio', 'quien'],
    detalle: ['detalle', 'descripcion'],
    monto: ['monto', 'valor', 'total'],
  },
  mmpp: {
    notaFiscal: ['notafiscal', 'nnotafiscal', 'numeronotafiscal', 'nfiscal'],
    proveedor: ['proveedor'],
    producto: ['producto'],
    fechaEmision: ['fechaemision', 'emision'],
    cantidadKg: ['cantidadkg', 'kg', 'cantidad'],
    valorNota: ['valornota', 'valor', 'total'],
  },
  flujo: {
    mes: ['mes'],
    ingresos: ['ingresos', 'ingreso'],
    egresos: ['egresos', 'egreso'],
  },
};

function mapRow(raw: RawRow, aliasKey: string, idPrefix: string, idx: number): RawRow {
  const alias = ALIASES[aliasKey];
  const obj: RawRow = { id: idPrefix + '-' + idx };
  Object.entries(raw).forEach(([h, val]) => {
    const nk = normalizeKey(h);
    for (const field in alias) {
      if (alias[field].includes(nk)) { obj[field] = cleanVal(val); break; }
    }
  });
  return obj;
}

// "SIM/SI/PAGADO" -> Pagada (verde) · "NO/IMPAGO/PENDIENTE" -> No pagada (rojo)
// · "no_aplica/no_especifica" o vacío -> Sin definir (gris, no se fuerza un
// estado que los datos no confirman).
function deriveEstadoVenta(pago: string): Venta['estado'] {
  const nk = normalizeKey(pago);
  if (['sim', 'si', 'pagado', 'pagada'].includes(nk)) return 'Pagada';
  if (['no', 'nao', 'impago', 'pendiente'].includes(nk)) return 'No pagada';
  return 'Sin definir';
}

function normalizeEstadoBoleto(v: any): string {
  const nk = normalizeKey(v);
  if (['pagado', 'pagada', 'pago'].includes(nk)) return 'Pagado';
  return 'Pendiente';
}

const mapVenta = (r: RawRow, idx: number): Venta => {
  const o = mapRow(r, 'ventas', 'v', idx);
  const totalCandidate = o.totalNf !== undefined && String(o.totalNf).trim() !== '' ? o.totalNf : o.valorVenta;
  return {
    id: o.id, fecha: toDateOnly(o.fecha), vendedor: o.vendedor || '', cliente: o.cliente || '',
    tipo: o.tipo || '', documento: o.documento || '', producto: o.producto || '',
    lote: o.lote || '', origen: o.origen || '', unidades: toNumber(o.unidades), kilos: toNumber(o.kilos),
    valorKilo: toNumber(o.valorKilo), total: toNumber(totalCandidate), expedicao: o.expedicao || '',
    fechaEntrega: toDateOnly(o.fechaEntrega), metodoPago: o.metodoPago || '', pago: o.pago || '',
    fechaVencimiento: toDateOnly(o.fechaVencimiento), fechaPago: toDateOnly(o.fechaPago),
    facturado: o.facturado || '', detalle: o.detalle || '', estado: deriveEstadoVenta(o.pago || ''),
  };
};

const mapInventario = (r: RawRow, idx: number): InventarioItem => {
  const o = mapRow(r, 'inventario', 'i', idx);
  return { id: o.id, producto: o.producto || '', categoria: o.categoria || '', cantidad: toNumber(o.cantidad), unidad: o.unidad || '' };
};

const mapComision = (r: RawRow, idx: number): Comision => {
  const o = mapRow(r, 'comisiones', 'c', idx);
  return { id: o.id, vendedor: o.vendedor || '', mes: o.mes || '', monto: toNumber(o.monto) };
};

const mapCliente = (r: RawRow, idx: number): Cliente => {
  const o = mapRow(r, 'clientes', 'cl', idx);
  return { id: o.id, nombre: o.nombre || '', contacto: o.contacto || '', telefono: o.telefono || '', email: o.email || '', direccion: o.direccion || '', rubro: o.rubro || '' };
};

const mapPago = (r: RawRow, idx: number): Pago => {
  const o = mapRow(r, 'pagos', 'p', idx);
  return { id: o.id, mes: o.mes || '', responsable: o.responsable || '', detalle: o.detalle || '', monto: toNumber(o.monto) };
};

const mapFlujoRow = (r: RawRow, idx: number): FlujoRow => {
  const o = mapRow(r, 'flujo', 'f', idx);
  return { mes: o.mes || '', ingresos: toNumber(o.ingresos), egresos: toNumber(o.egresos) };
};

// Compras: además de los campos base, busca columnas "Boleto1 Vencimiento",
// "Boleto1 Valor", "Boleto1 Estado", "Boleto2 ...", "Boleto3 ...".
function mapMmppRow(raw: RawRow, id: string): MmppNota {
  const alias = ALIASES.mmpp;
  const obj: RawRow = { id };
  const boletoData: Record<string, Partial<Boleto>> = {};
  Object.entries(raw).forEach(([h, val]) => {
    const nk = normalizeKey(h);
    for (const field in alias) {
      if (alias[field].includes(nk)) { obj[field] = cleanVal(val); return; }
    }
    const m = nk.match(/^boleto0?(\d)(vencimiento|venc|valor|estado)$/);
    if (m) {
      const n = m[1];
      boletoData[n] = boletoData[n] || {};
      if (m[2] === 'vencimiento' || m[2] === 'venc') boletoData[n].fechaVencimiento = cleanVal(val);
      else if (m[2] === 'valor') boletoData[n].valor = toNumber(val);
      else if (m[2] === 'estado') boletoData[n].estado = normalizeEstadoBoleto(val);
    }
  });
  const boletos: Boleto[] = Object.keys(boletoData)
    .sort()
    .map((k) => ({ fechaVencimiento: '', valor: 0, estado: 'Pendiente', ...boletoData[k] }))
    .filter((b) => b.fechaVencimiento);
  return {
    id, notaFiscal: obj.notaFiscal || '', proveedor: obj.proveedor || '', producto: obj.producto || '',
    fechaEmision: toDateOnly(obj.fechaEmision), cantidadKg: toNumber(obj.cantidadKg), valorNota: toNumber(obj.valorNota),
    boletos,
  };
}

/* --------------------------------- datos de ejemplo ------------------------ */
// Solo se usan si la API todavía no responde y no hay nada en caché.

const VENTAS_SEED: Venta[] = [
  { id: 'v1', fecha: addDays(-6), vendedor: 'Ricardo Battistini', cliente: 'Sin especificar', tipo: 'NFC-e', documento: '', producto: 'Salmão defumado fatiado COHO 100 gr', lote: '', origen: '', unidades: 20, kilos: 2, valorKilo: 238, total: 476, expedicao: 'Retiro en vendedor', fechaEntrega: addDays(-6), metodoPago: 'Dinheiro', pago: 'SIM', fechaVencimiento: '', fechaPago: '', facturado: 'nao', detalle: '', estado: 'Pagada' },
  { id: 'v2', fecha: addDays(-6), vendedor: 'Ricardo Battistini', cliente: 'Sin especificar', tipo: 'no_especifica', documento: '', producto: 'Ostra cozida defumada 100gr', lote: '', origen: '', unidades: 10, kilos: 1, valorKilo: 270, total: 270, expedicao: 'Retiro en vendedor', fechaEntrega: addDays(-5), metodoPago: 'no_especifica', pago: 'no_especifica', fechaVencimiento: '', fechaPago: '', facturado: 'nao', detalle: '', estado: 'Sin definir' },
  { id: 'v3', fecha: addDays(-5), vendedor: 'Ricardo Battistini', cliente: 'Sin especificar', tipo: 'no_especifica', documento: '', producto: 'Mexilhão cozido defumado 100gr', lote: '', origen: '', unidades: 10, kilos: 1, valorKilo: 162, total: 162, expedicao: 'Retiro en vendedor', fechaEntrega: addDays(-5), metodoPago: 'no_especifica', pago: 'no_especifica', fechaVencimiento: '', fechaPago: '', facturado: 'nao', detalle: '', estado: 'Sin definir' },
];

const INVENTARIO_SEED: InventarioItem[] = [
  { id: 'i1', producto: 'Salmón Ahumado en Frío 500g', categoria: 'Salmón', cantidad: 120, unidad: 'un' },
  { id: 'i2', producto: 'Salmón Ahumado en Frío 1kg', categoria: 'Salmón', cantidad: 45, unidad: 'un' },
  { id: 'i3', producto: 'Trucha Ahumada Filete', categoria: 'Trucha', cantidad: 0, unidad: 'un' },
  { id: 'i4', producto: 'Mejillones Ahumados en Aceite', categoria: 'Mariscos', cantidad: 60, unidad: 'frasco' },
];

const COMISIONES_SEED: Comision[] = [
  { id: 'c1', vendedor: 'Ricardo Battistini', mes: monthKey(-1), monto: 187500 },
  { id: 'c2', vendedor: 'Ricardo Battistini', mes: monthKey(0), monto: 92400 },
];

const CLIENTES_SEED: Cliente[] = [
  { id: 'cl1', nombre: 'Sin especificar', contacto: '', telefono: '', email: '', direccion: '', rubro: '' },
];

const COMPRAS_MMPP_SEED: MmppNota[] = [
  { id: 'm1', notaFiscal: 'FC-5521', proveedor: 'Pesquera Los Fiordos', producto: 'Salmón entero fresco', fechaEmision: addDays(-15), cantidadKg: 2200, valorNota: 9680000, boletos: [
    { fechaVencimiento: addDays(5), valor: 3226667, estado: 'Pendiente' },
  ] },
];

const PAGOS_SEED: Pago[] = [
  { id: 'p1', mes: monthKey(-1), responsable: 'Roberto Alvarez', detalle: 'Compra de insumos de embalaje', monto: 1250000 },
];

const MESES_LABEL = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const FLUJO_SEED: FlujoRow[] = MESES_LABEL.map((m, idx) => ({
  mes: m,
  ingresos: 8000000 + Math.round(Math.sin(idx / 2) * 1500000) + idx * 120000,
  egresos: 6200000 + Math.round(Math.cos(idx / 3) * 900000) + idx * 80000,
}));

// General: visible para Trabajador y Gerencia, con montos completos.
// Gerencia y administración: solo Gerencia.
const MENU_GENERAL: MenuItem[] = [
  { id: 'ventas', label: 'Ventas', icon: ShoppingCart },
  { id: 'comisiones', label: 'Comisiones', icon: TrendingUp },
  { id: 'inventario', label: 'Inventario', icon: Package },
  { id: 'clientes', label: 'Cartera de clientes', icon: Users },
];
const MENU_ADMIN: MenuItem[] = [
  { id: 'mmpp', label: 'Compras MMPP', icon: Truck },
  { id: 'pagos', label: 'Pagos', icon: Wallet },
  { id: 'flujo', label: 'Flujo de caja', icon: FileText },
  { id: 'estadisticas', label: 'Estadísticas', icon: BarChart3 },
];
const RESPONSABLE_COLOR: Record<string, string> = {
  'Roberto Alvarez': C.navy,
  'Diether Reuck': C.teal,
  'Patagonia Natural': C.salmon,
};

/* ------------------------------- caché local -------------------------------- */

const STORAGE_KEYS: Record<string, string> = {
  ventas: 'panel:ventas', comisiones: 'panel:comisiones', inventario: 'panel:inventario',
  clientes: 'panel:clientes', mmpp: 'panel:compras-mmpp', pagos: 'panel:pagos', flujo: 'panel:flujo-caja',
};

function saveData(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignorar */ }
}

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (e) { return null; }
}

interface LoadResult<T> { data: T[]; source: DataSource; }

async function loadModule<T>(storageKey: string, sheetParamKey: string, mapFn: (r: RawRow, idx: number) => T, seed: T[]): Promise<LoadResult<T>> {
  try {
    const raw = await fetchSheet(SHEET_PARAMS[sheetParamKey]);
    const mapped = raw.map(mapFn);
    saveData(STORAGE_KEYS[storageKey], mapped);
    return { data: mapped, source: 'live' };
  } catch (e) {
    const cached = readCache<T>(STORAGE_KEYS[storageKey]);
    if (cached) return { data: Array.isArray(cached) ? cached : [cached], source: 'cache' };
    return { data: seed, source: 'seed' };
  }
}

async function loadMmpp(seed: MmppNota[]): Promise<LoadResult<MmppNota>> {
  try {
    const raw = await fetchSheet(SHEET_PARAMS.mmpp);
    const mapped = raw.map((r: RawRow, idx: number) => mapMmppRow(r, 'm-' + idx));
    saveData(STORAGE_KEYS.mmpp, mapped);
    return { data: mapped, source: 'live' };
  } catch (e) {
    const cached = readCache<MmppNota>(STORAGE_KEYS.mmpp);
    if (cached) return { data: Array.isArray(cached) ? cached : [cached], source: 'cache' };
    return { data: seed, source: 'seed' };
  }
}

/* ----------------------------- subcomponentes ------------------------------ */

function ModuleHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
      <div>
        <h2 className="text-lg font-medium" style={{ color: C.text }}>{title}</h2>
        {subtitle && <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  );
}

function ColorLegend({ items }: { items: [string, string, string][] }) {
  return (
    <div className="flex items-center gap-4 mt-3 text-xs flex-wrap" style={{ color: C.textMuted }}>
      {items.map(([label, bg, fg]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span style={{ background: bg, border: `1px solid ${fg}` }} className="w-3 h-3 rounded-sm inline-block" />
          {label}
        </span>
      ))}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, background: C.surface }} className="rounded-md p-4">
      <div className="text-sm font-medium mb-2" style={{ color: C.text }}>{title}</div>
      {children}
    </div>
  );
}

function NavItem({ item, active, onClick }: { item: MenuItem; active: string; onClick: (id: string) => void }) {
  const Icon = item.icon;
  const isActive = active === item.id;
  return (
    <button
      onClick={() => onClick(item.id)}
      style={{
        background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent',
        color: isActive ? '#FFFFFF' : 'rgba(255,255,255,0.7)',
        borderLeft: isActive ? `3px solid ${C.salmon}` : '3px solid transparent',
      }}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:text-white"
    >
      <Icon size={16} />
      <span>{item.label}</span>
    </button>
  );
}

function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <div style={{ background: C.salmon, width: size, height: size, borderRadius: 6 }} className="flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">P</div>
  );
}

function Sidebar({ active, setActive, role }: { active: string; setActive: (id: string) => void; role: Role }) {
  return (
    <aside style={{ background: C.navy, width: 232, flexShrink: 0 }} className="flex flex-col py-5">
      <div className="px-4 pb-5 mb-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="flex items-center gap-2">
          <BrandMark />
          <div>
            <div className="text-white text-sm font-medium leading-tight">Patagonia Natural</div>
            <div style={{ color: 'rgba(255,255,255,0.5)' }} className="text-xs leading-tight">Panel de gestión</div>
          </div>
        </div>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.4)' }} className="px-4 text-xs mb-1 mt-2">General</div>
      {MENU_GENERAL.map((item) => (
        <NavItem key={item.id} item={item} active={active} onClick={setActive} />
      ))}
      {role === 'gerencia' && (
        <>
          <div style={{ color: 'rgba(255,255,255,0.4)' }} className="px-4 text-xs mb-1 mt-5">Gerencia y administración</div>
          {MENU_ADMIN.map((item) => (
            <NavItem key={item.id} item={item} active={active} onClick={setActive} />
          ))}
        </>
      )}
    </aside>
  );
}

/* ------------------------------ pantalla de acceso -------------------------- */

function AuthScreen({ onAuthenticated }: { onAuthenticated: (role: Role) => void }) {
  const [target, setTarget] = useState<Role | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const pick = (role: Role) => { setTarget(role); setPin(''); setError(false); };
  const back = () => { setTarget(null); setPin(''); setError(false); };
  const confirm = () => {
    if (target && pin === ROLE_PINS[target]) {
      onAuthenticated(target);
    } else {
      setError(true);
      setPin('');
    }
  };

  return (
    <div style={{ background: C.bg, minHeight: '100vh' }} className="flex items-center justify-center p-4">
      <div style={{ border: `1px solid ${C.border}`, background: C.surface, maxWidth: 380 }} className="rounded-md p-8 w-full">
        <div className="flex items-center gap-2 mb-6 justify-center">
          <BrandMark size={32} />
          <div>
            <div className="text-base font-medium" style={{ color: C.text }}>Patagonia Natural</div>
            <div className="text-xs" style={{ color: C.textMuted }}>Panel de gestión</div>
          </div>
        </div>

        {!target ? (
          <>
            <div className="text-sm mb-4 text-center" style={{ color: C.textMuted }}>Elige tu perfil para continuar</div>
            <div className="flex flex-col gap-2">
              <button onClick={() => pick('trabajador')} style={{ border: `1px solid ${C.border}`, color: C.text }} className="px-4 py-2.5 rounded-md text-sm">Trabajador</button>
              <button onClick={() => pick('gerencia')} style={{ background: C.navy }} className="px-4 py-2.5 rounded-md text-sm text-white">Gerencia / Administrador</button>
            </div>
          </>
        ) : (
          <>
            <div className="text-sm mb-1 text-center font-medium" style={{ color: C.text }}>
              {target === 'gerencia' ? 'Gerencia / Administrador' : 'Trabajador'}
            </div>
            <div className="text-xs mb-4 text-center" style={{ color: C.textMuted }}>Ingresa el PIN de 4 dígitos</div>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
              onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }}
              autoFocus
              className={inputCls}
              style={{ ...inputStyle, textAlign: 'center', letterSpacing: '0.5em', fontSize: 20 }}
              placeholder="••••"
            />
            {error && <div className="text-xs mt-2 text-center" style={{ color: C.danger }}>PIN incorrecto — inténtalo de nuevo.</div>}
            <div className="flex justify-between gap-2 mt-4">
              <button type="button" onClick={back} className="px-3 py-1.5 text-sm" style={{ color: C.textMuted }}>Volver</button>
              <button type="button" onClick={confirm} style={{ background: C.salmon }} className="px-4 py-1.5 text-sm text-white rounded-md">Ingresar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- barra superior --------------------------- */

const STATUS_LABEL: Record<ConnectionStatus, [string, string]> = {
  live: ['Conectado a Google Sheets', C.success],
  partial: ['Conexión parcial con Google Sheets', C.warning],
  offline: ['Sin conexión — mostrando datos guardados', C.danger],
  checking: ['Conectando…', C.textMuted],
};

interface TopBarProps {
  role: Role;
  onLogout: () => void;
  alerts: Alert[];
  notifOpen: boolean;
  setNotifOpen: React.Dispatch<React.SetStateAction<boolean>>;
  lastSync: Date | null;
  connectionStatus: ConnectionStatus;
}

function TopBar({ role, onLogout, alerts, notifOpen, setNotifOpen, lastSync, connectionStatus }: TopBarProps) {
  const elapsed = lastSync ? Math.max(0, Math.round((Date.now() - lastSync.getTime()) / 1000)) : null;
  const [label, color] = STATUS_LABEL[connectionStatus] || STATUS_LABEL.checking;
  const StatusIcon = connectionStatus === 'offline' ? WifiOff : Wifi;
  return (
    <header style={{ borderBottom: `1px solid ${C.border}`, background: C.surface }} className="flex items-center justify-between px-6 py-3">
      <div>
        <div className="text-sm font-medium" style={{ color: C.text }}>Ventas, inventario y gestión</div>
        <div className="text-xs flex items-center gap-1.5" style={{ color: C.textMuted }}>
          <StatusIcon size={12} style={{ color }} />
          <span style={{ color }}>{label}</span>
          {elapsed !== null && <span>· hace {elapsed}s</span>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div style={{ border: `1px solid ${C.border}`, color: C.textMuted }} className="px-3 py-1.5 rounded-md text-xs">
          {role === 'gerencia' ? 'Gerencia / Administrador' : 'Trabajador'}
        </div>
        <button onClick={onLogout} style={{ border: `1px solid ${C.border}`, color: C.textMuted }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs">
          <LogOut size={13} /> Cerrar sesión
        </button>
        <div className="relative">
          <button onClick={() => setNotifOpen((o) => !o)} style={{ border: `1px solid ${C.border}` }} className="relative p-2 rounded-md">
            <Bell size={16} color={C.text} />
            {alerts.length > 0 && (
              <span style={{ background: C.danger }} className="absolute -top-1 -right-1 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{alerts.length}</span>
            )}
          </button>
          {notifOpen && (
            <div style={{ border: `1px solid ${C.border}`, background: C.surface }} className="absolute right-0 mt-2 w-80 rounded-md shadow-lg z-20 max-h-96 overflow-auto">
              <div className="px-3 py-2 text-xs font-medium" style={{ borderBottom: `1px solid ${C.border}`, color: C.text }}>Notificaciones ({alerts.length})</div>
              {alerts.length === 0 ? (
                <div className="px-3 py-4 text-xs" style={{ color: C.textMuted }}>Sin alertas por ahora.</div>
              ) : (
                alerts.map((a) => (
                  <div key={a.id} className="px-3 py-2 text-xs flex gap-2" style={{ borderBottom: `1px solid ${C.border}` }}>
                    <AlertTriangle size={14} style={{ color: a.tipo === 'danger' ? C.danger : a.tipo === 'warning' ? C.warning : C.teal, flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <div style={{ color: C.textMuted }}>{a.area}</div>
                      <div style={{ color: C.text }}>{a.texto}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-64" style={{ color: C.textMuted }}>
      <RefreshCw size={18} className="animate-spin mr-2" /> Cargando datos…
    </div>
  );
}

/* --------------------------------- Ventas ---------------------------------- */

function VentasView({ ventas }: { ventas: Venta[] }) {
  const [vendedorF, setVendedorF] = useState('Todos');
  const [clienteF, setClienteF] = useState('Todos');
  const [mesF, setMesF] = useState('Todos');

  const vendedores = ['Todos', ...new Set(ventas.map((v) => v.vendedor))];
  const clientesList = ['Todos', ...new Set(ventas.map((v) => v.cliente))];
  const meses = ['Todos', ...new Set(ventas.map((v) => (v.fecha || '').slice(0, 7)))].filter(Boolean).sort();

  const filtered = ventas.filter((v) =>
    (vendedorF === 'Todos' || v.vendedor === vendedorF) &&
    (clienteF === 'Todos' || v.cliente === clienteF) &&
    (mesF === 'Todos' || (v.fecha || '').startsWith(mesF))
  );

  const total = filtered.reduce((s, v) => s + (Number(v.total) || 0), 0);

  const rowStyle = (estado: Venta['estado']): React.CSSProperties => {
    if (estado === 'Pagada') return { background: C.successBg, color: '#1F5C3B' };
    if (estado === 'No pagada') return { background: C.dangerBg, color: '#8B2E24' };
    return { background: C.neutralBg, color: C.textMuted };
  };

  return (
    <div>
      <ModuleHeader title="Ventas" subtitle="Una fila por producto vendido — filtra por vendedor, cliente o mes (histórico desde noviembre de 2025)">
        <select value={vendedorF} onChange={(e) => setVendedorF(e.target.value)} className={inputCls} style={{ ...inputStyle, width: 170 }}>
          {vendedores.map((v) => <option key={v}>{v}</option>)}
        </select>
        <select value={clienteF} onChange={(e) => setClienteF(e.target.value)} className={inputCls} style={{ ...inputStyle, width: 180 }}>
          {clientesList.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={mesF} onChange={(e) => setMesF(e.target.value)} className={inputCls} style={{ ...inputStyle, width: 130 }}>
          {meses.map((m) => <option key={m}>{m}</option>)}
        </select>
      </ModuleHeader>

      <div style={{ border: `1px solid ${C.border}`, background: C.surface }} className="rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: C.bg, color: C.textMuted }} className="text-left">
              {['Fecha', 'Vendedor', 'Cliente', 'Producto', 'Kilos', 'Valor venta', 'Tipo', 'Pago', 'Entrega'].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => (
              <tr key={v.id} style={rowStyle(v.estado)}>
                <td className="px-3 py-2">{v.fecha}</td>
                <td className="px-3 py-2">{v.vendedor}</td>
                <td className="px-3 py-2">{v.cliente}</td>
                <td className="px-3 py-2">{v.producto}</td>
                <td className="px-3 py-2 text-right">{v.kilos}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(v.total)}</td>
                <td className="px-3 py-2">{v.tipo}</td>
                <td className="px-3 py-2 font-medium">{v.estado}</td>
                <td className="px-3 py-2">{v.fechaEntrega || '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center" style={{ color: C.textMuted }}>Sin ventas para este filtro.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ background: C.navy, color: '#fff' }} className="font-medium">
              <td className="px-3 py-2" colSpan={5}>Total del filtro</td>
              <td className="px-3 py-2 text-right">{formatCurrency(total)}</td>
              <td className="px-3 py-2" colSpan={3}></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <ColorLegend items={[['Pagada', C.successBg, '#1F5C3B'], ['No pagada', C.dangerBg, '#8B2E24'], ['Sin definir', C.neutralBg, C.textMuted]]} />
    </div>
  );
}

/* ------------------------------- Comisiones --------------------------------- */

function ComisionesView({ comisiones }: { comisiones: Comision[] }) {
  const [vendedorF, setVendedorF] = useState('Todos');
  const [mesF, setMesF] = useState('Todos');
  const vendedores = ['Todos', ...new Set(comisiones.map((c) => c.vendedor))];
  const meses = ['Todos', ...new Set(comisiones.map((c) => c.mes))].sort();
  const filtered = comisiones.filter((c) => (vendedorF === 'Todos' || c.vendedor === vendedorF) && (mesF === 'Todos' || c.mes === mesF));
  const total = filtered.reduce((s, c) => s + (Number(c.monto) || 0), 0);

  return (
    <div>
      <ModuleHeader title="Comisiones por vendedor" subtitle="Filtra por vendedor y/o por mes">
        <select value={vendedorF} onChange={(e) => setVendedorF(e.target.value)} className={inputCls} style={{ ...inputStyle, width: 180 }}>
          {vendedores.map((v) => <option key={v}>{v}</option>)}
        </select>
        <select value={mesF} onChange={(e) => setMesF(e.target.value)} className={inputCls} style={{ ...inputStyle, width: 140 }}>
          {meses.map((m) => <option key={m}>{m}</option>)}
        </select>
      </ModuleHeader>
      <div style={{ border: `1px solid ${C.border}`, background: C.surface }} className="rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: C.bg, color: C.textMuted }} className="text-left">
              <th className="px-3 py-2 font-medium">Vendedor</th>
              <th className="px-3 py-2 font-medium">Mes</th>
              <th className="px-3 py-2 font-medium text-right">Comisión</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} style={{ borderTop: `1px solid ${C.border}` }}>
                <td className="px-3 py-2">{c.vendedor}</td>
                <td className="px-3 py-2">{c.mes}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(c.monto)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-6 text-center" style={{ color: C.textMuted }}>Sin resultados para este filtro.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ background: C.navy, color: '#fff' }} className="font-medium">
              <td className="px-3 py-2" colSpan={2}>Total</td>
              <td className="px-3 py-2 text-right">{formatCurrency(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------- Inventario --------------------------------- */

function InventarioView({ inventario }: { inventario: InventarioItem[] }) {
  const rowStyle = (item: InventarioItem): React.CSSProperties => (item.cantidad > 0 ? { background: C.successBg } : { background: '#FFFFFF' });

  return (
    <div>
      <ModuleHeader title="Inventario de productos" subtitle="Disponibilidad actual por producto" />
      <div style={{ border: `1px solid ${C.border}`, background: C.surface }} className="rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: C.bg, color: C.textMuted }} className="text-left">
              <th className="px-3 py-2 font-medium">Producto</th>
              <th className="px-3 py-2 font-medium">Categoría</th>
              <th className="px-3 py-2 font-medium text-right">Cantidad</th>
              <th className="px-3 py-2 font-medium">Unidad</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {inventario.map((p) => (
              <tr key={p.id} style={{ ...rowStyle(p), borderTop: `1px solid ${C.border}` }}>
                <td className="px-3 py-2">{p.producto}</td>
                <td className="px-3 py-2">{p.categoria}</td>
                <td className="px-3 py-2 text-right font-medium">{p.cantidad}</td>
                <td className="px-3 py-2">{p.unidad}</td>
                <td className="px-3 py-2">
                  {p.cantidad === 0 && <span style={{ color: C.danger }} className="text-xs font-medium">Sin stock</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ColorLegend items={[['Con disponibilidad', C.successBg, '#1F5C3B'], ['Sin disponibilidad', '#FFFFFF', C.border]]} />
    </div>
  );
}

/* --------------------------- Cartera de clientes ----------------------------- */

function ClientesView({ clientes }: { clientes: Cliente[] }) {
  const [q, setQ] = useState('');
  const filtered = clientes.filter((c) => {
    const hay = `${c.nombre} ${c.contacto} ${c.telefono} ${c.email} ${c.direccion} ${c.rubro}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <div>
      <ModuleHeader title="Cartera de clientes" subtitle={`${clientes.length} clientes registrados`} />
      <div className="relative mb-4" style={{ maxWidth: 340 }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: C.textMuted }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, contacto, rubro…" className={inputCls} style={{ ...inputStyle, paddingLeft: 32 }} />
      </div>
      <div style={{ border: `1px solid ${C.border}`, background: C.surface }} className="rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: C.bg, color: C.textMuted }} className="text-left">
              {['Cliente', 'Contacto', 'Teléfono', 'Email', 'Dirección', 'Rubro'].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} style={{ borderTop: `1px solid ${C.border}` }}>
                <td className="px-3 py-2 font-medium">{c.nombre}</td>
                <td className="px-3 py-2">{c.contacto}</td>
                <td className="px-3 py-2">{c.telefono}</td>
                <td className="px-3 py-2">{c.email}</td>
                <td className="px-3 py-2">{c.direccion}</td>
                <td className="px-3 py-2">{c.rubro}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center" style={{ color: C.textMuted }}>Ningún cliente coincide con "{q}".</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --------------------------- Compras (materia prima) ------------------------- */

function boletoBadge(estado: string, fechaVencimiento: string) {
  let bg = C.warningBg, fg = '#7A5210', txt = estado;
  if (estado === 'Pagado') { bg = C.successBg; fg = '#1F5C3B'; }
  else {
    const d = daysUntil(fechaVencimiento);
    if (d !== null && d < 0) { bg = C.dangerBg; fg = '#8B2E24'; txt = 'Vencido'; }
  }
  return <span style={{ background: bg, color: fg }} className="text-xs px-1.5 py-0.5 rounded">{txt}</span>;
}

function MmppView({ mmpp }: { mmpp: MmppNota[] }) {
  const sorted = [...mmpp].sort((a, b) => new Date(b.fechaEmision).getTime() - new Date(a.fechaEmision).getTime());
  return (
    <div>
      <ModuleHeader title="Compras de materia prima (MMPP)" subtitle="Notas más recientes arriba, las más antiguas abajo" />
      <div className="space-y-3">
        {sorted.map((n) => (
          <div key={n.id} style={{ border: `1px solid ${C.border}`, background: C.surface }} className="rounded-md p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <div>
                <span className="font-medium" style={{ color: C.text }}>{n.notaFiscal}</span>
                <span style={{ color: C.textMuted }} className="ml-2 text-xs">{n.proveedor} · {n.producto} · {n.cantidadKg} kg · emitida {n.fechaEmision}</span>
              </div>
              <div className="font-medium" style={{ color: C.text }}>{formatCurrency(n.valorNota)}</div>
            </div>
            {n.boletos.length > 0 && (
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${n.boletos.length}, 1fr)` }}>
                {n.boletos.map((b, idx) => (
                  <div key={idx} style={{ background: C.bg }} className="rounded px-3 py-2 text-xs flex items-center justify-between">
                    <div>
                      <div style={{ color: C.textMuted }}>Boleto {idx + 1} · vence {b.fechaVencimiento}</div>
                      <div style={{ color: C.text }} className="font-medium">{formatCurrency(b.valor)}</div>
                    </div>
                    {boletoBadge(b.estado, b.fechaVencimiento)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------- Pagos ------------------------------------ */

function PagosView({ pagos }: { pagos: Pago[] }) {
  const [mesF, setMesF] = useState('Todos');
  const meses = ['Todos', ...new Set(pagos.map((p) => p.mes))].sort();
  const filtered = pagos.filter((p) => mesF === 'Todos' || p.mes === mesF);
  const total = filtered.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const porResponsable: Record<string, number> = {};
  filtered.forEach((p) => { porResponsable[p.responsable] = (porResponsable[p.responsable] || 0) + (Number(p.monto) || 0); });

  return (
    <div>
      <ModuleHeader title="Pagos y gastos" subtitle="Gastos mensuales y responsable">
        <select value={mesF} onChange={(e) => setMesF(e.target.value)} className={inputCls} style={{ ...inputStyle, width: 140 }}>
          {meses.map((m) => <option key={m}>{m}</option>)}
        </select>
      </ModuleHeader>
      <div className="flex gap-3 mb-4 flex-wrap">
        {Object.entries(porResponsable).map(([r, v]) => (
          <div key={r} style={{ border: `1px solid ${C.border}`, background: C.surface }} className="rounded-md px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span style={{ background: RESPONSABLE_COLOR[r] || C.textMuted }} className="w-2 h-2 rounded-full inline-block" />
              <span style={{ color: C.textMuted }}>{r}</span>
            </div>
            <div style={{ color: C.text }} className="font-medium mt-0.5">{formatCurrency(v)}</div>
          </div>
        ))}
      </div>
      <div style={{ border: `1px solid ${C.border}`, background: C.surface }} className="rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: C.bg, color: C.textMuted }} className="text-left">
              <th className="px-3 py-2 font-medium">Mes</th>
              <th className="px-3 py-2 font-medium">Responsable</th>
              <th className="px-3 py-2 font-medium">Detalle</th>
              <th className="px-3 py-2 font-medium text-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} style={{ borderTop: `1px solid ${C.border}` }}>
                <td className="px-3 py-2">{p.mes}</td>
                <td className="px-3 py-2">{p.responsable}</td>
                <td className="px-3 py-2">{p.detalle}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(p.monto)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: C.navy, color: '#fff' }} className="font-medium">
              <td className="px-3 py-2" colSpan={3}>Total</td>
              <td className="px-3 py-2 text-right">{formatCurrency(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------- Flujo de caja -------------------------------- */

function FlujoCajaView({ flujo }: { flujo: FlujoRow[] }) {
  let acumulado = 0;
  const rows = flujo.map((f) => {
    const saldo = f.ingresos - f.egresos;
    acumulado += saldo;
    return { ...f, saldo, acumulado };
  });

  return (
    <div>
      <ModuleHeader title="Flujo de caja anual" subtitle="Ingresos, egresos y saldo acumulado por mes — desde la pestaña Flujo" />
      <div style={{ border: `1px solid ${C.border}`, background: C.surface, height: 260 }} className="rounded-md p-4 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="mes" tick={{ fontSize: 11, fill: C.textMuted }} />
            <YAxis tick={{ fontSize: 11, fill: C.textMuted }} tickFormatter={(v: number) => `${Math.round(v / 1e6)}M`} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Legend />
            <Line type="monotone" dataKey="ingresos" stroke={C.success} strokeWidth={2} dot={false} name="Ingresos" />
            <Line type="monotone" dataKey="egresos" stroke={C.danger} strokeWidth={2} dot={false} name="Egresos" />
            <Line type="monotone" dataKey="acumulado" stroke={C.navy} strokeWidth={2} dot={false} name="Saldo acumulado" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ border: `1px solid ${C.border}`, background: C.surface }} className="rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: C.bg, color: C.textMuted }} className="text-left">
              <th className="px-3 py-2 font-medium">Mes</th>
              <th className="px-3 py-2 font-medium text-right">Ingresos</th>
              <th className="px-3 py-2 font-medium text-right">Egresos</th>
              <th className="px-3 py-2 font-medium text-right">Saldo</th>
              <th className="px-3 py-2 font-medium text-right">Acumulado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.mes} style={{ borderTop: `1px solid ${C.border}` }}>
                <td className="px-3 py-2">{r.mes}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(r.ingresos)}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(r.egresos)}</td>
                <td className="px-3 py-2 text-right" style={{ color: r.saldo >= 0 ? C.success : C.danger }}>{formatCurrency(r.saldo)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatCurrency(r.acumulado)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------- Estadísticas -------------------------------- */

function InventarioMiniChart({ inventario }: { inventario: InventarioItem[] }) {
  const porCategoria: Record<string, number> = {};
  inventario.forEach((p) => { porCategoria[p.categoria] = (porCategoria[p.categoria] || 0) + (Number(p.cantidad) || 0); });
  const data = Object.entries(porCategoria).map(([name, value]) => ({ name, value }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: C.textMuted }} />
        <YAxis tick={{ fontSize: 10, fill: C.textMuted }} />
        <Tooltip />
        <Bar dataKey="value" fill={C.navy} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function EstadisticasView({ ventas, inventario, pagos }: { ventas: Venta[]; inventario: InventarioItem[]; pagos: Pago[] }) {
  const porVendedor: Record<string, number> = {};
  ventas.forEach((v) => { porVendedor[v.vendedor] = (porVendedor[v.vendedor] || 0) + (Number(v.total) || 0); });
  const dataVendedor = Object.entries(porVendedor).map(([name, value]) => ({ name, value }));

  const estadoCount: Record<string, number> = { Pagada: 0, 'No pagada': 0, 'Sin definir': 0 };
  ventas.forEach((v) => { estadoCount[v.estado] = (estadoCount[v.estado] || 0) + 1; });
  const dataEstado = Object.entries(estadoCount).map(([name, value]) => ({ name, value }));
  const PIE_COLORS: Record<string, string> = { Pagada: C.success, 'No pagada': C.danger, 'Sin definir': C.textMuted };

  const gastoPorResponsable: Record<string, number> = {};
  pagos.forEach((p) => { gastoPorResponsable[p.responsable] = (gastoPorResponsable[p.responsable] || 0) + (Number(p.monto) || 0); });
  const dataGasto = Object.entries(gastoPorResponsable).map(([name, value]) => ({ name, value }));

  return (
    <div>
      <ModuleHeader title="Estadísticas" subtitle="Se calculan solas a partir de Ventas, Inventario y Pagos — no hay nada que cargar aquí" />
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Ventas por vendedor">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dataVendedor}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: C.textMuted }} />
              <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickFormatter={(v: number) => `${Math.round(v / 1e6)}M`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="value" fill={C.teal} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Estado de pago de las ventas">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={dataEstado} dataKey="value" nameKey="name" outerRadius={80} label={(e: any) => e.name}>
                {dataEstado.map((d, i) => <Cell key={i} fill={PIE_COLORS[d.name] || C.textMuted} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Gasto por responsable">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dataGasto}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: C.textMuted }} />
              <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickFormatter={(v: number) => `${Math.round(v / 1e6)}M`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="value" fill={C.salmon} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Inventario por categoría">
          <InventarioMiniChart inventario={inventario} />
        </ChartCard>
      </div>
    </div>
  );
}

/* ----------------------------------- App -------------------------------------- */

export default function App() {
  // Sesión: ver la nota de seguridad del PIN al inicio del archivo.
  const [session, setSession] = useState<Role | null>(null);
  const role: Role = session ?? 'trabajador';

  const [active, setActive] = useState<string>('ventas');
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('checking');
  const [, forceTick] = useState(0);

  const [ventas, setVentas] = useState<Venta[]>([]);
  const [comisiones, setComisiones] = useState<Comision[]>([]);
  const [inventario, setInventario] = useState<InventarioItem[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [mmpp, setMmpp] = useState<MmppNota[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [flujo, setFlujo] = useState<FlujoRow[]>([]);
  const [inventoryEvents, setInventoryEvents] = useState<Alert[]>([]);
  const prevInventarioRef = useRef<InventarioItem[] | null>(null);

  // Nota: esto sigue trayendo datos en segundo plano aunque nadie haya
  // iniciado sesión todavía, para que la primera vista tras el PIN ya
  // tenga datos listos en vez de tener que esperar el próximo sondeo.
  const refreshAll = useCallback(async (isInitial: boolean) => {
    const [vR, cR, iR, clR, mR, pR, fR] = await Promise.all([
      loadModule('ventas', 'ventas', mapVenta, VENTAS_SEED),
      loadModule('comisiones', 'comisiones', mapComision, COMISIONES_SEED),
      loadModule('inventario', 'inventario', mapInventario, INVENTARIO_SEED),
      loadModule('clientes', 'clientes', mapCliente, CLIENTES_SEED),
      loadMmpp(COMPRAS_MMPP_SEED),
      loadModule('pagos', 'pagos', mapPago, PAGOS_SEED),
      loadModule('flujo', 'flujo', mapFlujoRow, FLUJO_SEED),
    ]);

    const i = iR.data;
    if (prevInventarioRef.current) {
      const prevById: Record<string, InventarioItem> = {};
      prevInventarioRef.current.forEach((item) => { prevById[item.id] = item; });
      const newEvents: Alert[] = [];
      i.forEach((item) => {
        const prev = prevById[item.id];
        if (!prev) {
          newEvents.push({ id: 'evt-new-' + item.id + '-' + Date.now(), tipo: 'info', area: 'Inventario', texto: `Nuevo producto agregado: ${item.producto}` });
        } else if (prev.cantidad === 0 && Number(item.cantidad) > 0) {
          newEvents.push({ id: 'evt-restock-' + item.id + '-' + Date.now(), tipo: 'info', area: 'Inventario', texto: `Se repuso stock de ${item.producto} (${item.cantidad} ${item.unidad})` });
        }
      });
      if (newEvents.length) setInventoryEvents((old) => [...newEvents, ...old].slice(0, 8));
    }
    prevInventarioRef.current = i;

    setVentas(vR.data); setComisiones(cR.data); setInventario(i); setClientes(clR.data);
    setMmpp(mR.data); setPagos(pR.data); setFlujo(fR.data);

    const sources = [vR.source, cR.source, iR.source, clR.source, mR.source, pR.source, fR.source];
    if (sources.every((s) => s === 'live')) setConnectionStatus('live');
    else if (sources.some((s) => s === 'live')) setConnectionStatus('partial');
    else setConnectionStatus('offline');

    setLastSync(new Date());
    if (isInitial) setLoading(false);
  }, []);

  useEffect(() => {
    refreshAll(true);
    const poll = setInterval(() => refreshAll(false), 10000);
    const tick = setInterval(() => forceTick((x) => x + 1), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [refreshAll]);

  useEffect(() => {
    if (role === 'trabajador' && MENU_ADMIN.some((m) => m.id === active)) setActive('ventas');
  }, [role, active]);

  const alerts = useMemo<Alert[]>(() => {
    const list: Alert[] = [];
    ventas.forEach((v) => {
      if (v.estado !== 'Pagada') {
        const d = daysUntil(v.fechaVencimiento);
        if (d !== null && d <= 7) {
          const ref = v.documento ? `Doc. ${v.documento} de ${v.cliente}` : `Venta a ${v.cliente}`;
          list.push({
            id: 'venta-' + v.id,
            tipo: d < 0 ? 'danger' : 'warning',
            area: 'Ventas',
            texto: d < 0 ? `${ref} vencida hace ${Math.abs(d)} día(s)` : `${ref} vence en ${d} día(s)`,
          });
        }
      }
    });
    inventario.forEach((p) => {
      if (p.cantidad === 0) {
        list.push({ id: 'stock0-' + p.id, tipo: 'danger', area: 'Inventario', texto: `${p.producto} está sin stock` });
      }
    });
    if (role === 'gerencia') {
      mmpp.forEach((nota) => {
        (nota.boletos || []).forEach((b, idx) => {
          if (b.estado !== 'Pagado') {
            const d = daysUntil(b.fechaVencimiento);
            if (d !== null && d <= 7) {
              list.push({
                id: `mmpp-${nota.id}-${idx}`,
                tipo: d < 0 ? 'danger' : 'warning',
                area: 'Compras',
                texto: d < 0
                  ? `Boleto ${idx + 1} de ${nota.proveedor} (Nota ${nota.notaFiscal}) vencido hace ${Math.abs(d)} día(s) — ${formatCurrency(b.valor)}`
                  : `Boleto ${idx + 1} de ${nota.proveedor} (Nota ${nota.notaFiscal}) vence en ${d} día(s) — ${formatCurrency(b.valor)}`,
              });
            }
          }
        });
      });
    }
    return [...list, ...inventoryEvents];
  }, [ventas, inventario, mmpp, role, inventoryEvents]);

  const renderModule = (): ReactNode => {
    switch (active) {
      case 'ventas': return <VentasView ventas={ventas} />;
      case 'comisiones': return <ComisionesView comisiones={comisiones} />;
      case 'inventario': return <InventarioView inventario={inventario} />;
      case 'clientes': return <ClientesView clientes={clientes} />;
      case 'mmpp': return role === 'gerencia' ? <MmppView mmpp={mmpp} /> : null;
      case 'pagos': return role === 'gerencia' ? <PagosView pagos={pagos} /> : null;
      case 'flujo': return role === 'gerencia' ? <FlujoCajaView flujo={flujo} /> : null;
      case 'estadisticas': return role === 'gerencia' ? <EstadisticasView ventas={ventas} inventario={inventario} pagos={pagos} /> : null;
      default: return null;
    }
  };

  if (!session) {
    return <AuthScreen onAuthenticated={setSession} />;
  }

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }} className="flex text-sm">
      <Sidebar active={active} setActive={setActive} role={role} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar role={role} onLogout={() => setSession(null)} alerts={alerts} notifOpen={notifOpen} setNotifOpen={setNotifOpen} lastSync={lastSync} connectionStatus={connectionStatus} />
        <main className="flex-1 overflow-auto p-6">
          {loading ? <LoadingState /> : renderModule()}
        </main>
      </div>
    </div>
  );
}
