import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, currency: string = "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(value);
}

export function formatDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "";
  const str = typeof dateInput === "string" ? dateInput : dateInput.toISOString();
  const datePart = str.split("T")[0];
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
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
