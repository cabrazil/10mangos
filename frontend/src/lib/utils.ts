import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, currency: string = "BRL") {
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function parseCurrencyInput(value: string): number {
  if (!value) return 0;
  const trimmed = value.trim();
  // Se contiver vírgula e ponto (ex: "1,234.56" - padrão US ou "1.234,56" - padrão BR)
  if (trimmed.includes(",") && trimmed.includes(".")) {
    const lastComma = trimmed.lastIndexOf(",");
    const lastDot = trimmed.lastIndexOf(".");
    if (lastComma > lastDot) {
      // Padrão BR: 1.234,56 -> tira pontos, troca vírgula por ponto
      return parseFloat(trimmed.replace(/\./g, "").replace(",", "."));
    } else {
      // Padrão US: 1,234.56 -> tira vírgulas
      return parseFloat(trimmed.replace(/,/g, ""));
    }
  }
  // Se contiver apenas vírgula (ex: "1234,56") -> troca por ponto
  if (trimmed.includes(",")) {
    return parseFloat(trimmed.replace(",", "."));
  }
  // Se contiver apenas ponto ou apenas dígitos (ex: "1234.56" ou "1234") -> direto parseFloat
  return parseFloat(trimmed);
}

export function formatDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "";
  try {
    const str = typeof dateInput === "string" ? dateInput : (dateInput instanceof Date && !isNaN(dateInput.getTime()) ? dateInput.toISOString() : String(dateInput));
    const datePart = str.split("T")[0];
    const [year, month, day] = datePart.split("-");
    if (!year || !month || !day) return "";
    return `${day}/${month}/${year}`;
  } catch {
    return "";
  }
}

export function computeShiftedDate(currentDateStr: string, delta: -1 | 1): string {
  if (!currentDateStr) {
    const now = new Date();
    return now.toISOString().split("T")[0];
  }
  const dStr = currentDateStr.split("T")[0];
  const [y, m, d] = dStr.split("-").map(Number);

  if (delta === 1) {
    // Se estiver no final do mês (dia 28 a 31), mover para o mês seguinte coloca no dia 01 do próximo mês
    // (ideal para compras de final de ciclo de fatura de cartão)
    if (d >= 28) {
      const nextM = m === 12 ? 1 : m + 1;
      const nextY = m === 12 ? y + 1 : y;
      return `${nextY}-${String(nextM).padStart(2, "0")}-01`;
    } else {
      const nextM = m === 12 ? 1 : m + 1;
      const nextY = m === 12 ? y + 1 : y;
      const maxDays = new Date(nextY, nextM, 0).getDate();
      const finalD = Math.min(d, maxDays);
      return `${nextY}-${String(nextM).padStart(2, "0")}-${String(finalD).padStart(2, "0")}`;
    }
  } else {
    // delta === -1: se estiver no início do mês (dia 1 a 3), coloca no último dia do mês anterior
    if (d <= 3) {
      const prevM = m === 1 ? 12 : m - 1;
      const prevY = m === 1 ? y - 1 : y;
      const lastDay = new Date(prevY, prevM, 0).getDate();
      return `${prevY}-${String(prevM).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    } else {
      const prevM = m === 1 ? 12 : m - 1;
      const prevY = m === 1 ? y - 1 : y;
      const maxDays = new Date(prevY, prevM, 0).getDate();
      const finalD = Math.min(d, maxDays);
      return `${prevY}-${String(prevM).padStart(2, "0")}-${String(finalD).padStart(2, "0")}`;
    }
  }
}
