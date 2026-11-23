export interface NubankTransaction {
  date: Date;
  rawDate: string;
  description: string;
  amount: number;
  isPayment: boolean;
  installmentNumber?: number;
  installmentCount?: number;
}

export interface NubankParseResult {
  isNubank: boolean;
  transactions: NubankTransaction[];
}

/**
 * Parser para arquivo CSV de fatura exportado pelo aplicativo Nubank
 * Formato padrão:
 * date,title,amount
 * 2026-11-19,NuTag*EOF8G87,"5,70"
 * 2026-11-06,Pagamento recebido,"- 7.794,31"
 */
export function parseNubankCsv(bufferOrText: Buffer | string): NubankParseResult {
  let text = typeof bufferOrText === 'string' ? bufferOrText : bufferOrText.toString('utf-8');

  // Fallback se contiver caracteres corrompidos
  if (text.includes('\uFFFD') && Buffer.isBuffer(bufferOrText)) {
    text = bufferOrText.toString('latin1');
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) {
    return { isNubank: false, transactions: [] };
  }

  // Verificar o cabeçalho (date,title,amount)
  const header = lines[0].toLowerCase().replace(/\s/g, '');
  const hasDate = header.includes('date') || header.includes('data');
  const hasTitle = header.includes('title') || header.includes('titulo') || header.includes('descri');
  const hasAmount = header.includes('amount') || header.includes('valor');

  if (!hasDate || !hasTitle || !hasAmount) {
    return { isNubank: false, transactions: [] };
  }

  const transactions: NubankTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.match(/(?:[^,"]+|"[^"]*")+/g);
    if (!parts || parts.length < 3) continue;

    const rawDate = parts[0].trim();
    const description = parts[1].replace(/^"|"$/g, '').trim();
    const rawAmount = parts[2].replace(/^"|"$/g, '').trim();

    if (!rawDate || !description || !rawAmount) continue;

    // Converter valor brasileiro ("5,70" -> 5.70, "- 7.794,31" -> -7794.31)
    const cleanedAmount = rawAmount.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
    const amountVal = parseFloat(cleanedAmount);
    if (isNaN(amountVal)) continue;

    // Parse de data segura ao meio-dia UTC
    const dateParts = rawDate.split('-');
    let dateObj: Date;
    if (dateParts.length === 3) {
      const [y, m, d] = dateParts.map(Number);
      dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    } else {
      dateObj = new Date(rawDate);
    }

    if (isNaN(dateObj.getTime())) continue;

    const isPayment = description.toLowerCase().includes('pagamento') || amountVal < 0;

    // Extrair parcelamento (ex: "Parcela 1/5")
    let installmentNumber: number | undefined;
    let installmentCount: number | undefined;
    const instMatch = description.match(/parcela\s+(\d+)\/(\d+)/i);
    if (instMatch) {
      installmentNumber = parseInt(instMatch[1], 10);
      installmentCount = parseInt(instMatch[2], 10);
    }

    transactions.push({
      date: dateObj,
      rawDate,
      description,
      amount: Math.abs(amountVal),
      isPayment,
      installmentNumber,
      installmentCount,
    });
  }

  return {
    isNubank: transactions.length > 0,
    transactions,
  };
}
